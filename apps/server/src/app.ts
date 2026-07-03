import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { loadModuleRegistry } from "./module-registry.js";
import { RoomRegistry } from "./room-registry.js";
import { makeRequireSession } from "./session.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerModuleRoutes } from "./routes/modules.js";
import { registerPlayRoutes } from "./routes/plays.js";
import { registerSessionRoutes } from "./routes/session.js";
import { registerTableRoutes } from "./routes/tables.js";
import { registerTableWsRoute } from "./routes/table-ws.js";

export interface BuildAppOptions {
  dataDir?: string;
  contentDir?: string;
  webDist?: string;
  sessionSecret?: string;
  inviteCode?: string;
  /** 4단계 §4: TURN 자격증명 발급용 공유 비밀·URL — 테스트에서 config 싱글턴을 오버라이드할 때 쓴다. */
  turnSecret?: string;
  turnUrls?: string[];
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const dataDir = opts.dataDir ?? config.dataDir;
  const contentDir = opts.contentDir ?? config.contentDir;
  const webDist = opts.webDist ?? config.webDist;
  const sessionSecret = opts.sessionSecret ?? config.sessionSecret;
  if (opts.inviteCode !== undefined) config.inviteCode = opts.inviteCode;
  if (opts.turnSecret !== undefined) config.turnSecret = opts.turnSecret;
  if (opts.turnUrls !== undefined) config.turnUrls = opts.turnUrls;

  const app = Fastify({ logger: opts.logger ?? false });

  const db = openDb(dataDir);
  const registry = loadModuleRegistry(contentDir);
  const assetsDir = join(dataDir, "assets");
  mkdirSync(assetsDir, { recursive: true });
  const rooms = new RoomRegistry(db);

  // 각 플러그인의 onRoute 훅(특히 @fastify/websocket)이 라우트 등록보다 먼저 붙어야 한다 —
  // await 없이 register만 하면 .get()이 훅 부착 전에 동기 실행되어 웹소켓 라우트가
  // 일반 HTTP 라우트로 등록되는 버그가 있었다(핸들러 인자 (socket,request)가 (request,reply)로 뒤바뀜).
  await app.register(fastifyCookie, { secret: sessionSecret });
  await app.register(fastifyMultipart);
  await app.register(fastifyWebsocket);
  await app.register(fastifyStatic, { root: contentDir, prefix: "/content/", decorateReply: true });
  // 업로드된 지도 이미지는 /uploads/ 아래 둔다 — Vite 빌드 산출물이 기본적으로 /assets/*.js|css로
  // 나오기 때문에, 지도용 정적 서빙을 /assets/에 물리면 find-my-way 라우팅에서 웹앱 번들 자체가
  // 가려져 브라우저에 흰 화면만 뜨는 충돌이 난다(실사용 중 발견).
  await app.register(fastifyStatic, { root: assetsDir, prefix: "/uploads/", decorateReply: false });
  const indexHtmlPath = join(webDist, "index.html");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/", decorateReply: false });
  }
  if (existsSync(indexHtmlPath)) {
    // 3단계 추가: 수동 라우팅 SPA(apps/web)라서 /t/:token, /table/:id 같은 경로는 실제 파일이
    // 아니다 — 정적 파일로 못 찾은 GET 요청은 index.html로 떨어뜨려 클라이언트가 pathname을
    // 읽고 알아서 화면을 고르게 한다. /api·/content·/uploads·/ws·/assets(웹 번들)는 원래대로
    // 404가 나야 하므로 이 경로들은 폴백에서 제외한다.
    const indexHtml = readFileSync(indexHtmlPath, "utf-8");
    app.setNotFoundHandler((request, reply) => {
      const isApiLike =
        request.method !== "GET" ||
        request.url.startsWith("/api") ||
        request.url.startsWith("/ws") ||
        request.url.startsWith("/content") ||
        request.url.startsWith("/uploads") ||
        request.url.startsWith("/assets");
      if (isApiLike) {
        return reply.code(404).send({ error: "not_found", message: "그런 경로가 없다." });
      }
      return reply.type("text/html").send(indexHtml);
    });
  }

  const requireSession = makeRequireSession(db);

  registerSessionRoutes(app, requireSession);
  registerAuthRoutes(app, db);
  registerModuleRoutes(app, registry);
  registerPlayRoutes(app, db, registry, requireSession);
  registerTableRoutes(app, db, dataDir, requireSession);
  registerTableWsRoute(app, rooms, requireSession);

  app.addHook("onClose", (_instance, done) => {
    rooms.destroy();
    db.close();
    done();
  });

  return app;
}
