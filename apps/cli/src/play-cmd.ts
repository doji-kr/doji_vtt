import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { createRun, step } from "@hearthside/runtime";
import type { Effect, Input } from "@hearthside/runtime";
import { loadModule } from "./load-module.js";

function printEffects(effects: Effect[]): void {
  for (const e of effects) {
    switch (e.type) {
      case "showReadAloud":
        console.log(`\n${e.text}`);
        break;
      case "narrate":
        console.log(`» ${e.text}`);
        break;
      case "requestCheck":
        console.log(`\n[판정] ${e.skill} DC ${e.dc}`);
        break;
      case "showChoices":
        if (e.prompt) console.log(`\n${e.prompt}`);
        e.options.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}`));
        break;
      case "startEncounter":
        console.log(`\n[조우] ${e.name}`);
        if (e.readAloud) console.log(e.readAloud);
        if (e.monsters?.length) console.log(`상대: ${e.monsters.join(", ")}`);
        break;
      case "giveHandout":
        console.log(`\n[핸드아웃] ${e.title}`);
        if (e.text) console.log(e.text);
        break;
      case "revealSecret":
        console.log(`\n[비밀] ${e.text}`);
        break;
      case "setFlag":
        // 플레이어 채널엔 조용히 — 필요하면 디버그 시 켤 수 있게 남겨둔다.
        break;
      case "end":
        console.log(`\n=== 엔딩: ${e.title ?? e.endingId} ===`);
        break;
    }
  }
}

type PendingKind = "resolveCheck" | "choose" | "continue" | "ended";

function pendingKindOf(effects: Effect[]): PendingKind {
  if (effects.some((e) => e.type === "end")) return "ended";
  if (effects.some((e) => e.type === "requestCheck")) return "resolveCheck";
  if (effects.some((e) => e.type === "showChoices")) return "choose";
  return "continue";
}

export async function runPlay(pathArg: string): Promise<number> {
  const module = loadModule(pathArg);
  const rl = createInterface({ input: stdin });
  // readline/promises의 question()은 파이프 입력(비TTY)에서 첫 줄 이후 멈추는 문제가 있다
  // (Windows/git-bash 조합에서 관찰됨) — 대신 같은 인터페이스의 비동기 이터레이터로
  // 한 줄씩 순서대로 꺼낸다. 인터랙티브 터미널에서도 동일하게 동작한다.
  const lines = rl[Symbol.asyncIterator]();
  async function ask(promptText: string): Promise<string> {
    stdout.write(promptText);
    const { value, done } = await lines.next();
    if (done) throw new Error("입력이 끝났다.");
    return value;
  }

  try {
    let { state, effects } = createRun(module);
    printEffects(effects);

    while (!state.ended) {
      const kind = pendingKindOf(effects);
      let input: Input;

      if (kind === "resolveCheck") {
        const answer = await ask("판정 합계를 입력: ");
        const total = Number.parseInt(answer, 10);
        if (Number.isNaN(total)) {
          console.log("숫자를 입력해라.");
          continue;
        }
        input = { type: "resolveCheck", total };
      } else if (kind === "choose") {
        const showChoices = effects.find((e) => e.type === "showChoices");
        if (showChoices?.type !== "showChoices") throw new Error("내부 오류: showChoices effect 없음");
        const answer = await ask(`선택 (1-${showChoices.options.length}): `);
        const idx = Number.parseInt(answer, 10) - 1;
        const chosen = showChoices.options[idx];
        if (!chosen) {
          console.log("올바른 번호를 입력해라.");
          continue;
        }
        input = { type: "choose", optionId: chosen.id };
      } else {
        await ask("(계속하려면 Enter) ");
        input = { type: "continue" };
      }

      ({ state, effects } = step(state, input));
      printEffects(effects);
    }

    return 0;
  } finally {
    rl.close();
  }
}
