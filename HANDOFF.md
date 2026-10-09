# 작업 인계 (2026-10-09)

새 대화에서 이 파일부터 읽고 이어서 진행합니다.

## 프로젝트 한 줄 요약
전시 부스 참가신청 REST API(NestJS) + 그 API를 도구로 쓰는 Claude AI 에이전트.
**목적**: 프론트엔드 4년차가 풀스택 기본기와 AI 에이전트 경험을 쌓는 학습용 토이 프로젝트.
GitHub: https://github.com/HeeJeShin/booth-agent (public, 브랜치 `master`)

## 작업 방식 (꼭 지킬 것)
- **배우는 용도**이므로 코드에 **주석으로 기본 원리와 유의점(⚠️)**을 정리하면서 진행합니다. 원리와 유의점은 `LEARNING.md`에도 섹션을 추가합니다.
- 채팅 답변은 짧게 쓰고, 긴 내용은 문서로 남깁니다.
- 이력서에는 "현재 토이 프로젝트로 진행 중"이라고 표현합니다. 실무 경력처럼 쓰지 않습니다.

## 환경 메모
| 항목 | 값 |
|---|---|
| 서버 포트 | **3100** (3000은 이력서/포트폴리오 앱이 사용) |
| DB | Docker Postgres 17, 호스트 포트 **5433** (`pnpm db:up`, Docker Desktop 필요) |
| 빌드/실행 | Nest CLI가 Node 22.13에서 깨져서 **CLI 없이 `tsc`로 빌드** (`pnpm build`, `pnpm start:dev`) |
| 테스트 | **Vitest** (`pnpm test`). NestJS 12가 ESM 전용이라 Jest는 동작하지 않음 |
| Prisma | v7: `prisma.config.ts`, pg 드라이버 어댑터, `moduleFormat = "cjs"`, 생성 위치 `src/generated/prisma` |
| 시드 | `pnpm db:seed` (전시회 3개) |
| Claude | `claude-opus-5-5`, effort medium, `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) |

## 1단계 — ✅ 완료 (2026-10-07)
- 전시회 조회, 참가 신청·조회·취소 API, Swagger(`/docs`)
- 트랜잭션 + `SELECT ... FOR UPDATE`로 초과 판매 방지 → **50건 동시 신청 중 39건 성공, 11건 409, 남은 부스 0** (실측)
- 에이전트 루프 수동 구현(`src/agent/agent.service.ts`), 쓰기 도구는 사람 승인 후 실행, SSE 스트리밍(`POST /agent/chat`)
- 도구 입력을 REST와 **같은 DTO로 검증**
- Vitest 12개 통과
- 목 모드(`USE_MOCK_AGENT=true`, `src/agent/mock-client.ts`): 키 없이 규칙 기반 가짜 모델로 루프·도구(실제 DB)·승인·SSE 흐름 확인 가능. curl로 대화 → 승인 대기 → 거절까지 확인함
- ⚠️ **남은 것: 실제 Claude 호출 테스트.** `.env`의 `ANTHROPIC_API_KEY`가 비어 있어 아직 실제로 돌려보지 못했습니다. 목 모드로 흐름은 확인했으니, 키가 생기면 `USE_MOCK_AGENT=false`로 바꾸고 README의 curl 예시로 대화 → 신청 → 승인 흐름을 확인해야 합니다.

## 2단계 — 🚧 시작 직후 멈춤

### 지금 상태 (커밋됨, DB 미적용)
- `pnpm add @nestjs/jwt cookie-parser` / `-D @types/cookie-parser` 설치 완료
- `prisma/schema.prisma`에 **User, RefreshToken 모델 추가**, **Application.userId(필수) 추가** — 주석 포함
- ⚠️ **마이그레이션은 아직 적용 안 됨.** Application에 필수 컬럼이 생기므로 기존 개발 DB를 초기화해야 합니다.
  Prisma가 AI 에이전트의 `migrate reset`을 사용자 동의 없이 막으므로, **사용자가 직접 실행하거나 명시적으로 동의**해야 합니다:
  ```bash
  npx prisma migrate reset --force   # 개발 DB 데이터 삭제 (시드 데이터뿐)
  npx prisma migrate dev --name auth
  pnpm db:seed
  ```

### 남은 작업 (순서대로)
**백엔드: 인증**
1. `src/auth/` 모듈
   - `POST /auth/signup`, `POST /auth/login`: 비밀번호는 Node 내장 `crypto.scrypt` + salt로 해시 (외부 패키지 X, 원리 학습용)
   - 액세스 토큰: JWT 15분, 응답 body로 전달 → 프론트는 **메모리에만** 저장 (localStorage는 XSS에 취약)
   - 리프레시 토큰: 랜덤 문자열 7일, **httpOnly·SameSite=Lax 쿠키**, DB에는 해시만 저장
   - `POST /auth/refresh`: **토큰 회전** (쓴 토큰은 revoke 후 새로 발급). 이미 revoke된 토큰이 다시 오면 탈취로 보고 그 사용자 토큰 전부 무효화
   - `POST /auth/logout`, `GET /auth/me`
2. `JwtAuthGuard`(CanActivate) + `@CurrentUser()` 데코레이터
3. `main.ts`: `cookie-parser`, CORS `credentials: true` + origin `http://localhost:3001`, Swagger `addBearerAuth()`

**백엔드: 소유권**
4. 신청 생성 시 `userId`는 **토큰에서** 꺼냄 (body로 받지 않음)
5. `GET /applications/me` 추가. 남의 신청을 조회·취소하면 **403이 아니라 404** (존재 여부를 숨김)
6. 에이전트: `/agent/chat`에 가드 적용, 대화를 `userId`에 묶음(남의 conversationId 접근 차단), `AgentTools.run(name, input, { userId })`, 도구 `list_my_applications` 추가
7. 테스트 갱신·추가: 도구 실행에 userId 전달, 리프레시 회전과 재사용 감지, 소유권 404

**프론트: Next.js 채팅 화면 (`web/`, 포트 3001)**
8. `create-next-app` (App Router, TS, Tailwind, pnpm). ⚠️ 최신 Next는 변경이 많으니 `node_modules/next/dist/docs` 먼저 확인
9. `/login`: 로그인·회원가입
10. `/`: 채팅(SSE를 `fetch` + `ReadableStream`으로 읽기, EventSource는 POST 불가), 도구 실행 표시, **승인/거절 버튼**, 내 신청 목록
11. 액세스 토큰은 메모리에, 새로고침 시 `/auth/refresh`로 복구, 401이면 refresh 후 재시도

**마무리**
12. `LEARNING.md`에 "7. 인증(JWT)"과 "8. 프론트 SSE·토큰 처리" 섹션 추가, README의 단계표와 API 표 갱신
13. 커밋·푸시

## 3단계 (예정)
대화 기록 DB 저장, MCP 서버로 도구 공개, Docker 배포

## 면접 대비로 설명할 수 있어야 할 것 (2단계)
- 액세스 토큰과 리프레시 토큰을 나누는 이유, 각각 어디에 저장하는가
- 리프레시 토큰 회전과 재사용 감지
- 남의 리소스 접근에 403 대신 404를 주는 이유
- userId를 body가 아니라 토큰에서 꺼내는 이유
