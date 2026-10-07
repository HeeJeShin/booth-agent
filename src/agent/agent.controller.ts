// ─────────────────────────────────────────────────────────────
// POST /agent/chat — 응답을 SSE(Server-Sent Events)로 흘려보냅니다.
//
// ⭐ SSE 원리: HTTP 응답을 닫지 않고 열어둔 채, 아래 형식의 텍스트를 조금씩 계속 써 보냅니다.
//     event: text
//     data: {"delta":"안녕"}
//     (빈 줄 = 이벤트 하나 끝)
//
// ⚠️ 브라우저 기본 EventSource는 GET만 지원합니다. 본문을 보내야 하므로 POST + fetch 스트림 읽기를 씁니다.
// ⚠️ 응답 헤더(200)를 이미 보낸 뒤에는 상태코드를 바꿀 수 없습니다.
//    그래서 스트리밍 도중 에러는 HTTP 500이 아니라 "event: error"로 알려줍니다.
// ─────────────────────────────────────────────────────────────
import { BadRequestException, Body, ConflictException, Controller, Logger, NotFoundException, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AgentEvent, AgentService } from "./agent.service";
import { ConversationStore } from "./conversation.store";
import { ChatRequestDto } from "./dto/chat-request.dto";

@ApiTags("agent")
@Controller("agent")
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agent: AgentService,
    private readonly store: ConversationStore,
  ) {}

  @Post("chat")
  async chat(@Body() body: ChatRequestDto, @Req() req: Request, @Res() res: Response) {
    // ── 스트리밍 시작 전: 잘못된 요청은 일반 HTTP 에러(400/404/409)로 바로 돌려줍니다 ──
    const conversation = body.conversationId ? this.store.get(body.conversationId) : this.store.create();
    if (!conversation) throw new NotFoundException("대화를 찾을 수 없습니다.");
    if (conversation.busy) throw new ConflictException("이전 응답이 아직 진행 중입니다.");
    if (conversation.pending && !body.decision) {
      throw new BadRequestException("승인 대기 중인 신청이 있습니다. decision을 보내주세요.");
    }
    if (!conversation.pending && !body.message) throw new BadRequestException("message가 필요합니다.");

    // ── SSE 헤더 ──
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const emit = (event: AgentEvent) => {
      const { type, ...data } = event;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    // 프론트가 다음 요청에 쓸 수 있도록 대화 ID를 제일 먼저 보냅니다.
    res.write(`event: conversation\ndata: ${JSON.stringify({ conversationId: conversation.id })}\n\n`);

    // 사용자가 탭을 닫으면 Claude 호출을 중단합니다.
    const abort = new AbortController();
    req.on("close", () => abort.abort());

    conversation.busy = true;
    try {
      if (conversation.pending) {
        await this.agent.resolveApproval(conversation, body.decision!, emit, abort.signal);
      } else {
        await this.agent.chat(conversation, body.message!, emit, abort.signal);
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        this.logger.error(err);
        emit({ type: "error", message: err instanceof Error ? err.message : "알 수 없는 오류" });
      }
    } finally {
      // try/finally: 에러가 나도 busy를 풀고 응답을 닫아야 다음 요청이 막히지 않습니다.
      conversation.busy = false;
      res.end();
    }
  }
}
