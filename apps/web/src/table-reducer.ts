// 실시간 테이블 클라이언트 상태 리듀서 — docs/PROTOCOL.md의 s2c 이벤트를 그대로 반영한다.
// 순수 함수다: 네트워크·시간 의존성이 없어(now는 인자로 받는다) 테스트가 쉽다.
// 서버가 이미 role별로 log를 필터링해서 보내므로(비밀 굴림 채널 분리), 여기서는 받은 걸
// 그대로 반영할 뿐 — 클라이언트가 "숨겨야 하나?"를 판단하는 코드 경로는 절대 두지 않는다.

export interface Token {
  id: string;
  ownerNickname: string | null;
  label: string;
  x: number;
  y: number;
  colorSeed: string;
  locked: boolean;
}

export interface ChatLogEntry {
  kind: "chat";
  actor: string;
  text: string;
  whisperTo?: string;
  at: string;
}

export interface RollLogEntry {
  kind: "roll";
  actor: string;
  expression: string;
  rolls: number[][];
  total: number;
  mode: "normal" | "adv" | "dis";
  secret: boolean;
  at: string;
}

export type LogEntry = ChatLogEntry | RollLogEntry;

export interface Grid {
  cellSize: number;
  offsetX: number;
  offsetY: number;
}

export interface Participant {
  nickname: string;
  role: "dm" | "player";
  connected: boolean;
}

export interface AbilityMods {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface Character {
  id: string;
  ownerUserId: string;
  ownerDisplayName: string;
  tokenId: string | null;
  name: string;
  class: string;
  abilityMods: AbilityMods;
  hpCurrent: number;
  hpMax: number;
  ac: number;
  status: string[];
  updatedAt: string;
}

export interface InitiativeEntry {
  id: string;
  label: string;
  order: number;
  characterId: string | null;
}

// 4단계 §3: 수동 안개 — RLE(hidden부터 시작하는 run 길이 배열), 셀 인덱스는 y*cols+x.
export interface FogState {
  cols: number;
  rows: number;
  runs: number[];
}

export interface RoomState {
  name: string;
  ownerNickname: string;
  map: { path: string | null };
  grid: Grid;
  tokens: Token[];
  participants: Participant[];
  log: LogEntry[];
  characters: Character[];
  initiative: InitiativeEntry[];
  fog: FogState | null;
}

/** runs(RLE, hidden부터 시작) → boolean[] (true = revealed). 서버 apps/server/src/fog.ts와 동일 로직 —
 * 안개 레이어를 그리려면 캔버스가 셀별 상태를 알아야 한다. */
export function decodeFog(fog: FogState): boolean[] {
  const cells = new Array<boolean>(fog.cols * fog.rows).fill(false);
  let i = 0;
  let revealed = false;
  for (const run of fog.runs) {
    if (revealed) cells.fill(true, i, i + run);
    i += run;
    revealed = !revealed;
  }
  return cells;
}

function encodeFog(cells: boolean[]): number[] {
  const runs: number[] = [];
  let current = false;
  let count = 0;
  for (const revealed of cells) {
    if (revealed === current) {
      count += 1;
    } else {
      runs.push(count);
      current = revealed;
      count = 1;
    }
  }
  runs.push(count);
  return runs;
}

/** 좌표 목록을 revealed로 표시한 새 FogState를 반환한다 — fog.reveal 브로드캐스트를
 * 로컬 상태에 반영할 때 쓴다(서버가 델타 좌표만 보내므로 클라이언트가 직접 병합한다). */
function revealFogCells(fog: FogState, points: { x: number; y: number }[]): FogState {
  const cells = decodeFog(fog);
  for (const p of points) {
    if (p.x < 0 || p.x >= fog.cols || p.y < 0 || p.y >= fog.rows) continue;
    cells[p.y * fog.cols + p.x] = true;
  }
  return { cols: fog.cols, rows: fog.rows, runs: encodeFog(cells) };
}

export interface Ping {
  id: string;
  x: number;
  y: number;
  actor: string;
  at: number;
}

export interface ServerMessage {
  type: string;
  payload: unknown;
  actor?: string;
  seq?: number;
  room_id?: string;
}

export interface TableClientState {
  room: RoomState | null;
  seq: number | null;
  pings: Ping[];
  lastError: { code: string; message: string } | null;
  selfRole: "dm" | "player" | null;
}

export const initialTableClientState: TableClientState = {
  room: null,
  seq: null,
  pings: [],
  lastError: null,
  selfRole: null,
};

const LOG_CAP = 100;
const PING_CAP = 20;

function capLog(log: LogEntry[]): LogEntry[] {
  if (log.length <= LOG_CAP) return log;
  return log.slice(log.length - LOG_CAP);
}

function upsertParticipant(list: Participant[], next: Participant): Participant[] {
  const idx = list.findIndex((p) => p.nickname === next.nickname);
  if (idx === -1) return [...list, next];
  const copy = list.slice();
  copy[idx] = next;
  return copy;
}

/** payload를 대충 믿고 쓴다 — 서버가 zod로 이미 검증한 값이 그대로 온다(PROTOCOL.md). */
function payloadAs<T>(msg: ServerMessage): T {
  return msg.payload as T;
}

/**
 * 서버 메시지 하나를 현재 상태에 반영한다. React 쪽에서는
 * `setState(s => applyServerMessage(s, msg, selfNickname))` 형태로 쓴다.
 */
export function applyServerMessage(
  state: TableClientState,
  msg: ServerMessage,
  selfNickname: string,
  now: number = Date.now(),
): TableClientState {
  switch (msg.type) {
    case "state.snapshot": {
      const payload = payloadAs<RoomState & { seq: number }>(msg);
      const { seq, ...room } = payload;
      const selfRole: "dm" | "player" = room.ownerNickname === selfNickname ? "dm" : "player";
      return { ...state, room, seq, selfRole, lastError: null };
    }
    case "error": {
      return { ...state, lastError: payloadAs<{ code: string; message: string }>(msg) };
    }
    case "table.join": {
      if (!state.room || !msg.actor) return state;
      const { role } = payloadAs<{ role: "dm" | "player" }>(msg);
      const participants = upsertParticipant(state.room.participants, {
        nickname: msg.actor,
        role,
        connected: true,
      });
      return { ...state, room: { ...state.room, participants }, seq: msg.seq ?? state.seq };
    }
    case "table.leave": {
      if (!state.room) return state;
      const { nickname } = payloadAs<{ nickname: string }>(msg);
      const participants = state.room.participants.map((p) =>
        p.nickname === nickname ? { ...p, connected: false } : p,
      );
      return { ...state, room: { ...state.room, participants }, seq: msg.seq ?? state.seq };
    }
    case "map.set": {
      if (!state.room) return state;
      const { path } = payloadAs<{ path: string }>(msg);
      return { ...state, room: { ...state.room, map: { path } }, seq: msg.seq ?? state.seq };
    }
    case "grid.set": {
      if (!state.room) return state;
      const grid = payloadAs<Grid>(msg);
      return { ...state, room: { ...state.room, grid }, seq: msg.seq ?? state.seq };
    }
    case "token.add": {
      if (!state.room) return state;
      const token = payloadAs<Token>(msg);
      return { ...state, room: { ...state.room, tokens: [...state.room.tokens, token] }, seq: msg.seq ?? state.seq };
    }
    case "token.move": {
      if (!state.room) return state;
      const { tokenId, x, y } = payloadAs<{ tokenId: string; x: number; y: number }>(msg);
      const tokens = state.room.tokens.map((t) => (t.id === tokenId ? { ...t, x, y } : t));
      return { ...state, room: { ...state.room, tokens }, seq: msg.seq ?? state.seq };
    }
    case "token.remove": {
      if (!state.room) return state;
      const { tokenId } = payloadAs<{ tokenId: string }>(msg);
      const tokens = state.room.tokens.filter((t) => t.id !== tokenId);
      return { ...state, room: { ...state.room, tokens }, seq: msg.seq ?? state.seq };
    }
    case "token.lock": {
      if (!state.room) return state;
      const { tokenId, locked } = payloadAs<{ tokenId: string; locked: boolean }>(msg);
      const tokens = state.room.tokens.map((t) => (t.id === tokenId ? { ...t, locked } : t));
      return { ...state, room: { ...state.room, tokens }, seq: msg.seq ?? state.seq };
    }
    case "dice.roll": {
      if (!state.room) return state;
      const entry = payloadAs<RollLogEntry>(msg);
      return { ...state, room: { ...state.room, log: capLog([...state.room.log, entry]) }, seq: msg.seq ?? state.seq };
    }
    case "chat.say": {
      if (!state.room) return state;
      const entry = payloadAs<ChatLogEntry>(msg);
      return { ...state, room: { ...state.room, log: capLog([...state.room.log, entry]) }, seq: msg.seq ?? state.seq };
    }
    case "ping.place": {
      const { x, y } = payloadAs<{ x: number; y: number }>(msg);
      const ping: Ping = { id: `${now}-${Math.random().toString(36).slice(2)}`, x, y, actor: msg.actor ?? "system", at: now };
      const pings = [...state.pings, ping].slice(-PING_CAP);
      return { ...state, pings, seq: msg.seq ?? state.seq };
    }
    case "character.set": {
      if (!state.room) return state;
      const character = payloadAs<Character>(msg);
      const idx = state.room.characters.findIndex((c) => c.id === character.id);
      const characters =
        idx === -1
          ? [...state.room.characters, character]
          : state.room.characters.map((c) => (c.id === character.id ? character : c));
      return { ...state, room: { ...state.room, characters }, seq: msg.seq ?? state.seq };
    }
    case "character.hp": {
      if (!state.room) return state;
      const { characterId, hpCurrent, hpMax } = payloadAs<{ characterId: string; hpCurrent: number; hpMax: number }>(msg);
      const characters = state.room.characters.map((c) => (c.id === characterId ? { ...c, hpCurrent, hpMax } : c));
      return { ...state, room: { ...state.room, characters }, seq: msg.seq ?? state.seq };
    }
    case "status.set": {
      if (!state.room) return state;
      const { characterId, status } = payloadAs<{ characterId: string; status: string[] }>(msg);
      const characters = state.room.characters.map((c) => (c.id === characterId ? { ...c, status } : c));
      return { ...state, room: { ...state.room, characters }, seq: msg.seq ?? state.seq };
    }
    case "initiative.set": {
      if (!state.room) return state;
      const entry = payloadAs<InitiativeEntry>(msg);
      const idx = state.room.initiative.findIndex((e) => e.id === entry.id);
      const initiative =
        idx === -1
          ? [...state.room.initiative, entry]
          : state.room.initiative.map((e) => (e.id === entry.id ? entry : e));
      return { ...state, room: { ...state.room, initiative }, seq: msg.seq ?? state.seq };
    }
    case "initiative.remove": {
      if (!state.room) return state;
      const { id } = payloadAs<{ id: string }>(msg);
      const initiative = state.room.initiative.filter((e) => e.id !== id);
      return { ...state, room: { ...state.room, initiative }, seq: msg.seq ?? state.seq };
    }
    case "fog.init":
    case "fog.reset": {
      if (!state.room) return state;
      const fog = payloadAs<FogState>(msg);
      return { ...state, room: { ...state.room, fog }, seq: msg.seq ?? state.seq };
    }
    case "fog.reveal": {
      if (!state.room || !state.room.fog) return state;
      const { cells } = payloadAs<{ cells: { x: number; y: number }[] }>(msg);
      const fog = revealFogCells(state.room.fog, cells);
      return { ...state, room: { ...state.room, fog }, seq: msg.seq ?? state.seq };
    }
    default:
      return state;
  }
}
