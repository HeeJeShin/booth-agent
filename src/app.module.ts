// ─────────────────────────────────────────────────────────────
// 루트 모듈. NestJS 앱은 "모듈"들의 트리입니다.
//   Module     = 관련 기능 묶음(폴더 단위라고 생각하면 편함)
//   Controller = HTTP 요청을 받는 입구 (라우팅만, 로직은 X)
//   Service    = 실제 비즈니스 로직 (컨트롤러·에이전트 등 여러 곳에서 재사용)
// 프론트 비유: Controller = 페이지 라우트, Service = 커스텀 훅/유틸
// ─────────────────────────────────────────────────────────────
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AgentModule } from "./agent/agent.module";
import { ApplicationsModule } from "./applications/applications.module";
import { ExhibitionsModule } from "./exhibitions/exhibitions.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    // .env를 읽어 process.env에 넣어줍니다. isGlobal이면 다른 모듈에서 다시 import 안 해도 됨.
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ExhibitionsModule,
    ApplicationsModule,
    AgentModule,
  ],
})
export class AppModule {}
