import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { buildApp } from "./app.js";

const CONTENT_DIR = fileURLToPath(new URL("../../../content/modules", import.meta.url));
const INVITE_CODE = "test-invite";

let dataDir: string;

function freshDataDir(): string {
  return mkdtempSync(join(tmpdir(), "hearthside-ws-test-"));
}

async function startApp(dir: string): Promise<{ app: FastifyInstance; base: string }> {
  const app = await buildApp({
    dataDir: dir,
    contentDir: CONTENT_DIR,
    inviteCode: INVITE_CODE,
    sessionSecret: "test-secret-test-secret",
    logger: true,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (typeof address !== "object" || address === null) throw new Error("서버 주소를 못 얻었다");
  return { app, base: `http://127.0.0.1:${address.port}` };
}

async function login(base: string, nickname: string): Promise<string> {
  const res = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invite_code: INVITE_CODE, nickname }),
  });
  const cookies = res.headers.getSetCookie();
  const sessionCookie = cookies.find((c) => c.startsWith("hs_session="));
  if (!sessionCookie) throw new Error("세션 쿠키를 못 받았다");
  return sessionCookie.split(";")[0]!;
}

/** 테이블을 만드는(=DM이 되는) 쪽은 회원 계정이 필요하다 — 4단계부터 게스트는 방을 못 만든다.
 * username은 표시 이름과 별개(영문/숫자)라 매번 무관한 값을 만들어 충돌을 피한다. */
let registerCounter = 0;
async function registerMember(base: string, displayName: string): Promise<string> {
  registerCounter += 1;
  const res = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `member${registerCounter}`,
      password: "hunter2pass",
      display_name: displayName,
      invite_code: INVITE_CODE,
    }),
  });
  const cookies = res.headers.getSetCookie();
  const memberCookie = cookies.find((c) => c.startsWith("hs_member="));
  if (!memberCookie) throw new Error("회원 세션 쿠키를 못 받았다");
  return memberCookie.split(";")[0]!;
}

async function createTable(base: string, cookie: string, name: string): Promise<{ id: string; invite_token: string }> {
  const res = await fetch(`${base}/api/tables`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  return (await res.json()) as { id: string; invite_token: string };
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

function send(socket: WebSocket, type: string, payload: unknown): void {
  socket.send(JSON.stringify({ type, payload }));
}

/** predicate에 맞는 다음 메시지를 기다린다. 무관한 메시지(예: table.join 노이즈)는 무시한다. */
function waitFor(socket: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`timeout waiting for message matching predicate (${timeoutMs}ms)`));
    }, timeoutMs);
    function onMessage(raw: Buffer) {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve(msg);
      }
    }
    socket.on("message", onMessage);
  });
}

/** timeoutMs 동안 predicate에 맞는 메시지가 "오지 않았음"을 확인한다. */
async function assertNeverArrives(socket: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 400): Promise<void> {
  await expect(waitFor(socket, predicate, timeoutMs)).rejects.toThrow(/timeout/);
}

describe("실시간 테이블 WS", () => {
  let app: FastifyInstance;
  let base: string;

  beforeEach(async () => {
    dataDir = freshDataDir();
    ({ app, base } = await startApp(dataDir));
  });

  afterEach(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("두 클라이언트가 토큰 이동으로 동기화되고 seq가 단조 증가한다", async () => {
    const dmCookie = await registerMember(base, "DM닉");
    const playerCookie = await login(base, "플레이어닉");
    const table = await createTable(base, dmCookie, "테스트 방");

    const dmWs = connectWs(base, table.id, dmCookie);
    await onceOpen(dmWs);
    const playerWs = connectWs(base, table.id, playerCookie);
    await onceOpen(playerWs);

    send(dmWs, "hello", {});
    const dmSnapshot = await waitFor(dmWs, (m) => m.type === "state.snapshot");
    expect(dmSnapshot.payload.ownerNickname).toBe("DM닉");

    send(dmWs, "token.add", { label: "P", ownerNickname: "플레이어닉", x: 1, y: 1 });
    const addedOnDm = await waitFor(dmWs, (m) => m.type === "token.add");
    const addedOnPlayer = await waitFor(playerWs, (m) => m.type === "token.add");
    expect(addedOnDm.payload.id).toBe(addedOnPlayer.payload.id);
    const tokenId = addedOnDm.payload.id as string;
    const firstSeq = addedOnDm.seq as number;

    send(playerWs, "token.move", { tokenId, x: 5, y: 7 });
    const movedOnDm = await waitFor(dmWs, (m) => m.type === "token.move");
    const movedOnPlayer = await waitFor(playerWs, (m) => m.type === "token.move");
    expect(movedOnDm.payload).toEqual({ tokenId, x: 5, y: 7 });
    expect(movedOnPlayer.payload).toEqual({ tokenId, x: 5, y: 7 });
    expect(movedOnDm.seq).toBeGreaterThan(firstSeq);

    dmWs.close();
    playerWs.close();
  });

  it("권한 위반은 error로 응답하고 연결은 유지된다", async () => {
    const dmCookie = await registerMember(base, "DM닉2");
    const playerCookie = await login(base, "플레이어닉2");
    const table = await createTable(base, dmCookie, "테스트 방2");

    const dmWs = connectWs(base, table.id, dmCookie);
    await onceOpen(dmWs);
    const playerWs = connectWs(base, table.id, playerCookie);
    await onceOpen(playerWs);

    // 플레이어가 지도를 바꾸려 한다 — DM 전용 op
    send(playerWs, "map.set", { path: "/uploads/whatever.png" });
    const err = await waitFor(playerWs, (m) => m.type === "error");
    expect(err.payload.code).toBe("forbidden");

    // 연결이 살아있는지 — 이어서 정상 op(chat.say)가 여전히 통과하는지로 확인한다
    send(playerWs, "chat.say", { text: "아직 살아있다" });
    const chat = await waitFor(dmWs, (m) => m.type === "chat.say");
    expect(chat.payload.text).toBe("아직 살아있다");

    dmWs.close();
    playerWs.close();
  });

  it("잠긴 토큰은 소유자도 움직일 수 없고, 남의 토큰은 아예 움직일 수 없다", async () => {
    const dmCookie = await registerMember(base, "DM닉3");
    const playerCookie = await login(base, "플레이어닉3");
    const table = await createTable(base, dmCookie, "테스트 방3");

    const dmWs = connectWs(base, table.id, dmCookie);
    await onceOpen(dmWs);
    const playerWs = connectWs(base, table.id, playerCookie);
    await onceOpen(playerWs);

    send(dmWs, "token.add", { label: "P", ownerNickname: "플레이어닉3", x: 0, y: 0 });
    const added = await waitFor(dmWs, (m) => m.type === "token.add");
    await waitFor(playerWs, (m) => m.type === "token.add");
    const tokenId = added.payload.id as string;

    // 남의 토큰(주인이 없는 걸로 새로 하나 더 추가) 이동 시도
    send(dmWs, "token.add", { label: "M", ownerNickname: null, x: 2, y: 2 });
    const monster = await waitFor(dmWs, (m) => m.type === "token.add" && m.payload.label === "M");
    await waitFor(playerWs, (m) => m.type === "token.add" && m.payload.label === "M");

    send(playerWs, "token.move", { tokenId: monster.payload.id, x: 9, y: 9 });
    const forbidden1 = await waitFor(playerWs, (m) => m.type === "error");
    expect(forbidden1.payload.code).toBe("forbidden");

    // DM이 플레이어 토큰을 잠근다
    send(dmWs, "token.lock", { tokenId, locked: true });
    await waitFor(dmWs, (m) => m.type === "token.lock");
    await waitFor(playerWs, (m) => m.type === "token.lock");

    send(playerWs, "token.move", { tokenId, x: 3, y: 3 });
    const forbidden2 = await waitFor(playerWs, (m) => m.type === "error");
    expect(forbidden2.payload.code).toBe("forbidden");

    dmWs.close();
    playerWs.close();
  });

  it("게스트가 초대 링크로 테이블 id를 얻어 입장할 수 있다", async () => {
    const dmCookie = await registerMember(base, "DM닉4");
    const table = await createTable(base, dmCookie, "테스트 방4");

    const guestCookie = await login(base, "게스트닉4");
    const res = await fetch(`${base}/api/tables/by-invite/${table.invite_token}`, {
      headers: { Cookie: guestCookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toBe(table.id);

    const guestWs = connectWs(base, body.id, guestCookie);
    await onceOpen(guestWs);
    send(guestWs, "hello", {});
    const snapshot = await waitFor(guestWs, (m) => m.type === "state.snapshot");
    expect(snapshot.payload.ownerNickname).toBe("DM닉4");
    guestWs.close();
  });

  it("재접속(새 소켓)해도 스냅샷으로 방 상태를 복원한다", async () => {
    const dmCookie = await registerMember(base, "DM닉5");
    const table = await createTable(base, dmCookie, "테스트 방5");

    const dmWs1 = connectWs(base, table.id, dmCookie);
    await onceOpen(dmWs1);
    send(dmWs1, "token.add", { label: "X", ownerNickname: null, x: 1, y: 1 });
    await waitFor(dmWs1, (m) => m.type === "token.add");
    dmWs1.close();

    const dmWs2 = connectWs(base, table.id, dmCookie);
    await onceOpen(dmWs2);
    send(dmWs2, "hello", {});
    const snapshot = await waitFor(dmWs2, (m) => m.type === "state.snapshot");
    expect(snapshot.payload.tokens).toHaveLength(1);
    expect(snapshot.payload.tokens[0].label).toBe("X");
    dmWs2.close();
  });

  describe("비밀 굴림 채널 분리", () => {
    it("gm 굴림 결과는 DM 소켓에만 가고 플레이어 소켓에는 절대 안 간다", async () => {
      const dmCookie = await registerMember(base, "DM닉6");
      const playerCookie = await login(base, "플레이어닉6");
      const table = await createTable(base, dmCookie, "테스트 방6");

      const dmWs = connectWs(base, table.id, dmCookie);
      await onceOpen(dmWs);
      const playerWs = connectWs(base, table.id, playerCookie);
      await onceOpen(playerWs);

      send(dmWs, "dice.roll", { expression: "1d20+5", secret: true });
      const dmRoll = await waitFor(dmWs, (m) => m.type === "dice.roll");
      expect(dmRoll.payload.secret).toBe(true);

      // 플레이어 소켓에는 이 굴림이 절대 도착하지 않는다
      await assertNeverArrives(playerWs, (m) => m.type === "dice.roll");

      dmWs.close();
      playerWs.close();
    });

    it("플레이어가 secret:true를 시도하면 거부된다", async () => {
      const dmCookie = await registerMember(base, "DM닉7");
      const playerCookie = await login(base, "플레이어닉7");
      const table = await createTable(base, dmCookie, "테스트 방7");

      const dmWs = connectWs(base, table.id, dmCookie);
      await onceOpen(dmWs);
      const playerWs = connectWs(base, table.id, playerCookie);
      await onceOpen(playerWs);

      send(playerWs, "dice.roll", { expression: "1d20", secret: true });
      const err = await waitFor(playerWs, (m) => m.type === "error");
      expect(err.payload.code).toBe("forbidden");

      dmWs.close();
      playerWs.close();
    });

    it("공개 굴림은 양쪽 다 같은 결과를 받는다", async () => {
      const dmCookie = await registerMember(base, "DM닉8");
      const playerCookie = await login(base, "플레이어닉8");
      const table = await createTable(base, dmCookie, "테스트 방8");

      const dmWs = connectWs(base, table.id, dmCookie);
      await onceOpen(dmWs);
      const playerWs = connectWs(base, table.id, playerCookie);
      await onceOpen(playerWs);

      send(playerWs, "dice.roll", { expression: "2d6+1" });
      const onDm = await waitFor(dmWs, (m) => m.type === "dice.roll");
      const onPlayer = await waitFor(playerWs, (m) => m.type === "dice.roll");
      expect(onDm.payload.total).toBe(onPlayer.payload.total);
      expect(onDm.payload.secret).toBe(false);

      dmWs.close();
      playerWs.close();
    });
  });

  describe("계정 마이그레이션 — 소유권은 userId로만 판단한다", () => {
    it("게스트 세션으로는 POST /api/tables가 403이라 테이블 자체를 만들 수 없다", async () => {
      const guestCookie = await login(base, "방만들려는게스트");
      const res = await fetch(`${base}/api/tables`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: guestCookie },
        body: JSON.stringify({ name: "게스트의 방" }),
      });
      expect(res.status).toBe(403);
    });

    it("같은 표시 이름을 쓰더라도 회원이어야 DM role을 받는다 — 게스트는 항상 player", async () => {
      const dmCookie = await registerMember(base, "동명이인");
      const table = await createTable(base, dmCookie, "동명이인 테스트 방");

      // 게스트가 DM과 정확히 같은 표시 이름으로 들어와도 role은 player여야 한다
      // (역할 판단은 nickname 문자열이 아니라 userId로만 한다).
      const guestCookie = await login(base, "동명이인");
      const guestWs = connectWs(base, table.id, guestCookie);
      await onceOpen(guestWs);
      send(guestWs, "hello", {});
      const snapshot = await waitFor(guestWs, (m) => m.type === "state.snapshot");
      const self = snapshot.payload.participants.find((p: { nickname: string }) => p.nickname === "동명이인" && p.connected);
      // 게스트가 DM 전용 op를 시도하면 거부되는 것으로 role이 player임을 증명한다
      send(guestWs, "map.set", { path: "/uploads/x.png" });
      const err = await waitFor(guestWs, (m) => m.type === "error");
      expect(err.payload.code).toBe("forbidden");
      expect(self).toBeDefined();
      guestWs.close();
    });
  });
});
