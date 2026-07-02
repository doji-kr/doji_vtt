import { describe, expect, it } from "vitest";
import type { Module } from "@hearthside/schema";
import { createRun, replay, step } from "./runtime.js";
import type { Input } from "./types.js";

const module: Module = {
  schema_version: "0.1",
  meta: { title: "테스트", logline: "...", start_scene: "hall" },
  flags: [{ id: "found_secret" }],
  scenes: [
    {
      id: "hall",
      read_aloud: "복도에 촛불 하나가 켜져 있다.",
      secrets: [{ id: "candle_truth", dm_notes: "촛불은 마법이다.", reveal_text: "촛불이 스스로 흔들린다." }],
      blocks: [
        { type: "handout", id: "map", title: "낡은 지도" },
        { type: "secret", id: "reveal", secret_id: "candle_truth", set_flags: { found_secret: true } },
        {
          type: "check",
          id: "listen",
          skill: "감지",
          dc: 12,
          on_success: { read_aloud: "발소리를 들었다.", goto: "success_end" },
          on_fail: { read_aloud: "아무 소리도 못 들었지만 문은 열려 있다.", goto: "fail_end" },
        },
      ],
    },
    { id: "success_end", read_aloud: "성공적으로 끝났다.", ending: { id: "good", title: "해피엔딩" } },
    { id: "fail_end", read_aloud: "다른 방식으로 끝났다.", ending: { id: "bittersweet" } },
  ],
};

describe("runtime state machine", () => {
  it("createRun은 시작 씬의 read_aloud와 첫 블록 effect를 낸다", () => {
    const { effects, state } = createRun(module);
    expect(effects[0]).toEqual({ type: "showReadAloud", sceneId: "hall", text: module.scenes[0]!.read_aloud });
    expect(effects.some((e) => e.type === "giveHandout")).toBe(true);
    expect(state.ended).toBe(false);
  });

  it("goto 없는 블록은 같은 씬의 다음 블록으로 자동 진행한다 (fallthrough)", () => {
    const { state: s1 } = createRun(module);
    const step1 = step(s1, { type: "continue" }); // handout -> secret 활성화
    expect(step1.effects.some((e) => e.type === "revealSecret")).toBe(true);
    expect(step1.state.blockIndex).toBe(1);

    const step2 = step(step1.state, { type: "continue" }); // secret 해소 -> check 활성화
    expect(step2.effects.some((e) => e.type === "setFlag" && e.flag === "found_secret")).toBe(true);
    expect(step2.effects.some((e) => e.type === "requestCheck")).toBe(true);
    expect(step2.state.blockIndex).toBe(2);
  });

  it("성공 경로를 완주한다", () => {
    const inputs: Input[] = [{ type: "continue" }, { type: "continue" }, { type: "resolveCheck", total: 15 }];
    const final = replay(module, inputs);
    expect(final.ended).toBe(true);
    expect(final.endingId).toBe("good");
  });

  it("실패 경로도 전진하며 다른 엔딩으로 완주한다 (fail forward)", () => {
    const inputs: Input[] = [{ type: "continue" }, { type: "continue" }, { type: "resolveCheck", total: 3 }];
    const final = replay(module, inputs);
    expect(final.ended).toBe(true);
    expect(final.endingId).toBe("bittersweet");
  });

  it("잘못된 input은 거부한다 (check 블록에 choose를 보내면)", () => {
    let { state } = createRun(module);
    ({ state } = step(state, { type: "continue" }));
    ({ state } = step(state, { type: "continue" }));
    expect(() => step(state, { type: "choose", optionId: "nope" })).toThrow();
  });

  it("종료된 run에는 더 입력을 넣을 수 없다", () => {
    const final = replay(module, [{ type: "continue" }, { type: "continue" }, { type: "resolveCheck", total: 15 }]);
    expect(() => step(final, { type: "continue" })).toThrow();
  });

  it("replay는 결정론적이다 — 같은 입력 로그는 같은 상태를 만든다", () => {
    const inputs: Input[] = [{ type: "continue" }, { type: "continue" }, { type: "resolveCheck", total: 15 }];
    const a = replay(module, inputs);
    const b = replay(module, inputs);
    expect(a).toEqual(b);
  });

  it("Effect 어디에도 dm_notes 문자열이 새지 않는다", () => {
    const collected: unknown[] = [];
    let cur = createRun(module);
    collected.push(...cur.effects);
    for (const input of [{ type: "continue" }, { type: "continue" }, { type: "resolveCheck", total: 15 }] as Input[]) {
      cur = step(cur.state, input);
      collected.push(...cur.effects);
    }
    const serialized = JSON.stringify(collected);
    expect(serialized).not.toContain("촛불은 마법이다");
  });
});
