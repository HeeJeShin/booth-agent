// ─────────────────────────────────────────────────────────────
// DTO(Data Transfer Object) = "이 API에 어떤 모양의 데이터가 들어와야 하는가"의 규칙.
// 프론트의 zod 스키마와 같은 역할을 서버에서 합니다.
//
// ⭐ 이 프로젝트에서 가장 중요한 파일 중 하나:
// 사람이 REST로 보낸 요청이든, AI가 도구 호출로 만든 요청이든 "같은 DTO"로 검사합니다.
// → AI 출력을 서버 규칙으로 검증하는 구조(하네스). AI가 이상한 값을 만들어도 DB까지 못 갑니다.
// ─────────────────────────────────────────────────────────────
import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from "class-validator";

export class CreateApplicationDto {
  @ApiProperty({ example: 1, description: "신청할 전시회 ID" })
  @IsInt()
  @Min(1)
  exhibitionId: number;

  @ApiProperty({ example: "그린에너텍" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  companyName: string;

  @ApiProperty({ example: "홍길동" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  contactName: string;

  @ApiProperty({ example: "hong@example.com" })
  @IsEmail()
  contactEmail: string;

  // 한 회사가 부스를 너무 많이 잡지 못하게 상한을 둡니다(업무 규칙).
  @ApiProperty({ example: 2, minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  boothCount: number;

  // ⚠️ totalPrice, status는 일부러 DTO에 없습니다.
  // 가격·상태는 서버가 정하는 값이지 클라이언트(또는 AI)가 정하는 값이 아니기 때문입니다.
  // whitelist 옵션 덕분에 누가 보내도 무시됩니다.
}
