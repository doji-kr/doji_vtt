import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { requireSession, setSessionCookie } from "../session.js";

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

  // 3단계 추가: 클라이언트가 "나는 누구인가"를 알아야 하는 화면(테이블 화면의 자기 토큰/역할
  // 판단)이 생겨서, 쿠키만으로 현재 닉네임을 확인하는 조회 라우트를 더했다. 새 인증 흐름은
  // 아니다 — 기존 서명 쿠키를 그대로 읽는다.
  app.get("/api/session", { preHandler: requireSession }, async (request) => {
    return { nickname: request.nickname! };
  });
}
