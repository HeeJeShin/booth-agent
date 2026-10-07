# Booth Agent

전시회 부스 참가신청 REST API와, 그 API를 도구로 써서 대화로 신청을 처리하는 AI 에이전트.
NestJS로 백엔드 기본기를 익히기 위한 학습용 토이 프로젝트입니다.

> 원리와 유의점은 [LEARNING.md](./LEARNING.md)에 정리돼 있고, 코드 곳곳에 주석으로도 달아 두었습니다.

## 기술 스택
NestJS 12 · TypeScript · PostgreSQL 17 · Prisma 7 · Anthropic SDK (Claude Opus 5.5) · Swagger · Vitest · Docker Compose

## 실행
```bash
pnpm install              # 의존성 설치 + Prisma Client 생성
cp .env.example .env      # ANTHROPIC_API_KEY 입력 (에이전트 기능에만 필요)
pnpm db:up                # PostgreSQL 컨테이너 실행 (Docker Desktop 필요)
pnpm db:migrate           # 테이블 생성
pnpm db:seed              # 샘플 전시회 3개
pnpm start:dev            # http://localhost:3100
```
- API 문서: http://localhost:3100/docs
- 테스트: `pnpm test`
- DB 들여다보기: `pnpm db:studio`

## API
| Method | Path | 설명 |
|---|---|---|
| GET | `/exhibitions` | 전시회 목록 + 남은 부스 수 |
| GET | `/exhibitions/:id` | 전시회 상세 |
| POST | `/applications` | 참가 신청 (동시 신청에도 초과 판매 없음) |
| GET | `/applications/:id` | 신청 조회 |
| PATCH | `/applications/:id/cancel` | 신청 취소 |
| POST | `/agent/chat` | AI 에이전트와 대화 (SSE 스트리밍) |

### 에이전트 대화 예시
```bash
# 1) 새 대화
curl -N -X POST localhost:3100/agent/chat -H 'Content-Type: application/json' \
  -d '{"message":"그린에너지 엑스포에 부스 2개 신청하고 싶어요"}'
# → event: conversation / text / tool / approval_required / done

# 2) 이어서 대화 (위에서 받은 conversationId 사용)
curl -N -X POST localhost:3100/agent/chat -H 'Content-Type: application/json' \
  -d '{"conversationId":"<id>","message":"회사명 그린에너텍, 담당자 홍길동, hong@example.com"}'

# 3) 신청 승인
curl -N -X POST localhost:3100/agent/chat -H 'Content-Type: application/json' \
  -d '{"conversationId":"<id>","decision":"approve"}'
```
