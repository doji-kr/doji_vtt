# 화롯가 (Hearthside)

> Synology DS920+에 셀프호스팅하는 5e 호환 TRPG 플랫폼.
> **"TRPG 시나리오의 넷플릭스 + 그것을 만드는 스튜디오 + 상영관(라이브 테이블)을 한 지붕에."**

프로젝트 헌장은 [CLAUDE.md](./CLAUDE.md)에 있다 — 절대 원칙, 기술 스택, 디자인 시스템,
코딩 컨벤션 등 모든 결정의 근거는 그 문서가 우선한다. 이 README는 "지금 뭐가 되어 있고
뭐가 남았는지"를 보여주는 진행 현황판이다.

## 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| **1단계** | 시나리오 스키마 v0.1 + 헤드리스 런타임 (schema·runtime·린터·CLI) | ✅ 완료 |
| **2단계** | 브라우저 솔로 러너 세로 슬라이스 (서버 권위 실행 + Docker 배포) | ✅ 완료 |
| **3단계** | 라이브 테이블 코어 (WS 이벤트 릴레이, PixiJS 씬/토큰, 실시간 주사위, coturn, 인증 본편) | ⬜ 예정 |
| **v0.5** | 세 필러(플랫폼 셸·라이브 테이블·스튜디오+솔로 러너) 완성 | 진행 중 (1·2단계 = 솔로 러너 축) |
| **v1.0** | 솔로 전투, 타일 페인터(47-blob 오토타일), SRD 몬스터 컴펜디움, 업적 스탬프 | ⬜ |
| **v1.5** | AI DM(module.json이 대본이자 가드레일), 동적 조명 | ⬜ |
| **v2.0** | 룰북 빌더, 모듈 zip 이식, 평점·리뷰, 앰비언스 사운드보드 | ⬜ |

v0.5의 세 필러는 [CLAUDE.md §2](./CLAUDE.md#2-제품-형태--세-필러-v05-mvp) 참고.
MVP 성공 기준: "스튜디오에서 만든 시나리오를 친구는 라이브로, 다른 친구는 혼자 완주한다."

## 지금까지 만든 것

### 1단계 — 헤드리스 코어

- **`packages/schema`** — `module.json` 스키마 v0.1(zod), 린터 R1~R6, JSON Schema 자동 생성.
  필드별 의미와 예시는 [SCHEMA.md](./packages/schema/SCHEMA.md).
- **`packages/runtime`** — 순수 함수 상태머신(`createRun`/`step`/`replay`). 사이드이펙트·랜덤·IO
  없음. `Effect` 타입에 `dm_notes`가 애초에 존재하지 않아 플레이어 채널 오염이 타입 수준에서
  불가능하다.
- **`apps/cli`** — `pnpm hearth lint <path>` / `pnpm hearth play <path>`.
- **`content/modules/rats-in-the-cellar`** — 샘플 시나리오 "지하실의 쥐들". 씬 8개, 판정 3개
  (fail-forward 쇼케이스 포함), 분기 2개, 조우 1, 비밀 1, 핸드아웃 1, 엔딩 2종. 린트 error 0,
  `soloPlayable: true`.

세부 계약과 1단계에서 바뀐 설계 결정은 [docs/STAGE1-HANDOFF.md](./docs/STAGE1-HANDOFF.md).

### 2단계 — 브라우저 솔로 러너 + 배포

- **`apps/server`** — Fastify + better-sqlite3(WAL). **서버 권위 실행**: 클라이언트는
  `module.json` 원문을 절대 받지 않고 `Effect[]`만 받는다. 세이브는 SQLite `plays.log_json`
  (입력 로그) 하나뿐이며 `replay()`로 매번 복원한다. 인증은 초대코드+닉네임 서명 쿠키(라이트).
- **`packages/pixel-ui`** — 화롯가 디자인 시스템 시드(CLAUDE.md §6 토큰) —
  ParchmentPanel · WoodButton · PosterCard · DiceTray · CandleLoading · EndingCard.
- **`apps/web`** — React + Vite(PixiJS 미사용 — 게임북 UI는 DOM이 맞다는 판단). 서가(모듈 카드,
  자동 포스터, 이어서 하기) + 플레이 화면(Effect 스트림 렌더, 주사위 트레이).
- **`docker/`** — 멀티스테이지 Dockerfile + docker-compose. 실제로 이미지 빌드부터 컨테이너
  기동, 브라우저 완주, 재시작 후 이어하기, 유휴 메모리(~70MiB)까지 직접 검증했다.

작업 기록과 성능 측정치는 [docs/STAGE2.md](./docs/STAGE2.md), NAS 배포 절차는
[docs/DEPLOY.md](./docs/DEPLOY.md).

### 검증 상태

- `pnpm test` — **33개 테스트 전부 green** (schema 17 + runtime 8 + server e2e 6 + web 컴포넌트 2).
- 채널 분리 증명 테스트: 모든 API 응답 직렬화 결과에 `dm_notes`/`Npc.secret` 문자열이
  등장하지 않음을 자동 검사.
- 두 엔딩("봉인, 다시" / "평범한 하루") 모두 CLI·API·브라우저 각 경로에서 완주 확인.

## 남은 것

- **R7 린터 규칙(백로그)** — choice 블록에 조건 없이 항상 보이는 옵션이 하나도 없어 생기는
  소프트락을 저작 시점에 정적으로 잡는 규칙. 지금은 서버 레이어 가드(409)로만 막고 있다.
- **3단계 — 라이브 테이블 코어**: WebSocket 이벤트 릴레이, PixiJS 씬/토큰 렌더링, 실시간 주사위,
  coturn(WebRTC 음성 NAT 폴백), 계정 시스템 본편(argon2id).
- **v0.5 나머지**: 문서 우선 에디터(슬래시 블록), 자동 포스터 생성 고도화, 이중 프로필,
  홈 라이브러리 4줄 구성.
- 세션 도중 발견한 배포 환경 관찰(Windows/git-bash에서 `docker compose`에 인라인 환경변수를
  넘기면 반영이 안 되는 경우) — `docker/.env` 파일 사용으로 우회, DEPLOY.md에 명시.

## 로컬에서 돌려보기

```bash
pnpm install
pnpm test                                              # 전체 테스트
pnpm hearth lint content/modules/rats-in-the-cellar    # 린트
pnpm hearth play content/modules/rats-in-the-cellar    # 터미널에서 플레이

# 브라우저로 플레이 (서버+웹)
pnpm --filter @hearthside/web build
DATA_DIR=./apps/server/data INVITE_CODE=test SESSION_SECRET=devsecret \
  pnpm exec tsx apps/server/src/index.ts
# http://localhost:3000 접속

# 또는 Docker로
cd docker && cp .env.example .env   # SESSION_SECRET·INVITE_CODE 채우기
docker compose up --build
```

## 리포 구조

```
hearthside/
  packages/
    schema/      # module.json 타입·zod·린터·JSON Schema
    runtime/      # 헤드리스 재생 엔진
    pixel-ui/     # 디자인 시스템 React 컴포넌트
  apps/
    cli/          # hearth lint / hearth play
    server/       # Fastify + SQLite + 정적 서빙
    web/          # React + Vite 클라이언트
  content/
    modules/      # 손으로 쓴 시나리오
  docker/         # Dockerfile, docker-compose
  docs/           # 단계별 작업 기록·배포 가이드
```

자세한 구조 원칙은 [CLAUDE.md §4](./CLAUDE.md#4-리포-구조-pnpm-모노레포).
