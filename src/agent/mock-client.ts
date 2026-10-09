// ─────────────────────────────────────────────────────────────
// 목(mock) 모드용 가짜 Claude 클라이언트. `.env`에 USE_MOCK_AGENT=true를 넣으면 이걸 씁니다.
//
// ⭐ 왜 필요한가?
//   API 키 없이(=돈 안 내고) 에이전트 전체 흐름을 직접 돌려보기 위해서입니다.
//   "모델"만 가짜고 나머지는 전부 진짜입니다: 에이전트 루프, 도구 실행(실제 DB), 승인 단계, SSE 스트리밍.
//
// 동작 방식: 마지막 메시지를 보고 정해진 규칙(키워드)대로 답합니다. 진짜 모델처럼 이해하지는 못합니다.
//   - 사용자 글   → 키워드에 맞는 도구 요청(tool_use)을 돌려줌
//   - 도구 결과   → 결과를 사람이 읽을 문장으로 요약해서 돌려줌(end_turn)
//
// AgentService가 쓰는 부분(beta.messages.stream → on("text") / finalMessage())만 흉내 냅니다.
// ─────────────────────────────────────────────────────────────
import Anthropic from "@anthropic-ai/sdk";

type Block = Anthropic.Beta.BetaContentBlock;
type MockMessage = Pick<Anthropic.Beta.BetaMessage, "content" | "stop_reason" | "usage">;

const usage = { input_tokens: 0, output_tokens: 0 } as Anthropic.Beta.BetaUsage;
let toolUseSeq = 0;

export const MOCK_HELP = `[목 모드] 실제 AI 대신 정해진 규칙으로 답합니다. 이렇게 말해보세요:
- "전시회 목록 보여줘"
- "1번 전시회 알려줘"
- "1번 전시회 부스 2개 신청할게요 hong@example.com"
- "신청 3번 조회"`;

export function createMockClient(): Anthropic {
  const client = {
    beta: {
      messages: {
        stream: (params: { messages: Anthropic.Beta.BetaMessageParam[] }, options?: { signal?: AbortSignal }) => {
          const message = reply(params.messages);
          let onText: (delta: string) => void = () => {};
          return {
            on: (event: string, cb: (delta: string) => void) => {
              if (event === "text") onText = cb;
            },
            // 진짜 스트리밍처럼 글자를 조금씩 흘려보낸 뒤 완성된 메시지를 돌려줍니다.
            finalMessage: async () => {
              for (const block of message.content) {
                if (block.type !== "text") continue;
                for (let i = 0; i < block.text.length; i += 3) {
                  if (options?.signal?.aborted) throw new Error("aborted");
                  onText(block.text.slice(i, i + 3));
                  await new Promise((r) => setTimeout(r, 15));
                }
              }
              return message;
            },
          };
        },
      },
    },
  };
  // AgentService는 Anthropic 타입을 기대하므로, 쓰는 부분만 구현한 객체를 그 타입으로 취급합니다.
  return client as unknown as Anthropic;
}

function reply(messages: Anthropic.Beta.BetaMessageParam[]): MockMessage {
  const last = messages.at(-1)!;
  if (typeof last.content === "string") return replyToUser(last.content);

  // 도구 결과가 돌아온 경우: 직전 assistant 메시지에서 tool_use를 찾아 어떤 도구였는지 알아냅니다.
  const results = last.content.filter((b): b is Anthropic.Beta.BetaToolResultBlockParam => b.type === "tool_result");
  if (results.length === 0) return endTurn(MOCK_HELP);
  const prev = messages.at(-2);
  const toolUses = Array.isArray(prev?.content) ? prev.content : [];
  const lines = results.map((r) => {
    const toolUse = toolUses.find((b) => b.type === "tool_use" && b.id === r.tool_use_id);
    const name = toolUse?.type === "tool_use" ? toolUse.name : "";
    return summarize(name, typeof r.content === "string" ? r.content : "", r.is_error ?? false);
  });
  return endTurn(lines.join("\n\n"));
}

function replyToUser(text: string): MockMessage {
  const num = (re: RegExp) => {
    const m = text.match(re);
    return m ? Number(m[1]) : undefined;
  };
  const id = num(/(\d+)\s*번/) ?? num(/(\d+)/);

  if (text.includes("신청") && text.includes("조회") && id !== undefined) {
    return toolCall(`신청 ${id}번을 조회해 볼게요.`, "get_application", { applicationId: id });
  }
  if (text.includes("신청") && id !== undefined) {
    // 진짜 모델이라면 빠진 정보를 되물어야 하지만, 목 모드는 흐름 확인용이라 빈 값은 예시 값으로 채웁니다.
    const input = {
      exhibitionId: id,
      companyName: "목업상사",
      contactName: "홍길동",
      contactEmail: text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? "mock@example.com",
      boothCount: num(/(\d+)\s*개/) ?? 1,
    };
    return toolCall(
      `${id}번 전시회에 부스 ${input.boothCount}개를 신청할게요. (회사명 ${input.companyName}, 담당자 ${input.contactName}, ${input.contactEmail})\n승인하시면 신청이 진행됩니다.`,
      "create_application",
      input,
    );
  }
  if (id !== undefined) {
    return toolCall(`${id}번 전시회 정보를 조회해 볼게요.`, "get_exhibition", { exhibitionId: id });
  }
  if (/목록|전시/.test(text)) {
    return toolCall("전시회 목록을 조회해 볼게요.", "list_exhibitions", {});
  }
  return endTurn(MOCK_HELP);
}

function summarize(name: string, content: string, isError: boolean): string {
  if (isError) return `요청을 처리하지 못했어요: ${content}`;
  const data = JSON.parse(content);
  switch (name) {
    case "list_exhibitions":
      return (data as ExhibitionView[]).map(describeExhibition).join("\n") || "신청 가능한 전시회가 없어요.";
    case "get_exhibition":
      return describeExhibition(data);
    case "create_application":
      return `신청이 접수됐어요. 신청 번호 ${data.id}번, 금액 ${won(data.totalPrice)}, 상태 ${data.status}`;
    case "get_application":
      return `신청 ${data.id}번: ${data.companyName}, 부스 ${data.boothCount}개, ${won(data.totalPrice)}, 상태 ${data.status}`;
    default:
      return content;
  }
}

type ExhibitionView = { id: number; name: string; boothPrice: number; remainingBooths: number; isOpen: boolean };

const describeExhibition = (e: ExhibitionView) =>
  `${e.id}번 ${e.name}: 부스 ${won(e.boothPrice)}, 남은 부스 ${e.remainingBooths}개${e.isOpen ? "" : " (마감)"}`;

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const endTurn = (text: string): MockMessage => ({
  content: [{ type: "text", text } as Block],
  stop_reason: "end_turn",
  usage,
});

const toolCall = (text: string, name: string, input: unknown): MockMessage => ({
  content: [
    { type: "text", text } as Block,
    { type: "tool_use", id: `mock_toolu_${++toolUseSeq}`, name, input } as Block,
  ],
  stop_reason: "tool_use",
  usage,
});
