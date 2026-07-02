import { createRun, step } from "@hearthside/runtime";
import type { Effect, Input, RunState } from "@hearthside/runtime";
import type { Module } from "@hearthside/schema";

/**
 * runtime의 replay()는 최종 state만 반환한다(1단계 공개 API, 이번 단계에서 손대지 않는다).
 * 서버는 "지금 화면에 뭘 보여줘야 하는가"를 위해 마지막 step의 effects도 필요해서,
 * createRun/step을 그대로 재사용하는 서버 전용 얇은 래퍼를 둔다.
 */
export function replayToCurrentEffects(module: Module, inputs: readonly Input[]): { state: RunState; effects: Effect[] } {
  let { state, effects } = createRun(module);
  for (const input of inputs) {
    ({ state, effects } = step(state, input));
  }
  return { state, effects };
}

/** R7 후보(백로그): choice의 가시 옵션이 0개인 소프트락을 서버 레이어에서 막는다. */
export function findEmptyChoices(effects: Effect[]): Extract<Effect, { type: "showChoices" }> | undefined {
  return effects.find((e): e is Extract<Effect, { type: "showChoices" }> => e.type === "showChoices" && e.options.length === 0);
}
