import type { FastifyReply, FastifyRequest } from "fastify";

const COOKIE_NAME = "hs_session";

declare module "fastify" {
  interface FastifyRequest {
    nickname?: string;
  }
}

export function setSessionCookie(reply: FastifyReply, nickname: string): void {
  reply.setCookie(COOKIE_NAME, nickname, {
    signed: true,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** 보호 라우트 preHandler. 서명된 쿠키가 없거나 위조됐으면 401. */
export function requireSession(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
  const raw = request.cookies[COOKIE_NAME];
  if (!raw) {
    reply.code(401).send({ error: "no_session", message: "브렌다가 문 앞에서 막아선다 — 먼저 초대코드로 들어와야 한다." });
    return;
  }
  const result = request.unsignCookie(raw);
  if (!result.valid || !result.value) {
    reply.code(401).send({ error: "invalid_session", message: "세션이 만료됐거나 위조됐다 — 다시 들어와라." });
    return;
  }
  request.nickname = result.value;
  done();
}
