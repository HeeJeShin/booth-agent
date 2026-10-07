// ─────────────────────────────────────────────────────────────
// 에이전트 루프 테스트. 실제 Claude를 부르지 않고 "가짜 응답"을 순서대로 돌려주는 클라이언트를 끼웁니다.
//
// ⭐ 왜 가짜(mock)로 테스트하나?
//   - 실제 API는 돈이 들고, 매번 답이 조금씩 달라서 테스트가 들쭉날쭉해집니다.
//   - 우리가 검증하고 싶은 건 "모델이 똑똑한가"가 아니라 "우리 루프가 규칙대로 도는가"입니다.
//     (쓰기 도구는 승인 전에 실행되지 않는가, tool_result가 빠짐없이 붙는가, 무한 루프가 막히는가)
// ─────────────────────────────────────────────────────────────
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AgentEvent, AgentService } from "./agent.service";
import { AgentTools } from "./agent.tools";
import { Conversation } from "./conversation.store";

type FakeMessage = Pick<Anthropic.Beta.BetaMessage, "content" | "stop_reason" | "usage">;

// messages.stream()을 흉내 내는 가짜 클라이언트. 호출될 때마다 준비된 응답을 하나씩 꺼냅니다.
function fakeClient(responses: FakeMessage[]) {
  const calls: Anthropic.Beta.BetaMessageParam[][] = [];
  const client = {
    beta: {
      messages: {
        stream: (params: { messages: Anthropic.Beta.BetaMessageParam[] }) => {
          calls.push(structuredClone(params.messages));
          const message = responses.shift()!;
          return {
            on: (_event: string, cb: (delta: string) => void) => {
              for (const b of message.content) if (b.type === "text") cb(b.text);
            },
            finalMessage: async () => message,
          };
        },
      },
    },
  };
  return { client, calls };
}

const usage = {} as Anthropic.Beta.BetaUsage;
const text = (t: string) => ({ type: "text", text: t }) as Anthropic.Beta.BetaContentBlock;
const toolUse = (id: string, name: string, input: unknown) =>
  ({ type: "tool_use", id, name, input }) as Anthropic.Beta.BetaContentBlock;

function setup(responses: FakeMessage[]) {
  const run = vi.fn(async (name: string) => ({ content: `${name} 결과`, isError: false }));
  const service = new AgentService({ run } as unknown as AgentTools);
  const { client, calls } = fakeClient(responses);
  (service as unknown as { client: unknown }).client = client; // getClient()가 가짜를 쓰도록
  const events: AgentEvent[] = [];
  const conversation: Conversation = { id: "c1", messages: [], busy: false };
  return { service, run, calls, events, conversation, emit: (e: AgentEvent) => events.push(e) };
}

const signal = new AbortController().signal;

describe("AgentService", () => {
  it("조회 도구는 바로 실행하고, 결과를 붙여 다시 호출한다", async () => {
    const t = setup([
      { content: [toolUse("t1", "list_exhibitions", {})], stop_reason: "tool_use", usage },
      { content: [text("전시회는 2개입니다.")], stop_reason: "end_turn", usage },
    ]);

    await t.service.chat(t.conversation, "목록 보여줘", t.emit, signal);

    expect(t.run).toHaveBeenCalledWith("list_exhibitions", {});
    // 두 번째 호출의 마지막 메시지는 tool_use에 대응하는 tool_result여야 한다.
    const lastSent = t.calls[1].at(-1)!;
    expect(lastSent.role).toBe("user");
    expect(lastSent.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "t1" }),
    ]);
    expect(t.events.at(-1)).toEqual({ type: "done" });
  });

  it("쓰기 도구는 승인 전에는 실행하지 않고 멈춘다", async () => {
    const input = { exhibitionId: 1, companyName: "A", contactName: "B", contactEmail: "a@b.com", boothCount: 2 };
    const t = setup([
      { content: [toolUse("t1", "create_application", input)], stop_reason: "tool_use", usage },
    ]);

    await t.service.chat(t.conversation, "신청해줘", t.emit, signal);

    expect(t.run).not.toHaveBeenCalled();
    expect(t.conversation.pending?.toolUse.id).toBe("t1");
    expect(t.events.at(-1)).toEqual({ type: "approval_required", name: "create_application", input });
  });

  it("거절하면 실행하지 않고 is_error 결과를 붙여 대화를 이어간다", async () => {
    const t = setup([
      { content: [toolUse("t1", "create_application", {})], stop_reason: "tool_use", usage },
      { content: [text("알겠습니다. 신청하지 않았어요.")], stop_reason: "end_turn", usage },
    ]);
    await t.service.chat(t.conversation, "신청해줘", t.emit, signal);

    await t.service.resolveApproval(t.conversation, "reject", t.emit, signal);

    expect(t.run).not.toHaveBeenCalled();
    expect(t.calls[1].at(-1)!.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "t1", is_error: true }),
    ]);
    expect(t.conversation.pending).toBeUndefined();
  });

  it("도구 호출이 끝없이 이어지면 MAX_STEPS에서 멈춘다", async () => {
    const loopForever = Array.from({ length: 20 }, (_, i) => ({
      content: [toolUse(`t${i}`, "list_exhibitions", {})],
      stop_reason: "tool_use" as const,
      usage,
    }));
    const t = setup(loopForever);

    await t.service.chat(t.conversation, "계속", t.emit, signal);

    expect(t.calls.length).toBe(8);
    expect(t.events.at(-1)).toMatchObject({ type: "error" });
  });
});
