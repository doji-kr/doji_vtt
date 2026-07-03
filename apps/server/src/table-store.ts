import type Database from "better-sqlite3";
import type { Grid, RoomState } from "./table-protocol.js";

export interface TableRow {
  id: string;
  name: string;
  owner_user_id: string;
  /** users.display_name 조인 결과 — DB 컬럼이 아니라 쿼리 시점에 채워지는 값이다.
   * 기존 API 응답 필드 이름(ownerNickname)을 유지하기 위해 여기서 이름을 붙여둔다. */
  owner_display_name: string;
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
  initiative: RoomState["initiative"];
}

const SELECT_WITH_OWNER = `
  SELECT tables.*, users.display_name AS owner_display_name
  FROM tables
  JOIN users ON tables.owner_user_id = users.id
`;

export function insertTable(
  db: Database.Database,
  id: string,
  name: string,
  ownerUserId: string,
  inviteToken: string,
): TableRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tables (id, name, owner_user_id, invite_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, name, ownerUserId, inviteToken, now, now);
  return getTable(db, id)!;
}

export function getTable(db: Database.Database, id: string): TableRow | undefined {
  return db.prepare(`${SELECT_WITH_OWNER} WHERE tables.id = ?`).get(id) as TableRow | undefined;
}

export function getTableByInviteToken(db: Database.Database, inviteToken: string): TableRow | undefined {
  return db.prepare(`${SELECT_WITH_OWNER} WHERE tables.invite_token = ?`).get(inviteToken) as TableRow | undefined;
}

export function listTablesByOwner(db: Database.Database, ownerUserId: string): TableRow[] {
  return db
    .prepare(`${SELECT_WITH_OWNER} WHERE tables.owner_user_id = ? ORDER BY tables.updated_at DESC`)
    .all(ownerUserId) as TableRow[];
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
