import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { type Module, lint, parseModule } from "@hearthside/schema";

export interface ModuleSummary {
  id: string;
  title: string;
  logline: string;
  difficulty?: "easy" | "normal" | "hard";
  estimated_minutes?: number;
  tags?: string[];
  soloPlayable: boolean;
  poster_url: string | null;
}

export interface ModuleEntry {
  summary: ModuleSummary;
  module: Module;
}

/** content/modules를 스캔해서 lint를 통과(error 0)한 모듈만 메모리에 올린다. */
export function loadModuleRegistry(contentDir: string): Map<string, ModuleEntry> {
  const registry = new Map<string, ModuleEntry>();
  if (!existsSync(contentDir)) {
    console.warn(`[module-registry] 콘텐츠 폴더가 없다: ${contentDir}`);
    return registry;
  }

  for (const dirName of readdirSync(contentDir, { withFileTypes: true })) {
    if (!dirName.isDirectory()) continue;
    const moduleId = dirName.name;
    const jsonPath = join(contentDir, moduleId, "module.json");
    if (!existsSync(jsonPath)) continue;

    try {
      const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
      const module = parseModule(raw);
      const results = lint(module);
      const errorCount = results.filter((r) => r.severity === "error").length;
      if (errorCount > 0) {
        console.warn(`[module-registry] "${moduleId}" lint error ${errorCount}건 — 서가에서 제외한다.`);
        continue;
      }
      const soloPlayable = results.some((r) => r.ruleId === "R6");
      const posterAsset = module.meta.poster;
      const poster_url = posterAsset ? `/content/${moduleId}/${posterAsset}` : null;

      registry.set(moduleId, {
        module,
        summary: {
          id: moduleId,
          title: module.meta.title,
          logline: module.meta.logline,
          ...(module.meta.difficulty !== undefined ? { difficulty: module.meta.difficulty } : {}),
          ...(module.meta.estimated_minutes !== undefined ? { estimated_minutes: module.meta.estimated_minutes } : {}),
          ...(module.meta.tags !== undefined ? { tags: module.meta.tags } : {}),
          soloPlayable,
          poster_url,
        },
      });
    } catch (err) {
      console.warn(`[module-registry] "${moduleId}" 로드 실패 — 서가에서 제외한다: ${(err as Error).message}`);
    }
  }

  return registry;
}
