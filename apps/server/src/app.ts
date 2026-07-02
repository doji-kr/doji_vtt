import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { loadModuleRegistry } from "./module-registry.js";
import { registerModuleRoutes } from "./routes/modules.js";
import { registerPlayRoutes } from "./routes/plays.js";
import { registerSessionRoutes } from "./routes/session.js";

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

  app.register(fastifyCookie, { secret: sessionSecret });
  app.register(fastifyStatic, { root: contentDir, prefix: "/content/", decorateReply: true });
  if (existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist, prefix: "/", decorateReply: false });
  }

  registerSessionRoutes(app);
  registerModuleRoutes(app, registry);
  registerPlayRoutes(app, db, registry);

  app.addHook("onClose", (_instance, done) => {
    db.close();
    done();
  });

  return app;
}
