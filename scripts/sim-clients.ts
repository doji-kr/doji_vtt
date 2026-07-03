// 3단계 부하 시뮬레이터 (PROMPT-stage3.md §5) — WS 클라이언트 6개가 60초 동안 초당 수 회
// token.move를 보내고, 릴레이 왕복 지연(p50/p95)과 서버 프로세스의 CPU/RSS를 출력한다.
//
// table-ws.test.ts와 같은 방식으로 apps/server의 buildApp()을 이 프로세스 안에서 직접
// 띄운다(별도 서버를 미리 실행해둘 필요가 없다 — `pnpm exec tsx scripts/sim-clients.ts` 한
// 줄로 끝난다). CPU/RSS는 이 프로세스 전체(시뮬레이터 + 인메모리 서버) 기준 근사치다.
//
// 사용법: pnpm exec tsx scripts/sim-clients.ts

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { buildApp } from "../apps/server/src/app.js";

const CLIENT_COUNT = 6;
// SIM_DURATION_MS는 로컬에서 빠르게 스모크 테스트할 때만 쓴다(기본값 60초가 스펙 요구치).
const DURATION_MS = Number(process.env.SIM_DURATION_MS ?? 60_000);
const MOVE_INTERVAL_MS = 200; // 클라이언트당 초당 ~5회
const CONTENT_DIR = fileURLToPath(new URL("../content/modules", import.meta.url));
const INVITE_CODE = "sim-invite";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

async function login(base: string, nickname: string): Promise<string> {
  const res = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invite_code: INVITE_CODE, nickname }),
  });
  const cookies = res.headers.getSetCookie();
  const sessionCookie = cookies.find((c) => c.startsWith("hs_session="));
  if (!sessionCookie) throw new Error(`로그인 실패: ${nickname}`);
  return sessionCookie.split(";")[0]!;
}

function connectWs(base: string, tableId: string, cookie: string): WebSocket {
  const wsUrl = base.replace("http://", "ws://") + `/ws/tables/${tableId}`;
  return new WebSocket(wsUrl, { headers: { Cookie: cookie } });
}

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

interface ServerMessage {
  type: string;
  payload: any;
  seq?: number;
  actor?: string;
}

function nextMatch(socket: WebSocket, predicate: (m: ServerMessage) => boolean, timeoutMs = 3000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("timeout waiting for token.move echo"));
    }, timeoutMs);
    function onMessage(raw: Buffer) {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      if (predicate(msg)) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve(msg);
      }
    }
    socket.on("message", onMessage);
  });
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "hearthside-sim-"));
  let app: FastifyInstance | undefined;

  try {
    app = await buildApp({
      dataDir,
      contentDir: CONTENT_DIR,
      inviteCode: INVITE_CODE,
      sessionSecret: "sim-secret-sim-secret",
      logger: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (typeof address !== "object" || address === null) throw new Error("서버 주소를 못 얻었다");
    const base = `http://127.0.0.1:${address.port}`;

    console.log(`[sim] 서버 기동: ${base}`);

    const nicknames = Array.from({ length: CLIENT_COUNT }, (_, i) => (i === 0 ? "부하DM" : `부하플레이어${i}`));
    const cookies = await Promise.all(nicknames.map((n) => login(base, n)));

    const tableRes = await fetch(`${base}/api/tables`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies[0]! },
      body: JSON.stringify({ name: "부하테스트 방" }),
    });
    const table = (await tableRes.json()) as { id: string };

    const sockets = await Promise.all(
      nicknames.map(async (_, i) => {
        const socket = connectWs(base, table.id, cookies[i]!);
        await onceOpen(socket);
        return socket;
      }),
    );

    // DM(sockets[0])이 클라이언트마다 토큰을 하나씩 만들어 준다 — 각자 자기 토큰만 움직인다.
    const tokenIds: string[] = [];
    for (let i = 0; i < CLIENT_COUNT; i++) {
      sockets[0]!.send(
        JSON.stringify({
          type: "token.add",
          payload: { label: `P${i}`, ownerNickname: i === 0 ? null : nicknames[i], x: i, y: 0 },
        }),
      );
      const added = await nextMatch(sockets[0]!, (m) => m.type === "token.add" && m.payload.label === `P${i}`);
      tokenIds.push(added.payload.id as string);
    }

    console.log(`[sim] 토큰 ${tokenIds.length}개 준비 완료. ${DURATION_MS / 1000}초 동안 클라이언트당 ~${1000 / MOVE_INTERVAL_MS}회/초 token.move 전송 시작...`);

    // 측정 시작 시점의 CPU 사용량 스냅샷 — 이후 delta로 평균 CPU%를 계산한다.
    const cpuStart = process.cpuUsage();
    const wallStart = performance.now();
    let peakRssMb = process.memoryUsage().rss / (1024 * 1024);
    const rssTimer = setInterval(() => {
      const rssMb = process.memoryUsage().rss / (1024 * 1024);
      if (rssMb > peakRssMb) peakRssMb = rssMb;
    }, 1000);

    const latenciesByClient: number[][] = [];
    const endAt = Date.now() + DURATION_MS;

    await Promise.all(
      sockets.map(async (socket, i) => {
        const tokenId = tokenIds[i]!;
        const latencies: number[] = [];
        latenciesByClient.push(latencies);
        let x = i;
        while (Date.now() < endAt) {
          x = (x + 0.5) % 20;
          const y = Math.random() * 20;
          const t0 = performance.now();
          socket.send(JSON.stringify({ type: "token.move", payload: { tokenId, x, y } }));
          try {
            await nextMatch(socket, (m) => m.type === "token.move" && m.payload.tokenId === tokenId);
            latencies.push(performance.now() - t0);
          } catch {
            // 타임아웃은 드롭으로 취급 — 통계에서 제외하고 계속 진행한다.
          }
          await sleep(MOVE_INTERVAL_MS);
        }
      }),
    );

    clearInterval(rssTimer);
    const wallMs = performance.now() - wallStart;
    const cpuDelta = process.cpuUsage(cpuStart);
    const cpuMs = (cpuDelta.user + cpuDelta.system) / 1000;
    const cpuPercent = (cpuMs / wallMs) * 100;
    const finalRssMb = process.memoryUsage().rss / (1024 * 1024);

    const allLatencies = latenciesByClient.flat().sort((a, b) => a - b);
    const totalOps = allLatencies.length;

    console.log("\n=== 결과 ===");
    console.log(`클라이언트 수: ${CLIENT_COUNT}, 측정 시간: ${(wallMs / 1000).toFixed(1)}s, 총 왕복 샘플: ${totalOps}`);
    console.log(`릴레이 왕복 지연 — p50: ${percentile(allLatencies, 50).toFixed(2)}ms, p95: ${percentile(allLatencies, 95).toFixed(2)}ms, max: ${(allLatencies[allLatencies.length - 1] ?? NaN).toFixed(2)}ms`);
    console.log(`서버 프로세스(시뮬레이터 포함) — 평균 CPU: ${cpuPercent.toFixed(1)}%, RSS 종료값: ${finalRssMb.toFixed(1)}MB, RSS 피크: ${peakRssMb.toFixed(1)}MB`);

    for (const socket of sockets) socket.close();
  } finally {
    if (app) await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[sim] 실패:", err);
  process.exitCode = 1;
});
