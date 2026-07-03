import type Database from "better-sqlite3";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  created_at: string;
}

export function insertUser(
  db: Database.Database,
  id: string,
  username: string,
  passwordHash: string,
  displayName: string,
): UserRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, username, passwordHash, displayName, now);
  return getUserById(db, id)!;
}

export function getUserByUsername(db: Database.Database, username: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as UserRow | undefined;
}

export function getUserById(db: Database.Database, id: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}
