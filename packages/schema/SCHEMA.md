# module.json 스키마 v0.1

시나리오 하나 = `module.json` 파일 하나 (+ `assets/`). 손으로 쓸 수 있게 설계했다 —
과도한 중첩과 ID 강박을 피하고, 필드 이름은 자기설명적인 snake_case를 쓴다.
(AI DM이 v1.5에서 같은 파일을 읽으므로, 자연어 필드는 온전한 문장으로 쓴다.)

## 최상위 구조

```jsonc
{
  "schema_version": "0.1",
  "meta": { /* Meta */ },
  "npcs": [ /* Npc[] */ ],       // 선택
  "flags": [ /* FlagDef[] */ ],  // 선택 — 선언하면 R3가 오탈자를 잡아준다
  "scenes": [ /* Scene[] */ ]    // 최소 1개
}
```

## Meta

| 필드 | 타입 | 설명 |
|---|---|---|
| `title` | string | 시나리오 제목 |
| `logline` | string | 한 줄 소개 |
| `poster` | string? | 포스터 이미지 경로 (없으면 자동 생성 대상) |
| `tags` | string[]? | 장르/톤 태그 |
| `difficulty` | "easy"\|"normal"\|"hard"? | |
| `estimated_minutes` | number? | 예상 플레이 시간 |
| `start_scene` | string | 시작 씬의 `id` |

## Scene

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 씬 고유 id |
| `title` | string? | 에디터 표시용 (플레이어는 못 봄) |
| `read_aloud` | string | **플레이어에게 그대로 읽어주는 도입부** |
| `dm_notes` | string? | **DM만 보는 진행 메모** |
| `secrets` | Secret[]? | 이 씬에 딸린 비밀들 |
| `blocks` | Block[]? | 순서대로 실행되는 블록 (비어 있으면 반드시 `ending` 필요) |
| `edges_soft` | SoftEdge[]? | 라이브 DM 전용 재량 연결 |
| `ending` | { id, title? }? | 있으면 이 씬은 엔딩이다 |

### read_aloud / dm_notes 채널 분리

`read_aloud`는 플레이어가 듣는 텍스트, `dm_notes`는 진행자만 아는 정보다.
이 둘은 **타입 수준에서 분리**되어 있다: 헤드리스 런타임(`@hearthside/runtime`)이
플레이어에게 내보내는 `Effect` 타입들(`showReadAloud`, `giveHandout`, `revealSecret` 등)에는
애초에 `dm_notes` 필드가 존재하지 않는다. `dm_notes`를 담는 필드(`Scene.dm_notes`,
`Secret.dm_notes`, `EncounterBlock.dm_notes`)는 러너 내부에서만 읽히고 어떤 코드 경로로도
Effect로 직렬화되지 않는다. `secret` 블록이 발동돼도 나가는 건 `Secret.reveal_text`
(플레이어용 요약)뿐, `Secret.dm_notes`(진실 그 자체)는 절대 나가지 않는다.

## Block (5종, `type` 판별)

블록은 씬 안에서 **배열 순서대로** 실행된다.

- `check`/`choice`는 본질적으로 분기점이라 `goto`(들)가 항상 필수다 — 실행되면 반드시 다른 씬으로 이동한다.
- `encounter`/`handout`/`secret`은 `goto`를 **생략할 수 있다** — 생략하면 같은 씬의 다음 블록으로
  자연스럽게 넘어간다(핸드아웃을 보여주고 → 비밀을 밝히고 → 마지막에 선택지). 단, **씬의 마지막
  블록만은 반드시 `goto`로 씬을 떠나야 한다** — 스키마가 이를 강제한다.

즉 그래프의 노드는 **씬**이고, 씬 내부의 블록 나열은 "한 씬 안에서 여러 요소를 순서대로 보여주는"
선형 서브플로우다.

### check

```jsonc
{
  "type": "check", "id": "c1", "skill": "감지", "dc": 12,
  "on_success": { "read_aloud": "...", "goto": "scene_b", "set_flags": { "쥐구멍_발견": true } },
  "on_fail":    { "read_aloud": "...", "goto": "scene_c" }
}
```

`on_success.goto`와 `on_fail.goto`는 **둘 다 필수**다. 실패 분기에 goto가 없는 상태를
스키마 자체가 허용하지 않는다.

#### fail_forward의 의미

CLAUDE.md §1.4 "실패도 전진" — 판정 실패는 이야기를 멈추는 리셋 버튼이 아니라 **다른 방향으로
트는 분기점**이다. 이 스키마에서 fail_forward는 별도 필드가 아니라 **`on_fail.goto`가 필수라는
제약 자체**로 구현된다: 실패 분기도 성공 분기와 똑같이 반드시 다음 씬을 가리켜야 한다.
린터 R1(dead-fail)은 한 걸음 더 나가 그 `goto`가 실제로 진행 가능한 곳(블록이 있거나 진짜
엔딩인 씬)을 가리키는지까지 확인한다 — "goto는 있지만 그 씬이 막다른 골목"인 경우를 잡는다.

### choice

```jsonc
{
  "type": "choice", "id": "ch1", "prompt": "어느 쪽으로 갈까?",
  "options": [
    { "id": "left", "label": "왼쪽 통로", "goto": "scene_left" },
    { "id": "right", "label": "오른쪽 통로", "goto": "scene_right", "requires_flag": "지도_봤음" }
  ]
}
```

`options`는 최소 1개(단일 옵션은 "계속하기"류 진행 지점으로 흔히 쓴다). `requires_flag`가 있으면
해당 플래그가 참일 때만 노출한다.

### encounter

```jsonc
{ "type": "encounter", "id": "e1", "name": "쥐 떼", "monsters": ["거대 쥐 x4"], "goto": "scene_after" }
```

v0.5는 명중→피해 자동 적용을 하지 않는다(§9 non-goal). 조우는 "시작 → (테이블에서 진행) →
다음으로 이동"만 표현한다. 전투 해결 로직은 라이브 DM 또는 별도 규칙의 몫이다. `goto`를 생략하면
바로 다음 블록으로 넘어간다.

### handout

```jsonc
{ "type": "handout", "id": "h1", "title": "낡은 장부", "text": "...", "goto": "scene_after" }
```

플레이어에게 보여줄 문서/소품. `text`/`image` 자체가 플레이어 채널 콘텐츠다.

### secret

```jsonc
{ "type": "secret", "id": "s1", "secret_id": "장부의_진실", "goto": "scene_after" }
```

같은 씬의 `secrets[]`에서 `secret_id`가 가리키는 항목을 "발동"시킨다. 발동 시 플레이어에게는
`Secret.reveal_text`만 나가고, `Secret.dm_notes`는 절대 나가지 않는다.

## Secret (씬에 딸림)

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 이 씬 안에서 고유 |
| `dm_notes` | string | DM만 아는 진실 |
| `reveal_text` | string? | 발동 시 플레이어에게 보여줄 문장. 없으면 플래그만 바뀐다 |

## Npc

`wants`(원하는 것) / `fears`(두려워하는 것) / `secret`(숨기는 것) 3줄 요약 + `voice_notes`(말투 메모).
`secret`은 `dm_notes`와 동급으로 취급한다 — 플레이어 채널에 노출하는 코드를 짜지 않는다.

## SoftEdge vs HardEdge

| | Hard edge | Soft edge |
|---|---|---|
| 어디 있나 | 블록의 `goto` | `Scene.edges_soft[]` |
| 누가 타나 | 헤드리스 런타임(솔로 러너)이 **결정론적으로** 자동으로 탐 | 라이브 DM이 **재량으로** 수동으로 넘어갈 때만 |
| 린터 취급 | R2 도달성 판정의 기준선 | soft로만 도달되는 씬은 "라이브 전용"으로 표시(warn), 에러 아님 |
| 목적 | 게임북처럼 예측 가능한 분기 트리 | 즉흥 진행, 우회, DM의 임기응변을 위한 지름길/샛길 |

솔로 러너와 AI DM은 hard edge만 따라간다(§1.5). soft edge는 "이 씬들이 서사적으로 연결되어
있다"는 힌트일 뿐, 자동 재생 경로에는 절대 포함되지 않는다.

## 손으로 쓰기 예시 (최소 모듈)

```jsonc
{
  "schema_version": "0.1",
  "meta": { "title": "예시", "logline": "촛불 하나, 방 하나.", "start_scene": "start" },
  "scenes": [
    {
      "id": "start",
      "read_aloud": "문이 삐걱 열린다.",
      "blocks": [
        { "type": "choice", "id": "go", "options": [
          { "id": "enter", "label": "들어간다", "goto": "end" }
        ] }
      ]
    },
    { "id": "end", "read_aloud": "이야기가 끝난다.", "ending": { "id": "the_end" } }
  ]
}
```

## 린터 규칙 요약

| 규칙 | 심각도 | 내용 |
|---|---|---|
| R1 dead-fail | error | check 실패 분기가 막다른 씬으로 향함 |
| R2 orphan-scene | warn | 시작 장면에서 hard edge로 도달 불가 (soft로만 도달 시 "라이브 전용") |
| R3 broken-ref | error | 존재하지 않는 goto/secret_id/flag 참조 |
| R4 missing-dc | error | check에 dc 없음 |
| R5 loop-no-progress | warn | 플래그 변화 없는 hard 사이클 |
| R6 solo-playable | info | error 0 + 모든 도달 가능 씬이 엔딩에 도달 가능 → `soloPlayable: true` |
