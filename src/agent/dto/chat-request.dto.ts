import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

// POST /agent/chat 요청 본문.
//  - 새 대화: { message }
//  - 이어서 대화: { conversationId, message }
//  - 승인 대기 중인 신청에 답하기: { conversationId, decision: "approve" | "reject" }
export class ChatRequestDto {
  @ApiPropertyOptional({ description: "없으면 새 대화를 시작합니다." })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({ example: "그린에너지 엑스포에 부스 2개 신청하고 싶어요" })
  @IsOptional()
  @IsString()
  // 입력 길이 제한 = 비용 제한. 긴 입력은 그대로 토큰(=돈)이 됩니다.
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ enum: ["approve", "reject"] })
  @IsOptional()
  @IsIn(["approve", "reject"])
  decision?: "approve" | "reject";
}
