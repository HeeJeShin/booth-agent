// ─────────────────────────────────────────────────────────────
// ⭐ 에이전트 루프 (이 프로젝트의 심장)
//
//   사용자 메시지 추가
//     └─▶ Claude 호출 ──▶ stop_reason 확인
//            ├─ "end_turn"  : 답변 끝 → 종료
//            ├─ "tool_use"  : 도구 실행 → 결과를 대화에 추가 → 다시 Claude 호출 (반복)
//            │                 └ 쓰기 도구면 실행하지 않고 "승인 대기"로 멈춤
//            └─ 그 외       : 거절(refusal), 토큰 한도(max_tokens) 등 → 에러로 처리
//
// SDK에는 이 루프를 대신 돌려주는 Tool Runner도 있지만, 원리를 배우려고 직접 짰습니다.
// ─────────────────────────────────────────────────────────────
import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { AgentTools, TOOLS, WRITE_TOOLS } from "./agent.tools";
import { Conversation } from "./conversation.store";
import { SYSTEM_PROMPT } from "./system-prompt";

// 화면(SSE)으로 내보내는 이벤트 종류
export type AgentEvent =
  | { type: "text"; delta: string } //                         답변 글자가 생성되는 대로
  | { type: "tool"; name: string; input: unknown; isError: boolean } // 도구를 실행했음
  | { type: "approval_required"; name: string; input: unknown } //   사람 승인이 필요함
  | { type: "done" }
  | { type: "error"; message: string };

const MODEL = "claude-opus-5-5";
// ⚠️ 무한 루프 방지. 모델이 도구를 계속 부르면 그만큼 비용이 나갑니다. 상한을 꼭 두세요.
const MAX_STEPS = 8;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private client?: Anthropic;

  constructor(private readonly tools: AgentTools) {}

  // API 키가 없어도 REST API는 돌아가도록, Claude 클라이언트는 처음 쓸 때 만듭니다.
  private getClient(): Anthropic {
    if (!this.client && !process.env.ANTHROPIC_API_KEY) {
      throw new Error(".env에 ANTHROPIC_API_KEY를 넣고 서버를 다시 시작해주세요.");
    }
    // new Anthropic()은 환경변수 ANTHROPIC_API_KEY를 자동으로 읽습니다. 키를 코드에 직접 쓰지 마세요.
    return (this.client ??= new Anthropic());
  }

  /** 사용자 메시지로 한 턴을 진행합니다. */
  async chat(conversation: Conversation, message: string, emit: (e: AgentEvent) => void, signal: AbortSignal) {
    conversation.messages.push({ role: "user", content: message });
    await this.loop(conversation, emit, signal);
  }

  /** 승인 대기 중이던 쓰기 도구를 실행(또는 거절)하고 대화를 이어갑니다. */
  async resolveApproval(
    conversation: Conversation,
    decision: "approve" | "reject",
    emit: (e: AgentEvent) => void,
    signal: AbortSignal,
  ) {
    const pending = conversation.pending!;
    conversation.pending = undefined;

    let result: Anthropic.Beta.BetaToolResultBlockParam;
    if (decision === "approve") {
      const outcome = await this.tools.run(pending.toolUse.name, pending.toolUse.input);
      emit({ type: "tool", name: pending.toolUse.name, input: pending.toolUse.input, isError: outcome.isError });
      result = { type: "tool_result", tool_use_id: pending.toolUse.id, content: outcome.content, is_error: outcome.isError };
    } else {
      // 거절도 "결과"로 돌려줘야 합니다. tool_use에 대응하는 tool_result가 빠지면 다음 요청이 400 에러가 납니다.
      result = { type: "tool_result", tool_use_id: pending.toolUse.id, content: "사용자가 신청을 승인하지 않았습니다.", is_error: true };
    }

    // ⚠️ 한 턴에서 요청된 도구 결과들은 반드시 "하나의 user 메시지"에 모아서 보냅니다.
    conversation.messages.push({ role: "user", content: [...pending.otherResults, result] });
    await this.loop(conversation, emit, signal);
  }

  private async loop(conversation: Conversation, emit: (e: AgentEvent) => void, signal: AbortSignal) {
    for (let step = 0; step < MAX_STEPS; step++) {
      // ── 1. Claude 호출 (스트리밍) ──────────────────────────────
      // stream(): 응답을 한 번에 기다리지 않고 생성되는 대로 받습니다. 채팅 UI에서 글자가 타이핑되듯 보이는 원리.
      const stream = this.getClient().beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: conversation.messages,
          // 생각(추론)의 깊이. 상담 대화라 medium이면 충분합니다. 높일수록 느리고 비쌉니다.
          output_config: { effort: "medium" },
          // 모델이 안전 정책으로 답을 거절할 때, 서버가 대체 모델로 자동 재시도하게 하는 옵션.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        // 사용자가 브라우저를 닫으면 Claude 호출도 끊어서 쓸데없는 비용을 막습니다.
        { signal },
      );

      // 텍스트 조각이 올 때마다 바로 화면으로 흘려보냅니다.
      stream.on("text", (delta) => emit({ type: "text", delta }));

      let response: Anthropic.Beta.BetaMessage;
      try {
        // finalMessage(): 스트림이 끝나면 완성된 전체 메시지를 돌려줍니다(stop_reason, tool_use 블록 포함).
        response = await stream.finalMessage();
      } catch (err) {
        // 인증 실패, 요청 한도 초과 같은 API 에러는 타입별로 구분해서 처리합니다(문자열 비교 X).
        if (err instanceof Anthropic.AuthenticationError) throw new Error("ANTHROPIC_API_KEY가 올바르지 않습니다.");
        if (err instanceof Anthropic.RateLimitError) throw new Error("요청이 많아 잠시 후 다시 시도해주세요.");
        throw err;
      }
      this.logger.debug(`step ${step} stop_reason=${response.stop_reason} usage=${JSON.stringify(response.usage)}`);

      // ── 2. 응답을 대화 기록에 추가 ──────────────────────────────
      // ⚠️ 텍스트만 뽑아서 넣지 말고 content 전체(텍스트+도구 요청+thinking 블록)를 그대로 넣어야 합니다.
      conversation.messages.push({ role: "assistant", content: response.content });

      // ── 3. 멈춘 이유(stop_reason)에 따라 분기 ───────────────────
      if (response.stop_reason === "end_turn") {
        emit({ type: "done" });
        return;
      }
      if (response.stop_reason === "refusal") {
        emit({ type: "error", message: "이 요청은 처리할 수 없습니다." });
        return;
      }
      if (response.stop_reason === "max_tokens") {
        // 도구 입력이 중간에 잘렸을 수 있으므로 절대 실행하지 않습니다.
        emit({ type: "error", message: "응답이 너무 길어 중단됐습니다." });
        return;
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) {
        emit({ type: "done" });
        return;
      }

      // ── 4. 도구 실행 ────────────────────────────────────────
      // Claude는 한 번에 여러 도구를 요청할 수 있습니다(병렬 도구 호출).
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      let pendingWrite: Anthropic.Beta.BetaToolUseBlock | undefined;

      for (const toolUse of toolUses) {
        if (WRITE_TOOLS.has(toolUse.name) && !pendingWrite) {
          // 쓰기 도구는 실행하지 않고 보류 → 사람이 승인하면 resolveApproval에서 실행.
          pendingWrite = toolUse;
          continue;
        }
        if (WRITE_TOOLS.has(toolUse.name)) {
          // 쓰기 요청이 한 턴에 두 개 이상이면 하나씩만 승인받도록 나머지는 돌려보냅니다.
          results.push({ type: "tool_result", tool_use_id: toolUse.id, content: "신청은 한 번에 하나씩 진행합니다.", is_error: true });
          continue;
        }
        const outcome = await this.tools.run(toolUse.name, toolUse.input);
        emit({ type: "tool", name: toolUse.name, input: toolUse.input, isError: outcome.isError });
        results.push({ type: "tool_result", tool_use_id: toolUse.id, content: outcome.content, is_error: outcome.isError });
      }

      if (pendingWrite) {
        conversation.pending = { toolUse: pendingWrite, otherResults: results };
        emit({ type: "approval_required", name: pendingWrite.name, input: pendingWrite.input });
        return; // 여기서 멈추고, 사용자의 승인 요청을 기다립니다.
      }

      // 결과를 user 메시지로 추가하고 다시 Claude를 부릅니다(루프 처음으로).
      conversation.messages.push({ role: "user", content: results });
    }

    emit({ type: "error", message: `도구 호출이 ${MAX_STEPS}번을 넘어 중단했습니다.` });
  }
}
