import type { Block, Module, Scene } from "./schema.js";

export type LintSeverity = "error" | "warn" | "info";

export interface LintResult {
  ruleId: "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7";
  severity: LintSeverity;
  sceneId?: string;
  message: string;
  /** 고치는 방법을 한 문장으로. */
  hint: string;
}

interface HardEdge {
  from: string;
  to: string;
  /** 이 전환에서 플래그가 하나라도 바뀌는가 — R5(무진행 루프) 판정에 쓴다. */
  changesFlags: boolean;
  /** on_fail 분기에서 나온 edge인지 — R1(dead-fail) 판정에 쓴다. */
  isCheckFail: boolean;
  blockId: string;
}

function blockGotos(block: Block): { goto: string; changesFlags: boolean; isCheckFail: boolean }[] {
  switch (block.type) {
    case "check":
      return [
        {
          goto: block.on_success.goto,
          changesFlags: !!block.on_success.set_flags && Object.keys(block.on_success.set_flags).length > 0,
          isCheckFail: false,
        },
        {
          goto: block.on_fail.goto,
          changesFlags: !!block.on_fail.set_flags && Object.keys(block.on_fail.set_flags).length > 0,
          isCheckFail: true,
        },
      ];
    case "choice":
      return block.options.map((opt) => ({
        goto: opt.goto,
        changesFlags: !!opt.set_flags && Object.keys(opt.set_flags).length > 0,
        isCheckFail: false,
      }));
    case "encounter":
      return block.goto ? [{ goto: block.goto, changesFlags: false, isCheckFail: false }] : [];
    case "handout":
      return block.goto ? [{ goto: block.goto, changesFlags: false, isCheckFail: false }] : [];
    case "secret":
      return block.goto
        ? [
            {
              goto: block.goto,
              changesFlags: !!block.set_flags && Object.keys(block.set_flags).length > 0,
              isCheckFail: false,
            },
          ]
        : [];
  }
}

function collectHardEdges(module: Module): HardEdge[] {
  const edges: HardEdge[] = [];
  for (const scene of module.scenes) {
    for (const block of scene.blocks ?? []) {
      for (const g of blockGotos(block)) {
        edges.push({ from: scene.id, to: g.goto, changesFlags: g.changesFlags, isCheckFail: g.isCheckFail, blockId: block.id });
      }
    }
  }
  return edges;
}

function referencedFlags(module: Module): { flag: string; sceneId: string; blockId: string }[] {
  const refs: { flag: string; sceneId: string; blockId: string }[] = [];
  const push = (sceneId: string, blockId: string, flags: Record<string, unknown> | undefined) => {
    if (!flags) return;
    for (const flag of Object.keys(flags)) refs.push({ flag, sceneId, blockId });
  };
  for (const scene of module.scenes) {
    for (const block of scene.blocks ?? []) {
      if (block.type === "check") {
        push(scene.id, block.id, block.on_success.set_flags);
        push(scene.id, block.id, block.on_fail.set_flags);
      } else if (block.type === "choice") {
        for (const opt of block.options) {
          push(scene.id, block.id, opt.set_flags);
          if (opt.requires_flag) refs.push({ flag: opt.requires_flag, sceneId: scene.id, blockId: block.id });
        }
      } else if (block.type === "secret") {
        push(scene.id, block.id, block.set_flags);
      }
    }
  }
  return refs;
}

function isDeadEnd(scene: Scene): boolean {
  return (scene.blocks?.length ?? 0) === 0 && !scene.ending;
}

export function lint(module: Module): LintResult[] {
  const results: LintResult[] = [];
  const scenesById = new Map(module.scenes.map((s) => [s.id, s]));
  const hardEdges = collectHardEdges(module);

  // R3 broken-ref: goto/encounter/handout/secret_id/flag 참조가 존재하지 않는 대상을 가리킴
  for (const scene of module.scenes) {
    for (const block of scene.blocks ?? []) {
      for (const g of blockGotos(block)) {
        if (!scenesById.has(g.goto)) {
          results.push({
            ruleId: "R3",
            severity: "error",
            sceneId: scene.id,
            message: `블록 "${block.id}"이(가) 존재하지 않는 씬 "${g.goto}"으로 이동한다`,
            hint: `"${g.goto}" 씬을 추가하거나 goto 값을 실제 씬 id로 고쳐라.`,
          });
        }
      }
      if (block.type === "secret") {
        const found = (scene.secrets ?? []).some((s) => s.id === block.secret_id);
        if (!found) {
          results.push({
            ruleId: "R3",
            severity: "error",
            sceneId: scene.id,
            message: `블록 "${block.id}"이(가) 존재하지 않는 secret "${block.secret_id}"을(를) 참조한다`,
            hint: `씬 "${scene.id}"의 secrets[]에 id "${block.secret_id}"를 추가해라.`,
          });
        }
      }
    }
  }
  if (module.flags && module.flags.length > 0) {
    const declared = new Set(module.flags.map((f) => f.id));
    for (const ref of referencedFlags(module)) {
      if (!declared.has(ref.flag)) {
        results.push({
          ruleId: "R3",
          severity: "error",
          sceneId: ref.sceneId,
          message: `블록 "${ref.blockId}"이(가) 선언되지 않은 플래그 "${ref.flag}"를 참조한다`,
          hint: `module.flags에 "${ref.flag}"를 추가하거나 참조를 수정해라.`,
        });
      }
    }
  }

  // R4 missing-dc: check에 dc 없음 (zod 통과 후엔 사실상 발생하지 않지만 방어적으로 유지)
  for (const scene of module.scenes) {
    for (const block of scene.blocks ?? []) {
      if (block.type === "check" && !(typeof block.dc === "number" && Number.isFinite(block.dc))) {
        results.push({
          ruleId: "R4",
          severity: "error",
          sceneId: scene.id,
          message: `check 블록 "${block.id}"에 dc가 없다`,
          hint: `dc에 1~30 사이 숫자를 지정해라.`,
        });
      }
    }
  }

  // R1 dead-fail: check의 fail에 goto가 없거나(스키마가 막음) 진행 불가(막다른 씬으로 향함)
  for (const edge of hardEdges) {
    if (!edge.isCheckFail) continue;
    const target = scenesById.get(edge.to);
    if (target && isDeadEnd(target)) {
      results.push({
        ruleId: "R1",
        severity: "error",
        sceneId: edge.from,
        message: `블록 "${edge.blockId}"의 실패 분기가 막다른 씬 "${edge.to}"(블록도 엔딩도 없음)으로 향한다`,
        hint: `"${edge.to}"에 다음 블록을 추가하거나 scene.ending을 채워서 진짜 엔딩으로 만들어라 — 실패도 이야기를 진행시켜야 한다.`,
      });
    }
  }

  // R2 orphan-scene: 시작 장면에서 hard edge로 도달 불가
  const hardAdj = new Map<string, string[]>();
  for (const edge of hardEdges) {
    if (!hardAdj.has(edge.from)) hardAdj.set(edge.from, []);
    hardAdj.get(edge.from)!.push(edge.to);
  }
  const hardReachable = new Set<string>();
  {
    const stack = [module.meta.start_scene];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (hardReachable.has(id)) continue;
      hardReachable.add(id);
      for (const next of hardAdj.get(id) ?? []) stack.push(next);
    }
  }
  // R7 choice-softlock: 도달 가능한 choice 블록에 requires_flag 없는(항상 보이는) 옵션이
  // 하나도 없으면 경고 — 플래그 조합에 따라 그 시점에 선택지가 0개가 될 수 있다.
  // (그 도달 시점에 항상 참인 플래그가 있을 수도 있으므로 error가 아니라 warn이다 — 정적으로는
  // 확신할 수 없는 케이스이고, 런타임은 이 소프트락을 서버 레이어에서 이미 가드하고 있다.)
  for (const scene of module.scenes) {
    if (!hardReachable.has(scene.id)) continue;
    for (const block of scene.blocks ?? []) {
      if (block.type !== "choice") continue;
      const hasUnconditionalOption = block.options.some((o) => !o.requires_flag);
      if (!hasUnconditionalOption) {
        results.push({
          ruleId: "R7",
          severity: "warn",
          sceneId: scene.id,
          message: `choice 블록 "${block.id}"의 모든 옵션이 requires_flag 조건부다 — 플래그 조합에 따라 선택지가 하나도 안 보일 수 있다`,
          hint: `조건 없이 항상 보이는 옵션을 최소 1개 추가하거나, 이 블록에 도달할 때 항상 참인 플래그가 있는지 검토해라.`,
        });
      }
    }
  }

  const softAdj = new Map<string, string[]>();
  for (const scene of module.scenes) {
    for (const soft of scene.edges_soft ?? []) {
      if (!softAdj.has(scene.id)) softAdj.set(scene.id, []);
      softAdj.get(scene.id)!.push(soft.to);
    }
  }
  const softReachableFromHard = new Set<string>();
  {
    const stack = [...hardReachable];
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const next of softAdj.get(id) ?? []) {
        if (!softReachableFromHard.has(next) && !hardReachable.has(next)) {
          softReachableFromHard.add(next);
          stack.push(next);
        }
      }
    }
  }
  for (const scene of module.scenes) {
    if (hardReachable.has(scene.id)) continue;
    if (softReachableFromHard.has(scene.id)) {
      results.push({
        ruleId: "R2",
        severity: "warn",
        sceneId: scene.id,
        message: `씬 "${scene.id}"은(는) soft edge로만 도달 가능하다 (라이브 전용)`,
        hint: `솔로 러너에서도 도달시키려면 어떤 블록의 goto를 "${scene.id}"로 연결해라.`,
      });
    } else {
      results.push({
        ruleId: "R2",
        severity: "warn",
        sceneId: scene.id,
        message: `씬 "${scene.id}"은(는) 시작 장면에서 어떤 edge로도 도달할 수 없다`,
        hint: `"${scene.id}"로 향하는 goto나 edges_soft를 추가하거나, 쓰이지 않는 씬이면 삭제해라.`,
      });
    }
  }

  // R5 loop-no-progress: 플래그 변화 없는 hard 사이클
  {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const pathEdges: HardEdge[] = [];
    const reportedCycles = new Set<string>();

    const dfs = (sceneId: string) => {
      visiting.add(sceneId);
      for (const edge of hardEdges.filter((e) => e.from === sceneId)) {
        if (visiting.has(edge.to)) {
          const cycleStart = pathEdges.findIndex((e) => e.from === edge.to);
          const cycle = cycleStart === -1 ? [edge] : [...pathEdges.slice(cycleStart), edge];
          const noProgress = cycle.every((e) => !e.changesFlags);
          if (noProgress) {
            const key = cycle
              .map((e) => e.from)
              .sort()
              .join(">");
            if (!reportedCycles.has(key)) {
              reportedCycles.add(key);
              results.push({
                ruleId: "R5",
                severity: "warn",
                sceneId: edge.to,
                message: `씬 "${cycle.map((e) => e.from).join(" → ")} → ${edge.to}"가 플래그 변화 없이 순환한다`,
                hint: `순환 경로 중 한 블록에 set_flags를 추가해 진행 상태를 남겨라.`,
              });
            }
          }
          continue;
        }
        if (visited.has(edge.to)) continue;
        pathEdges.push(edge);
        dfs(edge.to);
        pathEdges.pop();
      }
      visiting.delete(sceneId);
      visited.add(sceneId);
    };
    dfs(module.meta.start_scene);
  }

  // R6 solo-playable: error 0 + 도달 가능한 모든 씬이 hard edge로 엔딩에 도달 가능
  const hasError = results.some((r) => r.severity === "error");
  if (!hasError && isSoloPlayable(module, hardReachable, hardAdj, scenesById)) {
    results.push({
      ruleId: "R6",
      severity: "info",
      message: `soloPlayable: true — 모든 경로가 hard edge만으로 엔딩에 도달한다`,
      hint: `솔로 러너 배지를 표시할 수 있다.`,
    });
  }

  return results;
}

function isSoloPlayable(
  module: Module,
  hardReachable: Set<string>,
  hardAdj: Map<string, string[]>,
  scenesById: Map<string, Scene>,
): boolean {
  const endingIds = new Set(module.scenes.filter((s) => s.ending).map((s) => s.id));
  if (endingIds.size === 0) return false;

  const canReachEnding = new Map<string, boolean>();
  const resolving = new Set<string>();

  const canReach = (sceneId: string): boolean => {
    if (canReachEnding.has(sceneId)) return canReachEnding.get(sceneId)!;
    if (endingIds.has(sceneId)) {
      canReachEnding.set(sceneId, true);
      return true;
    }
    if (resolving.has(sceneId)) return false; // 사이클 방어 — 이 경로 자체는 진행이 아니다
    resolving.add(sceneId);
    let ok = false;
    for (const next of hardAdj.get(sceneId) ?? []) {
      if (scenesById.has(next) && canReach(next)) {
        ok = true;
        break;
      }
    }
    resolving.delete(sceneId);
    canReachEnding.set(sceneId, ok);
    return ok;
  };

  for (const sceneId of hardReachable) {
    if (!canReach(sceneId)) return false;
  }
  return true;
}

/** soloPlayable 배지 여부만 필요할 때 쓰는 편의 함수. */
export function isModuleSoloPlayable(module: Module): boolean {
  return lint(module).some((r) => r.ruleId === "R6");
}
