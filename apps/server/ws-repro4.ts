import { buildApp } from "./src/app.js";
import WebSocket from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = mkdtempSync(join(tmpdir(), "ws-repro-"));
const contentDir = fileURLToPath(new URL("../../content/modules", import.meta.url));

const app = buildApp({ dataDir, contentDir, inviteCode: "test", sessionSecret: "test-secret-test-secret", logger: false });
await app.listen({ port: 0, host: "127.0.0.1" });
const addr = app.server.address();
console.log("listening on", addr.port);
const base = `http://127.0.0.1:${addr.port}`;

const res = await fetch(`${base}/api/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ invite_code: "test", nickname: "닉" }),
});
const cookies = res.headers.getSetCookie();
const cookie = cookies.find((c) => c.startsWith("hs_session=")).split(";")[0];
console.log("cookie=", cookie);

const tableRes = await fetch(`${base}/api/tables`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ name: "테스트" }),
});
const table = await tableRes.json();
console.log("table=", table);

const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws/tables/${table.id}`, { headers: { Cookie: cookie } });
ws.on("open", () => console.log("CLIENT: open"));
ws.on("message", (m) => {
  console.log("CLIENT got:", m.toString());
  process.exit(0);
});
ws.on("error", (e) => {
  console.log("CLIENT error:", e.message);
  process.exit(1);
});
ws.on("close", (code, reason) => console.log("CLIENT close:", code, reason?.toString()));
setTimeout(() => {
  console.log("TIMEOUT");
  process.exit(1);
}, 5000);
