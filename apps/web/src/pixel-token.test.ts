import { describe, expect, it } from "vitest";
import { initialOf, ringColorFor } from "./pixel-token.js";

describe("ringColorFor", () => {
  it("같은 시드는 항상 같은 색을 낸다 (결정적)", () => {
    expect(ringColorFor("플레이어닉")).toBe(ringColorFor("플레이어닉"));
    expect(ringColorFor("몬스터-오크-1")).toBe(ringColorFor("몬스터-오크-1"));
  });

  it("hex 색 문자열을 돌려준다", () => {
    expect(ringColorFor("아무거나")).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("initialOf", () => {
  it("라벨의 첫 글자를 대문자로 돌려준다", () => {
    expect(initialOf("orc")).toBe("O");
    expect(initialOf("오크")).toBe("오");
  });

  it("빈 라벨은 물음표로 대체한다", () => {
    expect(initialOf("   ")).toBe("?");
    expect(initialOf("")).toBe("?");
  });
});
