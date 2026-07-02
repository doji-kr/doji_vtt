import { describe, expect, it } from "vitest";
import { parseDiceExpression, rollDice } from "./dice.js";

describe("parseDiceExpression", () => {
  it("기본 표현식을 파싱한다", () => {
    expect(parseDiceExpression("1d20+5")).toEqual({
      count: 1,
      sides: 20,
      modifier: 5,
      mode: "normal",
      secret: false,
    });
  });

  it("음수 수정치를 파싱한다", () => {
    expect(parseDiceExpression("2d6-1")).toEqual({
      count: 2,
      sides: 6,
      modifier: -1,
      mode: "normal",
      secret: false,
    });
  });

  it("수정치 없는 표현식을 파싱한다", () => {
    expect(parseDiceExpression("3d8")).toEqual({
      count: 3,
      sides: 8,
      modifier: 0,
      mode: "normal",
      secret: false,
    });
  });

  it("adv/dis/gm 플래그를 순서 무관하게 파싱한다", () => {
    expect(parseDiceExpression("1d20+5 adv gm")).toEqual({
      count: 1,
      sides: 20,
      modifier: 5,
      mode: "adv",
      secret: true,
    });
    expect(parseDiceExpression("1d20 gm dis")).toEqual({
      count: 1,
      sides: 20,
      modifier: 0,
      mode: "dis",
      secret: true,
    });
  });

  it("대소문자를 구분하지 않는다", () => {
    expect(parseDiceExpression("1D20 ADV")).toEqual({
      count: 1,
      sides: 20,
      modifier: 0,
      mode: "adv",
      secret: false,
    });
  });

  it("count가 0이면 거부한다", () => {
    expect(() => parseDiceExpression("0d6")).toThrow(/1~100/);
  });

  it("연산자만 있고 숫자가 없으면 거부한다", () => {
    expect(() => parseDiceExpression("1d20+")).toThrow();
  });

  it("count 생략(d20)은 거부한다", () => {
    expect(() => parseDiceExpression("d20")).toThrow();
  });

  it("adv와 dis를 동시에 지정하면 거부한다", () => {
    expect(() => parseDiceExpression("1d20 adv dis")).toThrow(/동시에/);
  });

  it("알 수 없는 플래그는 거부한다", () => {
    expect(() => parseDiceExpression("1d20 crit")).toThrow(/알 수 없는/);
  });

  it("면 수가 범위를 벗어나면 거부한다", () => {
    expect(() => parseDiceExpression("1d1001")).toThrow(/면 수/);
  });

  it("빈 문자열은 거부한다", () => {
    expect(() => parseDiceExpression("   ")).toThrow();
  });
});

describe("rollDice", () => {
  it("normal 모드는 굴림 1세트를 반환하고 합계가 맞는다", () => {
    const spec = parseDiceExpression("3d6+2");
    const result = rollDice(spec);
    expect(result.rolls).toHaveLength(1);
    expect(result.rolls[0]).toHaveLength(3);
    for (const die of result.rolls[0]!) {
      expect(die).toBeGreaterThanOrEqual(1);
      expect(die).toBeLessThanOrEqual(6);
    }
    expect(result.total).toBe(result.rolls[0]!.reduce((a, b) => a + b, 0) + 2);
  });

  it("adv 모드는 두 세트를 굴려 더 높은 합계를 채택한다", () => {
    const spec = parseDiceExpression("1d20 adv");
    const result = rollDice(spec);
    expect(result.rolls).toHaveLength(2);
    const totals = result.rolls.map((r) => r.reduce((a, b) => a + b, 0));
    expect(result.total).toBe(Math.max(...totals));
  });

  it("dis 모드는 두 세트를 굴려 더 낮은 합계를 채택한다", () => {
    const spec = parseDiceExpression("1d20 dis");
    const result = rollDice(spec);
    expect(result.rolls).toHaveLength(2);
    const totals = result.rolls.map((r) => r.reduce((a, b) => a + b, 0));
    expect(result.total).toBe(Math.min(...totals));
  });

  it("gm 플래그는 결과에 secret:true로 남는다", () => {
    const spec = parseDiceExpression("1d20 gm");
    const result = rollDice(spec);
    expect(result.spec.secret).toBe(true);
  });
});
