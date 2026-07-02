import { describe, expect, it } from "vitest";
import { moduleSchema, parseModule, type Module } from "./schema.js";

const minimal: Module = {
  schema_version: "0.1",
  meta: {
    title: "예시",
    logline: "촛불 하나, 방 하나.",
    start_scene: "start",
  },
  scenes: [
    {
      id: "start",
      read_aloud: "문이 삐걱 열린다.",
      blocks: [
        {
          type: "choice",
          id: "go",
          options: [{ id: "enter", label: "들어간다", goto: "end" }],
        },
      ],
    },
    {
      id: "end",
      read_aloud: "이야기가 끝난다.",
      ending: { id: "the_end" },
    },
  ],
};

describe("moduleSchema", () => {
  it("최소 모듈을 라운드트립한다 (parse -> stringify -> parse)", () => {
    const parsed = parseModule(minimal);
    const roundTripped = parseModule(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(minimal);
  });

  it("schema_version이 다르면 거부한다", () => {
    const bad = { ...minimal, schema_version: "9.9" };
    expect(() => parseModule(bad)).toThrow();
  });

  it("scenes가 비어 있으면 거부한다", () => {
    const bad = { ...minimal, scenes: [] };
    expect(() => parseModule(bad)).toThrow();
  });

  it("check 블록은 on_success/on_fail의 goto가 필수다", () => {
    const bad = {
      ...minimal,
      scenes: [
        ...minimal.scenes.slice(0, 1),
        {
          id: "checked",
          read_aloud: "...",
          blocks: [
            {
              type: "check",
              id: "c1",
              skill: "감지",
              dc: 12,
              on_success: { goto: "end" },
              on_fail: {}, // goto 없음 — 실패도 전진 원칙 위반
            },
          ],
        },
      ],
    };
    expect(() => moduleSchema.parse(bad)).toThrow();
  });
});
