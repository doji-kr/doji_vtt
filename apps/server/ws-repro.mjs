import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket from "ws";

const app = Fastify({ logger: false });
await app.register(fastifyWebsocket);

app.get("/ws", { websocket: true }, (socket, request) => {
  console.log("HANDLER CALLED. socket ctor=", socket?.constructor?.name, "request ctor=", request?.constructor?.name);
  socket.send("hello");
});

await app.listen({ port: 0, host: "127.0.0.1" });
const addr = app.server.address();
console.log("listening on", addr.port);

const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
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
