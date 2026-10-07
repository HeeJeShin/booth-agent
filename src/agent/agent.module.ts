import { Module } from "@nestjs/common";
import { ApplicationsModule } from "../applications/applications.module";
import { ExhibitionsModule } from "../exhibitions/exhibitions.module";
import { AgentController } from "./agent.controller";
import { AgentService } from "./agent.service";
import { AgentTools } from "./agent.tools";
import { ConversationStore } from "./conversation.store";

@Module({
  // 다른 모듈이 exports한 서비스(Exhibitions/ApplicationsService)를 쓰려면 imports에 넣어야 합니다.
  // → 에이전트는 REST API와 "같은 서비스"를 호출합니다. 로직이 한 곳에만 있으니 규칙이 어긋날 일이 없습니다.
  imports: [ExhibitionsModule, ApplicationsModule],
  controllers: [AgentController],
  providers: [AgentService, AgentTools, ConversationStore],
})
export class AgentModule {}
