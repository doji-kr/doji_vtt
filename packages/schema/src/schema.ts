import { z } from "zod";

/**
 * module.json 스키마 v0.1.
 * 필드명은 손으로 쓴 JSON을 그대로 반영한다 (snake_case) — CLAUDE.md §5 표기와 일치.
 */

export const SCHEMA_VERSION = "0.1" as const;

// ── 공용 원시 타입 ──────────────────────────────────────────

/** 플래그 값. 대부분 boolean이지만 상태 문자열/카운터도 허용한다. */
export const flagValueSchema = z.union([z.boolean(), z.string(), z.number()]);
export type FlagValue = z.infer<typeof flagValueSchema>;

/** 블록 실행 결과로 여러 플래그를 한 번에 바꿀 때 쓰는 맵. */
export const setFlagsSchema = z.record(z.string(), flagValueSchema);
export type SetFlags = z.infer<typeof setFlagsSchema>;

const nonEmpty = (label: string) => z.string().min(1, `${label}은(는) 비어 있을 수 없다`);

export const flagDefSchema = z.object({
  id: nonEmpty("flag.id"),
  description: z.string().optional(),
});
export type FlagDef = z.infer<typeof flagDefSchema>;

export const npcSchema = z.object({
  id: nonEmpty("npc.id"),
  name: nonEmpty("npc.name"),
  portrait: z.string().optional(),
  /** 이 NPC가 원하는 것. */
  wants: nonEmpty("npc.wants"),
  /** 이 NPC가 두려워하는 것. */
  fears: nonEmpty("npc.fears"),
  /** 이 NPC가 숨기는 것 — dm_notes와 동급으로 취급, 플레이어 채널에 노출 금지. */
  secret: nonEmpty("npc.secret"),
  voice_notes: z.string().optional(),
});
export type Npc = z.infer<typeof npcSchema>;

/** soft edge — 라이브 DM이 재량으로 넘나드는 연결. 결정론적 러너는 절대 자동으로 타지 않는다. */
export const softEdgeSchema = z.object({
  to: nonEmpty("edges_soft[].to"),
  note: z.string().optional(),
});
export type SoftEdge = z.infer<typeof softEdgeSchema>;

/** 씬에 딸린 비밀 하나. dm_notes는 절대 플레이어 채널로 나가지 않는다. */
export const secretSchema = z.object({
  id: nonEmpty("secret.id"),
  /** DM만 아는 진실. Effect 타입 어디에도 실리지 않는다. */
  dm_notes: nonEmpty("secret.dm_notes"),
  /** secret 블록이 발동됐을 때 플레이어에게 보여줄 문장. 없으면 플래그만 바뀌고 노출 없음. */
  reveal_text: z.string().optional(),
});
export type Secret = z.infer<typeof secretSchema>;

// ── 블록 5종 ────────────────────────────────────────────────

const choiceOptionSchema = z.object({
  id: nonEmpty("choice.options[].id"),
  label: nonEmpty("choice.options[].label"),
  goto: nonEmpty("choice.options[].goto"),
  /** 이 옵션을 보여주려면 참이어야 하는 플래그. 없으면 항상 노출. */
  requires_flag: z.string().optional(),
  set_flags: setFlagsSchema.optional(),
});
export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

export const checkBlockSchema = z.object({
  type: z.literal("check"),
  id: nonEmpty("check.id"),
  /** 5e 스킬/능력치 이름 (예: "감지", "설득"). */
  skill: nonEmpty("check.skill"),
  dc: z.number().int().min(1).max(30),
  on_success: z.object({
    read_aloud: z.string().optional(),
    goto: nonEmpty("check.on_success.goto"),
    set_flags: setFlagsSchema.optional(),
  }),
  /**
   * 실패도 전진(fail forward, CLAUDE.md §1.4) — goto는 선택이 아니라 필수다.
   * 실패는 이야기를 멈추는 게 아니라 다른 방향으로 튼다.
   */
  on_fail: z.object({
    read_aloud: z.string().optional(),
    goto: nonEmpty("check.on_fail.goto"),
    set_flags: setFlagsSchema.optional(),
  }),
});
export type CheckBlock = z.infer<typeof checkBlockSchema>;

export const choiceBlockSchema = z.object({
  type: z.literal("choice"),
  id: nonEmpty("choice.id"),
  prompt: z.string().optional(),
  options: z.array(choiceOptionSchema).min(1, "choice.options는 최소 1개"),
});
export type ChoiceBlock = z.infer<typeof choiceBlockSchema>;

export const encounterBlockSchema = z.object({
  type: z.literal("encounter"),
  id: nonEmpty("encounter.id"),
  name: nonEmpty("encounter.name"),
  read_aloud: z.string().optional(),
  dm_notes: z.string().optional(),
  monsters: z.array(z.string()).optional(),
  /**
   * 조우 종료 후 이동할 곳. 생략하면 같은 씬의 다음 블록으로 넘어간다
   * (마지막 블록이면 반드시 지정해야 한다).
   */
  goto: z.string().optional(),
});
export type EncounterBlock = z.infer<typeof encounterBlockSchema>;

export const handoutBlockSchema = z.object({
  type: z.literal("handout"),
  id: nonEmpty("handout.id"),
  title: nonEmpty("handout.title"),
  text: z.string().optional(),
  image: z.string().optional(),
  /** 생략하면 같은 씬의 다음 블록으로 넘어간다 (마지막 블록이면 반드시 지정). */
  goto: z.string().optional(),
});
export type HandoutBlock = z.infer<typeof handoutBlockSchema>;

export const secretBlockSchema = z.object({
  type: z.literal("secret"),
  id: nonEmpty("secret_block.id"),
  /** 같은 씬의 secrets[] 중 하나를 가리킨다. */
  secret_id: nonEmpty("secret_block.secret_id"),
  /** 생략하면 같은 씬의 다음 블록으로 넘어간다 (마지막 블록이면 반드시 지정). */
  goto: z.string().optional(),
  set_flags: setFlagsSchema.optional(),
});
export type SecretBlock = z.infer<typeof secretBlockSchema>;

export const blockSchema = z.discriminatedUnion("type", [
  checkBlockSchema,
  choiceBlockSchema,
  encounterBlockSchema,
  handoutBlockSchema,
  secretBlockSchema,
]);
export type Block = z.infer<typeof blockSchema>;

// ── 씬 ─────────────────────────────────────────────────────

export const sceneSchema = z
  .object({
    id: nonEmpty("scene.id"),
    title: z.string().optional(),
    /** 플레이어에게 그대로 읽어주는 도입부. */
    read_aloud: nonEmpty("scene.read_aloud"),
    /** DM만 보는 진행 메모. 어떤 Effect에도 실리지 않는다. */
    dm_notes: z.string().optional(),
    secrets: z.array(secretSchema).optional(),
    /**
     * 순서대로 실행되는 블록들. encounter/handout/secret은 goto를 생략하면
     * 다음 블록으로 자연스럽게 넘어간다 — 단, 마지막 블록만은 반드시 씬을 떠나야 한다
     * (check/choice는 애초에 분기점이라 goto가 항상 필수).
     * blocks가 비어 있으면 이 씬은 반드시 ending이어야 한다.
     */
    blocks: z.array(blockSchema).optional(),
    edges_soft: z.array(softEdgeSchema).optional(),
    /** 이 씬이 엔딩이면 채운다 — 있으면 blocks 실행 후(또는 즉시) 이야기가 끝난다. */
    ending: z
      .object({
        id: nonEmpty("scene.ending.id"),
        title: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((scene, ctx) => {
    const blocks = scene.blocks ?? [];
    const last = blocks[blocks.length - 1];
    if (last && (last.type === "encounter" || last.type === "handout" || last.type === "secret") && !last.goto) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blocks", blocks.length - 1, "goto"],
        message: `씬 "${scene.id}"의 마지막 블록 "${last.id}"은(는) goto 없이는 씬을 떠날 수 없다.`,
      });
    }
  });
export type Scene = z.infer<typeof sceneSchema>;

// ── 메타 ────────────────────────────────────────────────────

export const metaSchema = z.object({
  title: nonEmpty("meta.title"),
  logline: nonEmpty("meta.logline"),
  poster: z.string().optional(),
  tags: z.array(z.string()).optional(),
  difficulty: z.enum(["easy", "normal", "hard"]).optional(),
  estimated_minutes: z.number().int().positive().optional(),
  start_scene: nonEmpty("meta.start_scene"),
});
export type Meta = z.infer<typeof metaSchema>;

// ── 모듈 전체 ─────────────────────────────────────────────

export const moduleSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  meta: metaSchema,
  npcs: z.array(npcSchema).optional(),
  flags: z.array(flagDefSchema).optional(),
  scenes: z.array(sceneSchema).min(1, "scenes는 최소 1개"),
});
export type Module = z.infer<typeof moduleSchema>;

export function parseModule(data: unknown): Module {
  return moduleSchema.parse(data);
}
