# 4단계 작업 기록 — §1 계정 본편 + §2 5e 라이트 시트·이니셔티브·HP/상태

## 재개 방법 (다음 세션에서 이어가기)

**지금 상태**: §1(계정 본편)·§2(5e 라이트 시트·이니셔티브·HP/상태) 끝났다. `pnpm test`
108개 전부 green. §3(수동 안개)부터 이어가면 된다.

새 세션에서:
1. `PROMPT-stage4.md`를 읽게 시키되, **§1·§2는 이미 끝났으니 건너뛰고 §3("수동 안개")부터
   시작**하라고 알려준다 — 이 문서의 "§1 아키텍처 결정"·"§2 아키텍처 결정" 절을 먼저 읽혀서
   회원/게스트 구분과 캐릭터·이니셔티브 실시간 op가 어떻게 생겼는지 파악시킨 다음 진행한다.
2. §3은 `RoomState`에 `fog` 필드를 추가하고 새 캔버스 레이어를 그리는 작업이다 — §2에서
   `characters`/`initiative`를 `RoomState`에 추가하고 `LiveRoom.snapshot()`/`flush()`에
   엮은 패턴(`apps/server/src/room-registry.ts`)을 그대로 재사용하면 된다.
3. 순서는 여전히 "계정 → 5e 시트 → 안개 → 음성"이다 — §3 끝나면 §4(WebRTC 음성,
   best-effort)로 이어간다.
4. README 로드맵 4단계 행은 네 항목이 전부(또는 WebRTC를 제외한 나머지가) 끝난 뒤 마지막에
   한 번에 정리한다 — 지금은 의도적으로 미갱신 상태다.

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
- [ ] README 로드맵 4단계 — 여전히 미갱신(§3 안개, §4 음성 남음)
