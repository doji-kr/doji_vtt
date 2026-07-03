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
  /** 5단계: 회원이 만든 play만 채워진다 — 게스트는 nickname 기준을 그대로 쓴다. */
  owner_user_id: string | null;
  /** 5단계: 프리뷰 play(스튜디오 draft 재생)는 목록·이어하기 어디에도 노출되지 않는다. */
  is_preview: number;
  /** 5단계: 발행물(st-*) 대상 play 생성 시점의 published_hash — stale 판정에 쓴다. */
  module_hash: string | null;
}

export function insertPlay(
  db: Database.Database,
  id: string,
  moduleId: string,
  nickname: string,
  opts: { ownerUserId?: string | null; isPreview?: boolean; moduleHash?: string | null } = {},
): PlayRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO plays (id, module_id, nickname, log_json, ended, ending_id, created_at, updated_at, owner_user_id, is_preview, module_hash)
     VALUES (?, ?, ?, '[]', 0, NULL, ?, ?, ?, ?, ?)`,
  ).run(id, moduleId, nickname, now, now, opts.ownerUserId ?? null, opts.isPreview ? 1 : 0, opts.moduleHash ?? null);
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

/** 게스트 플레이 목록 — 3단계부터 있던 그대로, 프리뷰는 애초에 게스트가 만들 수 없다(회원 전용
 * 기능)지만 방어적으로 is_preview = 0을 조건에 넣는다. */
export function listPlaysByNickname(db: Database.Database, nickname: string): PlayRow[] {
  return db
    .prepare(`SELECT * FROM plays WHERE nickname = ? AND is_preview = 0 ORDER BY updated_at DESC`)
    .all(nickname) as PlayRow[];
}

/** 5단계: 회원 플레이 목록 — owner_user_id 기준. 같은 닉네임 게스트 둘의 세이브가 섞이던
 * 문제가 회원 계정에선 발생하지 않는다(닉네임 문자열이 아니라 계정 id로 귀속되므로). */
export function listPlaysByOwner(db: Database.Database, ownerUserId: string): PlayRow[] {
  return db
    .prepare(`SELECT * FROM plays WHERE owner_user_id = ? AND is_preview = 0 ORDER BY updated_at DESC`)
    .all(ownerUserId) as PlayRow[];
}
