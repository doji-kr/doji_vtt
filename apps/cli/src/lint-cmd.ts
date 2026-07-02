import { lint } from "@hearthside/schema";
import { loadModule } from "./load-module.js";

const SEVERITY_LABEL: Record<string, string> = {
  error: "[오류]",
  warn: "[경고]",
  info: "[정보]",
};

export function runLint(pathArg: string): number {
  const module = loadModule(pathArg);
  const results = lint(module);

  if (results.length === 0) {
    console.log("문제 없음.");
    return 0;
  }

  for (const r of results) {
    const where = r.sceneId ? ` (${r.sceneId})` : "";
    console.log(`${SEVERITY_LABEL[r.severity]} ${r.ruleId}${where}: ${r.message}`);
    console.log(`  hint: ${r.hint}`);
  }

  const errorCount = results.filter((r) => r.severity === "error").length;
  const warnCount = results.filter((r) => r.severity === "warn").length;
  const soloPlayable = results.some((r) => r.ruleId === "R6");

  console.log("");
  console.log(`error ${errorCount}, warn ${warnCount} — soloPlayable: ${soloPlayable}`);

  return errorCount > 0 ? 1 : 0;
}
