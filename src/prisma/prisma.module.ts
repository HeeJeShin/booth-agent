import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

// @Global: 다른 모듈이 imports에 PrismaModule을 안 적어도 PrismaService를 주입받을 수 있게 합니다.
// DB처럼 "거의 모든 모듈이 쓰는 것"에만 쓰세요. 남발하면 의존 관계가 안 보이게 됩니다.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService], // exports에 있어야 바깥 모듈에서 쓸 수 있습니다.
})
export class PrismaModule {}
