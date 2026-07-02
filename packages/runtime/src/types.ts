import type { FlagValue, Module } from "@hearthside/schema";

/**
 * 플레이어 채널로 나가는 이벤트. dm_notes/Secret.dm_notes/Npc.secret은
 * 이 타입들 어디에도 필드로 존재하지 않는다 — 타입 수준의 채널 분리.
 */
export type Effect =
  | { type: "showReadAloud"; sceneId: string; text: string }
  /** check 판정 성공/실패 분기의 짧은 결과 서술. */
  | { type: "narrate"; text: string }
  | { type: "requestCheck"; blockId: string; skill: string; dc: number }
  | { type: "showChoices"; blockId: string; prompt?: string; options: { id: string; label: string }[] }
  | { type: "startEncounter"; blockId: string; name: string; readAloud?: string; monsters?: string[] }
  | { type: "giveHandout"; blockId: string; title: string; text?: string; image?: string }
  | { type: "revealSecret"; blockId: string; text: string }
  | { type: "setFlag"; flag: string; value: FlagValue }
  | { type: "end"; endingId: string; title?: string };

export type Input =
  | { type: "continue" }
  | { type: "choose"; optionId: string }
  | { type: "resolveCheck"; total: number };

export interface RunState {
  readonly module: Module;
  readonly sceneId: string;
  /** 현재 씬 안에서 다음 입력을 기다리는 블록의 인덱스. ended면 의미 없다. */
  readonly blockIndex: number;
  readonly flags: Record<string, FlagValue>;
  readonly ended: boolean;
  readonly endingId?: string;
  readonly endingTitle?: string;
  /** 입력 로그 — 세이브/replay의 유일한 근거. */
  readonly log: readonly Input[];
}
