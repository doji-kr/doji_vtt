import type { FogState } from "./table-protocol.js";

/** 새 안개 상태 — 전체 비공개(hidden)로 시작한다. */
export function initFog(cols: number, rows: number): FogState {
  return { cols, rows, runs: [cols * rows] };
}

/** runs(RLE, hidden부터 시작) → boolean[] (true = revealed). */
function decode(fog: FogState): boolean[] {
  const cells = new Array<boolean>(fog.cols * fog.rows).fill(false);
  let i = 0;
  let revealed = false;
  for (const run of fog.runs) {
    if (revealed) cells.fill(true, i, i + run);
    i += run;
    revealed = !revealed;
  }
  return cells;
}

/** boolean[] → runs(RLE, hidden부터 시작 — 첫 구간이 revealed면 길이 0인 hidden 구간을 앞에 둔다). */
function encode(cells: boolean[]): number[] {
  const runs: number[] = [];
  let current = false; // hidden부터 시작
  let count = 0;
  for (const revealed of cells) {
    if (revealed === current) {
      count += 1;
    } else {
      runs.push(count);
      current = revealed;
      count = 1;
    }
  }
  runs.push(count);
  return runs;
}

/** 좌표 목록을 revealed로 표시한 새 FogState를 반환한다. 그리드 밖 좌표는 무시한다. */
export function revealCells(fog: FogState, points: { x: number; y: number }[]): FogState {
  const cells = decode(fog);
  for (const p of points) {
    if (p.x < 0 || p.x >= fog.cols || p.y < 0 || p.y >= fog.rows) continue;
    cells[p.y * fog.cols + p.x] = true;
  }
  return { cols: fog.cols, rows: fog.rows, runs: encode(cells) };
}

export function resetFog(fog: FogState): FogState {
  return initFog(fog.cols, fog.rows);
}
