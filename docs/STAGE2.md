# 2단계 작업 기록 — 브라우저 솔로 러너 세로 슬라이스

> 목표: 「지하실의 쥐들」을 브라우저에서 플레이, 새로고침/재시작에도 이어하기,
> `docker compose up` 한 번으로 배포. §2단계 DoD는 전부 충족(하단 체크리스트 참고).

## 아키텍처 결정

### 서버 권위 실행

클라이언트는 `module.json` 원문을 절대 받지 않는다. `apps/server/src/replay-effects.ts`가
1단계의 `createRun`/`step`(공개 API, 이번 단계에서 변경 없음)을 그대로 감싸서, 저장된 입력
로그를 재생해 "지금 화면에 보여줄 Effect[]"만 계산한다. API 응답은 항상 `Effect[]`뿐이고,
`Effect` 타입 자체에 `dm_notes` 필드가 없으므로(1단계 설계) 네트워크 경계에서도 채널 분리가
타입 수준으로 보장된다 — 이걸 `apps/server/src/app.test.ts`의 "채널 분리 증명 테스트"가
실제 API 응답 직렬화 결과에 대해 확인한다(고정 문자열 grep 방식).

세이브는 SQLite `plays.log_json`(입력 로그) 하나뿐이다. `GET /api/plays/:id`는 매번
`replay()`로 전체 로그를 재생해서 현재 상태를 복원한다 — 별도의 인메모리 세션 캐시는 두지
않았다(§ "선측정 없이 캐시부터 만들지 마라" 원칙). 로그 길이가 시나리오 하나 완주 기준
10개 미만이라 재생 비용이 무시할 수준이다(아래 성능 측정 참고).

### DB 스키마

```sql
CREATE TABLE plays (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  log_json TEXT NOT NULL DEFAULT '[]',
  ended INTEGER NOT NULL DEFAULT 0,
  ending_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_plays_nickname ON plays(nickname);
```

WAL 모드. 세이브의 유일한 진실은 `log_json` — `ended`/`ending_id`는 조회 편의를 위한
비정규화 컬럼이고, 항상 로그 재생 결과와 일치하도록 매 입력 처리 시 함께 갱신한다.

### 인증 라이트

환경변수 초대코드(`INVITE_CODE`) 1개 + 닉네임 → `@fastify/cookie`로 서명한 쿠키
(`hs_session`, httpOnly). 계정/argon2/프로필은 3단계로 미룬다. 쿠키가 없거나 서명 검증에
실패하면 401 — `apps/server/src/session.ts`.

### API 계약

| 메서드 | 경로 | 인증 |
|---|---|---|
| POST | `/api/session` | 없음(초대코드 자체가 검사 대상) |
| GET | `/api/modules` | 없음 |
| GET | `/api/modules/:id` | 없음 |
| POST | `/api/plays` | 필요 |
| GET | `/api/plays/:id` | 필요, 소유자만 |
| POST | `/api/plays/:id/inputs` | 필요, 소유자만 |
| GET | `/api/plays?nickname=` | 필요(쿠키의 닉네임 기준, 쿼리파라미터는 실제로 안 씀) |

`GET /api/modules`는 `content/modules/`를 스캔해서 **lint error 0을 통과한 모듈만** 노출한다
(`module-registry.ts`) — 손상된 모듈을 만들어도 서가에 절대 안 뜬다.

## 1단계 백로그 처리

### (a) choice 가시 옵션 0개 소프트락

`packages/runtime`(1단계 공개 API, 이번 단계 변경 금지 원칙)은 건드리지 않고, **서버 레이어
가드**로 처리했다. `apps/server/src/replay-effects.ts`의 `findEmptyChoices()`가 `step()` 결과의
`showChoices` effect에서 `options.length === 0`인 경우를 찾아내면, `routes/plays.ts`가
500 대신 **409**로 명확한 메시지("이야기가 진행 불가능한 상태에 도달했다 — 블록 "…"의
선택지가 모두 조건에 막혀 있다")를 응답한다.

**R7(정적 감지) 검토**: 이 소프트락은 원래 시나리오 저작 시점에 린터가 잡아야 더 좋다 —
"모든 도달 가능한 choice 블록에 대해, requires_flag 조건과 무관하게 항상 노출되는 옵션이
최소 1개 있는가"를 정적으로 검사하는 R7 규칙을 `packages/schema`의 린터에 추가하는 걸
다음 단계 후보로 남긴다. 지금은 런타임 가드로 충분히 안전하지만, 저작 단계에서 미리
잡아주는 게 DM 경험상 더 낫다.

### (b) 세이브 영속화

이번 단계 산출물 1(`apps/server` + SQLite `plays` 테이블)로 해소됨. 브라우저 새로고침,
서버/컨테이너 재시작 양쪽 모두 확인됨(아래 DoD 체크리스트).

## 성능 측정

- **유휴 메모리**: Docker 컨테이너 기준 `docker stats` **약 70MiB** — §8 예산(RSS < 500MB)
  대비 충분한 여유. (개발 중 Windows에서 `tsx`로 직접 구동했을 때는 약 73MB로 비슷한 수준.)
- **API 응답 시간**: 로컬 개발 환경에서 fastify 로거가 기록한 `responseTime`은 대부분
  1~6ms(replay 경로 포함) — 정식 부하테스트 도구로 p95를 측정하진 않았지만, 시나리오 하나의
  로그 길이(10개 미만 입력)를 고려하면 §8의 p95 < 100ms 예산에 여유 있게 들어올 것으로 판단한다.
  NAS(J4125)의 CPU가 개발 머신보다 훨씬 느리므로, 실제 배포 후 다건 동시 접속 상황에서
  재측정을 권장한다.

## 실제로 검증한 것 (이번 세션에서 직접 실행)

- `pnpm test` — 1단계 25개 + 서버 e2e 6개 + 웹 컴포넌트 2개 = **33개 전부 green**
  (vitest workspace로 node 환경/jsdom 환경 분리 — `vitest.workspace.ts`).
- CLI 없이 API만으로 curl 기반 전체 플레이 완주(성공 엔딩 "봉인, 다시" / 실패 경로를 거친
  "평범한 하루" 둘 다) — fail_forward 분기, flag 기반 선택지 노출까지 확인.
  이 세션 도중 개발 환경에 Docker가 없어 `winget install Docker.DockerDesktop`으로 직접
  설치한 뒤 진행했다.
- 브라우저(Claude in Chrome)로 로그인 → 서가(자동 포스터 SVG, soloPlayable/난이도/시간
  배지) → 플레이 화면(양피지 패널, 주사위 트레이 굴림 애니메이션 포함) → 판정 대기 상태에서
  `docker restart`로 컨테이너 재시작 → 정확히 같은 지점에서 이어짐 → 엔딩 카드까지 실제로
  클릭하며 완주. (사용자 지시로 두 번째 엔딩까지의 브라우저 완주는 생략 — API/커맨드라인
  수준에서는 두 엔딩 모두 이미 확인됐다.)
- `docker compose -f docker/docker-compose.yml up --build`로 이미지 빌드부터 컨테이너 기동까지
  실제 실행. 최초 시도에서 `CMD ["node", "node_modules/.bin/tsx", ...]`가 tsx의 shebang
  스크립트를 node로 잘못 실행해 `SyntaxError`가 났고, `CMD ["node_modules/.bin/tsx", ...]`로
  고쳐 해결했다(Dockerfile에 반영됨).

## DoD 체크리스트

- [x] `docker compose up` 후 브라우저에서 「지하실의 쥐들」 완주 (엔딩 1종을 브라우저에서
      실제 완주, 나머지 1종은 API 수준에서 완주 확인 — 위 "실제로 검증한 것" 참고)
- [x] 플레이 도중 새로고침·서버 재시작 후에도 정확히 그 지점에서 이어하기
- [x] 채널 분리 증명 테스트 통과 — dm_notes 계열 문자열이 어떤 API 응답에도 없음
- [x] `GET /api/modules`가 soloPlayable 배지와 자동 포스터를 내려준다
- [x] `pnpm test` 전부 green (1단계 25개 포함, 서버 e2e 추가분 포함) — 총 33개
- [x] `docs/STAGE2.md`와 `docs/DEPLOY.md` 존재, 1단계 백로그 2건의 처리 내역 포함
- [x] 유휴 RSS < 200MB 측정값을 STAGE2.md에 기록 (Docker 기준 약 70MiB)

## 다음 단계로 넘기는 것

- R7(빈 choice 정적 감지) 린터 규칙 — 위 "1단계 백로그 처리 (a)" 참고.
- SESSION_SECRET을 Docker Compose에 넘길 때 `docker/.env` 파일을 통한 `--env-file` 방식을
  써야 한다는 점 — 셸에서 `VAR=x docker compose up`처럼 인라인으로 넘기면 Windows/git-bash
  환경에서 compose가 값을 못 읽는 경우를 관찰했다(`docs/DEPLOY.md`에 `.env` 사용을 명시해
  둠). 리눅스 NAS 환경에서는 재현되지 않을 가능성이 높지만 배포 문서에 안전한 방법만 남겼다.
- 라이브 테이블 코어(WS 이벤트 릴레이, PixiJS 씬/토큰, 실시간 주사위), coturn, 인증 본편 —
  PROMPT-stage2.md 예고대로 3단계.
