// 목 클라이언트를 진짜 AgentService 루프에 끼워서, 키 없이도 대화 → 도구 → 승인 흐름이 도는지 확인합니다.
import { describe, expect, it, vi } from "vitest";
import { AgentEvent, AgentService } from "./agent.service";
import { AgentTools } from "./agent.tools";
import { Conversation } from "./conversation.store";
import { MOCK_HELP } from "./mock-client";

function setup() {
  vi.stubEnv("USE_MOCK_AGENT", "true");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  const run = vi.fn(async (name: string) => {
    if (name === "list_exhibitions") {
      return { content: JSON.stringify([{ id: 1, name: "그린에너지 엑스포", boothPrice: 1250000, remainingBooths: 10, isOpen: true }]), isError: false };
    }
    if (name === "create_application") {
      return { content: JSON.stringify({ id: 7, totalPrice: 2500000, status: "PENDING" }), isError: false };
    }
    return { content: "없는 전시회입니다.", isError: true };
  });
  const service = new AgentService({ run } as unknown as AgentTools);
  const events: AgentEvent[] = [];
  const conversation: Conversation = { id: "c1", messages: [], busy: false };
  const emit = (e: AgentEvent) => events.push(e);
  const said = () => events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
  return { service, run, events, conversation, emit, said };
}

const signal = new AbortController().signal;

describe("목 모드", () => {
  it("API 키 없이 목록 조회 → 결과 요약까지 진행한다", async () => {
    const t = setup();

    await t.service.chat(t.conversation, "전시회 목록 보여줘", t.emit, signal);

    expect(t.run).toHaveBeenCalledWith("list_exhibitions", {});
    expect(t.said()).toContain("1번 그린에너지 엑스포: 부스 1,250,000원, 남은 부스 10개");
    expect(t.events.at(-1)).toEqual({ type: "done" });
  });

  it("신청은 승인 대기로 멈추고, 승인하면 실행한다", async () => {
    const t = setup();

    await t.service.chat(t.conversation, "1번 전시회 부스 2개 신청 hong@example.com", t.emit, signal);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.events.at(-1)).toMatchObject({
      type: "approval_required",
      input: { exhibitionId: 1, boothCount: 2, contactEmail: "hong@example.com" },
    });

    await t.service.resolveApproval(t.conversation, "approve", t.emit, signal);
    expect(t.run).toHaveBeenCalledWith("create_application", expect.objectContaining({ exhibitionId: 1 }));
    expect(t.said()).toContain("신청 번호 7번");
  });

  it("도구 에러는 이유를 그대로 전달한다", async () => {
    const t = setup();

    await t.service.chat(t.conversation, "99번 전시회 알려줘", t.emit, signal);

    expect(t.said()).toContain("요청을 처리하지 못했어요: 없는 전시회입니다.");
  });

  it("규칙에 없는 말에는 사용법을 안내한다", async () => {
    const t = setup();

    await t.service.chat(t.conversation, "안녕", t.emit, signal);

    expect(t.said()).toBe(MOCK_HELP);
    expect(t.run).not.toHaveBeenCalled();
  });
});
