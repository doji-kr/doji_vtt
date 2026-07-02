# 1단계 인수인계 — 시나리오 스키마 v0.1 + 헤드리스 런타임

> 대상: 다음 단계(라이브 테이블 / 에디터 / 서버 / AI DM)를 설계하는 쪽.
> 목적: 무엇이 확정됐고, 원래 설계에서 뭐가 바뀌었고, 다음 단계가 반드시 지켜야 할 제약이 뭔지.
> 구현 디테일(함수 내부 로직)은 뺐다 — 필요하면 코드가 있다.

## 상태

`PROMPT-runtime-design.md`의 DoD 전부 충족:
- `pnpm test` — 25개 테스트 green (schema 17 + runtime 8)
- `pnpm hearth lint content/modules/rats-in-the-cellar` — error 0, `soloPlayable: true`
- `pnpm hearth play content/modules/rats-in-the-cellar` — 두 엔딩 모두 터미널에서 도달 확인
- 의도적 오류 픽스처(막다른 실패, 고아 씬)를 린터가 정확한 sceneId·hint로 잡음

## 산출물 위치

```
packages/schema/   — module.json 타입 + zod 스키마 + 린터. SCHEMA.md에 필드별 설명 전체.
packages/runtime/  — 헤드리스 상태머신 (createRun/step/replay). 순수 함수, 의존성 0(외 @hearthside/schema).
apps/cli/          — pnpm hearth lint|play
content/modules/rats-in-the-cellar/  — 샘플 시나리오 (8씬, 판정 3, 분기 2, 조우 1, 비밀 1, 핸드아웃 1, 엔딩 2)
packages/schema/module.schema.json   — 에디터 자동완성용 JSON Schema (zod에서 자동 생성)
```

## module.json 계약 요약

전체 필드 설명은 `packages/schema/SCHEMA.md` 참조. 다음 단계 설계에 필요한 핵심만:

- **그래프의 노드는 씬(Scene)이다.** 씬 안의 `blocks[]`는 씬 내부에서 순서대로 실행되는
  선형 서브플로우고, 씬 사이를 잇는 건 각 블록의 `goto`(들)다.
- **`check`/`choice`는 분기점이라 `goto`가 항상 필수.** 실행되면 반드시 다른 씬으로 이동한다.
  (`on_fail.goto` 필수 = "실패도 전진" 원칙이 스키마 레벨에서 강제됨.)
- **`encounter`/`handout`/`secret`은 `goto`가 선택.** 생략하면 같은 씬의 다음 블록으로 자동
  진행한다(예: 핸드아웃 보여주고 → 비밀 밝히고 → 마지막에 선택지). 씬의 **마지막** 블록만은
  반드시 `goto`로 씬을 떠나야 한다 — zod `superRefine`이 강제.
- `read_aloud`/`dm_notes`는 필드 자체가 다른 레벨에 있다 — `dm_notes`는 Scene/Secret/Npc.secret에만
  존재하고, 플레이어 채널(Effect)에는 애초에 그 필드가 없다.
- `edges_soft[]`는 씬에 딸린 "라이브 DM 전용 재량 연결"이며 **헤드리스 런타임은 이걸 절대 자동으로
  타지 않는다.** 린터 R2는 hard edge로만 도달성을 판정하고, soft로만 닿는 씬은 경고로 "라이브 전용"
  표시만 한다.

### 원래 설계(PROMPT-runtime-design.md)에서 바뀐 것 2가지

1. `choice.options` 최소 개수를 2 → **1**로 완화. "계속하기"류 단일 선택지(사실상 진행 지점)가
   자연스럽게 필요해서.
2. `encounter`/`handout`/`secret`의 `goto`를 **필수 → 선택**으로 바꿈. 원래 설계대로 전부 필수였다면
   씬 안에 블록을 여러 개 두는 게 의미가 없었다(첫 블록에서 항상 다른 씬으로 튀어버림). 대신 마지막
   블록만 필수로 강제해서 "씬 = 여러 요소가 순서대로 나오는 한 덩어리"라는 원래 의도를 살렸다.

## 런타임 계약

```ts
createRun(module, opts?) => { state: RunState, effects: Effect[] }
step(state, input) => { state: RunState, effects: Effect[] }
replay(module, inputs) => RunState   // 세이브 = 입력 로그. 같은 입력이면 항상 같은 상태(결정론).
```

- `Input = {type:'continue'} | {type:'choose', optionId} | {type:'resolveCheck', total}`
  — **엔진은 주사위를 굴리지 않는다.** `resolveCheck`의 `total`은 바깥(실제 주사위, UI, 테스트,
  AI)이 넣어준다. 지금 CLI는 사람이 합계를 직접 타이핑하는 가장 단순한 형태로만 구현했다 —
  "주사위를 실제로 굴려주는 UI"는 이 계약 위에 자유롭게 얹으면 된다(엔진 변경 불필요).
- `Effect` 유니온: `showReadAloud | narrate | requestCheck | showChoices | startEncounter |
  giveHandout | revealSecret | setFlag | end` — 이 중 어디에도 `dm_notes`/`Secret.dm_notes`/
  `Npc.secret` 필드가 없다. **서버/클라이언트가 Effect만 그대로 전송하면 DM 정보 유출이
  타입 수준에서 불가능**하다. 이건 다음 단계(실시간 이벤트 설계)에서 그대로 활용할 수 있는 보장이다.
- `RunState`에 `module` 전체가 들어있다 — `step()`은 module을 다시 받지 않는다. 즉 세이브는
  "module 참조 + 입력 로그"만 있으면 충분하고, 라이브 방의 인메모리 상태도 이 구조 그대로 쓰면 된다.
- 라이브 테이블에서 DM이 soft edge로 임의 이동하는 것은 **이 런타임의 범위 밖**이다 — `step()`은
  hard edge 기반 결정론적 진행만 다룬다. 라이브 사이드바가 soft edge로 점프하는 기능은 이 상태머신을
  감싸는 별도 레이어(다음 단계)에서 다뤄야 한다.

## 이번 단계에서 하지 않은 것 (다음 단계 스코프)

서버/DB/네트워크, 에디터 UI, PixiJS 렌더링, AI DM 호출, 회원/프로필, 파티/HP/이니셔티브 상태,
실제 주사위 굴림(현재는 합계 직접 입력) — 전부 `PROMPT-runtime-design.md`가 원래 범위 밖으로
명시한 것들이고 실제로 손대지 않았다.
