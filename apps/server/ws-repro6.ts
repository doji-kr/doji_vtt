import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket from "ws";
import { openDb } from "./src/db.js";
import { loadModuleRegistry } from "./src/module-registry.js";
import { RoomRegistry } from "./src/room-registry.js";
import { registerModuleRoutes } from "./src/routes/modules.js";
import { registerPlayRoutes } from "./src/routes/plays.js";
import { registerSessionRoutes } from "./src/routes/session.js";
import { registerTableRoutes } from "./src/routes/tables.js";
import { registerTableWsRoute } from "./src/routes/table-ws.js";

const dataDir = mkdtempSync(join(tmpdir(), "ws-repro6-"));
const contentDir = fileURLToPath(new URL("../../content/modules", import.meta.url));
const assetsDir = join(dataDir, "assets");
mkdirSync(assetsDir, { recursive: true });

const app = Fastify({ logger: false });
const db = openDb(dataDir);
const registry = loadModuleRegistry(contentDir);
const rooms = new RoomRegistry(db);

app.register(fastifyCookie, { secret: "test-secret-test-secret" });
app.register(fastifyMultipart);
app.register(fastifyWebsocket);
app.register(fastifyStatic, { root: contentDir, prefix: "/content/", decorateReply: true });
app.register(fastifyStatic, { root: assetsDir, prefix: "/assets/", decorateReply: false });

registerSessionRoutes(app);
console.log("FLAG_MODULES=", process.env.FLAG_MODULES);
if (process.env.FLAG_MODULES !== "0") registerModuleRoutes(app, registry);
if (process.env.FLAG_PLAYS !== "0") registerPlayRoutes(app, db, registry);
if (process.env.FLAG_TABLES !== "0") registerTableRoutes(app, db, dataDir);
registerTableWsRoute(app, rooms);

await app.listen({ port: 0, host: "127.0.0.1" });
const addr = app.server.address() as any;
console.log("listening on", addr.port);
const base = `http://127.0.0.1:${addr.port}`;

const res = await fetch(`${base}/api/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ invite_code: "", nickname: "닉" }),
});
const cookies = res.headers.getSetCookie();
const cookie = cookies.find((c) => c.startsWith("hs_session="))!.split(";")[0]!;

const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws/tables/abc123`, { headers: { Cookie: cookie } });
ws.on("open", () => console.log("CLIENT: open"));
ws.on("message", (m) => {
  console.log("CLIENT got:", m.toString());
  process.exit(0);
});
ws.on("error", (e) => {
  console.log("CLIENT error:", e.message);
  process.exit(1);
});
setTimeout(() => {
  console.log("TIMEOUT");
  process.exit(1);
}, 3000);
