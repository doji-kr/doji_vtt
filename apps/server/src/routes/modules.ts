import type { FastifyInstance } from "fastify";
import type { ModuleEntry } from "../module-registry.js";

export function registerModuleRoutes(app: FastifyInstance, registry: Map<string, ModuleEntry>): void {
  app.get("/api/modules", async () => {
    return [...registry.values()].map((e) => e.summary);
  });

  app.get<{ Params: { id: string } }>("/api/modules/:id", async (request, reply) => {
    const entry = registry.get(request.params.id);
    if (!entry) {
      return reply.code(404).send({ error: "not_found", message: "그런 이야기는 서가에 없다." });
    }
    return entry.summary;
  });
}
