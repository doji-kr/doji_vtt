import type Database from "better-sqlite3";
import type { AbilityMods, Character } from "./table-protocol.js";

export interface CharacterRow {
  id: string;
  table_id: string;
  token_id: string | null;
  owner_user_id: string;
  /** users.display_name 조인 결과 — DB 컬럼이 아니라 쿼리 시점에 채워지는 값이다. */
  owner_display_name: string;
  name: string;
  class: string;
  ability_mods_json: string;
  hp_current: number;
  hp_max: number;
  ac: number;
  status_json: string;
  updated_at: string;
}

const SELECT_WITH_OWNER = `
  SELECT characters.*, users.display_name AS owner_display_name
  FROM characters
  JOIN users ON characters.owner_user_id = users.id
`;

export function insertCharacter(
  db: Database.Database,
  id: string,
  tableId: string,
  ownerUserId: string,
  name: string,
  className: string,
  abilityMods: AbilityMods,
  ac: number,
  hpMax: number,
): CharacterRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO characters (id, table_id, owner_user_id, name, class, ability_mods_json, hp_current, hp_max, ac, status_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
  ).run(id, tableId, ownerUserId, name, className, JSON.stringify(abilityMods), hpMax, hpMax, ac, now);
  return getCharacter(db, id)!;
}

export function getCharacter(db: Database.Database, id: string): CharacterRow | undefined {
  return db.prepare(`${SELECT_WITH_OWNER} WHERE characters.id = ?`).get(id) as CharacterRow | undefined;
}

export function listCharactersByTable(db: Database.Database, tableId: string): CharacterRow[] {
  return db
    .prepare(`${SELECT_WITH_OWNER} WHERE characters.table_id = ? ORDER BY characters.updated_at ASC`)
    .all(tableId) as CharacterRow[];
}

/** character.set(기존 id 있음) — 이름·클래스·능력치수정치·AC·토큰 연결만 갱신한다.
 * HP는 별도 op(character.hp)의 몫이라 여기서 건드리지 않는다. */
export function updateCharacterFields(
  db: Database.Database,
  id: string,
  fields: { name: string; class: string; abilityMods: AbilityMods; ac: number; tokenId: string | null },
): CharacterRow {
  db.prepare(
    `UPDATE characters SET name = ?, class = ?, ability_mods_json = ?, ac = ?, token_id = ?, updated_at = ? WHERE id = ?`,
  ).run(fields.name, fields.class, JSON.stringify(fields.abilityMods), fields.ac, fields.tokenId, new Date().toISOString(), id);
  return getCharacter(db, id)!;
}

/** 델타가 아니라 절대값 — 명중→피해 자동 적용 금지(CLAUDE.md §1.6)를 지키려면
 * "몇 대 맞아서 몇 깎였다"를 서버가 계산하면 안 되고, 사람이 숫자를 직접 써넣는다. */
export function updateCharacterHp(db: Database.Database, id: string, hpCurrent: number, hpMax: number): CharacterRow {
  db.prepare(`UPDATE characters SET hp_current = ?, hp_max = ?, updated_at = ? WHERE id = ?`).run(
    hpCurrent,
    hpMax,
    new Date().toISOString(),
    id,
  );
  return getCharacter(db, id)!;
}

export function updateCharacterStatus(db: Database.Database, id: string, status: string[]): CharacterRow {
  db.prepare(`UPDATE characters SET status_json = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(status),
    new Date().toISOString(),
    id,
  );
  return getCharacter(db, id)!;
}

export function rowToCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name,
    tokenId: row.token_id,
    name: row.name,
    class: row.class,
    abilityMods: JSON.parse(row.ability_mods_json) as AbilityMods,
    hpCurrent: row.hp_current,
    hpMax: row.hp_max,
    ac: row.ac,
    status: JSON.parse(row.status_json) as string[],
    updatedAt: row.updated_at,
  };
}
