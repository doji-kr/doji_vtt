# PROMPT — 시나리오 스키마 v0.1 + 헤드리스 런타임 설계·구현

> 사용법: 리포 루트에 `CLAUDE.md`를 둔 상태에서, Claude Code 새 세션에 이 파일 내용을 그대로 전달한다.

## 역할과 컨텍스트

너는 「화롯가」의 리드 엔지니어다. 시작하기 전에 리포 루트의 `CLAUDE.md`를 정독하라 —
특히 **§1 절대 원칙, §4 리포 구조, §5 데이터 모델**. 이 프롬프트와 CLAUDE.md가 충돌하면 CLAUDE.md가 옳다.

## 목표

시나리오 포맷 `module.json`의 **스키마 v0.1**과, 그것을 재생하는 **헤드리스 런타임**을 설계·구현한다.
완료 시점에 나는 터미널에서 샘플 시나리오를 처음부터 끝까지 플레이할 수 있어야 한다.
UI·서버·DB·네트워크는 이번 범위가 아니다.

이 단계가 프로젝트 전체의 초석이다: 여기서 만드는 포맷을 라이브 테이블, 솔로 러너,
그리고 v1.5의 AI DM이 똑같이 재생한다.

## 산출물 (전부 필수)

### 1. `packages/schema`
- TypeScript 타입 + zod 스키마: `Module`, `Meta`, `Scene`, `Block`(= `Check | Choice | Encounter | Handout | Secret`), `Npc{wants, fears, secret}`, `Flag`, soft/hard edge 구분
- JSON Schema export → `module.schema.json` (에디터 자동완성용)
- `SCHEMA.md`: 필드별 의미와 손으로 쓴 예시. 다음 세 가지는 반드시 설명한다:
  `read_aloud`/`dm_notes`의 채널 분리, `fail_forward`의 의미, soft edge와 hard edge의 차이.

### 2. 시나리오 린터 — `lint(module): LintResult[]`
| 규칙 | 내용 | 심각도 |
|---|---|---|
| R1 dead-fail | check의 fail에 goto가 없거나 진행 불가 | error |
| R2 orphan-scene | 시작 장면에서 hard edge로 도달 불가 (soft로만 도달 = "라이브 전용" 표시) | warn |
| R3 broken-ref | 존재하지 않는 goto/encounter/handout/flag 참조 | error |
| R4 missing-dc | check에 dc 없음 | error |
| R5 loop-no-progress | 플래그 변화 없는 hard 사이클 | warn |
| R6 solo-playable | error 0 + 모든 경로가 hard edge로 엔딩에 도달 가능 → `soloPlayable: true` 배지 산출 | info |

`LintResult = { ruleId, severity, sceneId?, message, hint }` — hint는 고치는 방법을 한 문장으로.

### 3. `packages/runtime` — 헤드리스 상태머신
- `createRun(module, opts?) => RunState`
- `step(state, input) => { state, effects }` — **순수 함수**. 사이드이펙트·랜덤·IO 금지.
- Input: `{type:'continue'} | {type:'choose', optionId} | {type:'resolveCheck', total}`
  — **엔진은 주사위를 굴리지 않는다.** 굴림 결과는 바깥 세계(실제 주사위 UI, 테스트, 훗날 AI)가 넣어준다.
  테스트 편의용 seeded 굴림 헬퍼는 엔진 밖 유틸로 별도 제공.
- Effect: `showReadAloud | requestCheck | showChoices | startEncounter | giveHandout | revealSecret | setFlag | end`
  — **dm_notes는 어떤 Effect 타입에도 포함될 수 없게 설계한다** (타입 수준에서 플레이어 채널 오염 차단).
- 세이브 = 입력 로그: `replay(module, inputs) => RunState`. 같은 입력 시퀀스는 항상 같은 상태.

### 4. `content/modules/rats-in-the-cellar/` — 샘플 「지하실의 쥐들」 (한국어)
- 장면 6~8개, 판정 3개 이상(그중 하나는 fail_forward가 돋보이는 설계), 분기 2개,
  조우 1, 비밀 1, 핸드아웃 1, 엔딩 2종
- 30분 분량 입문작 톤. 린트 error 0, `soloPlayable` 배지 획득이 필수 조건.

### 5. CLI
- `pnpm hearth lint <path>` — 린트 결과를 사람이 읽기 좋게 출력
- `pnpm hearth play <path>` — 터미널 텍스트 러너: read_aloud 출력 → 선택지/판정 입력(직접 굴린 값 입력) → 완주

### 6. 테스트 (vitest)
- 스키마: 샘플 모듈 파싱 라운드트립
- 린터: 규칙(R1~R6)별 위반 픽스처 1개 + 통과 픽스처 1개
- 러너: 성공 경로 완주 / 실패 경로 완주(fail_forward 확인) / 잘못된 input 거부
- `replay` 결정성: 같은 입력 로그 → 깊은 동등 상태

## 제약

- 의존성: schema = zod만, runtime = 0. ESM, 브라우저/노드 양립. UI 라이브러리 import 금지.
- 스키마는 **사람이 손으로 쓸 수 있어야 한다** — 과도한 중첩과 ID 강박을 피하고, 기본값을 관대하게.
- AI DM이 같은 파일을 읽는다(v1.5) — 필드 이름은 자기설명적으로, 자연어 필드(read_aloud, dm_notes, hint)는 온전한 문장으로.

## 진행 방식

1. **먼저 `SCHEMA.md` 초안과 타입 시그니처만 제시하고 멈춰라.** 내 승인 후 구현에 들어간다.
2. 승인 후 순서: schema → 린터 → runtime → 샘플 모듈 → CLI → 테스트.
3. 각 단계가 끝날 때마다 실행 가능한 증거(테스트 결과, CLI 출력 캡처)를 보여라.
4. 보고와 코드 주석은 한국어로.

## 완료 기준 (Definition of Done)

- [ ] `pnpm test` 전부 green
- [ ] `pnpm hearth lint content/modules/rats-in-the-cellar` → error 0, `soloPlayable: true`
- [ ] `pnpm hearth play content/modules/rats-in-the-cellar` 로 두 엔딩 모두 도달 가능
- [ ] 의도적 오류 픽스처(막다른 실패, 고아 장면)를 린터가 정확한 sceneId와 hint로 잡는다
- [ ] `SCHEMA.md`만 읽은 사람이 새 시나리오를 손으로 쓸 수 있다

## 하지 말 것

서버/DB/네트워크 코드 · 에디터 UI · PixiJS 렌더링 · AI 호출 · 회원/프로필 — 전부 다음 단계다.
이번 단계의 성공은 "터미널에서 지하실의 쥐를 잡는 것"이다.
