import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { config } from "../config.js";
import { getTable, getTableByInviteToken, insertTable, listTablesByOwner, setTableMapPath } from "../table-store.js";
import { generateTurnCredential } from "../turn-credentials.js";

const TURN_CREDENTIAL_TTL_SECONDS = 60 * 60; // 1시간 — 세션 하나 동안은 재발급 없이 충분

const MAP_MAX_BYTES = 8 * 1024 * 1024;
const MAP_MIME_WHITELIST: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

type RequireSession = (request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => void;

export function registerTableRoutes(
  app: FastifyInstance,
  db: Database.Database,
  dataDir: string,
  requireSession: RequireSession,
): void {
  app.post(
    "/api/tables",
    { preHandler: requireSession },
    async (request, reply) => {
      // 테이블 생성(=DM이 되기)은 회원 계정 전용이다 — 게스트는 userId가 없으므로 여기서
      // 걸러진다(PROMPT-stage4.md §1, "게스트는 시트를 못 만든다"와 같은 원칙의 테이블판).
      if (!request.userId) {
        return reply.code(403).send({ error: "account_required", message: "테이블을 열려면 먼저 회원가입/로그인이 필요하다." });
      }
      const parsed = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body", message: "방 이름을 확인해달라 (1~60자)." });
      }
      const id = randomUUID();
      const inviteToken = randomBytes(12).toString("base64url");
      const row = insertTable(db, id, parsed.data.name, request.userId, inviteToken);
      return reply.code(201).send({ id: row.id, name: row.name, invite_token: row.invite_token });
    },
  );

  app.get(
    "/api/tables",
    { preHandler: requireSession },
    async (request, reply) => {
      if (!request.userId) {
        return reply.code(403).send({ error: "account_required", message: "이야기꾼의 서재는 회원만 볼 수 있다." });
      }
      const rows = listTablesByOwner(db, request.userId);
      return rows.map((r) => ({ id: r.id, name: r.name, invite_token: r.invite_token, updated_at: r.updated_at }));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/tables/:id",
    { preHandler: requireSession },
    async (request, reply) => {
      const row = getTable(db, request.params.id);
      if (!row) return reply.code(404).send({ error: "not_found", message: "그런 테이블이 없다." });
      return {
        id: row.id,
        name: row.name,
        ownerNickname: row.owner_display_name,
        isOwner: row.owner_user_id === request.userId,
      };
    },
  );

  app.get<{ Params: { token: string } }>(
    "/api/tables/by-invite/:token",
    { preHandler: requireSession },
    async (request, reply) => {
      const row = getTableByInviteToken(db, request.params.token);
      if (!row) return reply.code(404).send({ error: "not_found", message: "초대 링크가 유효하지 않다." });
      return { id: row.id, name: row.name };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/tables/:id/map",
    { preHandler: requireSession },
    async (request, reply) => {
      const row = getTable(db, request.params.id);
      if (!row) return reply.code(404).send({ error: "not_found", message: "그런 테이블이 없다." });
      if (row.owner_user_id !== request.userId) {
        return reply.code(403).send({ error: "forbidden", message: "DM만 지도를 올릴 수 있다." });
      }

      const file = await request.file({ limits: { fileSize: MAP_MAX_BYTES } });
      if (!file) return reply.code(400).send({ error: "no_file", message: "업로드된 파일이 없다." });

      const ext = MAP_MIME_WHITELIST[file.mimetype];
      if (!ext) {
        return reply
          .code(415)
          .send({ error: "unsupported_type", message: "png/jpg/webp만 지도로 올릴 수 있다." });
      }

      const buffer = await file.toBuffer();
      if (buffer.byteLength > MAP_MAX_BYTES) {
        return reply.code(413).send({ error: "too_large", message: "지도 파일은 8MB를 넘을 수 없다." });
      }

      const assetsDir = join(dataDir, "assets");
      mkdirSync(assetsDir, { recursive: true });
      // 경로 탈출 방지: 원본 파일명을 절대 쓰지 않고 무작위 id + 화이트리스트 확장자로 저장한다.
      const filename = `${randomUUID()}${ext}`;
      writeFileSync(join(assetsDir, filename), buffer);

      const publicPath = `/uploads/${filename}`;
      setTableMapPath(db, row.id, publicPath);
      return { path: publicPath };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/tables/:id/turn-credentials",
    { preHandler: requireSession },
    async (request, reply) => {
      const row = getTable(db, request.params.id);
      if (!row) return reply.code(404).send({ error: "not_found", message: "그런 테이블이 없다." });

      const iceServers: { urls: string | string[]; username?: string; credential?: string }[] = [
        { urls: ["stun:stun.l.google.com:19302"] },
      ];
      // TURN_SECRET이 없으면 coturn 없이(STUN만으로) 굴러가는 배포로 보고 TURN 항목을
      // 건너뛴다 — 4단계 §4 설계: coturn은 안전망이지 필수 인프라가 아니다.
      if (config.turnSecret && config.turnUrls.length > 0) {
        const { username, credential, ttl } = generateTurnCredential(
          config.turnSecret,
          request.nickname ?? request.params.id,
          TURN_CREDENTIAL_TTL_SECONDS,
        );
        iceServers.push({ urls: config.turnUrls, username, credential });
        return { iceServers, ttl };
      }
      return { iceServers, ttl: TURN_CREDENTIAL_TTL_SECONDS };
    },
  );
}
