import { describe, expect, it } from "vitest";
import { initFog, resetFog, revealCells } from "./fog.js";

describe("initFog", () => {
  it("전체 hidden인 단일 run으로 시작한다", () => {
    expect(initFog(4, 3)).toEqual({ cols: 4, rows: 3, runs: [12] });
  });
});

describe("revealCells", () => {
  it("좌표 하나를 revealed로 표시하면 그 셀만 걷힌다", () => {
    const fog = initFog(4, 3);
    const revealed = revealCells(fog, [{ x: 1, y: 0 }]);
    // 인덱스 1(=y*4+x=1)만 revealed → runs: hidden 1, revealed 1, hidden 10
    expect(revealed.runs).toEqual([1, 1, 10]);
  });

  it("이미 걷힌 셀을 다시 걷어도 멱등하다", () => {
    const fog = initFog(4, 3);
    const once = revealCells(fog, [{ x: 1, y: 0 }]);
    const twice = revealCells(once, [{ x: 1, y: 0 }]);
    expect(twice.runs).toEqual(once.runs);
  });

  it("그리드 밖 좌표는 무시한다", () => {
    const fog = initFog(2, 2);
    const revealed = revealCells(fog, [{ x: 99, y: 99 }, { x: -1, y: 0 }]);
    expect(revealed.runs).toEqual([4]);
  });

  it("여러 좌표를 한 번에 걷을 수 있다", () => {
    const fog = initFog(4, 1);
    const revealed = revealCells(fog, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(revealed.runs).toEqual([0, 2, 2]);
  });
});

describe("resetFog", () => {
  it("걷혔던 안개를 전부 다시 가린다(크기는 유지)", () => {
    const fog = initFog(4, 3);
    const revealed = revealCells(fog, [{ x: 1, y: 0 }]);
    expect(resetFog(revealed)).toEqual({ cols: 4, rows: 3, runs: [12] });
  });
});
