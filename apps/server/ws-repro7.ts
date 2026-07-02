import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket from "ws";
import { requireSession, setSessionCookie } from "./src/session.js";

const dataDir = mkdtempSync(join(tmpdir(), "ws-repro7-"));

const app = Fastify({ logger: false });
app.register(fastifyCookie, { secret: "test-secret-test-secret" });
app.register(fastifyWebsocket);

app.post("/login", async (request, reply) => {
  setSessionCookie(reply, "닉");
  return { ok: true };
});

app.get<{ Params: { id: string } }>(
  "/ws/tables/:id",
  { websocket: true, preHandler: requireSession },
  (socket, request) => {
    console.log("HANDLER CALLED. socket ctor=", (socket as any)?.constructor?.name, "request ctor=", (request as any)?.constructor?.name, "params=", (request as any)?.params);
    socket.send("hello");
  },
);

await app.listen({ port: 0, host: "127.0.0.1" });
const addr = app.server.address() as any;
console.log("listening on", addr.port);
const base = `http://127.0.0.1:${addr.port}`;

const res = await fetch(`${base}/login`, { method: "POST" });
const cookies = res.headers.getSetCookie();
const cookie = cookies.find((c) => c.startsWith("hs_session="))!.split(";")[0]!;
console.log("cookie=", cookie);

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
