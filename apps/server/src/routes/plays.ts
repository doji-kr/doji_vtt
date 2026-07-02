import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { createRun, step } from "@hearthside/runtime";
import type { Effect, Input } from "@hearthside/runtime";
import type { ModuleEntry } from "../module-registry.js";
import { appendInput, getPlay, insertPlay, listPlaysByNickname } from "../play-store.js";
import { findEmptyChoices, replayToCurrentEffects } from "../replay-effects.js";
import { requireSession } from "../session.js";

const inputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("continue") }),
  z.object({ type: z.literal("choose"), optionId: z.string().min(1) }),
  z.object({ type: z.literal("resolveCheck"), total: z.number().int() }),
]);

function extractEndingId(effects: Effect[]): string | undefined {
  return effects.find((e): e is Extract<Effect, { type: "end" }> => e.type === "end")?.endingId;
}

/** R7 후보(백로그, docs/STAGE2.md 참고): 소프트락을 500 대신 409로 명확히 보고한다. */
function respondIfSoftLocked(effects: Effect[], reply: FastifyReply): boolean {
  const empty = findEmptyChoices(effects);
  if (!empty) return false;
  reply.code(409).send({
    error: "soft_lock",
    message: `이야기가 진행 불가능한 상태에 도달했다 — 블록 "${empty.blockId}"의 선택지가 모두 조건에 막혀 있다. 작성자에게 알려달라.`,
  });
  return true;
}

export function registerPlayRoutes(app: FastifyInstance, db: Database.Database, registry: Map<string, ModuleEntry>): void {
  app.post(
    "/api/plays",
    { preHandler: requireSession },
    async (request, reply) => {
      const parsed = z.object({ module_id: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", message: "module_id가 필요하다." });
      }
      const entry = registry.get(parsed.data.module_id);
      if (!entry) {
        return reply.code(404).send({ error: "not_found", message: "그런 이야기는 서가에 없다." });
      }

      const { effects } = createRun(entry.module);
      if (respondIfSoftLocked(effects, reply)) return;

      const id = randomUUID();
      insertPlay(db, id, entry.summary.id, request.nickname!);
      return reply.code(201).send({ play_id: id, effects, ended: false });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/plays/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const row = getPlay(db, request.params.id);
      if (!row || row.nickname !== request.nickname) {
        return reply.code(404).send({ error: "not_found", message: "그런 플레이 기록이 없다." });
      }
      const entry = registry.get(row.module_id);
      if (!entry) {
        return reply.code(410).send({ error: "module_gone", message: "이 이야기는 더 이상 서가에 없다." });
      }
      const log = JSON.parse(row.log_json) as Input[];
      const { effects } = replayToCurrentEffects(entry.module, log);
      return { effects, ended: !!row.ended, ending_id: row.ending_id };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/plays/:id/inputs",
    { preHandler: requireSession },
    async (request, reply) => {
      const row = getPlay(db, request.params.id);
      if (!row || row.nickname !== request.nickname) {
        return reply.code(404).send({ error: "not_found", message: "그런 플레이 기록이 없다." });
      }
      if (row.ended) {
        return reply.code(400).send({ error: "already_ended", message: "이미 끝난 이야기다 — 처음부터 다시 시작해라." });
      }
      const entry = registry.get(row.module_id);
      if (!entry) {
        return reply.code(410).send({ error: "module_gone", message: "이 이야기는 더 이상 서가에 없다." });
      }
      const bodyParsed = z.object({ input: inputSchema }).safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.code(400).send({ error: "invalid_input", message: "입력 형식이 올바르지 않다." });
      }

      const existingLog = JSON.parse(row.log_json) as Input[];
      const { state: currentState } = replayToCurrentEffects(entry.module, existingLog);

      let stepResult: ReturnType<typeof step>;
      try {
        stepResult = step(currentState, bodyParsed.data.input);
      } catch (err) {
        return reply.code(400).send({ error: "rejected_input", message: (err as Error).message });
      }

      if (respondIfSoftLocked(stepResult.effects, reply)) return;

      const newLog = [...existingLog, bodyParsed.data.input];
      const ended = stepResult.state.ended;
      const endingId = extractEndingId(stepResult.effects);
      appendInput(db, row.id, newLog, ended, endingId);

      return { effects: stepResult.effects, ended };
    },
  );

  app.get(
    "/api/plays",
    { preHandler: requireSession },
    async (request) => {
      const rows = listPlaysByNickname(db, request.nickname!);
      return rows.map((r) => ({
        id: r.id,
        module_id: r.module_id,
        updated_at: r.updated_at,
        ended: !!r.ended,
        ending_id: r.ending_id,
      }));
    },
  );
}
