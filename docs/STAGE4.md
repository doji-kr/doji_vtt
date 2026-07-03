# 4단계 작업 기록 — §1 계정 본편 + §2 5e 라이트 시트·이니셔티브·HP/상태 + §3 수동 안개 + §4 WebRTC 음성

## 재개 방법 (다음 세션에서 이어가기)

**지금 상태**: 4단계 네 항목(§1 계정 본편·§2 5e 라이트 시트/이니셔티브/HP·상태·§3 수동
안개·§4 WebRTC 음성) 전부 코드·테스트·문서 레벨로 끝났다. `pnpm test` 134개 전부 green.
**단, §4는 정의상 best-effort고, 실제 두 브라우저 사이의 마이크 음성 왕복은 이번 세션에서
검증하지 못했다** — 아래 "§4 실제로 검증한 것 / 하지 못한 것" 절 참고. 4단계는 이걸로
종료하고, 다음은 [`PROMPT-stage5.md`](../PROMPT-stage5.md)(스튜디오 v1 — 문서 우선 에디터)로
넘어가면 된다.

새 세션에서 5단계를 시작할 때:
1. `PROMPT-stage5.md`를 읽게 시키기 전에, 이 문서의 "§1~§4 아키텍처 결정" 절로 계정
   (`userId`/`displayName`/게스트 `nickname` 3분법), 실시간 op 체계(`table-protocol.ts`
   discriminated union + `room-registry.ts` 권한 분기), `characters`/`fog`/음성 시그널링이
   각각 어디에 붙는지 파악시킨다.
2. 4단계로 다시 돌아올 일이 생긴다면(예: 실제 NAS 환경에서 진짜 마이크로 음성 검증), 이
   문서의 "§4 하지 못한 것" 절이 왜 못 했는지·무엇을 확인하면 되는지 그대로 체크리스트다.

---

# §1 계정 본편 (최소 침습 마이그레이션)


> 목표: 닉네임 자리 표시자였던 인증을 실제 계정(argon2id)으로 바꾸되, 게스트 입장 흐름은
> 그대로 유지한다. `PROMPT-stage4.md`가 예고한 네 항목(계정·5e 라이트 시트·수동 안개·
> WebRTC 음성) 중 **§1 계정만** 이번 작업 범위다 — "한 단계, 한 리스크" 원칙에 따라 인증
> 모델 자체를 바꾸는 이 항목을 가장 먼저 끝내고, 나머지 세 항목은 이후 별도 작업으로
> 남긴다(README 로드맵의 4단계 행은 아직 ⬜로 둔다 — 부분 완료를 억지로 ✅로 바꾸지 않는다).

## 아키텍처 결정

### 두 종류의 서명 쿠키 공존

`hs_session`(게스트, nickname 서명)은 3단계 그대로 폐기하지 않고 남긴다. `hs_member`(회원,
user_id 서명)를 새로 추가했다. `apps/server/src/session.ts`의 `makeRequireSession(db)`가
회원 쿠키를 먼저 확인하고(매 요청마다 `users` 테이블에서 현재 username/display_name을
조회 — 캐시하지 않는다, 나중에 표시 이름 변경 기능이 생겨도 쿠키가 오래된 이름을 들고
있는 일이 없게), 없거나 무효하면 게스트 쿠키로 폴백한다. 어느 쪽도 없으면 401.

`requireSession`이 채우는 필드:
- 회원: `request.userId` / `request.username` / `request.displayName`
- 게스트: `request.guestName`
- 공통(하위호환): `request.nickname = displayName ?? guestName` — 3단계까지 쓰이던 필드
  이름을 표시 전용으로 유지했다. **소유권 판단에는 절대 안 쓴다** — 게스트도 이 필드가
  채워지므로, `userId`가 있는지만으로 회원 여부를 가른다.

`requireSession`을 만들려면 db 접근이 필요해졌다(회원 쿠키 조회). 기존엔 `session.ts`가
싱글턴 함수를 export했는데, 이번에 `makeRequireSession(db)` 팩토리로 바꿨다 — `app.ts`가
한 번 만들어서 `registerSessionRoutes`/`registerAuthRoutes`/`registerTableRoutes`/
`registerPlayRoutes`/`registerTableWsRoute`에 의존성 주입 형태로 넘긴다(다른 라우트
모듈들이 이미 `db`를 인자로 받는 관례와 일관되게 맞췄다).

### 테이블 소유권 — `owner_nickname` 문자열 → `owner_user_id` 계정

`tables.owner_nickname TEXT`를 `tables.owner_user_id TEXT NOT NULL REFERENCES users(id)`로
바꿨다. 표시용 이름은 쿼리 시점에 `users`를 조인해 `owner_display_name`으로 얻고,
API 응답 필드 이름은 **`ownerNickname`을 그대로 유지**한다(PROMPT-stage4.md의 "기존 API
계약 모양은 유지, 내부 구현만 바꾼다" 지시를 그대로 따랐다 — `apps/server/src/table-store.ts`
의 `SELECT_WITH_OWNER` 조인 쿼리 참고).

`room-registry.ts`의 `LiveRoom.roleOf(userId)`도 `userId === this.ownerUserId`로만 role을
가른다(예전엔 `nickname === ownerNickname` 문자열 비교였다 — 두 게스트가 같은 표시
이름을 쓰면 오판할 여지가 있었다). 게스트는 `userId`가 애초에 없으므로(`null`) 무조건
`player`다 — **이게 "게스트는 DM이 될 수 없다"의 실제 구현**이다. 새 WS 테스트로
"DM과 정확히 같은 표시 이름을 쓴 게스트도 role은 player"를 증명했다
(`table-ws.test.ts` "계정 마이그레이션 — 소유권은 userId로만 판단한다" 블록).

### 회원가입 / 로그인

`apps/server/src/routes/auth.ts` 신설. `argon2`(argon2id, CLAUDE.md §2가 이미 알고리즘을
못 박아뒀다) 새 런타임 의존성을 추가했다 — 네이티브 바인딩이 있어 `pnpm approve-builds`가
필요했다(설치 스크립트 승인, 커밋에 남김). `username`(영문/숫자/밑줄 3~20자)과
`display_name`(닉네임, 1~40자 한글 포함)을 분리했다 — 로그인 식별자와 화면 표시 이름은
다른 값일 수 있어야 한다는 게 PROMPT의 명시적 요구였다. 아이디/비밀번호 오류를 구분해서
응답하지 않는다(둘 다 `invalid_credentials`) — 계정 존재 여부를 흘리지 않기 위해서다.

### 게스트 흐름은 회귀 없이 그대로

`POST /api/session`(게스트 세션 발급)은 코드 한 줄도 의미상 바뀌지 않았다 — 여전히
사이트 초대코드를 요구하고 nickname을 서명 쿠키에 담는다. 테이블 **참가**(토큰 이동,
채팅, 공개 굴림)는 게스트 세션만으로 3단계 권한표 그대로 동작한다 — `table-ws.test.ts`의
기존 8개 테스트를 회원/게스트 역할만 바꿔서(DM은 `registerMember`, 플레이어/게스트는
기존 `login`) 다시 통과시켰다. 막힌 건 딱 하나, **테이블 생성**(`POST /api/tables`)이다
— `request.userId`가 없으면 403(`account_required`). `GET /api/tables`(내가 만든 테이블
목록, "이야기꾼의 서재")도 같은 이유로 회원 전용이다.

### 웹 — 로그인 화면의 역할 분리

3단계까지 `LoginScreen`은 "닉네임 + 초대코드" 하나로 홈 진입과 게스트 초대 참가를 겸했다.
4단계부터 역할이 갈린다:
- **`LoginScreen`**(홈 진입) — 이제 실제 계정 로그인/가입 폼이다(아이디+비밀번호, 가입
  시에만 표시 이름+초대코드 추가). 홈(서가/이야기꾼의 서재)은 회원 전용이라는 결정을
  그대로 반영했다.
- **`JoinByInvite`**(`/t/:token`) — 더 이상 "이미 로그인돼 있다고 가정"하지 않는다. 마운트
  시 `whoAmI`로 세션 유무를 먼저 확인해, 이미 유효한 세션(게스트든 회원이든)이 있으면
  곧장 초대를 해석하고, 없으면 **"이 이름으로 그냥 들어가기" / "가입하고 들어가기"** 두
  선택지를 보여준다. 전자는 `POST /api/session`, 후자는 `POST /api/auth/register`를 그
  자리에서 태우고 성공하면 초대 해석으로 넘어간다.

`App.tsx`는 라우트별로 "회원이 필요한 경로"(`home` — 서가/이야기꾼의 서재)와 "게스트도
되는 경로"(`invite`, `table`)를 나눠, 세션이 있어도 회원이 아니면 홈 진입 시
`LoginScreen`으로 보낸다(URL을 직접 쳐서 홈에 우회 진입하는 것도 막는다).

### 이중 프로필의 시작 — 최소 진입점만

PROMPT 지시대로 완전히 분리된 대시보드는 만들지 않았다. `LibraryScreen`(내 플레이 =
"모험가 수첩")과 `TablesScreen`(내가 만든 테이블 = "이야기꾼의 서재")은 원래도 별개
화면이었으니, 제목과 이동 버튼 문구만 그 이름으로 다듬었다(`apps/web/src/screens/
LibraryScreen.tsx`, `TablesScreen.tsx`). 게스트는 홈에 도달하지 않으므로 이 화면들 자체가
회원만 보는 화면이라는 게 자연히 보장된다.

## 데이터 마이그레이션

로컬 개발 DB(`apps/server/data/`)가 아직 없었다(실사용자 없는 개발 단계, CLAUDE.md §1.9) —
그래서 별도 마이그레이션 스크립트를 만들지 않았다. `users` 테이블을 새로 만들고
`tables.owner_user_id NOT NULL`로 스키마를 바꿨을 뿐이다. 만약 이전 스키마로 만들어진
`hearthside.db`가 남아있다면(예: 3단계 세션에서 수동으로 서버를 띄워 데이터를 만든 적이
있다면) `CREATE TABLE IF NOT EXISTS`는 기존 테이블을 고치지 않으므로, 그 파일은 지우고
다시 시작해야 한다 — 이번 세션에서 실제로 `apps/server/data/`가 비어 있는 것을 확인했다.
`plays` 테이블은 손대지 않았다(여전히 `nickname` 컬럼 기반) — 솔로 플레이는 이번 단계
범위가 아니고, 게스트/회원 둘 다 표시 이름으로 계속 이용할 수 있어 변경할 이유가 없었다.

## 실제로 검증한 것 (이번 세션에서 직접 실행)

**자동 테스트**: `pnpm test` — 기존 86개 + 신규 15개(서버 `app.test.ts` +10: 회원가입/
로그인/재로그인/중복 username 409/틀린 비밀번호 401/존재하지 않는 username 401/비밀번호
argon2id 해시 확인/게스트 테이블 생성 403/회원 테이블 생성 201/게스트가 초대로 참가 가능;
서버 `table-ws.test.ts` +2: 게스트가 POST /api/tables로 방을 못 만듦, 동명이인이어도
게스트는 항상 player; 웹 `JoinByInvite.test.tsx` +3: 이미 세션 있으면 즉시 해석/게스트
선택지 노출/게스트 진입 흐름/가입 진입 흐름, 기존 2개는 새 컴포넌트 동작에 맞춰
재작성했다) = **101개 전부 green**. 서버·웹 타입체크(`tsc --noEmit`)도 별도로 통과 확인.

**빌드 후 실제 서버 기동 + curl/WS 스크립트로 실제 왕복 확인** (`pnpm --filter
@hearthside/web build` 산출물 + `DATA_DIR=... INVITE_CODE=letmein tsx apps/server/src/
index.ts`, 3단계 문서가 남긴 "빌드된 dist를 실제로 서빙하며 열어보기 전까진 안 드러나는
버그가 있다"는 교훈을 그대로 따랐다):

1. `POST /api/auth/register`(dmuser1/hunter2pass, 초대코드 포함) → 201, `hs_member`
   쿠키 발급.
2. 그 쿠키로 `GET /api/session` → `{kind:"member", username:"dmuser1",
   displayName:"돗트DM", ...}`.
3. 같은 username으로 재가입 → 409 `username_taken`.
4. 틀린 비밀번호로 `POST /api/auth/login` → 401. 올바른 비밀번호 → 200 + 새 `hs_member`
   쿠키(= 로그아웃 후 재로그인 시나리오). 그 쿠키로 `GET /api/session` 재확인 → 같은
   계정으로 인식.
5. 쿠키 없이 `GET /api/session` → 401(비로그인 상태 확인).
6. 회원 쿠키로 `POST /api/tables`(방 이름 "금요일 밤 지하실") → 201, invite_token 발급.
7. `POST /api/session`(닉네임 "지나가던모험가", 계정 없음) → 200, 게스트 쿠키 발급.
8. 게스트 쿠키로 `GET /api/tables/by-invite/:token` → 200, 테이블 id 획득(계정 없이
   초대 해석 가능 확인).
9. 게스트 쿠키로 `POST /api/tables` → **403 `account_required`**(게스트는 방을 못
   만든다 확인).
10. `GET /api/tables/:id`를 DM/게스트 양쪽 쿠키로 각각 호출 → 둘 다 `ownerNickname:
    "돗트DM"`, DM은 `isOwner:true`, 게스트는 `isOwner:false`(소유권 필드가 계정 기반으로
    정확히 갈리는 것 확인).
11. Node `ws` 스크립트로 실제 `GET /ws/tables/:id` 웹소켓을 회원/게스트 쿠키 각각으로
    열어 `hello` → `state.snapshot`을 받았다: 회원(DM) 소켓은
    `participants: [{nickname:"돗트DM", role:"dm", ...}]`, 게스트 소켓은 자신이
    `role:"player"`로 참가자 목록에 반영됨을 확인. 게스트 소켓으로 `map.set`(DM 전용
    op)을 시도해 `error {code:"forbidden"}`를 실제로 받는 것까지 확인 — 연결이 살아있는
    실시간 채널에서 권한이 계정 기반으로 정확히 작동함을 자동 테스트가 아니라 실제
    서버·실제 소켓으로 재확인했다.

위 curl/WS 검증은 임시 데이터 디렉터리(`%TEMP%/hs-stage4-verify`)를 새로 만들어
실행했고, 세션 종료 후 서버 프로세스 종료 + 임시 파일 삭제까지 정리했다.

**리드 세션에서 독립적으로 재검증**: 위 curl/WS 확인은 작업을 위임받은 서브에이전트가
직접 수행·보고한 것이고, 리드 세션이 그 결과만 믿지 않고 **같은 서버를 다시 띄워 별도로
동일한 흐름을 재현**했다 — 회원가입→중복 아이디 409→틀린 초대코드 401→틀린 비번 401→
재로그인, 회원 테이블 생성 201/게스트 생성 시도 403/게스트 초대 조회 200/게스트 서재
목록 403/회원 서재 목록 200, 그리고 실제 `ws` 라이브러리로 회원·게스트 소켓을 열어
`state.snapshot`의 role이 `dm`/`player`로 정확히 갈리는 것과 게스트가 `map.set`을
시도했을 때 `error{code:"forbidden"}`를 받고 연결은 유지되는 것까지 — 전부 독립적으로
같은 결과를 재현했다. `pnpm test` 101/101도 리드 세션에서 재실행해 확인.

**하지 않은 것**: 브라우저로 직접 "가입하고 들어가기"/"이 이름으로 그냥 들어가기" 두
버튼을 클릭해보는 수동 UI 조작은 이번에도 못 했다(claude-in-chrome 브라우저 확장이
이 세션엔 연결되지 않았다) — 대신 각 화면의 로직을 컴포넌트 테스트
(`JoinByInvite.test.tsx`)로 상세히 커버했고, 그 아래 깔린 API·WS 계약은 리드 세션이
독립적으로 재검증했다. **다음에 이어받는 사람은 브라우저 두 개로 직접 클릭해보는 걸
권한다** — 3단계에서 그렇게 해서 Pixi `hitArea`/정적 파일 충돌 버그를 잡은 전례가 있다.

## 이번 단계에서 내린 판단 콜 (검토 요청)

- **회원 쿠키에 `userId`만 서명하고, `username`/`displayName`은 매 요청 DB 조회로 얻는다**
  — 캐시해서 쿠키에 다 넣는 대신 매번 조회를 택했다. 표시 이름 변경 같은 기능이 나중에
  생겨도 쿠키가 오래된 값을 들고 있지 않게 하기 위해서다. `users` 테이블은 PK 조회라
  비용이 낮다(§8 성능 예산에 영향 없음 — 테이블 목록/WS 연결 같은 저빈도 요청에서만 쓰인다).
- **`requireSession`을 팩토리(`makeRequireSession(db)`)로 바꾸고 각 라우트 모듈에 의존성
  주입**했다 — 기존에 싱글턴을 여러 파일이 직접 import하던 패턴을, db가 필요해지면서
  자연히 다른 라우트 모듈들(`registerTableRoutes(app, db, ...)` 등)과 같은 관례로
  맞췄다. 리스크는 낮다고 판단(컴파일 타임에 강제되는 배선이라 빠뜨리면 바로 타입 에러).
- **`plays`(솔로 플레이)는 손대지 않고 nickname 기반 그대로 뒀다** — PROMPT가 캐릭터
  시트(2번 항목)에서만 `owner_user_id NOT NULL`을 명시했고, 솔로 플레이 자체는 계정
  여부와 무관하게 계속 되어야 한다고 판단했다(게스트도 혼자 이야기를 완주할 수 있어야
  한다 — 이건 v0.5 "스튜디오+솔로 러너" 필러의 기존 동작이고 이번 계정 마이그레이션이
  건드릴 이유가 없다).
- **`GET /api/session`/`POST /api/auth/*` 응답 모양이 3단계와 다르다** — PROMPT가 명시적으로
  허용한 예외다(인증 관련 API는 이번 단계의 목적 자체이므로 바뀌어도 된다). `docs/
  PROTOCOL.md`에 옛 모양과 새 모양을 표로 남겨 뭐가 왜 바뀌었는지 추적 가능하게 했다.
- **테이블 목록(`GET /api/tables`)도 403으로 회원 전용화** — PROMPT가 명시한 건 "테이블
  생성"뿐이었지만, "내가 만든 테이블 목록"은 의미상 "이야기꾼의 서재"이므로 같은 게이트를
  적용하는 게 일관적이라고 판단했다. 게스트가 이 엔드포인트를 칠 경로가 UI에도 없다.
- **JoinByInvite의 "가입하고 들어가기"에서 초대코드 입력칸을 다시 요구한다** — 회원가입
  API가 초대코드를 필요로 하기 때문에 UX상 어쩔 수 없이 중복 입력이다. 초대 **링크**
  자체(`/t/:token`)와 사이트 **초대코드**(`config.inviteCode`)는 서로 다른 개념이라는 걸
  PROMPT가 명확히 구분하고 있어서, 헷갈리지 않게 두 화면 다 "초대코드"라는 동일한 라벨을
  썼다.

## 다음으로 넘기는 것

- PROMPT-stage4.md §2 (5e 라이트 시트·이니셔티브·HP/상태), §3 (수동 안개), §4 (WebRTC 음성)
  — 순서대로 별도 작업.
- 게스트→회원 승격 API는 PROMPT가 명시적으로 범위 밖이라고 못 박았으므로 만들지 않았다
  (게스트로 한 판 놀고 나중에 따로 가입 / 지금 바로 "가입하고 들어가기" 두 경로만 지원).
- 브라우저로 직접 두 진입 버튼을 눌러보는 수동 확인이 아직 안 됐다 — 위 "하지 않은 것"
  참고.
- README 로드맵 4단계 행은 이번 세션에서 건드리지 않았다(§1만 끝난 부분 완료 상태 —
  나머지 세 항목이 끝난 뒤 한 번에 정리하기로 함).

## DoD 체크리스트 (§1 계정 범위 한정)

- [x] 회원가입(초대코드+아이디+비번) → 로그인 → 로그아웃(쿠키 폐기) → 재로그인이 전부
      실제 DB 계정으로 동작 — curl로 실제 확인(위 1~4번)
- [x] 같은 username으로 두 번 가입 시도하면 거부(409) — 자동 테스트 + curl 둘 다 확인
- [x] 초대 링크로 들어온 사람이 계정 없이 "이 이름으로 그냥 들어가기"로 즉시 참가 가능,
      같은 화면에서 "가입하고 들어가기"를 고르면 그 자리에서 회원 계정 생성 후 같은
      표시 이름으로 입장 — 컴포넌트 테스트(JoinByInvite)로 두 경로 다 확인, API 레벨은
      curl/WS로 실제 확인. 브라우저 클릭 조작은 미완(다음 세션 권장).
- [x] 테이블 생성(DM 되기)은 로그인 없이는 403 — 자동 테스트 + curl 확인
- [x] `pnpm test` 전부 green — 기존 86개 + 신규 15개 = 101개
- [x] `docs/PROTOCOL.md` v1 갱신(인증 계약 변경사항 표로 정리)
- [x] `docs/STAGE4.md`(이 문서) 존재
- [ ] README 로드맵 4단계 — 의도적으로 미갱신(부분 완료, 나머지 세 항목 완료 후 정리)

---

# §2 5e 라이트 시트 · 이니셔티브 · HP/상태

> 목표: 친구들이 각자 캐릭터 시트(이름·클래스·능력치 수정치·HP·AC·상태 태그)를 만들어
> 테이블에 들고 앉고, 이니셔티브 순서가 돌고, HP가 실시간으로 깎이는 것. PROMPT-stage4.md
> §2 전체 범위 — 새 데이터 모델(characters) + 새 실시간 op 6종 + UI(시트 카드·능력치
> 굴림 버튼·HP 바·상태 칩·이니셔티브 리본).

## 아키텍처 결정

### 데이터 모델 — `characters`는 관계형 테이블, `RoomState`에 JSON으로 얹지 않는다

`tokens`/`log`는 `tables.state_json`에 통째로 직렬화되지만, `characters`는 별도
SQLite 테이블(`apps/server/src/db.ts`)로 뒀다 — `owner_user_id NOT NULL REFERENCES
users(id)`라는 FK 제약이 "게스트는 캐릭터를 못 만든다"를 스키마 레벨에서 강제하는 핵심
장치인데, JSON blob 안에 묻으면 이 제약이 안 걸린다. `character-store.ts`가
`table-store.ts`/`user-store.ts`와 같은 관례(plain function + db 인자, `SELECT_WITH_OWNER`
조인 상수)를 따른다. `LiveRoom` 생성자가 `listCharactersByTable(db, tableId)`로 메모리에
캐시해두고, 매 op마다 DB에 즉시 쓴다(토큰처럼 3초 디바운스가 아니다 — HP 같은 값을 재부팅
때 잃으면 안 되고, 단발 UPDATE라 저비용이라 즉시 쓰기를 택했다). `initiative`는 반대로
JSON(`RoomState.initiative` → `tables.state_json`)에 얹었다 — 이니셔티브 항목은 세션이
끝나면 의미 없어지는 휘발성 데이터라 관계형으로 승격할 이유가 없고, `tokens`/`log`와 같은
디바운스 저장 주기를 그대로 타면 충분하다.

### `character.hp`는 절대값만 받는다 — 델타 계산은 서버가 하지 않는다

PROMPT가 명시한 CLAUDE.md §1.6("명중→피해 자동 적용 금지") 제약을 지키려면 "몇 대 맞아서
몇 깎였다"를 서버가 계산하면 안 된다. 그래서 `character.hp` payload는
`{ characterId, hpCurrent, hpMax }` 절대값이고, 서버는 그대로 UPDATE만 한다 — 클라이언트
(DM 또는 소유자)가 판정을 해석해서 숫자를 직접 써넣는 게 유일한 경로다.

### 권한 — "본인 소유 또는 DM", 이니셔티브만 DM 전용

`character.set`(갱신)/`character.hp`/`status.set` 세 op는 `existing.ownerUserId ===
conn.userId || conn.role === "dm"`로 판단한다. 처음엔 "본인만"으로 좁게 설계할지 "DM도
가능"으로 열지 판단이 갈렸는데, 사용자에게 직접 확인해 **DM도 가능**으로 결정했다 — DM이
전투 중 플레이어 캐릭터의 HP를 대신 조정해야 하는 실전 필요(플레이어가 자리를 비웠거나,
그룹 효과로 여러 캐릭터 HP를 한 번에 만져야 하는 경우)가 있고, `token.move`가 이미
"DM은 모든 토큰, 플레이어는 자기 것만"이라는 동일한 비대칭 권한 패턴을 쓰고 있어 일관성도
맞는다. 반면 `initiative.set`/`initiative.remove`는 **DM 전용**으로 사용자가 명시적으로
확정했다(옵션: DM만 / 본인 또는 DM / 참가자 전원 — "DM만"을 권장안으로 제시하고 그대로
채택됨). 이니셔티브 굴림 자체는 기존 `dice.roll`을 그대로 쓰고, 그 결과를 순번으로
"확정"하는 것만 DM의 별도 동작이라는 PROMPT의 설계를 그대로 따른 것이다.

### 캐릭터 생성 — `character.set`이 id 유무로 생성/갱신을 겸한다

새 op 타입을 `character.create`/`character.update`로 나누지 않고 `character.set` 하나가
`id` optional 여부로 분기하게 했다(PROMPT가 이미 이 이름으로 못 박아뒀다). 서버가
`randomUUID()`로 id를 발급하는 것도 `token.add`와 동일한 패턴이다. 생성 시에만 `hpMax`를
받아 시작 HP를 시딩하고(현재 HP = 최대 HP로 시작), 갱신 시엔 `hpMax`를 무시한다 — HP
변경은 `character.hp` 전용 경로로만 일어나야 한다는 원칙을 op 스키마 레벨에서도 지켰다.

### 클라이언트 — "클릭 = 굴림"은 새 파서 없이 기존 `/roll` 채팅 관례를 그대로 쓴다

PROMPT가 "새 주사위 파서를 만들지 마라"고 명시했다. `TableScreen`에 전용 주사위 입력
컴포넌트가 없고 채팅 텍스트 입력(`chatText` state)이 `/roll ` 접두사로 굴림과 채팅을
겸하는 기존 3단계 관례를 그대로 재사용해, 능력치 버튼 클릭 시
`setChatText(\`/roll 1d20${fmtMod(mod)}\`)`로 입력창을 채워준다 — 사용자가 "보내기"를
눌러야 실제로 `dice.roll`이 나간다(자동 전송하지 않는다, PROMPT의 "인풋에 꽂아준다"라는
표현을 문자 그대로 따름). 새 이니셔티브 굴림도 같은 경로를 쓰고, 굴림 결과를 순번칸에
옮겨적는 건 DM이 직접 하는 별도 동작이다(자동 연결 없음 — 이것도 "산수는 기계가, 판정은
사람이" 원칙).

### UI — 캐릭터 카드는 사이드 패널이 아니라 캔버스 아래 새 가로 영역

3단계까지 `.hs-table-layout`은 "캔버스+DM패널 / 참가자+채팅" 2열 그리드였다. 캐릭터
시트는 여러 장 나열되면 세로로 길어지므로 그 아래 `.hs-table-bottom`(캐릭터 목록 2 :
이니셔티브 1 비율)을 새로 얹었다 — 기존 2열 레이아웃을 건드리지 않고 확장했다. 편집 가능
여부(`canEditCharacter`)에 따라 HP 폼/상태 추가 입력/시트 고치기 버튼이 조건부로 렌더링되고,
게스트(`selfUserId === null`)에게는 새 캐릭터 만들기 폼 대신 "가입하면 캐릭터를 만들 수
있어요" 안내만 보인다(PROMPT가 명시한 게스트 UI 대체 요구사항).

## 실제로 검증한 것

**자동 테스트**: `pnpm test` — 기존 101개 + 신규 7개(서버 `table-ws.test.ts` +5: 회원이
캐릭터 생성·갱신 시 양쪽 소켓 동기화/게스트 캐릭터 생성 거부(`account_required`)/제3자는
남의 캐릭터 HP를 못 고치지만 DM은 고칠 수 있음+상태 태그 부여/이니셔티브는 DM만 추가·삭제
가능·플레이어 시도 시 거부/재접속 시 캐릭터·이니셔티브가 스냅샷에 복원됨; 웹
`table-reducer.test.ts` +2: `character.set`/`character.hp`/`status.set` 반영,
`initiative.set`/`initiative.remove` 반영) = **108개 전부 green**. 서버·웹 타입체크
(`tsc --noEmit`)도 통과. (참고: 로컬 Node 26에서 `better-sqlite3`/`argon2` 네이티브 빌드가
V8 API 변경으로 실패해 Node 22로 전환해 실행했다 — 코드 변경 아님, 로컬 툴체인 문제.)

**빌드 후 실제 서버 기동 + 브라우저 두 개로 직접 조작** (`pnpm --filter @hearthside/web
build` 산출물 + `DATA_DIR=... INVITE_CODE=letmein tsx apps/server/src/index.ts`, claude-in-
chrome 확장으로 실제 두 탭을 열어 조작 — 지난 §1 세션에서 못 했던 "실제 브라우저 클릭"을
이번엔 완료했다):

1. 탭1(DM): `/auth/register`로 회원가입 → 홈 → "이야기꾼의 서재"에서 테이블 생성 →
   초대 링크로 자기 테이블 입장.
2. 탭1에서 캐릭터 생성 폼(이름/클래스/AC/최대HP/6개 능력치 수정치)을 실제로 입력해 제출 →
   캐릭터 카드가 즉시 렌더링(HP 22/22, AC 17, 능력치 버튼들).
3. 능력치 버튼(WIS -22, 의도적으로 극단값 입력해 눈에 띄게 만듦) 클릭 → 채팅 입력창에
   `/roll 1d20-22`가 자동으로 채워지는 것 확인("클릭 = 굴림") → 전송 → 모험 일지에
   `1d20-22 → -17` 결과 표시.
4. HP 입력칸에 9를 넣고 "HP 적용" 클릭 → HP 바가 초록(sage)/빨강(ember) 분할로 즉시
   갱신(9/22).
5. 상태 태그 입력칸에 "poisoned" 입력 후 Enter → 칩이 즉시 표시되고 "×"로 제거 가능한 것
   확인.
6. 이니셔티브 패널에 "고블린"/순번 14 입력 후 "추가" → 리본에 항목이 즉시 표시.
7. 탭2를 새로 열어 같은 브라우저 프로필의 `hs_member` 쿠키를 자바스크립트 `fetch`로
   덮어써(`/api/auth/register`) 두 번째 회원 계정("검증플레이어")을 만들고 같은 초대
   링크로 입장 → 참가자 목록에 즉시 추가(role: player), 탭1이 만든 캐릭터·HP·상태·
   이니셔티브가 전부 스냅샷으로 그대로 보임.
8. 탭2(플레이어)가 자기 캐릭터("아리아", DEX +3, HP 18/18, AC 14)를 생성 → 탭1(DM)
   화면에 실시간으로 새 캐릭터 카드가 나타남(폴링이 아니라 WS 브로드캐스트로 확인 —
   탭1은 스크롤/새로고침 없이 그대로 갱신됨).
9. 탭1(DM)이 탭2 소유 캐릭터("아리아")의 HP를 5/18로 직접 조정(소유자가 아니어도 DM은
   가능) → 탭2 화면에 즉시 반영되는 것 확인 — §2의 "DM도 소유자가 아닌 캐릭터의 HP를
   조정할 수 있다" 결정이 실제 두 브라우저 세션 사이에서 올바르게 동작함을 확인.
10. 탭2(플레이어) 화면에서 탭1(DM) 소유 캐릭터("돈트마가")에는 HP 편집 폼/시트 고치기
    버튼이 전혀 렌더링되지 않는 것 확인(소유자도 DM도 아니므로 `canEditCharacter`가
    false) — 편집 UI 자체가 없어 오조작이 원천 차단됨을 시각적으로 확인.
11. 탭2(플레이어) 화면에는 이니셔티브 추가 폼 자체가 렌더링되지 않는 것 확인(`selfRole
    === "dm"` 게이트) — 서버 권한 검증뿐 아니라 UI 레벨에서도 이중으로 막혀 있음.

**하지 못한 것**: "진짜 계정 없는 게스트"가 초대 링크로 들어왔을 때 캐릭터 생성 버튼 대신
가입 유도 안내가 뜨는 것은 이번엔 브라우저로 직접 못 봤다 — `hs_member`는 httpOnly라서
같은 브라우저 프로필의 새 탭에서 세 번째 신원(쿠키 없는 진짜 게스트)을 만들 방법이 없었다
(로그아웃 엔드포인트가 없다 — 만들 것까진 아니라고 판단, §1 범위 밖이자 과설계). 대신
①서버 자동 테스트("게스트는 캐릭터 시트를 만들 수 없다" — `account_required` 에러를
실제 WS 왕복으로 확인)와 ②`TableScreen.tsx`의 `selfUserId ? <CharacterForm/> : <안내
문구>` 삼항 분기 코드 확인 두 가지로 대체 검증했다. 다음 세션에서 브라우저 시크릿
창(별도 프로필)을 열어 확인하면 완전해진다.

## DoD 체크리스트 (§2 범위 한정)

- [x] 새 실시간 op 6종(`character.set` `character.hp` `status.set` `initiative.set`
      `initiative.remove`) — 서버 구현 + 자동 테스트 + 브라우저 실제 왕복 확인
- [x] `characters` 테이블(`owner_user_id NOT NULL`) — 게스트는 캐릭터 생성 시 서버가
      `account_required` 에러로 거부(자동 테스트로 확인, 브라우저 진짜-게스트 확인은
      다음 세션 권장)
- [x] 이니셔티브 굴림은 기존 `dice.roll` 재사용, 순번 확정은 DM의 별도 동작
      (`initiative.set`) — 새 주사위 파서 없음
- [x] "클릭 = 굴림" — 능력치 버튼 클릭 시 기존 채팅 입력에 `/roll 1d20+N` 프리필,
      기존 `/roll` 파싱 경로 그대로 사용
- [x] HP는 절대값만 받고 서버가 델타 계산을 하지 않음(CLAUDE.md §1.6)
- [x] 브라우저 두 개로 실제 확인: 캐릭터 생성·능력치 굴림·HP 조정·상태 태그·이니셔티브
      추가가 전부 상대 화면에 실시간 반영
- [x] 권한 검증: 남의 캐릭터는 소유자도 DM도 아니면 편집 UI 자체가 없음, 이니셔티브는
      플레이어 화면에 추가 폼 자체가 없음(서버 권한 + UI 게이트 이중 확인)
- [x] `pnpm test` 전부 green — 기존 101개 + 신규 7개 = 108개
- [x] `docs/PROTOCOL.md`에 신규 op 6종·타입(`Character`/`AbilityMods`/`InitiativeEntry`)·
      권한표 반영
- [x] `docs/STAGE4.md`(이 절) 갱신
- [x] README 로드맵 4단계 — §3 완료 시점에 갱신(§4 음성 남음)

---

# §3 수동 안개 (브러시)

## 아키텍처 결정

### 서버 권위 공유 레이어 — 개인별 시야 계산이 아니다

CLAUDE.md §9가 "동적 조명/시야"를 범위 밖에 뒀지만, 그건 **참가자마다 다른 시야를 서버가
자동 계산하는 기능**을 가리킨다. 여기서 만드는 "수동 안개"는 DM이 붓으로 걷은(reveal) 영역이
**모든 비-DM 참가자에게 공통으로** 보이는 단일 공유 비트마스크다 — 시야 계산도, 광원도,
장애물 판정도 없다. `RoomState.fog: FogState | null`로 방 상태에 얹고, `characters`/
`initiative`(§2)와 같은 패턴으로 `LiveRoom.snapshot()`/`flush()`에 엮었다.

### DM은 서버가 걸러주지 않는다 — 클라이언트가 role로 안개 레이어를 안 그릴 뿐

`dice.roll secret: true`(3단계)나 `dm_notes`(1·2단계)는 서버가 아예 그 소켓에 보내지 않는
**채널 분리**다. 안개는 다르다 — DM 소켓도 `fog.reveal`/스냅샷의 `fog` 필드를 똑같이
받는다. 다만 `TableCanvas.tsx`의 `redrawFog()`가 `selfRole === "dm"`이면 안개 레이어 자체를
그리지 않는다. 안개는 비밀 정보가 아니라 **뷰 모드 차이**이므로 채널 분리 수준의 엄격함
(서버측 필터링 + 회귀 테스트)까지는 필요 없다고 판단했다 — 어차피 DM 클라이언트 코드가 그
데이터로 무언가 비밀스러운 계산을 하지 않는다.

### RLE 비트마스크 — 성능 예산(§8) 대응

`FogState`를 `boolean[]`로 그대로 실으면 큰 그리드(예: 60×40 = 2400셀)에서 스냅샷 페이로드가
불필요하게 커진다. `apps/server/src/fog.ts`는 run-length encoding으로 `{ cols, rows,
runs: number[] }`만 직렬화한다 — `runs[0]`은 hidden 구간 길이(전체 비공개로 시작하니 항상
하나 이상의 hidden 구간이 있다), 그 뒤로 hidden/revealed가 번갈아 나오고 합은 항상
`cols*rows`다. `revealCells`/`resetFog` 둘 다 순수 함수(`decode → 배열 조작 → encode`)라
이미지 압축 라이브러리 없이 `node:crypto` 수준의 의존성 0으로 끝났다. 웹 쪽
(`apps/web/src/table-reducer.ts`)에 서버와 동일한 인코딩/디코딩 로직을 그대로 복제했다 —
공유 패키지로 뺄 만큼 크지 않고, 두 구현이 갈라지면 유닛 테스트(양쪽 다 있음)가 바로 잡아낸다.

### 새 실시간 op 3종과 권한 — 전부 DM 전용

`fog.init { cols, rows }`(그리드 해상도에 맞춘 새 안개, 기존 안개는 버려짐) ·
`fog.reveal { cells: {x,y}[] }`(브러시 스트로크) · `fog.reset {}`(전부 다시 가림). 셋 다
`conn.role !== "dm"`이면 `error forbidden`이고, `fog.reveal`/`fog.reset`은 `fog.init` 전이면
`error fog_not_initialized`다. 플레이어에게는 애초에 안개 준비/붓/초기화 버튼 자체가
렌더링되지 않는다(§2에서 확립한 "서버 권한 + UI 게이트 이중 확인" 패턴 재사용).

### 캔버스 레이어 순서 — 지도 → 안개 → 그리드 → 토큰 → 핑

PROMPT-stage4.md §3이 제안한 순서를 그대로 따랐다: 안개가 그리드보다 아래에 있어야 그리드
선이 항상 보여서 방향감이 유지된다. 브라우저로 실제로 봤을 때도 이 순서가 자연스러웠다 —
바꿀 이유가 없어 강제 요건대로 확정했다.

### 브러시 커밋 시점 — 토큰 드래그와 같은 "뗄 때 한 번" 패턴

3단계에서 확립한 "낙관적 프리뷰는 로컬에서만, 서버 반영은 놓을 때 한 번"(CLAUDE.md §6
"조용한 마법") 패턴을 안개 붓에도 그대로 썼다. 드래그하는 동안 `brushAccum`(Set)에 좌표를
모으고, `pointerup`에서 모인 좌표를 한 번의 `fog.reveal`로 전송한다 — 셀 하나씩 걷을 때마다
op를 보내면 빠른 드래그에서 초당 수십 개의 메시지가 나갈 수 있어 §8 성능 예산에 불리하다.

## 실제로 검증한 것

**자동 테스트**: `pnpm test` — 기존 108개 + 신규 12개(서버 `fog.test.ts` +6: `initFog`가
전체 hidden 단일 run으로 시작 / `revealCells`가 좌표 하나·여러 개를 걷고 그리드 밖 좌표를
무시하며 이미 걷힌 셀에 멱등함 / `resetFog`가 크기를 유지한 채 전부 재차단; 서버
`table-ws.test.ts` +4: DM이 준비→걷기→초기화하면 플레이어 화면에도 실시간 반영 / 플레이어가
안개 op 3종을 시도하면 전부 `error forbidden` / `fog.init` 전에 `fog.reveal`을 보내면
`error fog_not_initialized` / 재접속 시 안개가 스냅샷(`{ cols, rows, runs }`)에 그대로 복원;
웹 `table-reducer.test.ts` +2: `fog.init`/`fog.reveal`/`fog.reset`이 반영되고, 안개가 없는
상태에서 온 `fog.reveal`은 무시됨) = **120개 전부 green**.

**빌드 후 실제 서버 기동 + 브라우저 두 개로 직접 조작** (`pnpm --filter @hearthside/web
build` 산출물 + 임시 `DATA_DIR`로 서버 기동, claude-in-chrome으로 실제 두 탭 조작):

1. 탭1(DM)에서 회원가입 → 테이블 생성 → 20×15 안개 "안개 준비" 클릭 → 스냅샷에 전체 hidden
   `FogState`가 실림을 확인.
2. 탭2를 같은 초대 링크로 열었더니 처음엔 같은 브라우저 프로필 쿠키를 그대로 물려받아 탭1과
   동일한 DM으로 인증됐다(§2 검증 세션에서 이미 겪은 것과 같은 현상) — `fetch`로
   `/api/auth/register`를 다시 호출해 탭2 전용 두 번째 회원 계정을 만들어 진짜 두 번째
   참가자(role: player)로 전환한 뒤 진행했다.
3. 탭2(플레이어) 화면에서 지도 왼쪽 절반(그리드 20×15칸에 해당하는 640px 폭)이 완전히 검게
   가려진 것을 확인 — "안개 준비" 직후 전체 비공개 상태가 플레이어 화면에 정확히 반영됨.
4. 탭1(DM)이 안개 걷기(붓) 버튼을 눌러 브러시를 활성화하고 안개 영역 안의 한 지점을 클릭 →
   탭2(플레이어) 화면에서 클릭한 자리 주변(브러시 반경만큼)이 즉시 옅어지며 걷히는 것을
   실시간으로 확인(폴링이 아니라 WS 브로드캐스트).
5. 탭2를 새로고침(`state.snapshot` 재요청) → 걷혔던 영역이 그대로 유지된 것을 확인 —
   재접속 시 안개 복원이 실제로 동작한다.
6. 탭1(DM)이 "안개 초기화"를 클릭 → 탭2 화면에서 방금 걷혔던 영역이 다시 완전히 검게
   덮이는 것을 확인.
7. DM 화면 자체에는 안개 레이어가 전혀 그려지지 않고 항상 전체 지도가 보이는 것을 브러시
   조작 내내 확인 — `selfRole === "dm"`이면 안개를 그리지 않는 클라이언트 로직이 실제로
   동작함을 시각적으로 검증했다.

**하지 못한 것**: 진짜 계정 없는 게스트(§2와 같은 이유로 같은 브라우저 프로필에서 세 번째
신원을 만들 방법이 없었다)가 안개 화면을 보는 것은 별도로 확인하지 않았다 — 다만 안개는
회원/게스트를 구분하지 않고 "DM이냐 아니냐"로만 갈리므로(권한표 참고), §2에서 이미 확인한
게스트=player role 부여가 그대로 적용된다고 판단해 범위에서 제외했다. 붓 스트로크(드래그로
여러 셀을 연속으로 걷는 것)는 단일 클릭으로만 확인했다 — `brushAccum` 누적 로직은 유닛
테스트가 아니라 코드 리뷰로만 검증했다(캔버스 pointer 이벤트 시퀀스를 자동화 테스트로
재현하는 비용 대비 실익이 낮다고 판단).

## DoD 체크리스트 (§3 범위 한정)

- [x] 새 실시간 op 3종(`fog.init` `fog.reveal` `fog.reset`) — 서버 구현 + 자동 테스트 +
      브라우저 실제 왕복 확인
- [x] `RoomState.fog`가 스냅샷에 포함되고 재접속 시 복원됨(자동 테스트 + 브라우저 새로고침
      확인)
- [x] DM이 붓으로 걷으면 플레이어 화면에 그 영역만 즉시 드러남(브라우저 실시간 확인)
- [x] 권한 검증: 플레이어는 안개 op 3종 전부 거부되고(`error forbidden`), UI에도 안개 조작
      버튼 자체가 없음
- [x] DM 클라이언트는 안개 레이어를 그리지 않고 항상 전체를 봄(브라우저로 시각 확인)
- [x] 캔버스 레이어 순서: 지도 → 안개 → 그리드 → 토큰 → 핑(PROMPT-stage4.md §3 요건대로)
- [x] 안개 상태 직렬화는 RLE로 압축(§8 성능 예산 — 이미지 압축 라이브러리 없이 순수 함수)
- [x] `pnpm test` 전부 green — 기존 108개 + 신규 12개 = 120개
- [x] `docs/PROTOCOL.md`에 신규 op 3종·`FogState` 타입·권한표 반영
- [x] `docs/STAGE4.md`(이 절) 갱신
- [x] README 로드맵 4단계 — §3 완료로 갱신(§4 WebRTC 음성만 남음, 부분 완료로 정직하게 표기)

---

# §4 WebRTC 음성 메시 + coturn (best-effort)

## 아키텍처 결정

### 시그널링은 기존 테이블 WS 채널의 순수 릴레이 — 방 상태가 아니다

새 HTTP 서버나 새 WS 엔드포인트를 만들지 않고 기존 `/ws/tables/:id` 채널에 op 3종
(`voice.offer` `voice.answer` `voice.ice`)을 얹었다. `character.set`·`fog.reveal`처럼
`RoomState`를 바꾸는 다른 op와 결정적으로 다른 점: **음성 시그널링은 방 상태를 전혀 안
건드린다.** `LiveRoom`에 새 필드를 추가하지 않았고, `room-registry.ts`의 `relay()` 메서드는
`broadcast()`와 달리 `seq`를 소비하지 않고 `dirty`도 세우지 않는다(`hello`/`error`와 같은
취급). 대상은 `toNickname`으로 지정한 소켓에만 가고, 그 소켓이 여러 개(같은 사람이 탭을
여러 개 열었을 때)면 전부에게 간다 — 어느 탭이 응답할지는 서버가 판단할 문제가 아니라고
봤다. 서버는 `data`(SDP/ICE)를 zod `z.unknown()`으로만 받고 절대 파싱·해석하지 않는다.

### 권한 — 역할 무관, 전원이 발신 가능

`fog.*`/`initiative.*`가 DM 전용인 것과 달리 음성 op 3종은 **DM·플레이어 구분 없이 전원**
쓸 수 있다. 음성은 진행 도구가 아니라 대화 수단이기 때문이다 — 권한표에 "역할 무관"으로
명시했다(`docs/PROTOCOL.md`).

### mesh 구성 — 닉네임 사전순으로 glare를 피한다

WebRTC의 "양쪽이 동시에 offer를 보내는" glare 문제를, perfect-negotiation 패턴(rollback 등)
없이 가장 단순하게 풀었다: **자기 닉네임이 상대보다 사전순으로 앞이면 offer를 보내지 않고
기다린다.** 두 참가자 모두 같은 규칙을 쓰므로 항상 정확히 한쪽만 먼저 offer를 보낸다.
mesh 규모가 §3에 이미 못 박힌 ≤6인이라 이 정도로 충분하다고 판단했다 — 초당 여러 번
연결이 맺어지고 끊기는 상황이 아니라 세션 시작 시점에 한 번씩 맺어지는 정적에 가까운
연결이라 glare 확률 자체가 낮다.

### 클라이언트 상태 관리 — `apps/web/src/voice/useVoice.ts`, TableCanvas와 같은 propsRef 패턴

`RTCPeerConnection`/`MediaStream`/`AnalyserNode` 전부 React state가 아니라 ref에 둔다(리렌더
때마다 재생성하면 안 되는 명령형 객체들이라) — `TableCanvas.tsx`가 Pixi `Application`을
다루는 것과 같은 패턴이다. 최신 `sendOp`/참가자 목록은 `optsRef`에 매 렌더 반영해서 내부
헬퍼 함수(`ensurePeer`/`connectTo`/`handleSignal`)가 stale closure 없이 항상 최신 값을 본다.
음성 시그널링 메시지(`voice.*`)는 `RoomState`가 아니라서 `table-reducer.ts`의
`applyServerMessage`가 그냥 무시(`default: return state`)하므로, `useTableSocket`에
`onMessage` 콜백을 추가해 원본 메시지를 그대로 `useVoice.handleSignal`로 넘기는 우회로를
새로 냈다(`useTableSocket.ts`).

### 말하는 사람 토큰 글로우 — 매 틱 다시 그리는 별도 레이어

CLAUDE.md §6 시그니처("말하는 사람의 토큰이 촛불처럼 빛난다")를 위해 `TableCanvas.tsx`에
`glow` 레이어를 토큰 레이어 바로 위, 핑 레이어 바로 아래에 새로 넣었다. `AnalyserNode`로
로컬/원격 오디오 트랙의 평균 볼륨을 200ms마다 폴링해 임계값을 넘으면 그 닉네임을
`speaking` Set에 넣고, 매 프레임(ticker) 그 Set에 속한 닉네임이 소유한 토큰 주변에 맥동하는
링을 그린다. DM이 소유한 토큰이 없으면(몬스터 토큰뿐이면) DM이 말해도 캔버스에는 아무것도
안 뜬다 — 대신 참가자 패널에 🕯 아이콘을 같이 달아서 토큰 소유 여부와 무관하게 누가 말하는
중인지 알 수 있게 보완했다.

### TURN 자격증명 — coturn 없이도 동작하는 게 기본값

`TURN_SECRET` 환경변수가 없으면 서버는 STUN 항목 하나(`stun:stun.l.google.com:19302`)만
돌려주고 TURN 자격증명 발급 자체를 건너뛴다 — CLAUDE.md §1이 "NAS는 릴레이만" 원칙을
말하듯, coturn도 강제 인프라가 아니라 안전망이다. `TURN_SECRET`이 있으면
`apps/server/src/turn-credentials.ts`의 순수 함수 하나가 coturn의 `use-auth-secret`
방식대로 `HMAC-SHA1(secret, "<만료초>:<nickname>")` 자격증명을 만든다 — DB에 사용자별
TURN 계정을 새로 만들지 않는다(PROMPT 요건 그대로). `docker-compose.yml`의 `coturn`
서비스는 릴레이 UDP 포트를 자유롭게 열어야 해서 `network_mode: host`를 쓴다 — bridge +
포트 매핑으로는 TURN이 광고하는 릴레이 후보가 컨테이너 내부 IP가 되어 못 쓴다는 걸 문서
검토 단계에서 확인했다(coturn 공식 문서의 권고 배포 방식).

## 실제로 검증한 것

**자동 테스트**: `pnpm test` — 기존 120개 + 신규 14개(서버 `table-ws.test.ts` +3: 지정한
상대에게만 voice.offer/answer/ice가 도착하고 내용이 그대로 전달됨 / 대상이 아닌 제3자에게는
전달되지 않음 / 시그널링이 방의 seq를 소비하지 않아 이후 일반 op의 seq가 끊기지 않음;
서버 `turn-credentials.test.ts` +4: username이 `만료초:nickname` 형태 / 같은 입력이면
결정론적으로 같은 credential / secret이 다르면 credential도 다름 / ttl을 그대로 반환;
서버 `turn-route.test.ts` +4: `TURN_SECRET` 없으면 STUN만 / 있으면 HMAC 자격증명이 담긴
TURN 항목 추가 / 로그인 없이는 401 / 없는 테이블은 404; 웹 `useVoice.test.ts` +3: 사전순으로
뒤에 오는 참가자에게만 먼저 offer를 보냄(glare 회피 규칙) / voice.offer를 받으면
voice.answer로 응답함 / toggleMute가 로컬 오디오 트랙의 enabled를 뒤집음 — jsdom엔
WebRTC API가 없어서 `RTCPeerConnection`/`AudioContext`/`getUserMedia`를 최소한만 모킹해
순수 시그널링 로직만 검증했다) = **134개 전부 green**. 서버·웹 `tsc --noEmit` 둘 다 통과.

**브라우저 두 탭으로 직접 확인한 것** (`pnpm --filter @hearthside/web build` 산출물 + 임시
`DATA_DIR`로 서버 기동, claude-in-chrome으로 두 탭 조작):

1. 회원가입 → 테이블 생성 → 초대 링크로 두 번째 회원 입장까지 §2·§3과 같은 방식으로
   재현하고, 참가자 패널에 "🎙 음성 켜기" 버튼이 두 탭 모두에 뜨는 것을 확인(역할 무관 —
   DM·플레이어 UI가 같다, 권한표대로).
2. "음성 켜기"를 눌렀을 때 버튼이 "연결하는 중..."으로 바뀌고, `navigator.mediaDevices.
   getUserMedia`가 실패하도록 모의(reject)한 상태에서 버튼이 정상 상태로 돌아오며 에러
   메시지("마이크에 접근할 수 없다" 계열)가 참가자 패널에 뜨는 것을 확인 — 실패해도
   테이블의 나머지 기능(지도·그리드·안개 등)이 전혀 막히지 않고 계속 조작 가능함을
   확인했다(마이크 실패 도중 "그리드 저장" 버튼을 눌러 정상 동작 확인).
3. `GET /api/tables/:id/turn-credentials`를 인증된 세션에서 실제로 호출해 `{iceServers:
   [{urls:["stun:stun.l.google.com:19302"]}], ttl}` 형태 응답을 받는 것을 확인(이 서버
   인스턴스는 `TURN_SECRET`을 안 채운 상태 — STUN-only 경로).

## §4 하지 못한 것 (정직하게 기록)

**실제 두 브라우저 사이의 마이크 음성 왕복(오디오가 실제로 들리는지)은 검증하지 못했다.**
이유: `navigator.mediaDevices.getUserMedia({audio: true})`를 호출하면 Chrome이 네이티브
권한 프롬프트를 띄우는데, 이 프롬프트는 페이지 콘텐츠 밖(브라우저 크롬 영역)에 뜨는 UI라
`claude-in-chrome`의 페이지 레벨 자동화 도구로는 클릭할 수 없다. `navigator.permissions.
query({name:"microphone"})`로 상태를 확인해보니 `"prompt"`로 멈춰 있었고(자동으로 허용되지
않음), getUserMedia의 Promise는 JS 이벤트 루프를 막지 않은 채(다른 UI 조작은 계속 가능함을
확인) 무기한 대기 상태가 된다. 이건 페이지가 죽거나 실수를 한 게 아니라 이 자동화 환경의
근본적 한계다 — PROMPT-stage4.md §4가 애초에 "실제 미디어 연결까지 자동화 테스트할 필요는
없다, WebRTC 연결 자체는 브라우저 필요"라고 명시해둔 바로 그 지점이다.

따라서 다음은 **코드 리뷰와 부분 검증으로만** 확인했고, 사람이 실제 마이크가 있는 두 대의
기기(또는 크롬 프로필)로 열어서 최종 확인해야 한다:
- 두 참가자가 실제로 서로의 목소리를 듣는지
- 말할 때 토큰이 실제로 빛나는지(글로우 로직 자체는 `useVoice.speaking` Set과
  `TableCanvas`의 `redrawGlow()`로 구현·타입체크는 통과했지만, 실제 오디오 볼륨 임계값이
  체감상 적절한지는 사람 귀로 들어봐야 안다 — `SPEAKING_VOLUME_THRESHOLD = 12`는 추정치다)
- 음소거 버튼을 눌렀을 때 상대방이 실제로 못 듣는지(로컬 트랙 `enabled = false`로 구현했고
  이건 WebRTC 표준 동작이라 신뢰할 수 있지만 청각 확인은 못 했다)
- coturn을 통한 TURN 릴레이 폴백(대칭형 NAT 등 STUN이 실패하는 환경) — `TURN_SECRET`을
  채운 배포 자체를 이 세션에서 띄워보지 않았다(`docker-compose.yml`의 `coturn` 서비스와
  `turn-route.test.ts`의 HMAC 자격증명 발급 로직은 검증했지만, 실제 coturn 컨테이너가
  뜬 상태에서 진짜 TURN 릴레이가 동작하는지는 확인 못 함)

## DoD 체크리스트 (§4 범위 한정, PROMPT-stage4.md 기준 — best-effort 항목은 "(모의 확인)"으로 표기)

- [x] 새 시그널링 op 3종(`voice.offer` `voice.answer` `voice.ice`) — 기존 WS 채널 재사용,
      서버는 SDP/ICE 내용을 해석하지 않고 릴레이만 함(자동 테스트로 증명)
- [x] `docker-compose.yml`에 `coturn` 추가, TURN 자격증명은 서버가 발급(짧은 TTL 공유 비밀
      기반, DB에 사용자별 TURN 계정 없음)
- [x] 말하는 사람 토큰이 촛불처럼 빛나는 연출 — 구현 완료, 볼륨 임계값 기반 로직(브라우저
      마이크 없이는 육안 확인 불가, (모의 확인)만 함)
- [x] 음소거 버튼, 전체 꺼짐(음성 끄기) 옵션 — UI·로컬 트랙 제어 구현 완료
- [ ] (best-effort, 미검증) 브라우저 두 개가 서로의 목소리를 듣는다 — 이 자동화 환경의
      마이크 권한 프롬프트 한계로 실측 못 함, 사람이 실기기로 확인 필요
- [x] 새 런타임 의존성 0 — WebRTC는 브라우저 네이티브 API, TURN 자격증명은 `node:crypto`
- [x] `pnpm test` 전부 green — 기존 120개 + 신규 14개 = 134개
- [x] `docs/PROTOCOL.md`에 신규 op 3종·TURN 자격증명 엔드포인트·권한표 반영
- [x] `docs/STAGE4.md`(이 절) 갱신 — "하지 못한 것" 절 포함
- [x] README 로드맵 4단계 — 이걸로 4단계 전체를 마무리 표기(WebRTC는 best-effort 완료로
      정직하게 명시, 억지로 "완전 검증됨"이라 안 씀)

## 다음으로 넘기는 것

4단계 네 항목 전부 코드·문서 레벨로 끝났다. v0.5의 "라이브 테이블" 필러가 완성됐다는 뜻이다.
남는 건 "스튜디오 + 솔로 러너" 필러의 문서 우선 에디터뿐 —
[`PROMPT-stage5.md`](../PROMPT-stage5.md)가 이미 준비돼 있다. 실기기 음성 확인은 급하면
지금, 아니면 5단계와 병행해도 무방하다(§4가 다른 무엇도 막고 있지 않다 — PROMPT가 명시한
"음성이 없어도 테이블은 완전히 돌아간다"가 유효하다).
