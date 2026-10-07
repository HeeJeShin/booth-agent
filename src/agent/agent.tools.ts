// ─────────────────────────────────────────────────────────────
// AI 에이전트가 쓸 수 있는 "도구" 목록과, 도구를 실제로 실행하는 코드.
//
// ⭐ 에이전트(도구 호출)의 기본 원리
//   1) 서버가 Claude에게 "이런 도구들이 있어"라고 이름·설명·입력 스키마를 알려줍니다.
//   2) Claude는 직접 실행하지 않습니다. "이 도구를 이 입력으로 불러줘"라는 요청(tool_use)만 돌려줍니다.
//   3) 실제 실행은 우리 서버가 합니다. 결과(tool_result)를 다시 Claude에게 보내면 이어서 답합니다.
//   → 그래서 "AI가 뭘 할 수 있는가"의 경계는 전부 서버가 쥐고 있습니다. 여기가 보안의 핵심.
//
// ⚠️ 도구 입력은 "AI가 만든 값 = 믿을 수 없는 외부 입력"입니다.
//    사용자 폼 입력과 똑같이 DTO로 검증한 뒤에만 서비스에 넘깁니다.
// ─────────────────────────────────────────────────────────────
import Anthropic from "@anthropic-ai/sdk";
import { HttpException, Injectable } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ApplicationsService } from "../applications/applications.service";
import { CreateApplicationDto } from "../applications/dto/create-application.dto";
import { ExhibitionsService } from "../exhibitions/exhibitions.service";

// 도구 설명(description)은 Claude가 "언제 이 도구를 쓸지" 판단하는 유일한 근거입니다.
// 사람에게 API 문서를 쓰듯 구체적으로 적을수록 호출이 정확해집니다.
//
// eager_input_streaming: 스트리밍 응답에서 도구 입력을 생성되는 대로 바로 흘려보내게 합니다.
// 대신 서버(Anthropic) 쪽 입력 검증이 꺼지므로 → 아래 runTool에서 우리가 반드시 검증합니다.
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_exhibitions",
    description:
      "참가 신청 가능한 전시회 목록을 조회합니다. 각 전시회의 id, 이름, 장소, 일정, 부스 가격(원), 남은 부스 수(remainingBooths), 신청 가능 여부(isOpen)를 돌려줍니다. 사용자가 전시회 이름만 말하면 먼저 이 도구로 id를 찾으세요.",
    input_schema: { type: "object", properties: {}, required: [] },
    eager_input_streaming: true,
  },
  {
    name: "get_exhibition",
    description: "전시회 1개의 상세 정보와 현재 남은 부스 수를 조회합니다.",
    input_schema: {
      type: "object",
      properties: { exhibitionId: { type: "integer", description: "전시회 ID" } },
      required: ["exhibitionId"],
    },
    eager_input_streaming: true,
  },
  {
    name: "create_application",
    description:
      "전시회 부스 참가 신청을 생성합니다. 회사명·담당자명·담당자 이메일·부스 수를 모두 사용자에게 확인받은 뒤에만 호출하세요. 값을 추측해서 채우지 마세요. 이 도구는 실행 전에 사용자 승인 단계를 거칩니다.",
    input_schema: {
      // DTO(CreateApplicationDto)와 필드 이름을 똑같이 맞춰서, 같은 검증 규칙을 그대로 재사용합니다.
      type: "object",
      properties: {
        exhibitionId: { type: "integer" },
        companyName: { type: "string" },
        contactName: { type: "string" },
        contactEmail: { type: "string", description: "이메일 형식" },
        boothCount: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["exhibitionId", "companyName", "contactName", "contactEmail", "boothCount"],
    },
    eager_input_streaming: true,
  },
  {
    name: "get_application",
    description: "신청 번호로 참가 신청 내역(상태, 금액 등)을 조회합니다.",
    input_schema: {
      type: "object",
      properties: { applicationId: { type: "integer" } },
      required: ["applicationId"],
    },
    eager_input_streaming: true,
  },
];

// 데이터를 "바꾸는" 도구. 이런 도구는 AI가 바로 실행하지 않고 사람 승인을 받습니다(Human-in-the-loop).
// ⚠️ "실행 전에 꼭 물어봐"를 프롬프트에만 적어두면 모델이 가끔 건너뛸 수 있습니다.
//    그래서 승인 단계는 프롬프트가 아니라 서버 코드로 강제합니다.
export const WRITE_TOOLS = new Set(["create_application"]);

export type ToolOutcome = { content: string; isError: boolean };

@Injectable()
export class AgentTools {
  constructor(
    private readonly exhibitions: ExhibitionsService,
    private readonly applications: ApplicationsService,
  ) {}

  async run(name: string, input: unknown): Promise<ToolOutcome> {
    try {
      switch (name) {
        case "list_exhibitions":
          return ok(await this.exhibitions.findAll());
        case "get_exhibition":
          return ok(await this.exhibitions.findOne(requireInt(input, "exhibitionId")));
        case "get_application":
          return ok(await this.applications.findOne(requireInt(input, "applicationId")));
        case "create_application": {
          // ⭐ REST API(POST /applications)와 "같은 DTO"로 검증합니다.
          //   plainToInstance: 평범한 객체 → DTO 클래스 인스턴스 (데코레이터 규칙이 붙은 상태)
          //   validate: 그 규칙대로 검사해서 위반 목록을 돌려줌
          const dto = plainToInstance(CreateApplicationDto, input);
          const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
          if (errors.length > 0) {
            const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
            // 에러를 감추지 않고 Claude에게 그대로 돌려주면, 모델이 사용자에게 다시 물어보거나 값을 고칩니다.
            return fail(`입력값 검증 실패: ${messages.join(", ")}`);
          }
          return ok(await this.applications.create(dto));
        }
        default:
          return fail(`알 수 없는 도구: ${name}`);
      }
    } catch (err) {
      // 서비스가 던진 404/409 같은 업무 에러는 is_error 결과로 Claude에게 알려줍니다.
      // (예: "남은 부스가 3개라 5개를 신청할 수 없습니다" → 모델이 사용자에게 설명)
      if (err instanceof HttpException) return fail(err.message);
      throw err; // DB 장애 같은 예상 밖 에러는 숨기지 않고 위로 올립니다.
    }
  }
}

const ok = (data: unknown): ToolOutcome => ({ content: JSON.stringify(data), isError: false });
const fail = (message: string): ToolOutcome => ({ content: message, isError: true });

// 간단한 조회 도구용 검증. AI가 "1" 같은 문자열이나 빈 값을 보낼 수도 있으니 확인합니다.
function requireInt(input: unknown, key: string): number {
  const value = (input as Record<string, unknown> | null)?.[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HttpException(`${key}는 정수여야 합니다.`, 400);
  }
  return value;
}
