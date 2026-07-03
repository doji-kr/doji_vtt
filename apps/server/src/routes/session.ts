import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { setGuestCookie } from "../session.js";

const bodySchema = z.object({
  invite_code: z.string().optional().default(""),
  nickname: z.string().trim().min(1).max(40),
});

type RequireSession = (request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => void;

/**
 * 게스트 세션 발급 + 조회. `POST /api/session`은 3단계부터 있던 "닉네임 + 초대코드"
 * 엔드포인트 그대로다 — 4단계에서 폐기하지 않고, "게스트 세션 발급"이라는 이름으로 계속 쓴다
 * (PROMPT-stage4.md §1). 회원 가입/로그인은 routes/auth.ts가 새로 담당한다.
 */
export function registerSessionRoutes(app: FastifyInstance, requireSession: RequireSession): void {
  app.post("/api/session", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "닉네임을 확인해달라 (1~40자)." });
    }
    if (config.inviteCode && parsed.data.invite_code !== config.inviteCode) {
      return reply.code(401).send({ error: "invalid_invite_code", message: "초대코드가 맞지 않는다." });
    }
    setGuestCookie(reply, parsed.data.nickname);
    return { kind: "guest", displayName: parsed.data.nickname };
  });

  // whoAmI — 회원/게스트 어느 쪽이든 현재 세션의 표시 이름을 돌려준다. 클라이언트는 kind로
  // 회원/게스트를 구분해 UI를 가른다(예: 홈 화면 진입은 회원만).
  app.get("/api/session", { preHandler: requireSession }, async (request) => {
    if (request.userId) {
      return {
        kind: "member" as const,
        userId: request.userId,
        username: request.username!,
        displayName: request.displayName!,
      };
    }
    return { kind: "guest" as const, displayName: request.guestName! };
  });
}
