import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

export function openDb(dataDir: string = config.dataDir): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "hearthside.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS plays (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      nickname TEXT NOT NULL,
      log_json TEXT NOT NULL DEFAULT '[]',
      ended INTEGER NOT NULL DEFAULT 0,
      ending_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plays_nickname ON plays(nickname);

    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_nickname TEXT NOT NULL,
      invite_token TEXT NOT NULL UNIQUE,
      map_path TEXT,
      grid_json TEXT NOT NULL DEFAULT '{"cellSize":32,"offsetX":0,"offsetY":0}',
      state_json TEXT NOT NULL DEFAULT '{"tokens":[],"log":[]}',
      last_seq INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tables_owner ON tables(owner_nickname);
    CREATE INDEX IF NOT EXISTS idx_tables_invite ON tables(invite_token);
  `);
  return db;
}
