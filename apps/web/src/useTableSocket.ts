import { useEffect, useRef, useState } from "react";
import { applyServerMessage, initialTableClientState, type ServerMessage, type TableClientState } from "./table-reducer.js";

const RECONNECT_DELAY_MS = 1500;

/** 순수 함수라 window.location을 인자로 받는다 — 테스트에서 임의 host를 넣을 수 있게. */
export function wsUrlFor(tableId: string, loc: { protocol: string; host: string } = window.location): string {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${loc.host}/ws/tables/${encodeURIComponent(tableId)}`;
}

export interface UseTableSocket {
  state: TableClientState;
  connected: boolean;
  sendOp: (type: string, payload: unknown) => void;
}

/**
 * 방 하나에 대한 WS 연결을 관리한다. 컴포넌트가 마운트될 때마다(=새로고침/재입장) 새로
 * 연결하고 `hello`를 보내 스냅샷을 받는다 — 재접속 시 상태 복원이 이 하나의 흐름으로 된다.
 * 연결이 끊기면 짧은 지연 후 스스로 재시도한다.
 */
export function useTableSocket(tableId: string, selfNickname: string): UseTableSocket {
  const [state, setState] = useState<TableClientState>(initialTableClientState);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket;

    function connect(): void {
      socket = new WebSocket(wsUrlFor(tableId));
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (cancelled) return;
        setConnected(true);
        socket.send(JSON.stringify({ type: "hello", payload: {} }));
      });

      socket.addEventListener("message", (ev: MessageEvent) => {
        if (cancelled) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string) as ServerMessage;
        } catch {
          return; // 형식이 이상한 메시지는 조용히 무시한다 — 화면을 깨뜨리지 않는다
        }
        setState((s) => applyServerMessage(s, msg, selfNickname));
      });

      socket.addEventListener("close", () => {
        if (cancelled) return;
        setConnected(false);
        retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });

      socket.addEventListener("error", () => {
        socket.close();
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, selfNickname]);

  function sendOp(type: string, payload: unknown): void {
    const socket = socketRef.current;
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type, payload }));
    }
  }

  return { state, connected, sendOp };
}
