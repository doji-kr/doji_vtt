import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import WebSocket from "ws";
import { fileURLToPath } from "node:url";

const app = Fastify({ logger: false });
await app.register(fastifyCookie, { secret: "test-secret-test-secret" });
await app.register(fastifyMultipart);
await app.register(fastifyWebsocket);
app.register(fastifyStatic, { root: fileURLToPath(new URL("./src", import.meta.url)), prefix: "/content/", decorateReply: true });
app.register(fastifyStatic, { root: fileURLToPath(new URL("./src", import.meta.url)), prefix: "/assets/", decorateReply: false });
app.register(fastifyStatic, { root: fileURLToPath(new URL("../web/dist", import.meta.url)), prefix: "/", decorateReply: false });

function requireSession(request, reply, done) {
  request.nickname = "test";
  done();
}

app.get("/ws/tables/:id", { websocket: true, preHandler: requireSession }, (socket, request) => {
  console.log("HANDLER CALLED. socket ctor=", socket?.constructor?.name, "request ctor=", request?.constructor?.name, "params=", request?.params);
  socket.send("hello");
});

await app.listen({ port: 0, host: "127.0.0.1" });
const addr = app.server.address();
console.log("listening on", addr.port);

const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws/tables/abc123`);
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
}, 5000);
