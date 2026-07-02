import type Database from "better-sqlite3";
import type { Input } from "@hearthside/runtime";

export interface PlayRow {
  id: string;
  module_id: string;
  nickname: string;
  log_json: string;
  ended: number;
  ending_id: string | null;
  created_at: string;
  updated_at: string;
}

export function insertPlay(db: Database.Database, id: string, moduleId: string, nickname: string): PlayRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO plays (id, module_id, nickname, log_json, ended, ending_id, created_at, updated_at)
     VALUES (?, ?, ?, '[]', 0, NULL, ?, ?)`,
  ).run(id, moduleId, nickname, now, now);
  return getPlay(db, id)!;
}

export function getPlay(db: Database.Database, id: string): PlayRow | undefined {
  return db.prepare(`SELECT * FROM plays WHERE id = ?`).get(id) as PlayRow | undefined;
}

export function appendInput(
  db: Database.Database,
  id: string,
  log: readonly Input[],
  ended: boolean,
  endingId: string | undefined,
): void {
  db.prepare(
    `UPDATE plays SET log_json = ?, ended = ?, ending_id = ?, updated_at = ? WHERE id = ?`,
  ).run(JSON.stringify(log), ended ? 1 : 0, endingId ?? null, new Date().toISOString(), id);
}

export function listPlaysByNickname(db: Database.Database, nickname: string): PlayRow[] {
  return db
    .prepare(`SELECT * FROM plays WHERE nickname = ? ORDER BY updated_at DESC`)
    .all(nickname) as PlayRow[];
}
