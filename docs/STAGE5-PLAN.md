# 5단계 구현 계획 (승인된 설계 → 실행 순서)

> `docs/STAGE5.md`에 이미 승인 기록된 DDL·API·id/stale 정책·에디터 와이어를 실제로
> 구현하는 순서. 진행하면서 이 파일은 지우고 `docs/STAGE5.md`의 "실제로 검증한 것" 절로
> 흡수한다 — 이 파일 자체는 임시 체크리스트다.

## 진행 상태

- [x] **0. plays 마이그레이션** — `db.ts`에 `scenarios` 테이블 + `plays.owner_user_id`/
      `is_preview`/`module_hash` 컬럼(idempotent `addColumnIfMissing` 헬퍼로 기존 DB에도
      안전하게 얹음). `play-store.ts`에 `listPlaysByOwner`(회원용) 추가,
      `listPlaysByNickname`은 `is_preview = 0` 조건 추가, `insertPlay`에 옵션 인자
      (`ownerUserId`/`isPreview`/`moduleHash`) 추가. **(아직 테스트 안 붙임 — 1번에서 같이)**

- [ ] **1. `routes/plays.ts` 갱신** (기존 라우트 3개 손보기)
  - `POST /api/plays`: 회원이면 `owner_user_id`를 채워서 insert
  - `GET /api/plays`: `request.userId` 있으면 `listPlaysByOwner`, 없으면(게스트) 기존
    `listPlaysByNickname` — 목록 조회 분기
  - `GET /api/plays/:id` · `POST /api/plays/:id/inputs`: 소유권 판단을
    `row.owner_user_id === request.userId || (row.owner_user_id === null && row.nickname === request.nickname)`
    로 갱신(회원 vs 게스트 이중 분기)
  - `row.is_preview`면 `registry` 대신 `scenarios.draft_json`을 직접 읽어서 재생(린트
    오류가 있어도 파스만 되면 프리뷰는 재생 가능해야 함 — 발행 게이트인 "error 0"은
    프리뷰엔 적용 안 함)
  - `module_id`가 `st-`로 시작하고 `is_preview`가 아니면: `scenarios.published_hash`와
    `row.module_hash` 비교 → 다르면 `stale: true` 응답(로그 재생 안 함), 안내 후 사용자가
    명시적으로 새 play를 만들게 함(자동 재시작 없음)

- [ ] **2. `scenario-store.ts`** (신규, DB 접근 전담)
  - `insertScenario(db, id, ownerUserId, draftModule)` — draft 생성
  - `getScenario(db, id)` / `listScenariosByOwner(db, ownerUserId)`
  - `updateScenarioDraft(db, id, draftModule)` — PUT 저장
  - `publishScenario(db, id, publishedModule, hash)` — status/published_json/hash/at 갱신
  - `unpublishScenario(db, id)` — status만 'draft'로(published_json은 남겨서 재발행 가능하게)
  - `deleteScenarioDraft(db, id)` — draft 상태일 때만 삭제(호출부에서 상태 검사)

- [ ] **3. `scenario-template.ts`** (신규, 3막 원샷 스켈레톤)
  - 씬 5개(훅/전개1/전개2/절정/에필로그), read_aloud에 "TODO: ..." 안내 문장, 최소 hard
    edge로 전부 연결 → **생성 직후부터 `lint()` error 0**이 되도록 직접 만들고
    `parseModule`+`lint`로 검증하는 유닛 테스트를 붙인다(회귀 방지 — 템플릿이 스키마
    변경으로 깨지면 바로 알아챔).

- [ ] **4. `routes/scenarios.ts`** (신규, 전부 회원 전용 + zod 검증)
  - `POST /api/scenarios` — 템플릿 시딩, 201 + 원문 + lint
  - `GET /api/scenarios` — 내 서재 목록(요약 + lint 요약)
  - `GET /api/scenarios/:id` — **owner만, 아니면 403**(다른 회원도 게스트도)
  - `PUT /api/scenarios/:id` — `parseModule` 실패 400, 성공 시 저장 + lint 응답
  - `POST /api/scenarios/:id/publish` — lint error 0 게이트, 통과 시 발행 + 레지스트리 갱신
  - `POST /api/scenarios/:id/unpublish` — 레지스트리에서 제거
  - `DELETE /api/scenarios/:id` — draft만, published면 409
  - `POST /api/scenarios/:id/preview-plays` — draft 기준 프리뷰 play 생성(owner 전용)
  - `app.ts`에 라우트 등록 한 줄 추가

- [ ] **5. 레지스트리 병합** (`module-registry.ts` 또는 신규 `registry-sync.ts`)
  - 부팅 시 파일 스캔 후, DB에서 `status='published'`인 scenario 전부 같은
    `Map<string, ModuleEntry>`에 삽입(파일 ∪ DB 발행본 단일 뷰)
  - `ModuleSummary`에 `author_display_name`(파일 모듈은 "화롯가 내장" 고정,
    DB 발행물은 `users.display_name` 조인) · `published_at` 필드 추가
  - publish/unpublish 라우트가 호출하는 `syncScenarioIntoRegistry(registry, entry)` /
    `removeScenarioFromRegistry(registry, id)` 갱신 함수(파일 감시 없이 이 두 함수 호출로만
    레지스트리 최신화 — PROMPT 요건)

- [ ] **6. `apps/web` — 서가 확장** (기존 라이브러리 화면에 글쓴이 표기 + 라이브 전용 배지,
      솔로 시작 버튼은 `soloPlayable`일 때만 활성 — 이미 있는 필드라 새 필드 없이 UI만 추가)

- [ ] **7. `apps/web/src/studio/`** (신규 — "이야기꾼의 책상")
  - 서재 목록 화면(내 시나리오 카드, "새 이야기" 버튼)
  - 편집 화면(3패널 — STAGE5.md 와이어 그대로): 좌 씬 목록/메타/NPC/플래그,
    중앙 씬 편집(블록 스택 5종 폼), 우 린터 패널 + 프리뷰/발행 버튼
  - 자동 저장(2~3초 디바운스) + 상태 표시("잉크가 마르는 중… / 저장됨")
  - `/studio` 라우트 등록(기존 `routing.ts`/`App.tsx`의 수동 라우팅 패턴 그대로 확장)

- [ ] **8. 테스트** (서버 e2e + 웹)
  - 초안 생성 → 편집 → warn 있는 상태 publish(통과) / error 있는 상태 publish(거부) →
    발행 → 서가 노출 → 타 회원 GET/PUT 403 · 게스트 403 → 신규 play 완주 → 재발행 →
    기존 play 이어하기 시 stale → unpublish → 서가 소멸
  - 프리뷰 격리(목록·이어하기 어디에도 안 뜸)
  - 채널 분리 회귀 확장: DB 발행물의 `dm_notes`/`secret` 문자열이 서가·플레이 API 어디에도
    없음(기존 파일 모듈만 검사하던 테스트에 발행물 케이스 추가)
  - `plays` 회원 귀속: 같은 닉네임 게스트 둘의 세이브 혼선이 회원 계정에선 재현 안 됨

- [ ] **9. 문서** — `docs/STAGE5.md`에 "실제로 검증한 것"·판단 콜·DoD 체크리스트 채우기,
      `PUT + lint` p95 측정치 기록, README 로드맵 5단계 행 ✅ 갱신

## 하지 않을 것 (STAGE5.md/PROMPT 그대로)

협업 동시 편집 · 버전 이력 · 리치텍스트/DnD 라이브러리 · 이미지 에셋(포스터 업로드) ·
그래프 시각화 · DM 사이드바 · module.json 스키마 개정 · AI 호출.
