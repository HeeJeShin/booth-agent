// ─────────────────────────────────────────────────────────────
// 앱의 시작점. Express 서버를 띄우고 "모든 요청에 공통으로 적용할 것"을 여기서 설정합니다.
// ─────────────────────────────────────────────────────────────
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { join } from "path";
import { AppModule } from "./app.module";

async function bootstrap() {
  // <NestExpressApplication>: Express 전용 기능(useStaticAssets 등)을 쓰기 위한 타입 지정
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ⭐ 전역 ValidationPipe: 컨트롤러에 들어오는 body/query를 DTO 클래스 규칙으로 검사합니다.
  //  - whitelist: DTO에 없는 필드는 조용히 제거 (예: 클라이언트가 status: "CONFIRMED"를 몰래 보내도 무시)
  //  - forbidNonWhitelisted: 제거 대신 400 에러로 알려줌 → 프론트 실수를 빨리 발견
  //  - transform: 문자열 "3"을 number 3으로 바꾸는 등 DTO 타입으로 변환
  // ⚠️ 이게 없으면 DTO에 붙인 @IsInt() 같은 데코레이터는 그냥 장식일 뿐, 아무 검사도 안 합니다.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // 프론트(Next.js, 다른 포트)에서 호출할 수 있도록 CORS 허용. 운영에선 origin을 꼭 좁히세요.
  app.enableCors({ origin: ["http://localhost:3001"] });

  // Swagger: 컨트롤러와 DTO를 읽어서 API 문서를 자동 생성 → http://localhost:3100/docs
  // 백엔드와 "API 설계를 같이 논의"할 때 이 화면을 띄워놓고 얘기하면 됩니다.
  const config = new DocumentBuilder()
    .setTitle("Booth Agent API")
    .setDescription("전시 부스 참가신청 API + AI 에이전트")
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config));

  // public/ 폴더의 파일을 그대로 서빙 → 에이전트 테스트 화면 http://localhost:3100/playground.html
  app.useStaticAssets(join(__dirname, "..", "public"));

  await app.listen(process.env.PORT ?? 3100);
}
bootstrap();
