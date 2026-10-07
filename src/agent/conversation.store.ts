// ─────────────────────────────────────────────────────────────
// 대화 기록 저장소 (지금은 메모리, 서버 재시작하면 사라짐)
//
// ⭐ Claude API는 "상태가 없습니다(stateless)".
//    이전 대화를 기억하지 못하므로, 매 요청마다 지금까지의 대화 전체(messages)를 다시 보냅니다.
//    그래서 대화 기록을 어딘가에 들고 있어야 합니다.
//
// ⚠️ 왜 클라이언트가 아니라 서버가 들고 있나?
//    대화 기록에는 tool_result(서버가 실행한 결과)가 들어 있습니다.
//    클라이언트가 기록을 보내게 하면 "신청 완료됨" 같은 가짜 결과를 끼워 넣을 수 있습니다.
//
// ⚠️ 기록은 "뒤에 덧붙이기만" 합니다(append-only). 중간 메시지를 고치거나 지우면
//    프롬프트 캐시가 깨지고, 최신 모델은 이전 추론(thinking) 블록을 무효로 처리합니다.
//
// 다음 단계: Redis나 DB 테이블로 옮기면 서버를 여러 대 띄워도, 재시작해도 대화가 유지됩니다.
// ─────────────────────────────────────────────────────────────
import Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";

// 사람 승인을 기다리는 도구 호출
export type PendingApproval = {
  toolUse: Anthropic.Beta.BetaToolUseBlock;
  // 같은 턴에 함께 요청된 조회 도구들의 결과. 승인 후 tool_result들을 "한 메시지에 모아" 보내야 해서 보관합니다.
  otherResults: Anthropic.Beta.BetaToolResultBlockParam[];
};

export type Conversation = {
  id: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  pending?: PendingApproval;
  // 같은 대화에 요청이 동시에 두 개 들어오면 기록이 꼬이므로 하나씩만 처리합니다.
  busy: boolean;
};

@Injectable()
export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>();

  create(): Conversation {
    const conversation: Conversation = { id: randomUUID(), messages: [], busy: false };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  get(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }
}
