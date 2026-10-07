// AI가 만든 도구 입력이 서버 규칙(DTO)을 어기면, DB에 닿기 전에 막히는지 확인합니다.
import { describe, expect, it, vi } from "vitest";
import { ApplicationsService } from "../applications/applications.service";
import { ExhibitionsService } from "../exhibitions/exhibitions.service";
import { AgentTools } from "./agent.tools";

function setup() {
  const create = vi.fn(async (dto: unknown) => ({ id: 1, ...(dto as object) }));
  const tools = new AgentTools(
    {} as ExhibitionsService,
    { create } as unknown as ApplicationsService,
  );
  return { tools, create };
}

const valid = {
  exhibitionId: 1,
  companyName: "그린에너텍",
  contactName: "홍길동",
  contactEmail: "hong@example.com",
  boothCount: 2,
};

describe("AgentTools.create_application", () => {
  it("올바른 입력이면 서비스를 호출한다", async () => {
    const { tools, create } = setup();
    const result = await tools.run("create_application", valid);
    expect(result.isError).toBe(false);
    expect(create).toHaveBeenCalledOnce();
  });

  it("이메일 형식이 틀리면 서비스를 호출하지 않고 에러를 돌려준다", async () => {
    const { tools, create } = setup();
    const result = await tools.run("create_application", { ...valid, contactEmail: "모름" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("contactEmail");
    expect(create).not.toHaveBeenCalled();
  });

  it("AI가 가격이나 상태를 끼워 넣어도 거절한다", async () => {
    const { tools, create } = setup();
    const result = await tools.run("create_application", { ...valid, totalPrice: 0, status: "CONFIRMED" });
    expect(result.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("부스 수 상한(10개)을 넘으면 거절한다", async () => {
    const { tools, create } = setup();
    const result = await tools.run("create_application", { ...valid, boothCount: 50 });
    expect(result.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});
