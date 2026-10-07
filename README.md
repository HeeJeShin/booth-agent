# Booth Agent

전시회 부스 참가신청 REST API와, 그 API를 도구로 써서 대화로 신청을 처리하는 AI 에이전트.
NestJS로 백엔드 기본기를 익히기 위한 학습용 토이 프로젝트입니다.

> 원리와 유의점은 [LEARNING.md](./LEARNING.md)에 정리돼 있고, 코드 곳곳에 주석으로도 달아 두었습니다.

- **시작일**: 2026.10.07
- **진행 상태**: 1단계 완료 (API + AI 에이전트) · 2단계 진행 예정

## 목적
4년간 프론트엔드 개발자로 일하며, 백엔드에 결제 처리 구조를 제안하고 API 설계를 함께 논의해왔습니다.
이번에는 그 구조를 **직접 백엔드로 구현해보며** 풀스택 기본기를 갖추고,
요즘 서비스의 중심이 된 **AI 에이전트를 실제로 동작하는 수준까지** 만들어보는 것이 목적입니다.
도메인은 4년간 다뤄온 **전시회 부스 신청**으로 정해, 기술 학습에 집중했습니다.

## 목표
1. **백엔드 기본기**: NestJS 구조(Module·Controller·Service·DI), DTO 검증, Prisma로 DB 설계·마이그레이션
2. **데이터 정합성**: 동시에 신청이 몰려도 초과 판매가 없도록 트랜잭션과 행 잠금으로 보장
3. **AI 에이전트**: Claude가 내 API를 도구로 호출하는 에이전트 루프를 SDK 헬퍼 없이 직접 구현
4. **AI 결과 검증**: AI가 만든 입력을 REST와 같은 DTO로 검증하고, 데이터를 바꾸는 작업은 사람 승인 후 실행
5. **설명할 수 있는 코드**: 원리와 유의점을 주석과 LEARNING.md로 정리하고, 테스트로 규칙을 증명

## 단계별 계획
| 단계 | 내용 | 상태 |
|---|---|---|
| 1단계 | 전시회·신청 REST API, 동시성 처리, AI 에이전트 루프, 사람 승인, SSE 스트리밍, 테스트 | ✅ 완료 |
| 2단계 | JWT 로그인(액세스 + 리프레시 토큰), 본인 신청만 조회·취소, Next.js 채팅 화면 | ⏳ 예정 |
| 3단계 | 대화 기록 DB 저장, MCP 서버로 도구 공개, Docker 배포 | ⏳ 예정 |

## 주요 성과 (1단계)
- 남은 부스 78개에 2개씩 **50건을 동시에** 신청 → 정확히 39건 성공, 11건 거절, 초과 판매 0건
- AI가 가격·상태를 끼워 넣거나 잘못된 이메일을 만들어도 DB에 닿기 전에 차단 (테스트로 검증)
- 데이터를 바꾸는 도구는 서버가 실행을 보류하고 사람 승인을 받은 뒤에만 실행

## 구조
```
src/
├── exhibitions/   전시회 조회 (남은 부스 수 계산)
├── applications/  참가 신청 (트랜잭션 + 행 잠금)
├── agent/         AI 에이전트 (도구 정의, 루프, SSE, 대화 저장소)
└── prisma/        DB 연결 (싱글톤)
```

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
