import { describe, expect, it } from "vitest";
import { lint, type LintResult } from "./lint.js";
import type { Module } from "./schema.js";

function has(results: LintResult[], ruleId: LintResult["ruleId"]) {
  return results.some((r) => r.ruleId === ruleId);
}

const baseMeta = { title: "t", logline: "l", start_scene: "start" };

describe("lint R1 dead-fail", () => {
  it("실패 분기가 막다른 씬으로 향하면 error를 낸다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [
            {
              type: "check",
              id: "c1",
              skill: "감지",
              dc: 10,
              on_success: { goto: "win" },
              on_fail: { goto: "deadend" },
            },
          ],
        },
        { id: "win", read_aloud: "...", ending: { id: "win" } },
        { id: "deadend", read_aloud: "..." }, // blocks 없음, ending도 없음 -> 막다른 곳
      ],
    };
    const results = lint(m);
    expect(has(results, "R1")).toBe(true);
    expect(results.find((r) => r.ruleId === "R1")?.sceneId).toBe("start");
  });

  it("실패 분기가 진행 가능한 씬으로 향하면 통과한다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [
            {
              type: "check",
              id: "c1",
              skill: "감지",
              dc: 10,
              on_success: { goto: "win" },
              on_fail: { goto: "setback" },
            },
          ],
        },
        { id: "win", read_aloud: "...", ending: { id: "win" } },
        {
          id: "setback",
          read_aloud: "실패했지만 이야기는 이어진다.",
          blocks: [{ type: "choice", id: "ch", options: [{ id: "go", label: "계속", goto: "win" }] }],
        },
      ],
    };
    expect(has(lint(m), "R1")).toBe(false);
  });
});

describe("lint R2 orphan-scene", () => {
  it("어떤 goto/soft edge로도 도달 못 하면 warn을 낸다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [{ type: "choice", id: "ch", options: [{ id: "go", label: "계속", goto: "end" }] }],
        },
        { id: "end", read_aloud: "...", ending: { id: "end" } },
        { id: "orphan", read_aloud: "아무도 오지 않는 방." },
      ],
    };
    const results = lint(m);
    const r2 = results.find((r) => r.ruleId === "R2");
    expect(r2?.sceneId).toBe("orphan");
  });

  it("모든 씬이 hard edge로 도달 가능하면 통과한다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [{ type: "choice", id: "ch", options: [{ id: "go", label: "계속", goto: "end" }] }],
        },
        { id: "end", read_aloud: "...", ending: { id: "end" } },
      ],
    };
    expect(has(lint(m), "R2")).toBe(false);
  });
});

describe("lint R3 broken-ref", () => {
  it("존재하지 않는 씬을 가리키는 goto는 error다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [{ type: "choice", id: "ch", options: [{ id: "go", label: "계속", goto: "nowhere" }] }],
        },
      ],
    };
    const results = lint(m);
    expect(has(results, "R3")).toBe(true);
  });

  it("존재하지 않는 secret_id를 참조하면 error다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          secrets: [{ id: "real", dm_notes: "진실" }],
          blocks: [{ type: "secret", id: "s1", secret_id: "fake", goto: "start" }],
        },
      ],
    };
    expect(has(lint(m), "R3")).toBe(true);
  });

  it("모든 참조가 유효하면 통과한다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      flags: [{ id: "known" }],
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          secrets: [{ id: "real", dm_notes: "진실", reveal_text: "..." }],
          blocks: [
            { type: "secret", id: "s1", secret_id: "real", goto: "end", set_flags: { known: true } },
          ],
        },
        { id: "end", read_aloud: "...", ending: { id: "end" } },
      ],
    };
    expect(has(lint(m), "R3")).toBe(false);
  });
});

describe("lint R4 missing-dc", () => {
  it("dc가 없는 check는 error다 (스키마 우회 시 방어)", () => {
    const m = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [
            {
              type: "check",
              id: "c1",
              skill: "감지",
              on_success: { goto: "start" },
              on_fail: { goto: "start" },
            },
          ],
        },
      ],
    } as unknown as Module;
    expect(has(lint(m), "R4")).toBe(true);
  });

  it("dc가 있으면 통과한다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [
            {
              type: "check",
              id: "c1",
              skill: "감지",
              dc: 10,
              on_success: { goto: "end" },
              on_fail: { goto: "end" },
            },
          ],
        },
        { id: "end", read_aloud: "...", ending: { id: "end" } },
      ],
    };
    expect(has(lint(m), "R4")).toBe(false);
  });
});

describe("lint R5 loop-no-progress", () => {
  it("플래그 변화 없이 순환하면 warn을 낸다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [{ type: "choice", id: "ch", options: [{ id: "go", label: "계속", goto: "a" }] }],
        },
        {
          id: "a",
          read_aloud: "...",
          blocks: [{ type: "choice", id: "ch", options: [{ id: "go", label: "계속", goto: "b" }] }],
        },
        {
          id: "b",
          read_aloud: "...",
          blocks: [{ type: "choice", id: "ch", options: [{ id: "go", label: "돌아가기", goto: "a" }] }],
        },
      ],
    };
    expect(has(lint(m), "R5")).toBe(true);
  });

  it("순환 중 플래그가 바뀌면 통과한다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [{ type: "choice", id: "ch", options: [{ id: "go", label: "계속", goto: "a" }] }],
        },
        {
          id: "a",
          read_aloud: "...",
          blocks: [{ type: "choice", id: "ch", options: [{ id: "go", label: "계속", goto: "b" }] }],
        },
        {
          id: "b",
          read_aloud: "...",
          blocks: [
            {
              type: "choice",
              id: "ch",
              options: [{ id: "go", label: "돌아가기", goto: "a", set_flags: { visited_b: true } }],
            },
          ],
        },
      ],
    };
    expect(has(lint(m), "R5")).toBe(false);
  });
});

describe("lint R6 solo-playable", () => {
  it("error가 있으면 배지를 주지 않는다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [{ type: "choice", id: "ch", options: [{ id: "go", label: "계속", goto: "nowhere" }] }],
        },
      ],
    };
    expect(has(lint(m), "R6")).toBe(false);
  });

  it("모든 경로가 hard edge로 엔딩에 도달하면 배지를 준다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [{ type: "choice", id: "ch", options: [{ id: "go", label: "계속", goto: "end" }] }],
        },
        { id: "end", read_aloud: "...", ending: { id: "end" } },
      ],
    };
    expect(has(lint(m), "R6")).toBe(true);
  });
});

describe("lint R7 choice-softlock", () => {
  it("도달 가능한 choice의 모든 옵션이 requires_flag 조건부면 warn을 낸다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      flags: [{ id: "known" }],
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [
            {
              type: "choice",
              id: "ch",
              options: [{ id: "go", label: "조건부만", goto: "end", requires_flag: "known" }],
            },
          ],
        },
        { id: "end", read_aloud: "...", ending: { id: "end" } },
      ],
    };
    const results = lint(m);
    expect(has(results, "R7")).toBe(true);
    expect(results.find((r) => r.ruleId === "R7")?.sceneId).toBe("start");
  });

  it("requires_flag 없는 옵션이 하나라도 있으면 통과한다", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      flags: [{ id: "known" }],
      scenes: [
        {
          id: "start",
          read_aloud: "...",
          blocks: [
            {
              type: "choice",
              id: "ch",
              options: [
                { id: "go", label: "조건부", goto: "end", requires_flag: "known" },
                { id: "always", label: "항상 보임", goto: "end" },
              ],
            },
          ],
        },
        { id: "end", read_aloud: "...", ending: { id: "end" } },
      ],
    };
    expect(has(lint(m), "R7")).toBe(false);
  });

  it("도달 불가능한 씬의 choice는 R7 대상에서 제외한다 (R2가 이미 잡는다)", () => {
    const m: Module = {
      schema_version: "0.1",
      meta: baseMeta,
      flags: [{ id: "known" }],
      scenes: [
        { id: "start", read_aloud: "...", ending: { id: "start" } },
        {
          id: "orphan",
          read_aloud: "...",
          blocks: [
            {
              type: "choice",
              id: "ch",
              options: [{ id: "go", label: "조건부만", goto: "start", requires_flag: "known" }],
            },
          ],
        },
      ],
    };
    expect(has(lint(m), "R7")).toBe(false);
  });
});
