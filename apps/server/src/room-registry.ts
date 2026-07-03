import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { WebSocket } from "ws";
import { parseDiceExpression, rollDice } from "./dice.js";
import { initFog, resetFog, revealCells } from "./fog.js";
import { getTable, saveTableSnapshot, type TableRow } from "./table-store.js";
import {
  insertCharacter,
  listCharactersByTable,
  rowToCharacter,
  updateCharacterFields,
  updateCharacterHp,
  updateCharacterStatus,
} from "./character-store.js";
import { clientOpSchema } from "./table-protocol.js";
import type {
  Character,
  ClientOp,
  ErrorEnvelope,
  FogState,
  Grid,
  InitiativeEntry,
  LogEntry,
  Participant,
  RoomState,
  ServerEnvelope,
  Token,
} from "./table-protocol.js";

const LOG_CAP = 100;
const SAVE_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_MISS_LIMIT = 3;

interface Connection {
  socket: WebSocket;
  nickname: string;
  /** 회원 계정 id. 게스트 연결이면 null — role 판단에 쓰인다(userId만 신뢰). */
  userId: string | null;
  role: "dm" | "player";
  missedPongs: number;
}

function send(socket: WebSocket, data: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));
}

function sendError(socket: WebSocket, code: string, message: string): void {
  const env: ErrorEnvelope = { type: "error", payload: { code, message } };
  send(socket, env);
}

/** role !== 'dm'이면 secret 로그 항목을 걷어낸다 — 채널 분리를 스냅샷 레벨에서도 지킨다. */
function logForRole(log: LogEntry[], role: "dm" | "player"): LogEntry[] {
  if (role === "dm") return log;
  return log.filter((e) => !(e.kind === "roll" && e.secret));
}

export class LiveRoom {
  readonly id: string;
  private db: Database.Database;
  private grid: Grid;
  private mapPath: string | null;
  private tokens: Token[];
  private log: LogEntry[];
  private characters: Character[];
  private initiative: InitiativeEntry[];
  private fog: FogState | null;
  private participants: Map<string, Participant> = new Map();
  private connections: Set<Connection> = new Set();
  private seq: number;
  private ownerUserId: string;
  private ownerNickname: string;
  private name: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setInterval>;
  private heartbeatTimer: ReturnType<typeof setInterval>;

  constructor(db: Database.Database, row: TableRow) {
    this.db = db;
    this.id = row.id;
    this.name = row.name;
    this.ownerUserId = row.owner_user_id;
    this.ownerNickname = row.owner_display_name;
    this.mapPath = row.map_path;
    this.grid = JSON.parse(row.grid_json);
    const persisted = JSON.parse(row.state_json) as {
      tokens: Token[];
      log: LogEntry[];
      initiative?: InitiativeEntry[];
      fog?: FogState | null;
    };
    this.tokens = persisted.tokens;
    this.log = persisted.log;
    this.initiative = persisted.initiative ?? [];
    this.fog = persisted.fog ?? null;
    this.characters = listCharactersByTable(db, row.id).map(rowToCharacter);
    this.seq = row.last_seq;

    this.saveTimer = setInterval(() => this.flush(), SAVE_INTERVAL_MS);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  destroy(): void {
    clearInterval(this.saveTimer);
    clearInterval(this.heartbeatTimer);
    this.flush();
  }

  private flush(): void {
    if (!this.dirty) return;
    saveTableSnapshot(
      this.db,
      this.id,
      this.grid,
      { tokens: this.tokens, log: this.log, initiative: this.initiative, fog: this.fog },
      this.seq,
    );
    this.dirty = false;
  }

  private heartbeat(): void {
    for (const conn of [...this.connections]) {
      if (conn.missedPongs >= HEARTBEAT_MISS_LIMIT) {
        conn.socket.terminate();
        continue;
      }
      conn.missedPongs++;
      try {
        conn.socket.ping();
      } catch {
        // 소켓이 이미 죽었으면 다음 tick의 close 핸들러가 정리한다
      }
    }
  }

  /** DM 여부는 반드시 userId로만 판단한다 — 게스트(userId 없음)는 절대 DM이 될 수 없다. */
  roleOf(userId: string | null): "dm" | "player" {
    return userId !== null && userId === this.ownerUserId ? "dm" : "player";
  }

  private snapshot(role: "dm" | "player"): RoomState {
    return {
      name: this.name,
      ownerNickname: this.ownerNickname,
      map: { path: this.mapPath },
      grid: this.grid,
      tokens: this.tokens,
      participants: [...this.participants.values()],
      log: logForRole(this.log, role),
      characters: this.characters,
      initiative: this.initiative,
      fog: this.fog,
    };
  }

  private broadcast<T>(type: string, payload: T, actor: string, predicate?: (c: Connection) => boolean): void {
    this.seq += 1;
    this.dirty = true;
    const env: ServerEnvelope<T> = { seq: this.seq, room_id: this.id, actor, type, payload };
    for (const conn of this.connections) {
      if (predicate && !predicate(conn)) continue;
      send(conn.socket, env);
    }
  }

  /** 4단계 §4: WebRTC 시그널링 순수 릴레이 — 방 상태를 바꾸지 않으므로 seq를 소비하지
   * 않고(hello/error와 동일한 취급) dirty도 세우지 않는다. 대상이 여러 소켓(다중 탭)으로
   * 접속해 있으면 전부에게 보낸다 — 어느 탭이 받을지는 클라이언트가 정할 문제가 아니다. */
  private relay(type: string, payload: { toNickname: string; data?: unknown }, fromNickname: string): void {
    const env = { type, payload: { fromNickname, data: payload.data } };
    for (const conn of this.connections) {
      if (conn.nickname === payload.toNickname) send(conn.socket, env);
    }
  }

  private appendLog(entry: LogEntry): void {
    this.log.push(entry);
    if (this.log.length > LOG_CAP) this.log.splice(0, this.log.length - LOG_CAP);
  }

  join(socket: WebSocket, nickname: string, userId: string | null): void {
    const role = this.roleOf(userId);
    const conn: Connection = { socket, nickname, userId, role, missedPongs: 0 };
    this.connections.add(conn);
    this.participants.set(nickname, { nickname, role, connected: true });

    socket.on("pong", () => {
      conn.missedPongs = 0;
    });
    socket.on("message", (raw: Buffer) => this.handleMessage(conn, raw));
    socket.on("close", () => this.leave(conn));

    this.broadcast("table.join", { nickname, role }, nickname);
  }

  private leave(conn: Connection): void {
    this.connections.delete(conn);
    const p = this.participants.get(conn.nickname);
    if (p) this.participants.set(conn.nickname, { ...p, connected: false });
    this.broadcast("table.leave", { nickname: conn.nickname }, conn.nickname);
  }

  private handleMessage(conn: Connection, raw: Buffer): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      sendError(conn.socket, "invalid_json", "메시지가 올바른 JSON이 아니다.");
      return;
    }

    const opResult = clientOpSchemaSafeParse(parsed);
    if (!opResult.ok) {
      sendError(conn.socket, "invalid_op", opResult.message);
      return;
    }
    this.applyOp(conn, opResult.op);
  }

  private applyOp(conn: Connection, op: ClientOp): void {
    switch (op.type) {
      case "hello": {
        send(conn.socket, { type: "state.snapshot", payload: { ...this.snapshot(conn.role), seq: this.seq } });
        return;
      }
      case "map.set": {
        if (conn.role !== "dm") return void sendError(conn.socket, "forbidden", "DM만 지도를 바꿀 수 있다.");
        this.mapPath = op.payload.path;
        this.broadcast("map.set", op.payload, conn.nickname);
        return;
      }
      case "grid.set": {
        if (conn.role !== "dm") return void sendError(conn.socket, "forbidden", "DM만 그리드를 바꿀 수 있다.");
        this.grid = op.payload;
        this.broadcast("grid.set", op.payload, conn.nickname);
        return;
      }
      case "token.add": {
        if (conn.role !== "dm") return void sendError(conn.socket, "forbidden", "DM만 토큰을 추가할 수 있다.");
        const token: Token = {
          id: randomUUID(),
          ownerNickname: op.payload.ownerNickname,
          label: op.payload.label,
          x: op.payload.x,
          y: op.payload.y,
          colorSeed: op.payload.ownerNickname ?? op.payload.label,
          locked: false,
        };
        this.tokens.push(token);
        this.broadcast("token.add", token, conn.nickname);
        return;
      }
      case "token.move": {
        const token = this.tokens.find((t) => t.id === op.payload.tokenId);
        if (!token) return void sendError(conn.socket, "not_found", "그런 토큰이 없다.");
        if (conn.role !== "dm") {
          if (token.ownerNickname !== conn.nickname) {
            return void sendError(conn.socket, "forbidden", "남의 토큰은 움직일 수 없다.");
          }
          if (token.locked) return void sendError(conn.socket, "forbidden", "DM이 잠근 토큰이다.");
        }
        token.x = op.payload.x;
        token.y = op.payload.y;
        this.broadcast("token.move", { tokenId: token.id, x: token.x, y: token.y }, conn.nickname);
        return;
      }
      case "token.remove": {
        if (conn.role !== "dm") return void sendError(conn.socket, "forbidden", "DM만 토큰을 지울 수 있다.");
        const idx = this.tokens.findIndex((t) => t.id === op.payload.tokenId);
        if (idx === -1) return void sendError(conn.socket, "not_found", "그런 토큰이 없다.");
        this.tokens.splice(idx, 1);
        this.broadcast("token.remove", { tokenId: op.payload.tokenId }, conn.nickname);
        return;
      }
      case "token.lock": {
        if (conn.role !== "dm") return void sendError(conn.socket, "forbidden", "DM만 토큰을 잠글 수 있다.");
        const token = this.tokens.find((t) => t.id === op.payload.tokenId);
        if (!token) return void sendError(conn.socket, "not_found", "그런 토큰이 없다.");
        token.locked = op.payload.locked;
        this.broadcast("token.lock", { tokenId: token.id, locked: token.locked }, conn.nickname);
        return;
      }
      case "dice.roll": {
        const wantsSecret = op.payload.secret === true;
        if (wantsSecret && conn.role !== "dm") {
          return void sendError(conn.socket, "forbidden", "비밀 굴림은 DM만 할 수 있다.");
        }
        let spec;
        try {
          spec = parseDiceExpression(op.payload.expression);
        } catch (err) {
          return void sendError(conn.socket, "invalid_dice", (err as Error).message);
        }
        spec = { ...spec, secret: wantsSecret };
        const result = rollDice(spec);
        const entry: LogEntry = {
          kind: "roll",
          actor: conn.nickname,
          expression: op.payload.expression,
          rolls: result.rolls,
          total: result.total,
          mode: spec.mode,
          secret: spec.secret,
          at: new Date().toISOString(),
        };
        this.appendLog(entry);
        this.broadcast("dice.roll", entry, conn.nickname, spec.secret ? (c) => c.role === "dm" : undefined);
        return;
      }
      case "chat.say": {
        const entry: LogEntry = {
          kind: "chat",
          actor: conn.nickname,
          text: op.payload.text,
          ...(op.payload.whisperTo !== undefined ? { whisperTo: op.payload.whisperTo } : {}),
          at: new Date().toISOString(),
        };
        this.appendLog(entry);
        const predicate = op.payload.whisperTo
          ? (c: Connection) => c.nickname === conn.nickname || c.nickname === op.payload.whisperTo
          : undefined;
        this.broadcast("chat.say", entry, conn.nickname, predicate);
        return;
      }
      case "ping.place": {
        this.broadcast("ping.place", op.payload, conn.nickname);
        return;
      }
      case "character.set": {
        if (op.payload.id === undefined) {
          if (conn.userId === null) {
            return void sendError(conn.socket, "account_required", "게스트는 캐릭터 시트를 만들 수 없다.");
          }
          const hpMax = op.payload.hpMax ?? 0;
          const row = insertCharacter(
            this.db,
            randomUUID(),
            this.id,
            conn.userId,
            op.payload.name,
            op.payload.class,
            op.payload.abilityMods,
            op.payload.ac,
            hpMax,
          );
          const character = rowToCharacter(row);
          this.characters.push(character);
          this.broadcast("character.set", character, conn.nickname);
          return;
        }
        const existing = this.characters.find((c) => c.id === op.payload.id);
        if (!existing) return void sendError(conn.socket, "not_found", "그런 캐릭터가 없다.");
        if (existing.ownerUserId !== conn.userId && conn.role !== "dm") {
          return void sendError(conn.socket, "forbidden", "남의 캐릭터 시트는 고칠 수 없다.");
        }
        const row = updateCharacterFields(this.db, existing.id, {
          name: op.payload.name,
          class: op.payload.class,
          abilityMods: op.payload.abilityMods,
          ac: op.payload.ac,
          tokenId: op.payload.tokenId ?? existing.tokenId,
        });
        const character = rowToCharacter(row);
        this.characters = this.characters.map((c) => (c.id === character.id ? character : c));
        this.broadcast("character.set", character, conn.nickname);
        return;
      }
      case "character.hp": {
        const existing = this.characters.find((c) => c.id === op.payload.characterId);
        if (!existing) return void sendError(conn.socket, "not_found", "그런 캐릭터가 없다.");
        if (existing.ownerUserId !== conn.userId && conn.role !== "dm") {
          return void sendError(conn.socket, "forbidden", "남의 HP는 고칠 수 없다.");
        }
        const row = updateCharacterHp(this.db, existing.id, op.payload.hpCurrent, op.payload.hpMax);
        const character = rowToCharacter(row);
        this.characters = this.characters.map((c) => (c.id === character.id ? character : c));
        this.broadcast(
          "character.hp",
          { characterId: character.id, hpCurrent: character.hpCurrent, hpMax: character.hpMax },
          conn.nickname,
        );
        return;
      }
      case "status.set": {
        const existing = this.characters.find((c) => c.id === op.payload.characterId);
        if (!existing) return void sendError(conn.socket, "not_found", "그런 캐릭터가 없다.");
        if (existing.ownerUserId !== conn.userId && conn.role !== "dm") {
          return void sendError(conn.socket, "forbidden", "남의 상태는 고칠 수 없다.");
        }
        const row = updateCharacterStatus(this.db, existing.id, op.payload.status);
        const character = rowToCharacter(row);
        this.characters = this.characters.map((c) => (c.id === character.id ? character : c));
        this.broadcast("status.set", { characterId: character.id, status: character.status }, conn.nickname);
        return;
      }
      case "initiative.set": {
        if (conn.role !== "dm") return void sendError(conn.socket, "forbidden", "DM만 이니셔티브를 정할 수 있다.");
        const id = op.payload.id ?? randomUUID();
        const entry: InitiativeEntry = {
          id,
          label: op.payload.label,
          order: op.payload.order,
          characterId: op.payload.characterId ?? null,
        };
        const idx = this.initiative.findIndex((e) => e.id === id);
        if (idx === -1) this.initiative.push(entry);
        else this.initiative[idx] = entry;
        this.broadcast("initiative.set", entry, conn.nickname);
        return;
      }
      case "initiative.remove": {
        if (conn.role !== "dm") return void sendError(conn.socket, "forbidden", "DM만 이니셔티브를 지울 수 있다.");
        this.initiative = this.initiative.filter((e) => e.id !== op.payload.id);
        this.broadcast("initiative.remove", { id: op.payload.id }, conn.nickname);
        return;
      }
      case "fog.init": {
        if (conn.role !== "dm") return void sendError(conn.socket, "forbidden", "DM만 안개를 준비할 수 있다.");
        this.fog = initFog(op.payload.cols, op.payload.rows);
        this.broadcast("fog.init", this.fog, conn.nickname);
        return;
      }
      case "fog.reveal": {
        if (conn.role !== "dm") return void sendError(conn.socket, "forbidden", "DM만 안개를 걷을 수 있다.");
        if (!this.fog) return void sendError(conn.socket, "fog_not_initialized", "안개가 아직 준비되지 않았다.");
        this.fog = revealCells(this.fog, op.payload.cells);
        this.broadcast("fog.reveal", { cells: op.payload.cells }, conn.nickname);
        return;
      }
      case "fog.reset": {
        if (conn.role !== "dm") return void sendError(conn.socket, "forbidden", "DM만 안개를 초기화할 수 있다.");
        if (!this.fog) return void sendError(conn.socket, "fog_not_initialized", "안개가 아직 준비되지 않았다.");
        this.fog = resetFog(this.fog);
        this.broadcast("fog.reset", this.fog, conn.nickname);
        return;
      }
      case "voice.offer":
      case "voice.answer":
      case "voice.ice": {
        this.relay(op.type, op.payload, conn.nickname);
        return;
      }
    }
  }
}

// zod discriminatedUnion을 감싸서 실패 메시지를 사람이 읽기 좋게 만든다.
function clientOpSchemaSafeParse(data: unknown): { ok: true; op: ClientOp } | { ok: false; message: string } {
  const result = clientOpSchema.safeParse(data);
  if (result.success) return { ok: true, op: result.data };
  return { ok: false, message: result.error.issues[0]?.message ?? "op 형식이 올바르지 않다." };
}

export class RoomRegistry {
  private rooms = new Map<string, LiveRoom>();
  constructor(private db: Database.Database) {}

  getOrLoad(tableId: string): LiveRoom | undefined {
    const existing = this.rooms.get(tableId);
    if (existing) return existing;
    const row = getTable(this.db, tableId);
    if (!row) return undefined;
    const room = new LiveRoom(this.db, row);
    this.rooms.set(tableId, room);
    return room;
  }

  destroy(): void {
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }
}
