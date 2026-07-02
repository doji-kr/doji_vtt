# 실시간 프로토콜 v0 — 라이브 테이블

> 3단계 산출물. 서버 권위: 클라이언트는 op를 "제안"하고, 서버가 검증·순서 부여(seq)·적용 후
> 브로드캐스트한다. 낙관적 UI는 `token.move` 드래그 프리뷰에만 허용 — 서버 확정치가 오면
> 조용히 수렴한다(§ CLAUDE.md 6, "조용한 마법").

## 연결

`GET /ws/tables/:id` (WebSocket 업그레이드). 인증은 2단계에서 쓰는 서명 쿠키(`hs_session`)를
그대로 재사용한다 — 별도 로그인 절차 없음. 방을 찾을 수 없거나 쿠키가 없으면 업그레이드
자체를 거부한다(HTTP 레벨 401/404).

연결 직후 role이 정해진다: `nickname === table.owner_nickname`이면 **dm**, 아니면 **player**.

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

최소 세트(`table.join token.add token.move token.remove map.set grid.set dice.roll chat.say
ping.place`)에 `token.lock`을 추가했다 — "DM 잠금 토큰은 플레이어가 못 움직인다"는 DoD 요건을
표현하려면 잠금 상태를 토글하는 op가 최소 하나 필요하다. `table.join`은 별도 c2s op가 아니라
WS 연결 자체 + `hello`가 그 역할을 한다(아래 재접속 절차).

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

```ts
interface RoomState {
  name: string;
  ownerNickname: string;
  map: { path: string | null };
  grid: { cellSize: number; offsetX: number; offsetY: number };
  tokens: Token[];
  participants: { nickname: string; role: "dm" | "player"; connected: boolean }[];
  log: LogEntry[]; // 최근 채팅+굴림, 최대 100개
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
