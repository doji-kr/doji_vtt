import type Database from "better-sqlite3";
import type { Grid, RoomState } from "./table-protocol.js";

export interface TableRow {
  id: string;
  name: string;
  owner_nickname: string;
  invite_token: string;
  map_path: string | null;
  grid_json: string;
  state_json: string;
  last_seq: number;
  created_at: string;
  updated_at: string;
}

export interface PersistedRoomState {
  tokens: RoomState["tokens"];
  log: RoomState["log"];
}

export function insertTable(
  db: Database.Database,
  id: string,
  name: string,
  ownerNickname: string,
  inviteToken: string,
): TableRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tables (id, name, owner_nickname, invite_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, name, ownerNickname, inviteToken, now, now);
  return getTable(db, id)!;
}

export function getTable(db: Database.Database, id: string): TableRow | undefined {
  return db.prepare(`SELECT * FROM tables WHERE id = ?`).get(id) as TableRow | undefined;
}

export function getTableByInviteToken(db: Database.Database, inviteToken: string): TableRow | undefined {
  return db.prepare(`SELECT * FROM tables WHERE invite_token = ?`).get(inviteToken) as TableRow | undefined;
}

export function listTablesByOwner(db: Database.Database, ownerNickname: string): TableRow[] {
  return db
    .prepare(`SELECT * FROM tables WHERE owner_nickname = ? ORDER BY updated_at DESC`)
    .all(ownerNickname) as TableRow[];
}

export function setTableMapPath(db: Database.Database, id: string, mapPath: string): void {
  db.prepare(`UPDATE tables SET map_path = ?, updated_at = ? WHERE id = ?`).run(
    mapPath,
    new Date().toISOString(),
    id,
  );
}

/** 디바운스 스냅샷 저장 — 방 메모리 상태를 그대로 SQLite에 반영한다. */
export function saveTableSnapshot(
  db: Database.Database,
  id: string,
  grid: Grid,
  state: PersistedRoomState,
  lastSeq: number,
): void {
  db.prepare(`UPDATE tables SET grid_json = ?, state_json = ?, last_seq = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(grid),
    JSON.stringify(state),
    lastSeq,
    new Date().toISOString(),
    id,
  );
}
