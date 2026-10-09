# 학습 노트: 원리와 유의점

프론트엔드 개발자가 백엔드와 AI 에이전트를 처음 만들 때 알아야 할 것을, 이 프로젝트 코드에 맞춰 정리했습니다.
각 항목 옆의 파일을 열면 주석으로 같은 설명이 달려 있습니다.

---

## 0. Swagger 항목별 코드 지도 🗺️

Swagger(http://localhost:3100/docs)에서 API를 하나 실행해 보고, 아래 순서대로 파일을 따라가 보세요.

**모든 요청의 공통 흐름**
```
요청 → main.ts (ValidationPipe가 DTO 검사) → *.controller.ts (URL 연결) → *.service.ts (로직) → Prisma → PostgreSQL
                                                                                ↑ prisma/schema.prisma가 테이블 정의
```
모듈 연결은 `src/app.module.ts` → 각 `*.module.ts`, DB 연결은 `src/prisma/prisma.service.ts`에서 봅니다.

### exhibitions (전시회)

| Swagger 항목 | 읽는 순서 | 여기서 볼 것 |
|---|---|---|
| `GET /exhibitions` | `src/exhibitions/exhibitions.controller.ts:12` → `exhibitions.service.ts:10` `findAll()` | **N+1 문제**를 `groupBy`로 피하는 법, 남은 부스 수를 저장하지 않고 **계산**하는 이유 |
| `GET /exhibitions/{id}` | `exhibitions.controller.ts:18` → `exhibitions.service.ts:28` `findOne()` | `ParseIntPipe`(문자열 "1" → 숫자 1), 없으면 `NotFoundException` → **404** |

### applications (참가 신청)

| Swagger 항목 | 읽는 순서 | 여기서 볼 것 |
|---|---|---|
| `POST /applications` | `src/applications/dto/create-application.dto.ts` → `applications.controller.ts:13` → `applications.service.ts:14` `create()` | DTO 검증(`@IsEmail` 등) → **400**, **트랜잭션 + `SELECT ... FOR UPDATE`**로 초과 판매 막기, 금액은 서버가 계산, 남은 부스 부족 → **409** |
| `GET /applications/{id}` | `applications.controller.ts:18` → `applications.service.ts:59` `findOne()` | 위 전시회 상세와 같은 패턴 (복습용) |
| `PATCH /applications/{id}/cancel` | `applications.controller.ts:24` → `applications.service.ts:68` `cancel()` | 행을 지우지 않고 상태만 바꾸는 **소프트 삭제**, 이미 취소됨 → **409** |

> 💡 Swagger에서 일부러 실패시켜 보세요: 이메일 형식 틀리기(400), 없는 id(404), 남은 부스보다 많이 신청(409), 같은 신청 두 번 취소(409).

### agent (AI 에이전트)

| Swagger 항목 | 읽는 순서 | 여기서 볼 것 |
|---|---|---|
| `POST /agent/chat` | ① `src/agent/dto/chat-request.dto.ts` → ② `agent.controller.ts:31` → ③ `agent.service.ts:84` `loop()` → ④ `agent.tools.ts:88` `run()` → ⑤ `conversation.store.ts` | ② **SSE**(응답을 열어두고 `res.write`로 조금씩 보내기), ③ **에이전트 루프**(`stop_reason`에 따라 분기, 쓰기 도구는 **승인 대기**), ④ 도구가 결국 위의 **같은 서비스**를 호출, ⑤ 대화 기록을 서버가 들고 있는 이유 |
| (같은 API, 목 모드) | `agent.service.ts:40` `getClient()` → `src/agent/mock-client.ts` | `.env`의 `USE_MOCK_AGENT=true`면 가짜 모델로 돎 |
| (같은 API, 프롬프트) | `src/agent/system-prompt.ts` | 모델에게 주는 역할·규칙 |

> 💡 에이전트는 Swagger보다 **http://localhost:3100/playground.html**에서 보는 게 편합니다(`public/playground.html`, fetch로 SSE 읽는 프론트 코드).
> 테스트 코드(`*.spec.ts`)도 같이 읽으면 "이 코드가 무엇을 보장해야 하는지"가 보입니다.

---

## 1. NestJS 기본 구조

| 개념 | 하는 일 | 프론트 비유 | 파일 |
|---|---|---|---|
| Module | 관련 기능 묶음 | 기능 폴더 | `*.module.ts` |
| Controller | URL → 메서드 연결만 | 페이지 라우트 | `*.controller.ts` |
| Service | 실제 로직 | 커스텀 훅 / 유틸 | `*.service.ts` |
| DTO | 들어오는 데이터 규칙 | zod 스키마 | `dto/*.dto.ts` |
| Pipe | 요청 값 검증·변환 | 폼 validation | `main.ts` ValidationPipe |

**의존성 주입(DI)**: `constructor(private readonly prisma: PrismaService)`처럼 타입만 적으면 Nest가 인스턴스를 넣어줍니다.
직접 `new` 하지 않으니, 테스트할 때 가짜 객체로 바꿔 끼우기 쉽습니다.

### 유의점
- ⚠️ **DTO는 interface가 아니라 class로.** 런타임에 남는 건 class뿐이라 interface로 쓰면 검증이 안 됩니다.
- ⚠️ **ValidationPipe를 전역으로 켜야 DTO 데코레이터가 동작합니다.** 안 켜면 `@IsEmail()`은 그냥 장식입니다.
- ⚠️ **로직은 컨트롤러가 아니라 서비스에.** 이 프로젝트에선 REST API와 AI 에이전트가 같은 서비스를 호출합니다.
- ⚠️ **tsx·esbuild로 실행하면 DI가 깨집니다.** 데코레이터 메타데이터(`emitDecoratorMetadata`)를 만들지 않기 때문입니다. 그래서 `tsc`로 빌드합니다.

---

## 2. DB와 Prisma

- `prisma/schema.prisma`를 고치고 `pnpm db:migrate` → SQL 마이그레이션 생성 + DB 반영 + 타입 재생성.
- Prisma 7은 드라이버 어댑터(`@prisma/adapter-pg`)가 필수이고, 접속 정보는 `prisma.config.ts`에 둡니다.

### 유의점
- ⚠️ **PrismaClient는 앱 전체에 하나만.** 서비스마다 `new` 하면 DB 커넥션이 고갈됩니다 → `PrismaService`를 싱글톤으로.
- ⚠️ **계산 가능한 값은 저장하지 않기.** "남은 부스 수"를 컬럼으로 두면 신청/취소 때 어긋납니다. 신청 내역으로 계산합니다.
- ⚠️ **돈은 정수(원 단위)로.** 소수(float)는 오차가 생깁니다.
- ⚠️ **신청 시점 가격을 박제.** 전시회 가격이 나중에 바뀌어도 이미 낸 금액은 그대로여야 합니다(`totalPrice`).
- ⚠️ **N+1 쿼리.** 목록의 항목마다 쿼리를 날리지 말고 `groupBy`로 한 번에 집계합니다(`exhibitions.service.ts`).
- ⚠️ **삭제 대신 상태 변경(소프트 삭제).** 취소 이력을 남깁니다.

---

## 3. 동시성: 초과 판매 막기 ⭐

남은 부스가 1개일 때 두 회사가 **동시에** 신청하면, 둘 다 "1개 남음"을 읽고 둘 다 저장해버립니다(Race Condition).

해결: 트랜잭션 + `SELECT ... FOR UPDATE`로 전시회 행을 잠급니다(`applications.service.ts`).
뒤에 온 요청은 앞 요청이 끝날 때까지 기다렸다가 최신 수량을 읽습니다.

**실제 테스트 결과**: 남은 부스 78개에 2개씩 50건을 동시에 보냄 → **정확히 39건 성공(201), 11건 거절(409), 남은 부스 0**.

### 유의점
- ⚠️ **프론트에서 버튼을 막는 것으로는 절대 해결되지 않습니다.** 정합성은 서버와 DB가 책임집니다.
  (스마트관광에서 "결제 완료 처리는 백엔드가 맡아야 한다"고 제안했던 것과 같은 원리)
- ⚠️ **가격·상태는 서버가 정합니다.** 클라이언트가 `totalPrice`, `status`를 보내면 400으로 거절됩니다(whitelist).
- ⚠️ **raw SQL은 템플릿 리터럴(`$queryRaw\`...${값}\``)로.** 문자열을 이어 붙이면 SQL 인젝션 위험이 있습니다.

---

## 4. AI 에이전트 원리 ⭐

```
사용자 메시지
  └▶ Claude 호출 ─▶ stop_reason?
        ├ end_turn : 답변 끝
        ├ tool_use : 서버가 도구 실행 → tool_result를 대화에 추가 → 다시 호출 (반복)
        │            └ 쓰기 도구면 실행 안 하고 "사람 승인 대기"로 멈춤
        └ 그 외    : refusal / max_tokens → 에러 처리
```

- **Claude는 도구를 직접 실행하지 않습니다.** "이 도구를 이 값으로 불러줘"라고 요청만 하고, 실행은 우리 서버가 합니다.
  그래서 AI가 할 수 있는 일의 경계는 전부 서버 코드가 정합니다.
- **API는 상태가 없습니다.** 매 요청마다 대화 전체를 다시 보냅니다 → 서버가 대화 기록을 들고 있어야 합니다.
- 루프는 SDK의 Tool Runner로도 돌릴 수 있지만, 원리를 익히려고 직접 짰습니다(`agent.service.ts`).

### 유의점 (면접에서 설명할 수 있어야 하는 것들)
- ⚠️ **AI 출력 = 믿을 수 없는 외부 입력.** 도구 입력은 REST와 같은 DTO로 검증합니다(`agent.tools.ts`).
  AI가 이메일을 지어내거나 가격을 0원으로 넣어도 DB까지 못 갑니다. ← "AI 결과 검증"
- ⚠️ **중요한 규칙은 프롬프트가 아니라 코드로.** "신청 전에 꼭 물어봐"를 프롬프트에만 쓰면 가끔 건너뜁니다.
  쓰기 도구는 서버가 실행을 보류하고 사람 승인을 받습니다(Human-in-the-loop).
- ⚠️ **tool_use마다 tool_result를 빠짐없이.** 거절한 경우에도 "거절됨" 결과를 붙여야 합니다. 빠지면 다음 요청이 400 에러입니다.
  한 턴의 결과들은 **하나의 user 메시지**에 모읍니다.
- ⚠️ **대화 기록은 덧붙이기만(append-only).** 중간을 고치면 캐시가 깨지고, 이전 추론 블록이 무효가 됩니다.
  응답은 텍스트만 뽑지 말고 `content` 전체를 넣습니다.
- ⚠️ **대화 기록은 서버에.** 클라이언트가 기록을 보내게 하면 가짜 tool_result를 끼워 넣을 수 있습니다.
- ⚠️ **비용 상한.** 루프 최대 횟수(`MAX_STEPS`), 입력 길이 제한, 사용자가 창을 닫으면 호출 중단(AbortSignal).
- ⚠️ **API 키는 환경변수로만.** 코드나 git에 넣지 않습니다(`.env`는 `.gitignore`에 있음).
- ⚠️ **시스템 프롬프트에 날짜처럼 매번 바뀌는 값을 넣지 않기.** 프롬프트 캐시가 깨집니다.

---

## 5. SSE 스트리밍

응답을 닫지 않고 `event: ...\ndata: ...\n\n` 형식으로 조금씩 써 보냅니다(`agent.controller.ts`).

### 유의점
- ⚠️ 브라우저 `EventSource`는 **GET만** 됩니다. 본문을 보내야 하니 POST + `fetch` 스트림 읽기를 씁니다.
- ⚠️ 헤더를 보낸 뒤에는 **상태코드를 못 바꿉니다.** 잘못된 요청은 스트리밍 시작 전에 400/404로 거르고, 도중 에러는 `event: error`로 보냅니다.
- ⚠️ 같은 대화에 요청이 동시에 오면 기록이 꼬입니다 → `busy` 플래그로 409.

---

## 6. 테스트

`pnpm test` (Vitest, 12개)
- 에이전트 루프: 가짜 Claude 응답으로 "쓰기 도구는 승인 전 실행 안 됨", "거절 시 is_error 결과", "MAX_STEPS에서 멈춤" 확인
- 목 모드: 가짜 모델을 진짜 루프에 끼워 조회 → 승인 → 실행 흐름 확인 (`mock-client.spec.ts`)
- 도구 검증: 잘못된 이메일, 가격·상태 끼워 넣기, 부스 수 초과가 서비스까지 못 가는지 확인

⚠️ 실제 모델을 부르지 않고 가짜 응답으로 테스트하는 이유: 비용이 들지 않고 결과가 항상 같습니다.
검증하려는 건 "모델이 똑똑한가"가 아니라 "우리 루프가 규칙대로 도는가"입니다.

---

## 로드맵
- [x] **1단계**: REST API, 동시성 처리, AI 에이전트 루프, 사람 승인, SSE, 테스트
- [ ] **2단계**: JWT 로그인(액세스 + 리프레시 토큰), 신청을 본인 것만 조회·취소, Next.js 채팅 화면
- [ ] **3단계**: 대화 기록을 DB로 이전, MCP 서버로 도구 공개, 배포(Docker)

## 면접 대비: 스스로 답해보기
1. 남은 부스가 1개일 때 동시에 두 명이 신청하면? 왜 프론트에서 막으면 안 되나?
2. AI가 만든 도구 입력을 왜 믿으면 안 되고, 이 프로젝트는 어떻게 검증하나?
3. "신청 전 확인"을 프롬프트로만 하지 않고 서버 코드로 강제한 이유는?
4. 대화 기록을 클라이언트가 아니라 서버가 들고 있는 이유는?
5. SSE에서 스트리밍 도중 에러가 나면 왜 500을 못 주나?
6. 가격을 신청 테이블에 따로 저장하는 이유는?
