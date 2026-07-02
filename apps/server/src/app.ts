import { existsSync, mkdirSync } from "node:fs";
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
  logger?: boolean;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const dataDir = opts.dataDir ?? config.dataDir;
  const contentDir = opts.contentDir ?? config.contentDir;
  const webDist = opts.webDist ?? config.webDist;
  const sessionSecret = opts.sessionSecret ?? config.sessionSecret;
  if (opts.inviteCode !== undefined) config.inviteCode = opts.inviteCode;

  const app = Fastify({ logger: opts.logger ?? false });

  const db = openDb(dataDir);
  const registry = loadModuleRegistry(contentDir);
  const assetsDir = join(dataDir, "assets");
  mkdirSync(assetsDir, { recursive: true });
  const rooms = new RoomRegistry(db);

  app.register(fastifyCookie, { secret: sessionSecret });
  app.register(fastifyMultipart);
  app.register(fastifyWebsocket);
  app.register(fastifyStatic, { root: contentDir, prefix: "/content/", decorateReply: true });
  app.register(fastifyStatic, { root: assetsDir, prefix: "/assets/", decorateReply: false });
  if (existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist, prefix: "/", decorateReply: false });
  }

  registerSessionRoutes(app);
  registerModuleRoutes(app, registry);
  registerPlayRoutes(app, db, registry);
  registerTableRoutes(app, db, dataDir);
  registerTableWsRoute(app, rooms);

  app.addHook("onClose", (_instance, done) => {
    rooms.destroy();
    db.close();
    done();
  });

  return app;
}
