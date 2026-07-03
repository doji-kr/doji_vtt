import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { requireSession } from "../session.js";
import type { RoomRegistry } from "../room-registry.js";

export function registerTableWsRoute(app: FastifyInstance, registry: RoomRegistry): void {
  app.get<{ Params: { id: string } }>(
    "/ws/tables/:id",
    { websocket: true, preHandler: requireSession },
    (socket: WebSocket, request: FastifyRequest<{ Params: { id: string } }>) => {
      const room = registry.getOrLoad(request.params.id);
      if (!room) {
        socket.close(4404, "table not found");
        return;
      }
      room.join(socket, request.nickname!);
    },
  );
}
