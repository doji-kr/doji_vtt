import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import argon2 from "argon2";
import { z } from "zod";
import { config } from "../config.js";
import { setMemberCookie } from "../session.js";
import { getUserByUsername, insertUser } from "../user-store.js";

// 로그인 식별자는 영문/숫자/밑줄 3~20자 — 화면에 보이는 표시 이름(display_name)과는 분리한다
// (display_name은 지금의 nickname 자리를 그대로 잇는다: 한글 포함 1~40자).
const usernameSchema = z
  .string()
  .trim()
  .min(3, "아이디는 3자 이상이어야 한다.")
  .max(20, "아이디는 20자를 넘을 수 없다.")
  .regex(/^[a-zA-Z0-9_]+$/, "아이디는 영문/숫자/밑줄만 쓸 수 있다.");
const passwordSchema = z.string().min(8, "비밀번호는 8자 이상이어야 한다.").max(200);
const displayNameSchema = z.string().trim().min(1).max(40);

const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  display_name: displayNameSchema,
  invite_code: z.string().optional().default(""),
});

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance, db: Database.Database): void {
  app.post("/api/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", message: parsed.error.issues[0]?.message ?? "입력을 확인해달라." });
    }
    // 사이트 초대코드 게이트 — 게스트 입장과 같은 문(config.inviteCode)을 회원가입 시 1회
    // 요구한다. 로그인엔 필요 없다(PROMPT-stage4.md §1).
    if (config.inviteCode && parsed.data.invite_code !== config.inviteCode) {
      return reply.code(401).send({ error: "invalid_invite_code", message: "초대코드가 맞지 않는다." });
    }

    const existing = getUserByUsername(db, parsed.data.username);
    if (existing) {
      return reply.code(409).send({ error: "username_taken", message: "이미 쓰이고 있는 아이디다." });
    }

    const passwordHash = await argon2.hash(parsed.data.password, { type: argon2.argon2id });
    const id = randomUUID();
    const user = insertUser(db, id, parsed.data.username, passwordHash, parsed.data.display_name);

    setMemberCookie(reply, user.id);
    return reply.code(201).send({ kind: "member", userId: user.id, username: user.username, displayName: user.display_name });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "아이디와 비밀번호를 확인해달라." });
    }

    const user = getUserByUsername(db, parsed.data.username);
    // 사용자 없음/비밀번호 오류를 구분해 응답하면 아이디 존재 여부를 흘리게 되므로 같은
    // 메시지로 통일한다.
    const invalid = () => reply.code(401).send({ error: "invalid_credentials", message: "아이디 또는 비밀번호가 맞지 않는다." });
    if (!user) return invalid();

    const ok = await argon2.verify(user.password_hash, parsed.data.password);
    if (!ok) return invalid();

    setMemberCookie(reply, user.id);
    return { kind: "member", userId: user.id, username: user.username, displayName: user.display_name };
  });
}
