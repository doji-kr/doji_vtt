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

export interface RoomState {
  name: string;
  ownerNickname: string;
  map: { path: string | null };
  grid: Grid;
  tokens: Token[];
  participants: Participant[];
  log: LogEntry[];
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
