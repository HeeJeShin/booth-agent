// ─────────────────────────────────────────────────────────────
// DB 접속 객체(PrismaClient)를 Nest의 "Provider"로 감싼 것.
// @Injectable()을 붙이면 Nest가 앱 전체에서 딱 1개(싱글톤)만 만들어,
// 필요한 곳의 constructor에 자동으로 넣어줍니다(의존성 주입, DI).
// ⚠️ 서비스마다 new PrismaClient()를 하면 DB 커넥션이 그만큼 늘어나 금방 고갈됩니다.
// ─────────────────────────────────────────────────────────────
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Prisma 7부터는 "드라이버 어댑터"가 필수입니다. 여기선 node-postgres(pg) 드라이버를 씁니다.
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }

  // 라이프사이클 훅: 앱이 뜰 때 연결, 꺼질 때 연결 해제.
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
