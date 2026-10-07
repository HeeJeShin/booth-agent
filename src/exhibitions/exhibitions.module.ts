import { Module } from "@nestjs/common";
import { ExhibitionsController } from "./exhibitions.controller";
import { ExhibitionsService } from "./exhibitions.service";

@Module({
  controllers: [ExhibitionsController],
  providers: [ExhibitionsService],
  exports: [ExhibitionsService], // 에이전트 모듈에서 이 서비스를 쓰려고 내보냅니다.
})
export class ExhibitionsModule {}
