import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { RoomRegistry } from "../room-registry.js";

type RequireSession = (request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => void;

export function registerTableWsRoute(app: FastifyInstance, registry: RoomRegistry, requireSession: RequireSession): void {
  app.get<{ Params: { id: string } }>(
    "/ws/tables/:id",
    { websocket: true, preHandler: requireSession },
    (socket: WebSocket, request: FastifyRequest<{ Params: { id: string } }>) => {
      const room = registry.getOrLoad(request.params.id);
      if (!room) {
        socket.close(4404, "table not found");
        return;
      }
      // 회원이면 displayName + userId(role 판단용), 게스트면 guestName만 — 회원/게스트
      // 어느 쪽이든 request.nickname이 표시용으로 정규화되어 있다(session.ts 참고).
      room.join(socket, request.nickname!, request.userId ?? null);
    },
  );
}
