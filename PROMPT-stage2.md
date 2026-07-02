# PROMPT — 2단계: 브라우저 솔로 러너 세로 슬라이스 (서버 권위 실행 + NAS 배포)

> 사용법: 리포 루트에서 Claude Code 새 세션에 이 파일 내용을 그대로 전달한다.
> 전제: 1단계(schema · runtime · CLI · 샘플 모듈) 완료 — 테스트 25개 green,
> `rats-in-the-cellar` lint error 0 / soloPlayable: true, 터미널 두 엔딩 완주 검증됨.

## 역할과 컨텍스트

너는 「화롯가」의 리드 엔지니어다. 시작 전에 `CLAUDE.md`(특히 §1, §3, §4, §6, §8)와
`packages/schema/SCHEMA.md`를 정독하라. **1단계 산출물의 공개 API(schema 타입, runtime의
`createRun`/`step`/`replay`, Effect/Input 타입)는 이번 단계에서 변경 금지다** —
바꿔야만 한다면 멈추고 이유와 대안을 제시한 뒤 승인을 받는다.

## 목표

「지하실의 쥐들」을 **브라우저에서** 플레이한다. 탭을 닫거나 서버를 재시작해도 이어하기가 되고,
결과물은 `docker compose up` 한 번으로 DS920+에 올라간다. 이것이 플랫폼의 첫 세로 슬라이스다:
서가(최소) → 플레이 → 세이브 → 배포.

## 핵심 아키텍처 결정 (이 단계의 심장)

**런타임은 서버에서만 실행한다 (서버 권위).**

- 클라이언트는 `module.json` 원문을 **절대 받지 않는다.** 원문에는 `dm_notes` ·
  `Secret.dm_notes` · `Npc.secret`이 들어 있고, 이것이 브라우저에 내려가는 순간
  CLAUDE.md §1.3(채널 분리)이 무너진다.
- 클라이언트는 **Input을 보내고 Effect[]만 받는다.** Effect 타입은 1단계에서 이미
  dm_notes가 존재할 수 없게 설계되어 있다 — 이 보증을 네트워크 경계까지 확장하는 것이다.
- 서버는 플레이 상태를 메모리에 들고 있을 필요가 없다: **저장된 입력 로그를 `replay()`로
  복원 → `step()` → 로그에 append**가 기본 경로다(로그는 짧다 — 순수 함수의 보상).
  성능이 문제되면 그때 LRU 캐시를 얹는다(선측정 없이 캐시부터 만들지 마라).

## 산출물 (전부 필수)

### 1. `apps/server` — Fastify + better-sqlite3(WAL)

REST API (모두 `/api` 아래, zod로 요청/응답 검증):

| 메서드 | 경로 | 내용 |
|---|---|---|
| GET | `/api/modules` | 서가 목록. `content/modules/` 스캔 → **lint를 통과한 모듈만** 노출. 항목: id, title, logline, difficulty, estimated_minutes, tags, soloPlayable, poster_url |
| GET | `/api/modules/:id` | 위 메타의 단건. **scenes/npcs 등 본문은 절대 포함하지 않는다** |
| POST | `/api/plays` | 새 플레이 생성 `{module_id, nickname}` → `{play_id, effects}` (createRun 결과) |
| GET | `/api/plays/:id` | 이어하기: replay로 복원한 **현재 대기 상태의 Effect[] 재구성** + 진행 정보(ended, ending) |
| POST | `/api/plays/:id/inputs` | `{input: Input}` → 서버가 replay+step → 로그 저장 → `{effects, ended}`. 잘못된 입력은 400 + 런타임의 한국어 에러 메시지 |
| GET | `/api/plays?nickname=` | 내 플레이 목록(이어하기 카드용): module_id, updated_at, ended, ending_id |

- SQLite 테이블: `plays(id TEXT PK, module_id, nickname, log_json, ended INTEGER,
  ending_id TEXT NULL, created_at, updated_at)` — 세이브의 유일한 진실은 `log_json`이다.
- 인증 라이트: 환경변수 초대코드 1개 + 닉네임 → 서명된 쿠키 세션. 계정/argon2/프로필은 3단계.
- 정적 서빙: `apps/web` 빌드 결과물. DB 파일과 콘텐츠 경로는 env로(`DATA_DIR`, `CONTENT_DIR`).

### 2. `packages/pixel-ui` — 디자인 시스템 시드 (React)

CLAUDE.md §6의 토큰을 CSS 변수로 박고, 이번 단계에 필요한 최소 컴포넌트만:
`ParchmentPanel`, `WoodButton`, `PosterCard`(soloPlayable 배지 포함),
`DiceTray`(아래 3번), `CandleLoading`(로딩 문구: "촛불을 켜는 중…" 류), `EndingCard`.
과잉 일반화 금지 — 지금 쓰는 것만 만든다.

### 3. `apps/web` — React + Vite (PixiJS **금지** — 게임북 UI는 DOM이 맞다)

- **서가 화면**: 모듈 카드 목록(포스터·제목·로그라인·난이도·예상시간·soloPlayable 배지),
  내 이어하기 카드(진행 중 플레이). 포스터가 없으면 **자동 포스터 v0**: 제목 + §6 팔레트로
  만드는 결정적(모듈 id 시드) SVG — 서가에 빈칸이 없게.
- **플레이 화면**: Effect 스트림을 그대로 렌더한다 —
  `showReadAloud`(양피지 본문) · `narrate`(굴림 결과 서술) · `showChoices`(나무 버튼) ·
  `requestCheck`(**주사위 트레이**: d20 픽셀 스프라이트 굴림 애니 + 수정치 입력 → 합계가
  `resolveCheck.total`) · `startEncounter`(조우 카드, v0.5는 "계속" 버튼으로 서사 진행) ·
  `giveHandout`(소품 카드) · `revealSecret` · `end`(엔딩 카드 + "서가로" + "처음부터").
- 새로고침 복원: `GET /api/plays/:id`로 이어하기. 진행 중 이탈 후 서가에 돌아오면
  "이어서 하기"가 보인다.
- 미학: §6 준수 — 숯 배경 위 양피지, 촛불 앰버 강조, 픽셀 폰트는 제목만. 이모지 남발 금지.

### 4. Docker + 배포 문서

- 멀티스테이지 `Dockerfile`(pnpm build → node:22-slim 실행, 비루트 유저),
  `docker/docker-compose.yml`(app 하나, 볼륨 `/data`; coturn은 3단계).
- `docs/DEPLOY.md`: DS920+ 컨테이너 매니저 설치 절차, 역프록시(또는 Tailscale) 요약,
  백업은 `/data` 폴더 하나(Hyper Backup)임을 명시.

### 5. `docs/STAGE2.md` — 작업 기록 (이번 단계부터 필수 관례)

내린 결정과 근거 / 미결·백로그 / 다음 단계에 넘기는 것. **1단계 백로그 두 건을 반드시 포함해 처리하라**:
- (a) choice의 가시 옵션이 0개가 되는 소프트락 → 런타임 가드가 아닌 **서버 계층 가드**로:
  showChoices의 options가 비면 500이 아니라 명확한 에러 보고 + STAGE2.md에 "R7(정적 감지) 검토"로 기록.
  ※ runtime 패키지 수정은 금지 원칙에 걸리므로, 필요하다고 판단되면 승인 게이트로 가져와라.
- (b) 세이브 영속화 — 본 단계 산출물 1로 해소됨을 명시.

### 6. 테스트

- 서버 e2e(vitest + fastify.inject): 플레이 생성→입력→엔딩 전체 흐름 / 이어하기 복원 /
  잘못된 입력 400 / 초대코드 없는 접근 401.
- **채널 분리 증명 테스트**: 모든 API 응답 직렬화 결과에 샘플 모듈의 dm_notes ·
  Secret.dm_notes · Npc.secret **문자열이 등장하지 않음**을 자동 검사한다(고정 문자열 grep 방식).
  이 테스트가 이 단계의 대표 테스트다.
- web은 핵심 흐름 1개(플레이 화면 상태 전이) 컴포넌트 테스트면 충분.

## 제약

- 새 서버 의존성은 fastify, @fastify/static, @fastify/cookie, better-sqlite3, zod 수준을 넘지 않는다.
  넘어야 하면 커밋 메시지에 정당화(CLAUDE.md §3).
- 성능 예산(§8): 유휴 서버 RSS < 200MB, API p95 < 100ms(replay 경로 포함, 로컬 기준).
- UI 문자열은 §6 카피 톤. 에러도 여관 주인 말투를 유지하되 정보는 정확하게.

## 진행 방식

1. **먼저 1페이지 설계를 제시하고 멈춰라**: API 계약(요청/응답 예시 JSON), DB 스키마 DDL,
   화면 흐름(서가→플레이→엔딩→서가) 다이어그램 텍스트. 내 승인 후 구현.
2. 승인 후 순서: server(+테스트) → pixel-ui → web → docker → docs. 단계마다 실행 증거 제시.
3. 보고와 커밋 메시지는 한국어.

## 완료 기준 (Definition of Done)

- [ ] `docker compose up` 후 브라우저에서 「지하실의 쥐들」 **두 엔딩 모두** 완주
- [ ] 플레이 도중 새로고침·서버 재시작 후에도 정확히 그 지점에서 이어하기
- [ ] 채널 분리 증명 테스트 통과 — dm_notes 계열 문자열이 어떤 API 응답에도 없음
- [ ] `GET /api/modules`가 soloPlayable 배지와 자동 포스터를 내려준다
- [ ] `pnpm test` 전부 green (1단계 25개 포함, 서버 e2e 추가분 포함)
- [ ] `docs/STAGE2.md`와 `docs/DEPLOY.md` 존재, 1단계 백로그 2건의 처리 내역 포함
- [ ] 유휴 RSS < 200MB 측정값을 STAGE2.md에 기록

## 하지 말 것

라이브 테이블 · WebSocket · WebRTC · PixiJS · 계정 시스템 풀버전(argon2, 프로필) ·
홈 4줄 라이브러리 · 에디터 · AI 호출 — 전부 다음 단계다.
**3단계 예고**: 라이브 테이블 코어(WS 이벤트 릴레이 스파이크 + PixiJS 씬/토큰 + 실시간 주사위),
그때 coturn과 인증 본편이 함께 온다. 이번 단계의 성공은
"NAS에 올라간 화롯가에서, 브라우저로 지하실의 쥐를 잡고, 내일 이어서 잡는 것"이다.
