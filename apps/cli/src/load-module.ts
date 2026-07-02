import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";
import { type Module, parseModule } from "@hearthside/schema";

function resolveModulePath(pathArg: string): string {
  if (existsSync(pathArg) && statSync(pathArg).isDirectory()) {
    const candidate = join(pathArg, "module.json");
    if (!existsSync(candidate)) {
      throw new Error(`디렉터리 "${pathArg}" 안에 module.json이 없다.`);
    }
    return candidate;
  }
  if (!existsSync(pathArg)) {
    throw new Error(`경로를 찾을 수 없다: "${pathArg}"`);
  }
  return pathArg;
}

export function loadModule(pathArg: string): Module {
  const filePath = resolveModulePath(pathArg);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    throw new Error(`"${filePath}"는 올바른 JSON이 아니다: ${(err as Error).message}`);
  }
  try {
    return parseModule(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const lines = err.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
      throw new Error(`"${filePath}" 스키마 검증 실패:\n${lines.join("\n")}`);
    }
    throw err;
  }
}
