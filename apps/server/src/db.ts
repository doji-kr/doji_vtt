import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

export function openDb(dataDir: string = config.dataDir): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "hearthside.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    -- 4단계 §1: 계정 본편. username은 로그인 식별자, display_name은 화면에 보이는 이름
    -- (예전의 nickname이 여기로 흡수된다). 비밀번호는 argon2id 해시만 저장한다.
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

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

    -- 4단계 §1: 테이블 소유권은 owner_nickname(문자열) 대신 owner_user_id(계정)로 판단한다 —
    -- 게스트는 users 행이 없으므로 테이블을 만들 수 없다(= "DM이 되려면 회원가입"의 실제 구현).
    -- 표시용 이름은 응답 시 users.display_name을 조인해 ownerNickname 필드로 그대로 내려준다
    -- (기존 API 계약 모양을 유지하기 위해, PROMPT-stage4.md §재범위공지 참고).
    CREATE TABLE IF NOT EXISTS tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      invite_token TEXT NOT NULL UNIQUE,
      map_path TEXT,
      grid_json TEXT NOT NULL DEFAULT '{"cellSize":32,"offsetX":0,"offsetY":0}',
      state_json TEXT NOT NULL DEFAULT '{"tokens":[],"log":[],"initiative":[]}',
      last_seq INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tables_owner ON tables(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_tables_invite ON tables(invite_token);

    -- 4단계 §2: 캐릭터 시트는 owner_user_id NOT NULL — 게스트는 시트를 만들 수 없다
    -- (PROMPT-stage4.md §2, users 행이 없는 게스트는 이 FK를 만족시킬 수 없다).
    -- 테이블 범위(캠페인을 넘나드는 휴대용 캐릭터는 다음 단계 몫). token_id는 토큰과
    -- 느슨하게 연결하되 NULL 허용(시트만 먼저 만들고 토큰은 나중에 놓을 수 있게).
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES tables(id),
      token_id TEXT,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      class TEXT NOT NULL DEFAULT '',
      ability_mods_json TEXT NOT NULL DEFAULT '{"str":0,"dex":0,"con":0,"int":0,"wis":0,"cha":0}',
      hp_current INTEGER NOT NULL DEFAULT 0,
      hp_max INTEGER NOT NULL DEFAULT 0,
      ac INTEGER NOT NULL DEFAULT 10,
      status_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_characters_table ON characters(table_id);
    CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_user_id);
  `);
  return db;
}
