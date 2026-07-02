import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { setSessionCookie } from "../session.js";

const bodySchema = z.object({
  invite_code: z.string().optional().default(""),
  nickname: z.string().trim().min(1).max(40),
});

export function registerSessionRoutes(app: FastifyInstance): void {
  app.post("/api/session", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "닉네임을 확인해달라 (1~40자)." });
    }
    if (config.inviteCode && parsed.data.invite_code !== config.inviteCode) {
      return reply.code(401).send({ error: "invalid_invite_code", message: "초대코드가 맞지 않는다." });
    }
    setSessionCookie(reply, parsed.data.nickname);
    return { nickname: parsed.data.nickname };
  });
}
