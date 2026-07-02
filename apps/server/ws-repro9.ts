import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket from "ws";

const app = Fastify({ logger: false });
app.register(fastifyCookie, { secret: "test-secret-test-secret" });
app.register(fastifyWebsocket);

function myRequireSession(request: any, reply: any, done: any) {
  // unsignCookie를 호출하지 않고 바로 통과시킨다
  request.nickname = "닉";
  done();
}

app.get<{ Params: { id: string } }>(
  "/ws/tables/:id",
  { websocket: true, preHandler: myRequireSession },
  (socket, request) => {
    console.log("HANDLER CALLED. socket ctor=", (socket as any)?.constructor?.name, "request ctor=", (request as any)?.constructor?.name);
    socket.send("hello");
  },
);

await app.listen({ port: 0, host: "127.0.0.1" });
const addr = app.server.address() as any;
const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws/tables/abc123`);
ws.on("open", () => console.log("CLIENT: open"));
ws.on("message", (m) => { console.log("CLIENT got:", m.toString()); process.exit(0); });
ws.on("error", (e) => { console.log("CLIENT error:", e.message); process.exit(1); });
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 3000);
