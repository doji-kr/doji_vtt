# 5단계 작업 기록 — 스튜디오 v1 (문서 우선 에디터 · 발행 파이프라인)

## 기준선

시작 시점 `pnpm test`: **134개 전부 green**(4단계 §1~§4 완료 직후 — [docs/STAGE4.md](./STAGE4.md)
참고). 이 개수는 5단계가 끝나도 전부 green이어야 한다(PROMPT-stage5.md 전제).

## 설계 승인 기록 (구현 전 리뷰 — 사용자 승인 완료)

`PROMPT-stage5.md`의 "진행 방식 1"이 요구하는 네 가지를 구현 전에 제시하고 승인받았다.
아래는 그 승인된 내용 그대로다 — 구현 중 바뀌면 이 절도 같이 갱신한다.

### ① DDL

```sql
-- 신규: 스튜디오 발행물. draft_json은 항상 parseModule 통과 가능한 원문만 존재한다.
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,                 -- 'st-' + 짧은 hex(8자) — 파일 모듈 id와 네임스페이스 충돌 불가능
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  draft_json TEXT NOT NULL,
  published_json TEXT,                 -- NULL = 미발행
  published_hash TEXT,                 -- published_json의 SHA-256 — stale 판정용
  published_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scenarios_owner ON scenarios(owner_user_id);

-- 기존 plays 확장(better-sqlite3 exec에 ALTER TABLE ADD COLUMN, 기존 행은 NULL/0으로 채워짐)
ALTER TABLE plays ADD COLUMN owner_user_id TEXT REFERENCES users(id);
ALTER TABLE plays ADD COLUMN is_preview INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plays ADD COLUMN module_hash TEXT; -- 발행물(st-*) 대상 play만 기록, 파일 모듈 play는 NULL
CREATE INDEX IF NOT EXISTS idx_plays_owner ON plays(owner_user_id);
```

`GET /api/plays` 목록 조회는 `request.userId`가 있으면 `owner_user_id` 기준, 없으면(게스트)
기존 `nickname` 기준으로 분기한다 — 게스트 플레이 흐름은 무회귀로 유지한다.

### ② API — 요청/응답 예시

| 메서드 | 경로 | 예시 |
|---|---|---|
| POST | `/api/scenarios` | 요청 `{}` → `201 { id: "st-3f9a1c2b", status: "draft", module: {...3막 스켈레톤...}, lint: { errors: 0, warnings: 0, results: [] } }` |
| GET | `/api/scenarios` | `200 [{ id, title, status, updated_at, lint: { errors, warnings } }]` |
| GET | `/api/scenarios/:id` | owner만 — `200 { id, status, module: <draft_json>, lint }` / 그 외 `403` |
| PUT | `/api/scenarios/:id` | 요청 `{ module: <수정된 module.json> }` → `parseModule` 실패 시 `400`, 성공 시 `200 { status, updated_at, lint }` |
| POST | `/api/scenarios/:id/publish` | error 0 아니면 `409 { error: "lint_failed", lint }` / 통과 시 `200 { status: "published", published_at, lint }`(warn 있어도 통과) |
| POST | `/api/scenarios/:id/unpublish` | `200 { status: "draft" }` — 레지스트리에서 즉시 제거, 진행 중 play는 기존 `module_gone`(410) 경로를 그대로 재사용(새 메시지를 따로 만들지 않는다 — 이미 있는 걸로 의미가 충분) |
| DELETE | `/api/scenarios/:id` | draft만 `204` / published면 `409 { error: "must_unpublish_first" }` |
| POST | `/api/scenarios/:id/preview-plays` | owner 전용, **draft_json 기준**으로 `POST /api/plays`와 동일한 응답 모양(`{ play_id, effects, ended }`), 생성된 play는 `is_preview=1` |

**연결 포인트**: `GET /api/plays/:id`·`POST /api/plays/:id/inputs`는 지금
`registry.get(row.module_id)`로만 모듈을 찾는데, 프리뷰 play는 발행 전 draft라 레지스트리에
없다. `row.is_preview`면 레지스트리 대신 `scenarios.draft_json`을 직접 읽도록 이 두 핸들러에
분기를 추가한다(린트 오류가 있어도 프리뷰는 재생 가능해야 한다 — `parseModule`만 통과하면
됨, 발행 게이트인 "error 0"은 프리뷰엔 적용하지 않는다).

### ③ id 네임스페이스 · stale 정책

- 파일 모듈 id = 폴더명 그대로, 스튜디오 발행물 id = `st-` + `randomBytes(4).toString("hex")`
  (8자) — 접두사가 달라서 충돌이 원천적으로 불가능하다.
- 재발행마다 `published_json`의 SHA-256을 `published_hash`에 저장한다. **발행물(`st-*`) 대상
  play 생성 시**(프리뷰 제외) 그 시점 해시를 `plays.module_hash`에 기록한다. 이어하기
  (`GET /api/plays/:id`) 시 `scenario.published_hash !== play.module_hash`면 그 play는
  stale — 기존 로그를 재생하지 않고 응답에 `stale: true`를 내려 클라이언트가 "이야기가
  개정되어 처음부터 다시 시작합니다" 안내를 띄운 뒤, 사용자가 명시적으로 새 play를 만들게
  한다(자동 재시작은 하지 않는다 — 진행 상황을 실수로 잃지 않게). 파일 모듈은 이 검사
  대상이 아니다(라이브 배포로만 바뀌는 정적 콘텐츠라 "재발행" 개념이 없다).

### ④ 편집 화면 와이어(텍스트, `/studio/:id`)

```
┌─ 좌(씬 목록) ──────┬─ 중앙(선택된 씬 편집) ───────────────┬─ 우(린터·발행) ─┐
│ ▲▼ 씬1 씬2 씬3 [+]  │ 제목/로그라인/난이도/태그 (메타)      │ R1~R7 결과      │
│ ──────────────    │ ──────────────────────────────      │  · error 목록   │
│ ▶ 메타             │ "플레이어가 듣는 것" [textarea]       │  · warn 목록    │
│ ▶ NPC(3줄) [+]     │ "나만 아는 것"       [textarea]       │  (클릭→씬 이동) │
│ ▶ 플래그 선언 [+]  │ secrets[] 편집                        │ soloPlayable    │
│                    │ 블록 스택 [+판정 +선택지 +조우          │  배지 미리보기  │
│                    │            +핸드아웃 +비밀]           │ ─────────────  │
│                    │  각 블록: 타입별 폼, goto는            │ [프리뷰] 버튼   │
│                    │  기존 씬 드롭다운 + "＋새 씬"           │ [발행] 버튼     │
│                    │  check는 성공/실패 양쪽 폼 필수          │ 잉크 마르는 중… │
└────────────────────┴───────────────────────────────────┴─────────────────┘
```

## 진행 순서 (승인된 대로)

산출물 0(plays 마이그레이션) → server API(+테스트) → 레지스트리 병합 → web `/studio` →
템플릿 다듬기 → docs 갱신. 이 문서는 구현이 진행되며 "실제로 검증한 것"·"판단 콜"·
"DoD 체크리스트" 절을 이어서 채운다.
