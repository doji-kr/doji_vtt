# 실시간 프로토콜 v1 — 라이브 테이블 + 계정

> 3단계에서 v0으로 나왔고, 4단계 §1(계정 본편)에서 인증 계약이 바뀌어 v1으로 올린다.
> 서버 권위 원칙 자체는 그대로다: 클라이언트는 op를 "제안"하고, 서버가 검증·순서 부여(seq)·
> 적용 후 브로드캐스트한다. 낙관적 UI는 `token.move` 드래그 프리뷰에만 허용 — 서버 확정치가
> 오면 조용히 수렴한다(§ CLAUDE.md 6, "조용한 마법").

## 인증 (v1 — 4단계 §1에서 새로 생김)

3단계까지 인증은 "닉네임 + 서명 쿠키" 하나뿐이었다 — 진짜 계정이 아니라 자리 표시자였고,
같은 닉네임을 두 사람이 동시에 못 쓰게 막는 안전판도 없었다. 4단계부터 **두 종류의 서명
쿠키가 공존**한다:

| 쿠키 | 누가 갖나 | 담는 값 | 발급 엔드포인트 |
|---|---|---|---|
| `hs_session` (게스트) | 계정 없이 초대 링크로 참가한 사람 | 표시 이름(nickname) 문자열 | `POST /api/session` (기존 그대로, 폐기 안 함) |
| `hs_member` (회원) | 회원가입/로그인한 사람 | `user_id` | `POST /api/auth/register`, `POST /api/auth/login` (신규) |

- `POST /api/session { invite_code, nickname }` — 3단계 때 있던 그대로다. 이제부터는
  "게스트 세션 발급 엔드포인트"라는 이름이 붙는다. 사이트 초대코드(`config.inviteCode`)를
  여전히 요구한다.
- `POST /api/auth/register { username, password, display_name, invite_code }` — 회원가입.
  `username`은 로그인 식별자(영문/숫자/밑줄 3~20자), `display_name`이 화면에 보이는 이름
  (한글 포함, 예전 nickname의 자리를 잇는다). 비밀번호는 `argon2id`로 해시해 저장한다.
  사이트 초대코드를 가입 시 1회 요구한다(로그인엔 불필요).
- `POST /api/auth/login { username, password }` — 로그인.
- `GET /api/session` — whoAmI. 회원이면
  `{ kind: "member", userId, username, displayName }`, 게스트면
  `{ kind: "guest", displayName }`를 돌려준다. 둘 다 없으면 401.
  (3단계엔 `{ nickname }` 하나만 있었다 — 이 엔드포인트는 계정 계약 자체가 바뀌는 4단계
  범위 안이라 모양이 달라졌다. scenarios/plays/tables 같은 일반 리소스 API는 형태를
  유지했다.)

서버 내부적으로 `requireSession`은 회원 쿠키를 먼저 확인하고, 없거나 무효하면 게스트
쿠키로 폴백한다. **소유권·권한 판단(테이블 생성, 소유 비교)은 반드시 `userId`만 본다** —
게스트는 애초에 `userId`가 없으므로 자동으로 걸러진다. 표시용 이름이 필요한 코드는
`displayName ?? guestName`으로 정규화한다.

## 연결

`GET /ws/tables/:id` (WebSocket 업그레이드). 인증은 위 두 쿠키 중 하나(회원 `hs_member` 또는
게스트 `hs_session`)를 그대로 재사용한다 — WS 전용 로그인 절차는 없다. 방을 찾을 수 없거나
유효한 쿠키가 없으면 업그레이드 자체를 거부한다(HTTP 레벨 401/404).

연결 직후 role이 정해진다: 회원이고 `userId === table.owner_user_id`면 **dm**, 그 외(게스트
포함, userId가 다른 회원)는 전부 **player**다. 테이블 생성(`POST /api/tables`) 자체가
`userId` 없이는 403이므로, DM은 항상 회원 계정으로만 연결된다 — 게스트는 절대 DM이 될 수
없다.

## 봉투

**s2c(서버→클라이언트) 이벤트**는 전부 이 봉투를 쓴다:

```ts
interface ServerEnvelope<T> {
  seq: number;        // 방 안에서 단조 증가. hello/snapshot/error에는 없음
  room_id: string;
  actor: string;       // 이 이벤트를 일으킨 nickname (시스템 이벤트는 "system")
  type: string;         // 도메인.동사
  payload: T;           // 타입별 zod 스키마로 검증됨
}
```

**c2s(클라이언트→서버) op**는 seq/room_id/actor 없이 최소한만 보낸다 — 서버가 연결 컨텍스트에서
채운다:

```ts
interface ClientOp<T> {
  type: string;
  payload: T;
}
```

모든 payload는 `packages`가 아니라 `apps/server`에 두는 zod 스키마로 파싱한다(라이브 테이블은
1·2단계의 헤드리스 스키마/런타임과 무관한 새 도메인이라 별도 스키마 파일
`apps/server/src/table-protocol.ts`에 둔다).

## c2s 오퍼레이션

| type | payload | 권한 |
|---|---|---|
| `hello` | `{ last_seq?: number }` | 전원 |
| `map.set` | `{ path: string }` | DM |
| `grid.set` | `{ cellSize: number; offsetX: number; offsetY: number }` | DM |
| `token.add` | `{ label: string; ownerNickname: string \| null; x: number; y: number }` | DM |
| `token.move` | `{ tokenId: string; x: number; y: number }` | DM(모든 토큰) / 플레이어(자기 소유, 잠기지 않은 토큰만) |
| `token.remove` | `{ tokenId: string }` | DM |
| `token.lock` | `{ tokenId: string; locked: boolean }` | DM |
| `dice.roll` | `{ expression: string; secret?: boolean }` | 전원(단, `secret: true`는 DM만) |
| `chat.say` | `{ text: string; whisperTo?: string }` | 전원 |
| `ping.place` | `{ x: number; y: number }` | 전원 |
| `character.set` | `{ id?: string; name: string; class: string; abilityMods: AbilityMods; ac: number; tokenId?: string \| null; hpMax?: number }` | 회원만(`userId` 필수). `id` 없으면 새 캐릭터 생성(생성자가 소유자가 된다, `hpMax`로 시작 HP를 시딩). `id` 있으면 갱신 — 소유자 본인 또는 DM만. 갱신 시 `hpMax`는 무시된다(HP는 `character.hp` 전용) |
| `character.hp` | `{ characterId: string; hpCurrent: number; hpMax: number }` | 소유자 본인 또는 DM. **절대값**(델타 아님) — 명중→피해 자동 적용 금지(CLAUDE.md §1.6) 원칙상 "몇 대 맞아서 몇 깎였다"는 서버가 계산하지 않고 사람이 숫자를 직접 써넣는다 |
| `status.set` | `{ characterId: string; status: string[] }` | 소유자 본인 또는 DM. 자유 텍스트 태그 배열(SRD 조건 목록을 그대로 베끼지 않는다) |
| `initiative.set` | `{ id?: string; label: string; order: number; characterId?: string \| null }` | DM만. `id` 없으면 새 항목 추가, 있으면 갱신(순번 재확정 등) |
| `initiative.remove` | `{ id: string }` | DM만 |

최소 세트(`table.join token.add token.move token.remove map.set grid.set dice.roll chat.say
ping.place`)에 `token.lock`을 추가했다 — "DM 잠금 토큰은 플레이어가 못 움직인다"는 DoD 요건을
표현하려면 잠금 상태를 토글하는 op가 최소 하나 필요하다. `table.join`은 별도 c2s op가 아니라
WS 연결 자체 + `hello`가 그 역할을 한다(아래 재접속 절차).

**4단계 §2에서 추가된 6종**(`character.set` `character.hp` `status.set` `initiative.set`
`initiative.remove`)은 5e 라이트 시트·이니셔티브·HP/상태 기능의 실시간판이다. 이니셔티브
**정렬**(숫자 비교) 자체는 클라이언트가 해도 된다 — §1.6이 금지하는 건 "판정 해석"이지
"산수"이므로, 서버는 순번만 저장하고 정렬은 순번 리본 UI가 그린다.

## s2c 이벤트

성공한 모든 op는 (권한이 있으면) 같은 이름의 이벤트로 방 전원에게 브로드캐스트된다 —
`map.set`을 보내면 `map.set` 이벤트가 돌아오는 식. 예외:

- `hello` → `state.snapshot`(브로드캐스트 아님, 요청자에게만)
- `dice.roll` with `secret: true` → `dice.roll` 이벤트가 **DM 소켓에만** 전송된다.
  플레이어 소켓에는 어떤 형태로도 결과가 나가지 않는다(2단계 채널 분리 원칙의 실시간판).
- 권한 위반 / 유효성 실패 → `error`(요청자에게만, seq 없음): `{ type: "error", payload: {
  code: string; message: string } }`. 연결은 끊지 않는다.
- 참가자 입장/퇴장 → `table.join` / `table.leave` (actor = 해당 nickname, payload에 role 포함)

### `state.snapshot`

> v1 메모: `ownerNickname`/`Token.ownerNickname`/`Participant.nickname` 필드 이름과 모양은
> 3단계 그대로다 — 다만 내부적으로 이제 회원의 `users.display_name`(DM) 또는 게스트의
> 표시 이름을 담는다. 와이어 프로토콜 자체는 바뀌지 않았으니 클라이언트(`table-reducer.ts`,
> `TableCanvas`)는 손댈 필요가 없었다. 토큰 소유권(`Token.ownerNickname`)은 여전히 표시
> 이름 문자열로 비교한다 — 계정 id로의 연결은 이번 단계 범위 밖(캐릭터 시트가 생기는
> 다음 단계에서 `characters.owner_user_id`로 이어진다).

```ts
interface RoomState {
  name: string;
  ownerNickname: string;
  map: { path: string | null };
  grid: { cellSize: number; offsetX: number; offsetY: number };
  tokens: Token[];
  participants: { nickname: string; role: "dm" | "player"; connected: boolean }[];
  log: LogEntry[]; // 최근 채팅+굴림, 최대 100개
  characters: Character[]; // 4단계 §2
  initiative: InitiativeEntry[]; // 4단계 §2
}

interface Token {
  id: string;
  ownerNickname: string | null; // null = DM 소유(몬스터 등)
  label: string;
  x: number;
  y: number; // 그리드 셀 좌표(소수 허용 — 드래그 중 프리뷰용, 확정 시 정수로 스냅)
  colorSeed: string; // 결정적 팔레트 링 컬러 시드
  locked: boolean;
}

// 4단계 §2: 5e 라이트 시트 — 전체 스탯블록/주문 목록이 아니라 능력치 수정치만.
interface AbilityMods {
  str: number; dex: number; con: number; int: number; wis: number; cha: number;
}

interface Character {
  id: string;
  ownerUserId: string; // NOT NULL — 게스트는 캐릭터를 만들 수 없다
  ownerDisplayName: string;
  tokenId: string | null; // 시트만 먼저 만들고 토큰은 나중에 놓을 수 있다
  name: string;
  class: string;
  abilityMods: AbilityMods;
  hpCurrent: number;
  hpMax: number;
  ac: number;
  status: string[]; // 자유 텍스트 조건 태그
  updatedAt: string;
}

interface InitiativeEntry {
  id: string;
  label: string;
  order: number; // 숫자 비교로 정렬(내림차순) — 정렬 자체는 산수라 기계가 해도 된다
  characterId: string | null; // 캐릭터 시트와 느슨하게 연결, NPC/몬스터는 null
}

type LogEntry =
  | { kind: "chat"; actor: string; text: string; whisperTo?: string; at: string }
  | {
      kind: "roll";
      actor: string;
      expression: string;
      rolls: number[];
      total: number;
      mode: "normal" | "adv" | "dis";
      secret: boolean;
      at: string;
    };
```

`secret: true`인 굴림은 `log`에도 DM에게 보내는 스냅샷에만 포함된다 — 플레이어가 재접속해서
받는 스냅샷의 `log`에는 애초에 그런 항목이 없다(서버가 role별로 log를 필터링해서 보낸다).

## 재접속 절차

1. WS 연결 → 서버가 role 결정.
2. 클라이언트가 `hello { last_seq? }` 전송.
3. 서버가 `state.snapshot { ...RoomState, seq: 방의_현재_seq }`로 응답(role에 맞게 log 필터링).
   v0는 이벤트 델타 재생을 하지 않는다 — `last_seq`를 받아도 항상 풀 스냅샷을 보낸다(가장
   단순하고, 방 상태가 작아서 비용이 낮다). 델타 재생은 v1 최적화 후보로 남긴다.
4. 스냅샷 이후 실시간 이벤트 스트림이 이어진다.

## 권한 표

| 액션 | DM | 플레이어 |
|---|---|---|
| `map.set` / `grid.set` | ✅ | ❌ |
| `token.add` / `token.remove` / `token.lock` | ✅ | ❌ |
| `token.move` | ✅ (모든 토큰) | ✅ (자기 소유 + 잠기지 않은 토큰만) |
| `dice.roll` (공개) | ✅ | ✅ |
| `dice.roll` (`secret: true`) | ✅ | ❌ — 시도하면 `error` |
| `chat.say` / `ping.place` | ✅ | ✅ |
| `character.set` (생성) | ✅(회원) | ✅(회원만 — 게스트는 `error account_required`) |
| `character.set` (갱신) / `character.hp` / `status.set` | ✅ (모든 캐릭터) | ✅ (자기 소유 캐릭터만) |
| `initiative.set` / `initiative.remove` | ✅ | ❌ — 시도하면 `error forbidden` |

위반 시 `error` 이벤트로 응답하고 **연결은 유지**한다(끊지 않음 — DoD 요건).

## 하트비트 · 타임아웃

WS 프로토콜 레벨 ping/pong(애플리케이션 JSON 메시지가 아니라 `ws` 라이브러리의 내장 프레임)을
15초 간격으로 보낸다. 3회(45초) 연속 pong이 없으면 서버가 연결을 끊고 `table.leave`를
방 전원에게 브로드캐스트한다.

## seq 규칙

- 방마다 독립적으로 1부터 단조 증가(방 생성 시 0, 첫 브로드캐스트 이벤트가 1).
- `hello`/`state.snapshot`/`error`는 seq를 소비하지 않는다 — 오직 방 상태를 바꾸는 성공한
  브로드캐스트 이벤트만 seq를 받는다.
- `tables.last_seq` 컬럼에 디바운스(2~5초)로 저장 — 컨테이너 재시작 후에도 seq가 이어진다.

## 주사위 표현식 문법

```
<count>d<sides>[+|-<modifier>] [adv|dis] [gm]
```

- `count`: 1~100. `sides`: 1~1000. `modifier`: -999~999. 공백/대소문자 무관.
- `adv`/`dis`: 표현식 전체를 두 번 굴려 합계가 높은/낮은 쪽을 채택(관용적으로는 d20에만
  적용되지만, 여기서는 표현식 전체에 일반화한다 — 예: `2d6-1 adv`도 유효).
- `gm`: 결과가 DM에게만 보인다. `adv`/`dis`와 순서 무관하게 조합 가능(`1d20+5 adv gm`).
- 유효하지 않은 예: `0d6`(count 0), `1d20+`(연산자만 있고 숫자 없음), `d20`(count 생략은
  허용하지 않는다 — 항상 명시).

파서는 `apps/server/src/dice.ts`의 순수 함수 `parseDiceExpression(input): DiceSpec`이고,
실제 굴림(`crypto.randomInt` 기반)은 별도 함수가 담당한다 — 파서 자체는 랜덤을 쓰지 않아
결정론적으로 테스트할 수 있다.
