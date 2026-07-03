import { z } from "zod";

// ── 토큰 · 방 상태 ────────────────────────────────────────

export const tokenSchema = z.object({
  id: z.string(),
  ownerNickname: z.string().nullable(),
  label: z.string(),
  x: z.number(),
  y: z.number(),
  colorSeed: z.string(),
  locked: z.boolean(),
});
export type Token = z.infer<typeof tokenSchema>;

export const logEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("chat"),
    actor: z.string(),
    text: z.string(),
    whisperTo: z.string().optional(),
    at: z.string(),
  }),
  z.object({
    kind: z.literal("roll"),
    actor: z.string(),
    expression: z.string(),
    rolls: z.array(z.array(z.number())),
    total: z.number(),
    mode: z.enum(["normal", "adv", "dis"]),
    secret: z.boolean(),
    at: z.string(),
  }),
]);
export type LogEntry = z.infer<typeof logEntrySchema>;

export const gridSchema = z.object({
  cellSize: z.number().positive(),
  offsetX: z.number(),
  offsetY: z.number(),
});
export type Grid = z.infer<typeof gridSchema>;

export interface Participant {
  nickname: string;
  role: "dm" | "player";
  connected: boolean;
}

// ── 4단계 §2: 5e 라이트 시트 · 이니셔티브 ────────────────────

export const abilityModsSchema = z.object({
  str: z.number().int(),
  dex: z.number().int(),
  con: z.number().int(),
  int: z.number().int(),
  wis: z.number().int(),
  cha: z.number().int(),
});
export type AbilityMods = z.infer<typeof abilityModsSchema>;

/** owner_user_id NOT NULL을 반영 — 게스트가 만든 캐릭터는 있을 수 없다. */
export const characterSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  ownerDisplayName: z.string(),
  tokenId: z.string().nullable(),
  name: z.string(),
  class: z.string(),
  abilityMods: abilityModsSchema,
  hpCurrent: z.number().int(),
  hpMax: z.number().int(),
  ac: z.number().int(),
  status: z.array(z.string()),
  updatedAt: z.string(),
});
export type Character = z.infer<typeof characterSchema>;

export const initiativeEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  order: z.number(),
  characterId: z.string().nullable(),
});
export type InitiativeEntry = z.infer<typeof initiativeEntrySchema>;

// ── 4단계 §3: 수동 안개 ──────────────────────────────────────

/** RLE — 항상 "가려진(hidden) 구간" 길이부터 시작해 hidden/revealed를 번갈아 담는다.
 * 합계는 반드시 cols*rows와 같아야 한다. 큰 그리드에서도 페이로드가 작다. */
export const fogStateSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  runs: z.array(z.number().int().nonnegative()),
});
export type FogState = z.infer<typeof fogStateSchema>;

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

// ── c2s 오퍼레이션 ────────────────────────────────────────

export const clientOpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), payload: z.object({ last_seq: z.number().int().optional() }) }),
  z.object({ type: z.literal("map.set"), payload: z.object({ path: z.string().min(1) }) }),
  z.object({ type: z.literal("grid.set"), payload: gridSchema }),
  z.object({
    type: z.literal("token.add"),
    payload: z.object({
      label: z.string().min(1).max(8),
      ownerNickname: z.string().nullable(),
      x: z.number(),
      y: z.number(),
    }),
  }),
  z.object({
    type: z.literal("token.move"),
    payload: z.object({ tokenId: z.string(), x: z.number(), y: z.number() }),
  }),
  z.object({ type: z.literal("token.remove"), payload: z.object({ tokenId: z.string() }) }),
  z.object({
    type: z.literal("token.lock"),
    payload: z.object({ tokenId: z.string(), locked: z.boolean() }),
  }),
  z.object({
    type: z.literal("dice.roll"),
    payload: z.object({ expression: z.string().min(1), secret: z.boolean().optional() }),
  }),
  z.object({
    type: z.literal("chat.say"),
    payload: z.object({ text: z.string().min(1).max(2000), whisperTo: z.string().optional() }),
  }),
  z.object({ type: z.literal("ping.place"), payload: z.object({ x: z.number(), y: z.number() }) }),
  z.object({
    type: z.literal("character.set"),
    payload: z.object({
      id: z.string().optional(),
      name: z.string().min(1).max(40),
      class: z.string().max(30),
      abilityMods: abilityModsSchema,
      ac: z.number().int().min(0).max(30),
      tokenId: z.string().nullable().optional(),
      /** 생성 시에만 쓰인다(id 없을 때) — 시작 HP 시딩용. 갱신 시엔 무시한다(HP는 character.hp 몫). */
      hpMax: z.number().int().min(1).max(999).optional(),
    }),
  }),
  z.object({
    type: z.literal("character.hp"),
    payload: z.object({
      characterId: z.string(),
      hpCurrent: z.number().int(),
      hpMax: z.number().int().min(0),
    }),
  }),
  z.object({
    type: z.literal("status.set"),
    payload: z.object({
      characterId: z.string(),
      status: z.array(z.string().min(1).max(20)).max(10),
    }),
  }),
  z.object({
    type: z.literal("initiative.set"),
    payload: z.object({
      id: z.string().optional(),
      label: z.string().min(1).max(20),
      order: z.number(),
      characterId: z.string().nullable().optional(),
    }),
  }),
  z.object({ type: z.literal("initiative.remove"), payload: z.object({ id: z.string() }) }),
  z.object({
    type: z.literal("fog.init"),
    payload: z.object({ cols: z.number().int().min(1).max(200), rows: z.number().int().min(1).max(200) }),
  }),
  z.object({
    type: z.literal("fog.reveal"),
    payload: z.object({
      cells: z.array(z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() })).min(1).max(2000),
    }),
  }),
  z.object({ type: z.literal("fog.reset"), payload: z.object({}) }),
]);
export type ClientOp = z.infer<typeof clientOpSchema>;

// ── s2c 이벤트 ────────────────────────────────────────────

export interface ServerEnvelope<T = unknown> {
  seq: number;
  room_id: string;
  actor: string;
  type: string;
  payload: T;
}

export interface ErrorEnvelope {
  type: "error";
  payload: { code: string; message: string };
}
