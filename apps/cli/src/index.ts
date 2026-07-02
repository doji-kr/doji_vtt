#!/usr/bin/env node
import { runLint } from "./lint-cmd.js";
import { runPlay } from "./play-cmd.js";

async function main(): Promise<number> {
  const [command, pathArg] = process.argv.slice(2);

  if (!command || !pathArg) {
    console.error("사용법: hearth <lint|play> <module 경로>");
    return 1;
  }

  try {
    if (command === "lint") return runLint(pathArg);
    if (command === "play") return await runPlay(pathArg);
    console.error(`알 수 없는 명령: "${command}" (lint 또는 play)`);
    return 1;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}

main().then((code) => process.exit(code));
