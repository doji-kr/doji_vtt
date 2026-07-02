import type { Block, ChoiceOption, FlagValue, Module, Scene } from "@hearthside/schema";
import type { Effect, Input, RunState } from "./types.js";

export interface CreateRunOptions {
  initialFlags?: Record<string, FlagValue>;
}

export interface StepResult {
  state: RunState;
  effects: Effect[];
}

function findScene(module: Module, sceneId: string): Scene {
  const scene = module.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`알 수 없는 씬 참조: "${sceneId}" (린터를 먼저 돌려라)`);
  return scene;
}

function visibleOptions(options: ChoiceOption[], flags: Record<string, FlagValue>): ChoiceOption[] {
  return options.filter((o) => !o.requires_flag || flags[o.requires_flag]);
}

function setFlagEffects(setFlags: Record<string, FlagValue> | undefined): Effect[] {
  if (!setFlags) return [];
  return Object.entries(setFlags).map(([flag, value]) => ({ type: "setFlag", flag, value }) as Effect);
}

function applyFlags(
  flags: Record<string, FlagValue>,
  setFlags: Record<string, FlagValue> | undefined,
): Record<string, FlagValue> {
  return setFlags ? { ...flags, ...setFlags } : flags;
}

/** 블록이 "활성화"될 때(처음 보여질 때) 나가는 Effect. 입력을 소비하는 처리와는 별개다. */
function activateBlock(block: Block, scene: Scene, flags: Record<string, FlagValue>): Effect[] {
  switch (block.type) {
    case "check":
      return [{ type: "requestCheck", blockId: block.id, skill: block.skill, dc: block.dc }];
    case "choice":
      return [
        {
          type: "showChoices",
          blockId: block.id,
          ...(block.prompt !== undefined ? { prompt: block.prompt } : {}),
          options: visibleOptions(block.options, flags).map((o) => ({ id: o.id, label: o.label })),
        },
      ];
    case "encounter":
      return [
        {
          type: "startEncounter",
          blockId: block.id,
          name: block.name,
          ...(block.read_aloud !== undefined ? { readAloud: block.read_aloud } : {}),
          ...(block.monsters !== undefined ? { monsters: block.monsters } : {}),
        },
      ];
    case "handout":
      return [
        {
          type: "giveHandout",
          blockId: block.id,
          title: block.title,
          ...(block.text !== undefined ? { text: block.text } : {}),
          ...(block.image !== undefined ? { image: block.image } : {}),
        },
      ];
    case "secret": {
      const secret = (scene.secrets ?? []).find((s) => s.id === block.secret_id);
      if (!secret) throw new Error(`알 수 없는 secret 참조: "${block.secret_id}" (린터를 먼저 돌려라)`);
      return secret.reveal_text ? [{ type: "revealSecret", blockId: block.id, text: secret.reveal_text }] : [];
    }
  }
}

interface LandResult {
  effects: Effect[];
  sceneId: string;
  blockIndex: number;
  ended: boolean;
  endingId?: string;
  endingTitle?: string;
}

/** blockIndex 위치의 블록을 활성화한다. 씬의 첫 블록이 아니면 read_aloud를 다시 보여주지 않는다. */
function landOnBlock(module: Module, scene: Scene, blockIndex: number, flags: Record<string, FlagValue>): LandResult {
  const blocks = scene.blocks ?? [];
  const block = blocks[blockIndex];
  if (!block) throw new Error(`잘못된 모듈: 씬 "${scene.id}"의 블록 인덱스 ${blockIndex}가 없다`);
  return { effects: activateBlock(block, scene, flags), sceneId: scene.id, blockIndex, ended: false };
}

/** 다른 씬으로 진입한다 — read_aloud를 보여준 뒤 첫 블록을 활성화하거나, ending이면 그대로 끝낸다. */
function enterScene(module: Module, sceneId: string, flags: Record<string, FlagValue>): LandResult {
  const scene = findScene(module, sceneId);
  const effects: Effect[] = [{ type: "showReadAloud", sceneId: scene.id, text: scene.read_aloud }];
  const blocks = scene.blocks ?? [];

  if (blocks.length === 0) {
    if (!scene.ending) {
      throw new Error(`잘못된 모듈: 씬 "${scene.id}"에 블록도 ending도 없다 (린터 R1을 확인해라)`);
    }
    effects.push({
      type: "end",
      endingId: scene.ending.id,
      ...(scene.ending.title !== undefined ? { title: scene.ending.title } : {}),
    });
    return {
      effects,
      sceneId: scene.id,
      blockIndex: -1,
      ended: true,
      endingId: scene.ending.id,
      ...(scene.ending.title !== undefined ? { endingTitle: scene.ending.title } : {}),
    };
  }

  const first = landOnBlock(module, scene, 0, flags);
  return { ...first, effects: [...effects, ...first.effects] };
}

/** 블록을 처리한 뒤 결정된 다음 위치로 "착지"한다 — 같은 씬의 다음 블록이거나, 다른 씬의 진입이거나. */
function advance(
  module: Module,
  scene: Scene,
  blockIndex: number,
  goto: string | undefined,
  flags: Record<string, FlagValue>,
): LandResult {
  if (goto !== undefined) return enterScene(module, goto, flags);
  const nextIndex = blockIndex + 1;
  if (!(scene.blocks ?? [])[nextIndex]) {
    throw new Error(`잘못된 모듈: 씬 "${scene.id}"의 마지막 블록에 goto가 없다 (스키마 검증을 우회했다)`);
  }
  return landOnBlock(module, scene, nextIndex, flags);
}

function toState(prev: RunState, landing: LandResult, flags: Record<string, FlagValue>, input?: Input): RunState {
  return {
    module: prev.module,
    sceneId: landing.sceneId,
    blockIndex: landing.blockIndex,
    flags,
    ended: landing.ended,
    ...(landing.endingId !== undefined ? { endingId: landing.endingId } : {}),
    ...(landing.endingTitle !== undefined ? { endingTitle: landing.endingTitle } : {}),
    log: input ? [...prev.log, input] : prev.log,
  };
}

export function createRun(module: Module, opts?: CreateRunOptions): StepResult {
  const flags = opts?.initialFlags ? { ...opts.initialFlags } : {};
  const landing = enterScene(module, module.meta.start_scene, flags);
  const state: RunState = {
    module,
    sceneId: landing.sceneId,
    blockIndex: landing.blockIndex,
    flags,
    ended: landing.ended,
    ...(landing.endingId !== undefined ? { endingId: landing.endingId } : {}),
    ...(landing.endingTitle !== undefined ? { endingTitle: landing.endingTitle } : {}),
    log: [],
  };
  return { state, effects: landing.effects };
}

export function step(state: RunState, input: Input): StepResult {
  if (state.ended) throw new Error("이미 끝난 run에는 입력을 넣을 수 없다");

  const scene = findScene(state.module, state.sceneId);
  const block = (scene.blocks ?? [])[state.blockIndex];
  if (!block) throw new Error(`잘못된 상태: 씬 "${scene.id}"의 블록 인덱스 ${state.blockIndex}가 없다`);

  let flags = state.flags;
  let goto: string | undefined;
  const preEffects: Effect[] = [];

  switch (block.type) {
    case "check": {
      if (input.type !== "resolveCheck") {
        throw new Error(`check 블록 "${block.id}"은(는) resolveCheck 입력을 기다린다 (받은 입력: ${input.type})`);
      }
      const success = input.total >= block.dc;
      const branch = success ? block.on_success : block.on_fail;
      if (branch.read_aloud) preEffects.push({ type: "narrate", text: branch.read_aloud });
      preEffects.push(...setFlagEffects(branch.set_flags));
      flags = applyFlags(flags, branch.set_flags);
      goto = branch.goto;
      break;
    }
    case "choice": {
      if (input.type !== "choose") {
        throw new Error(`choice 블록 "${block.id}"은(는) choose 입력을 기다린다 (받은 입력: ${input.type})`);
      }
      const options = visibleOptions(block.options, flags);
      const selected = options.find((o) => o.id === input.optionId);
      if (!selected) {
        throw new Error(`choice 블록 "${block.id}"에 없거나 지금 선택할 수 없는 옵션: "${input.optionId}"`);
      }
      preEffects.push(...setFlagEffects(selected.set_flags));
      flags = applyFlags(flags, selected.set_flags);
      goto = selected.goto;
      break;
    }
    case "encounter":
    case "handout": {
      if (input.type !== "continue") {
        throw new Error(`${block.type} 블록 "${block.id}"은(는) continue 입력을 기다린다 (받은 입력: ${input.type})`);
      }
      goto = block.goto;
      break;
    }
    case "secret": {
      if (input.type !== "continue") {
        throw new Error(`secret 블록 "${block.id}"은(는) continue 입력을 기다린다 (받은 입력: ${input.type})`);
      }
      preEffects.push(...setFlagEffects(block.set_flags));
      flags = applyFlags(flags, block.set_flags);
      goto = block.goto;
      break;
    }
  }

  const landing = advance(state.module, scene, state.blockIndex, goto, flags);
  const newState = toState(state, landing, flags, input);
  return { state: newState, effects: [...preEffects, ...landing.effects] };
}

/** 세이브 = 입력 로그. 같은 module + 같은 입력 시퀀스는 항상 같은 상태를 만든다. */
export function replay(module: Module, inputs: readonly Input[]): RunState {
  let { state } = createRun(module);
  for (const input of inputs) {
    ({ state } = step(state, input));
  }
  return state;
}
