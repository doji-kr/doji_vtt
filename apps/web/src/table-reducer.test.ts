import { describe, expect, it } from "vitest";
import {
  applyServerMessage,
  initialTableClientState,
  type RoomState,
  type ServerMessage,
} from "./table-reducer.js";

const baseRoom: RoomState = {
  name: "테스트 방",
  ownerNickname: "DM닉",
  map: { path: null },
  grid: { cellSize: 32, offsetX: 0, offsetY: 0 },
  tokens: [],
  participants: [{ nickname: "DM닉", role: "dm", connected: true }],
  log: [],
  characters: [],
  initiative: [],
};

const zeroMods = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };

function snapshot(overrides: Partial<RoomState> = {}, seq = 3): ServerMessage {
  return { type: "state.snapshot", payload: { ...baseRoom, ...overrides, seq } };
}

describe("applyServerMessage", () => {
  it("state.snapshot으로 room을 채우고 selfRole을 ownerNickname 비교로 정한다", () => {
    const s1 = applyServerMessage(initialTableClientState, snapshot(), "DM닉");
    expect(s1.selfRole).toBe("dm");
    expect(s1.room?.name).toBe("테스트 방");
    expect(s1.seq).toBe(3);

    const s2 = applyServerMessage(initialTableClientState, snapshot(), "플레이어닉");
    expect(s2.selfRole).toBe("player");
  });

  it("token.add로 토큰이 추가되고 token.move로 좌표가 갱신된다", () => {
    let s = applyServerMessage(initialTableClientState, snapshot(), "DM닉");
    s = applyServerMessage(
      s,
      { type: "token.add", payload: { id: "t1", ownerNickname: null, label: "M", x: 1, y: 1, colorSeed: "M", locked: false }, seq: 4 },
      "DM닉",
    );
    expect(s.room?.tokens).toHaveLength(1);

    s = applyServerMessage(s, { type: "token.move", payload: { tokenId: "t1", x: 5, y: 7 }, seq: 5 }, "DM닉");
    expect(s.room?.tokens[0]).toMatchObject({ x: 5, y: 7 });
  });

  it("token.lock/token.remove가 반영된다", () => {
    let s = applyServerMessage(initialTableClientState, snapshot(), "DM닉");
    s = applyServerMessage(
      s,
      { type: "token.add", payload: { id: "t1", ownerNickname: null, label: "M", x: 0, y: 0, colorSeed: "M", locked: false }, seq: 4 },
      "DM닉",
    );
    s = applyServerMessage(s, { type: "token.lock", payload: { tokenId: "t1", locked: true }, seq: 5 }, "DM닉");
    expect(s.room?.tokens[0]?.locked).toBe(true);

    s = applyServerMessage(s, { type: "token.remove", payload: { tokenId: "t1" }, seq: 6 }, "DM닉");
    expect(s.room?.tokens).toHaveLength(0);
  });

  it("dice.roll / chat.say가 log에 그대로 쌓인다 (클라이언트는 절대 필터링하지 않는다)", () => {
    let s = applyServerMessage(initialTableClientState, snapshot(), "플레이어닉");
    s = applyServerMessage(
      s,
      {
        type: "dice.roll",
        payload: { kind: "roll", actor: "DM닉", expression: "1d20+5", rolls: [[20]], total: 25, mode: "normal", secret: false, at: "now" },
        seq: 4,
      },
      "플레이어닉",
    );
    expect(s.room?.log).toHaveLength(1);
    expect(s.room?.log[0]).toMatchObject({ kind: "roll", total: 25 });

    s = applyServerMessage(
      s,
      { type: "chat.say", payload: { kind: "chat", actor: "플레이어닉", text: "안녕", at: "now" }, seq: 5 },
      "플레이어닉",
    );
    expect(s.room?.log).toHaveLength(2);
  });

  it("log가 100개를 넘으면 앞에서부터 잘려나간다", () => {
    let s = applyServerMessage(initialTableClientState, snapshot(), "DM닉");
    for (let i = 0; i < 105; i++) {
      s = applyServerMessage(
        s,
        { type: "chat.say", payload: { kind: "chat", actor: "DM닉", text: `msg${i}`, at: "now" }, seq: 4 + i },
        "DM닉",
      );
    }
    expect(s.room?.log).toHaveLength(100);
    expect((s.room?.log[0] as { text: string }).text).toBe("msg5");
  });

  it("table.join/table.leave가 참가자 목록의 연결 상태를 갱신한다", () => {
    let s = applyServerMessage(initialTableClientState, snapshot(), "DM닉");
    s = applyServerMessage(s, { type: "table.join", payload: { role: "player" }, actor: "새친구", seq: 4 }, "DM닉");
    expect(s.room?.participants.find((p) => p.nickname === "새친구")).toMatchObject({ connected: true, role: "player" });

    s = applyServerMessage(s, { type: "table.leave", payload: { nickname: "새친구" }, seq: 5 }, "DM닉");
    expect(s.room?.participants.find((p) => p.nickname === "새친구")?.connected).toBe(false);
  });

  it("map.set / grid.set이 반영된다", () => {
    let s = applyServerMessage(initialTableClientState, snapshot(), "DM닉");
    s = applyServerMessage(s, { type: "map.set", payload: { path: "/assets/x.png" }, seq: 4 }, "DM닉");
    expect(s.room?.map.path).toBe("/assets/x.png");

    s = applyServerMessage(s, { type: "grid.set", payload: { cellSize: 48, offsetX: 10, offsetY: -5 }, seq: 5 }, "DM닉");
    expect(s.room?.grid).toEqual({ cellSize: 48, offsetX: 10, offsetY: -5 });
  });

  it("error 메시지는 lastError에 저장되고 room을 건드리지 않는다", () => {
    let s = applyServerMessage(initialTableClientState, snapshot(), "플레이어닉");
    const before = s.room;
    s = applyServerMessage(s, { type: "error", payload: { code: "forbidden", message: "안 된다" } }, "플레이어닉");
    expect(s.lastError).toEqual({ code: "forbidden", message: "안 된다" });
    expect(s.room).toBe(before);
  });

  it("ping.place가 pings에 쌓이고 20개를 넘으면 오래된 것부터 잘린다", () => {
    let s = initialTableClientState;
    for (let i = 0; i < 25; i++) {
      s = applyServerMessage(s, { type: "ping.place", payload: { x: i, y: i }, actor: "누군가", seq: i }, "DM닉", 1000 + i);
    }
    expect(s.pings).toHaveLength(20);
    expect(s.pings[0]?.x).toBe(5);
    expect(s.pings[s.pings.length - 1]?.x).toBe(24);
  });

  it("room이 아직 없으면(스냅샷 전) 델타 이벤트는 무시된다", () => {
    const s = applyServerMessage(initialTableClientState, { type: "token.move", payload: { tokenId: "x", x: 1, y: 1 }, seq: 1 }, "DM닉");
    expect(s.room).toBeNull();
  });

  it("character.set으로 캐릭터가 생성/갱신되고, character.hp·status.set이 반영된다", () => {
    let s = applyServerMessage(initialTableClientState, snapshot(), "플레이어닉");
    const character = {
      id: "c1",
      ownerUserId: "u1",
      ownerDisplayName: "플레이어닉",
      tokenId: null,
      name: "아리아",
      class: "로그",
      abilityMods: zeroMods,
      hpCurrent: 10,
      hpMax: 10,
      ac: 14,
      status: [],
      updatedAt: "now",
    };
    s = applyServerMessage(s, { type: "character.set", payload: character, seq: 4 }, "플레이어닉");
    expect(s.room?.characters).toHaveLength(1);

    s = applyServerMessage(
      s,
      { type: "character.set", payload: { ...character, class: "로그(도적단)" }, seq: 5 },
      "플레이어닉",
    );
    expect(s.room?.characters).toHaveLength(1);
    expect(s.room?.characters[0]?.class).toBe("로그(도적단)");

    s = applyServerMessage(
      s,
      { type: "character.hp", payload: { characterId: "c1", hpCurrent: 3, hpMax: 10 }, seq: 6 },
      "플레이어닉",
    );
    expect(s.room?.characters[0]).toMatchObject({ hpCurrent: 3, hpMax: 10 });

    s = applyServerMessage(
      s,
      { type: "status.set", payload: { characterId: "c1", status: ["poisoned"] }, seq: 7 },
      "플레이어닉",
    );
    expect(s.room?.characters[0]?.status).toEqual(["poisoned"]);
  });

  it("initiative.set으로 항목이 추가/갱신되고 initiative.remove로 지워진다", () => {
    let s = applyServerMessage(initialTableClientState, snapshot(), "DM닉");
    s = applyServerMessage(
      s,
      { type: "initiative.set", payload: { id: "i1", label: "고블린", order: 12, characterId: null }, seq: 4 },
      "DM닉",
    );
    expect(s.room?.initiative).toHaveLength(1);

    s = applyServerMessage(
      s,
      { type: "initiative.set", payload: { id: "i1", label: "고블린", order: 18, characterId: null }, seq: 5 },
      "DM닉",
    );
    expect(s.room?.initiative).toHaveLength(1);
    expect(s.room?.initiative[0]?.order).toBe(18);

    s = applyServerMessage(s, { type: "initiative.remove", payload: { id: "i1" }, seq: 6 }, "DM닉");
    expect(s.room?.initiative).toHaveLength(0);
  });
});
