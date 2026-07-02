import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "hearthside-test-"));
  app = buildApp({ dataDir, contentDir: CONTENT_DIR, inviteCode: INVITE_CODE, sessionSecret: "test-secret-test-secret" });
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
