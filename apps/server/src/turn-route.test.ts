import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";

const CONTENT_DIR = fileURLToPath(new URL("../../../content/modules", import.meta.url));
const INVITE_CODE = "test-invite";

let app: FastifyInstance;
let dataDir: string;

async function registerMember(displayName: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username: "turnuser", password: "hunter2pass", display_name: displayName, invite_code: INVITE_CODE },
  });
  const cookies = res.headers["set-cookie"];
  const list = Array.isArray(cookies) ? cookies : [cookies as string];
  const memberCookie = list.find((c) => c?.startsWith("hs_member="));
  if (!memberCookie) throw new Error("회원 세션 쿠키를 못 받았다");
  return memberCookie.split(";")[0]!;
}

async function createTable(cookie: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/tables",
    headers: { cookie },
    payload: { name: "TURN 테스트 방" },
  });
  return res.json().id as string;
}

describe("GET /api/tables/:id/turn-credentials (4단계 §4)", () => {
  afterEach(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("TURN_SECRET이 없으면 STUN만 돌려주고 TURN 자격증명은 발급하지 않는다", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "hearthside-turn-test-"));
    app = await buildApp({
      dataDir,
      contentDir: CONTENT_DIR,
      inviteCode: INVITE_CODE,
      sessionSecret: "test-secret-test-secret",
      turnSecret: "",
      turnUrls: [],
    });
    const cookie = await registerMember("STUN만DM");
    const tableId = await createTable(cookie);

    const res = await app.inject({ method: "GET", url: `/api/tables/${tableId}/turn-credentials`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.iceServers).toHaveLength(1);
    expect(body.iceServers[0]).toEqual({ urls: ["stun:stun.l.google.com:19302"] });
  });

  it("TURN_SECRET이 있으면 HMAC 자격증명이 담긴 TURN 항목이 추가된다", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "hearthside-turn-test-"));
    app = await buildApp({
      dataDir,
      contentDir: CONTENT_DIR,
      inviteCode: INVITE_CODE,
      sessionSecret: "test-secret-test-secret",
      turnSecret: "shared-turn-secret",
      turnUrls: ["turn:example.invalid:3478"],
    });
    const cookie = await registerMember("TURN있음DM");
    const tableId = await createTable(cookie);

    const res = await app.inject({ method: "GET", url: `/api/tables/${tableId}/turn-credentials`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.iceServers).toHaveLength(2);
    const turnEntry = body.iceServers[1];
    expect(turnEntry.urls).toEqual(["turn:example.invalid:3478"]);
    expect(typeof turnEntry.username).toBe("string");
    expect(turnEntry.username.endsWith(":TURN있음DM")).toBe(true);
    expect(typeof turnEntry.credential).toBe("string");
    expect(turnEntry.credential.length).toBeGreaterThan(0);
  });

  it("로그인 없이는 401", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "hearthside-turn-test-"));
    app = await buildApp({
      dataDir,
      contentDir: CONTENT_DIR,
      inviteCode: INVITE_CODE,
      sessionSecret: "test-secret-test-secret",
      turnSecret: "",
      turnUrls: [],
    });
    const res = await app.inject({ method: "GET", url: "/api/tables/nonexistent/turn-credentials" });
    expect(res.statusCode).toBe(401);
  });

  it("존재하지 않는 테이블이면 404", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "hearthside-turn-test-"));
    app = await buildApp({
      dataDir,
      contentDir: CONTENT_DIR,
      inviteCode: INVITE_CODE,
      sessionSecret: "test-secret-test-secret",
      turnSecret: "",
      turnUrls: [],
    });
    const cookie = await registerMember("없는테이블DM");
    const res = await app.inject({
      method: "GET",
      url: "/api/tables/00000000-0000-0000-0000-000000000000/turn-credentials",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
