import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { buildApp } from "./app.js";

const CONTENT_DIR = fileURLToPath(new URL("../../../content/modules", import.meta.url));
const MODULE_JSON = JSON.parse(
  readFileSync(join(CONTENT_DIR, "rats-in-the-cellar", "module.json"), "utf-8"),
);
const DM_ONLY_STRINGS: string[] = [
  MODULE_JSON.npcs[0].secret,
  MODULE_JSON.scenes.find((s: { id: string }) => s.id === "shrine").secrets[0].dm_notes,
];

const INVITE_CODE = "test-invite";

function extractSessionCookie(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : [raw as string];
  const sessionCookie = cookies.find((c) => c?.startsWith("hs_session="));
  if (!sessionCookie) throw new Error("세션 쿠키를 못 찾았다");
  return sessionCookie.split(";")[0]!;
}

let app: FastifyInstance;
let dataDir: string;
const responses: unknown[] = [];

async function inject(opts: InjectOptions): Promise<LightMyRequestResponse> {
  const res = await app.inject(opts);
  try {
    responses.push(res.json());
  } catch {
    // body가 JSON이 아니면(204 등) 무시
  }
  return res;
}

async function login(nickname: string): Promise<string> {
  const res = await inject({
    method: "POST",
    url: "/api/session",
    payload: { invite_code: INVITE_CODE, nickname },
  });
  return extractSessionCookie(res);
}

function extractMemberCookie(res: LightMyRequestResponse): string {
  const raw = res.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : [raw as string];
  const memberCookie = cookies.find((c) => c?.startsWith("hs_member="));
  if (!memberCookie) throw new Error("회원 세션 쿠키를 못 찾았다");
  return memberCookie.split(";")[0]!;
}

async function register(username: string, password: string, displayName: string): Promise<string> {
  const res = await inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { username, password, display_name: displayName, invite_code: INVITE_CODE },
  });
  return extractMemberCookie(res);
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "hearthside-test-"));
  app = await buildApp({ dataDir, contentDir: CONTENT_DIR, inviteCode: INVITE_CODE, sessionSecret: "test-secret-test-secret" });
  responses.length = 0;
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("세션/인증", () => {
  it("초대코드 없이 보호 라우트에 접근하면 401", async () => {
    const res = await inject({ method: "POST", url: "/api/plays", payload: { module_id: "rats-in-the-cellar" } });
    expect(res.statusCode).toBe(401);
  });

  it("틀린 초대코드는 401", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/session",
      payload: { invite_code: "wrong", nickname: "누군가" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/session은 게스트 세션의 표시 이름을 돌려주고, 로그인 없이는 401", async () => {
    const anon = await inject({ method: "GET", url: "/api/session" });
    expect(anon.statusCode).toBe(401);

    const cookie = await login("나야");
    const res = await inject({ method: "GET", url: "/api/session", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kind: "guest", displayName: "나야" });
  });
});

describe("계정 본편 (회원가입/로그인)", () => {
  it("회원가입 → GET /api/session이 회원 정보를 돌려준다", async () => {
    const cookie = await register("dotte", "hunter2pass", "돗트");
    const res = await inject({ method: "GET", url: "/api/session", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("member");
    expect(body.username).toBe("dotte");
    expect(body.displayName).toBe("돗트");
    expect(typeof body.userId).toBe("string");
  });

  it("같은 username으로 두 번 가입하면 409", async () => {
    await register("dupe", "hunter2pass", "첫번째");
    const res = await inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "dupe", password: "anotherpass", display_name: "두번째", invite_code: INVITE_CODE },
    });
    expect(res.statusCode).toBe(409);
  });

  it("회원가입도 사이트 초대코드를 요구한다", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "noinvite", password: "hunter2pass", display_name: "초대없음", invite_code: "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("로그인 성공 시 회원 세션이 발급되고, 로그아웃 후 재로그인해도 같은 계정으로 인식된다", async () => {
    await register("relog", "hunter2pass", "재로그인");
    const res = await inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "relog", password: "hunter2pass" },
    });
    expect(res.statusCode).toBe(200);
    const cookie = extractMemberCookie(res);
    const who = await inject({ method: "GET", url: "/api/session", headers: { cookie } });
    expect(who.json().username).toBe("relog");
  });

  it("잘못된 비밀번호로 로그인하면 401", async () => {
    await register("wrongpw", "hunter2pass", "틀린비번");
    const res = await inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "wrongpw", password: "not-the-password" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("존재하지 않는 username으로 로그인하면 401", async () => {
    const res = await inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "no-such-user", password: "whatever12" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("비밀번호는 argon2id 해시로 저장되고 평문으로 남지 않는다", async () => {
    await register("hashcheck", "hunter2pass", "해시체크");
    const raw = new Database(join(dataDir, "hearthside.db"), { readonly: true });
    const row = raw.prepare(`SELECT password_hash FROM users WHERE username = ?`).get("hashcheck") as {
      password_hash: string;
    };
    raw.close();
    expect(row.password_hash).not.toContain("hunter2pass");
    expect(row.password_hash.startsWith("$argon2id$")).toBe(true);
  });

  it("게스트 세션만으로는 테이블을 만들 수 없다(403) — 회원 계정이 있어야 DM이 된다", async () => {
    const guestCookie = await login("게스트123");
    const res = await inject({
      method: "POST",
      url: "/api/tables",
      headers: { cookie: guestCookie },
      payload: { name: "게스트가 만들려는 방" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("회원 계정으로는 테이블을 만들 수 있다", async () => {
    const memberCookie = await register("tablemaker", "hunter2pass", "방주인");
    const res = await inject({
      method: "POST",
      url: "/api/tables",
      headers: { cookie: memberCookie },
      payload: { name: "회원이 만든 방" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("게스트 세션이어도 초대 토큰으로 테이블에는 참가할 수 있다(계정 불필요)", async () => {
    const memberCookie = await register("hostuser", "hunter2pass", "호스트");
    const created = await inject({
      method: "POST",
      url: "/api/tables",
      headers: { cookie: memberCookie },
      payload: { name: "게스트 참가 테스트 방" },
    });
    const inviteToken = created.json().invite_token as string;

    const guestCookie = await login("지나가던게스트");
    const res = await inject({
      method: "GET",
      url: `/api/tables/by-invite/${inviteToken}`,
      headers: { cookie: guestCookie },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("서가", () => {
  it("GET /api/modules는 lint를 통과한 rats-in-the-cellar를 soloPlayable:true로 노출한다", async () => {
    const res = await inject({ method: "GET", url: "/api/modules" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const entry = body.find((m: { id: string }) => m.id === "rats-in-the-cellar");
    expect(entry).toBeDefined();
    expect(entry.soloPlayable).toBe(true);
  });
});

describe("플레이 전체 흐름", () => {
  it("생성 → 입력 반복 → 엔딩까지 완주하고, 도중 이어하기로 정확히 같은 지점을 복원한다", async () => {
    const cookie = await login("돗트");
    const headers = { cookie };

    const created = await inject({
      method: "POST",
      url: "/api/plays",
      headers,
      payload: { module_id: "rats-in-the-cellar" },
    });
    expect(created.statusCode).toBe(201);
    const playId = created.json().play_id as string;

    // handout -> choice
    await inject({ method: "POST", url: `/api/plays/${playId}/inputs`, headers, payload: { input: { type: "continue" } } });
    const afterChoice = await inject({
      method: "POST",
      url: `/api/plays/${playId}/inputs`,
      headers,
      payload: { input: { type: "choose", optionId: "go_direct" } },
    });
    expect(afterChoice.json().effects.some((e: { type: string }) => e.type === "requestCheck")).toBe(true);

    // 이어하기: 새로고침 시나리오 — GET으로 같은 대기 상태가 재구성되는지 확인
    const reloaded = await inject({ method: "GET", url: `/api/plays/${playId}`, headers });
    expect(reloaded.json().effects).toEqual(afterChoice.json().effects);
    expect(reloaded.json().ended).toBe(false);

    // listen_stairs 성공 -> cellar_main
    await inject({
      method: "POST",
      url: `/api/plays/${playId}/inputs`,
      headers,
      payload: { input: { type: "resolveCheck", total: 15 } },
    });
    // encounter continue -> after_fight
    await inject({ method: "POST", url: `/api/plays/${playId}/inputs`, headers, payload: { input: { type: "continue" } } });
    // study_altar 성공
    await inject({
      method: "POST",
      url: `/api/plays/${playId}/inputs`,
      headers,
      payload: { input: { type: "resolveCheck", total: 18 } },
    });
    // secret reveal continue
    await inject({ method: "POST", url: `/api/plays/${playId}/inputs`, headers, payload: { input: { type: "continue" } } });
    // 엔딩 선택
    const ending = await inject({
      method: "POST",
      url: `/api/plays/${playId}/inputs`,
      headers,
      payload: { input: { type: "choose", optionId: "reseal_understood" } },
    });
    expect(ending.json().ended).toBe(true);
    expect(ending.json().effects.some((e: { type: string; endingId?: string }) => e.type === "end" && e.endingId === "seal_restored")).toBe(true);

    const listed = await inject({ method: "GET", url: "/api/plays", headers });
    expect(listed.json()[0].ended).toBe(true);
    expect(listed.json()[0].ending_id).toBe("seal_restored");

    // 이미 끝난 플레이에 또 입력하면 400
    const afterEnd = await inject({
      method: "POST",
      url: `/api/plays/${playId}/inputs`,
      headers,
      payload: { input: { type: "continue" } },
    });
    expect(afterEnd.statusCode).toBe(400);
  });

  it("잘못된 input(기대하는 타입과 다름)은 400을 반환한다", async () => {
    const cookie = await login("실수쟁이");
    const headers = { cookie };
    const created = await inject({
      method: "POST",
      url: "/api/plays",
      headers,
      payload: { module_id: "rats-in-the-cellar" },
    });
    const playId = created.json().play_id as string;

    // 지금은 handout(continue 대기)인데 choose를 보낸다
    const res = await inject({
      method: "POST",
      url: `/api/plays/${playId}/inputs`,
      headers,
      payload: { input: { type: "choose", optionId: "nope" } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("채널 분리 증명 테스트", () => {
  it("실패 경로까지 포함한 전체 플레이 동안 어떤 API 응답에도 dm_notes/Npc.secret 문자열이 등장하지 않는다", async () => {
    const cookie = await login("탐정");
    const headers = { cookie };

    const created = await inject({
      method: "POST",
      url: "/api/plays",
      headers,
      payload: { module_id: "rats-in-the-cellar" },
    });
    const playId = created.json().play_id as string;

    const inputs = [
      { type: "continue" },
      { type: "choose", optionId: "ask_first" },
      { type: "resolveCheck", total: 5 },
      { type: "resolveCheck", total: 5 },
      { type: "continue" },
      { type: "resolveCheck", total: 5 },
      { type: "continue" },
      { type: "choose", optionId: "just_leave" },
    ];
    for (const input of inputs) {
      await inject({ method: "POST", url: `/api/plays/${playId}/inputs`, headers, payload: { input } });
    }
    await inject({ method: "GET", url: `/api/plays/${playId}`, headers });
    await inject({ method: "GET", url: "/api/modules" });
    await inject({ method: "GET", url: "/api/modules/rats-in-the-cellar" });

    const serialized = JSON.stringify(responses);
    for (const secretText of DM_ONLY_STRINGS) {
      expect(serialized).not.toContain(secretText);
    }
  });
});
