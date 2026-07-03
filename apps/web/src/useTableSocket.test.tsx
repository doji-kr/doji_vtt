import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTableSocket } from "./useTableSocket.js";

type Listener = (ev: any) => void;

class MockSocket {
  static instances: MockSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = MockSocket.CONNECTING;
  // 실제 WebSocket은 인스턴스에서도 OPEN/CLOSED 등을 읽을 수 있다(prototype 상속) — 훅의
  // `socket.readyState === socket.OPEN` 비교가 되게 하려면 목업도 인스턴스에 노출해야 한다.
  readonly OPEN = MockSocket.OPEN;
  readonly CONNECTING = MockSocket.CONNECTING;
  readonly CLOSED = MockSocket.CLOSED;
  url: string;
  sent: string[] = [];
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
  }

  addEventListener(type: string, cb: Listener): void {
    (this.listeners[type] ??= []).push(cb);
  }

  removeEventListener(type: string, cb: Listener): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockSocket.CLOSED;
    this.dispatch("close", {});
  }

  dispatch(type: string, ev: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }

  triggerOpen(): void {
    this.readyState = MockSocket.OPEN;
    this.dispatch("open", {});
  }

  triggerMessage(payload: unknown): void {
    this.dispatch("message", { data: JSON.stringify(payload) });
  }
}

afterEach(() => {
  MockSocket.instances = [];
  vi.unstubAllGlobals();
});

describe("useTableSocket", () => {
  it("마운트하면 소켓을 열고, open되면 hello를 보내고, 메시지를 리듀서에 반영한다", async () => {
    vi.stubGlobal("WebSocket", MockSocket as unknown as typeof WebSocket);

    const { result } = renderHook(() => useTableSocket("table-1", "DM닉"));
    expect(MockSocket.instances).toHaveLength(1);
    const socket = MockSocket.instances[0]!;
    expect(socket.url).toContain("/ws/tables/table-1");

    socket.triggerOpen();
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(socket.sent[0]).toContain("hello");

    socket.triggerMessage({
      type: "state.snapshot",
      payload: {
        name: "방",
        ownerNickname: "DM닉",
        map: { path: null },
        grid: { cellSize: 32, offsetX: 0, offsetY: 0 },
        tokens: [],
        participants: [],
        log: [],
        seq: 1,
      },
    });

    await waitFor(() => expect(result.current.state.room?.name).toBe("방"));
    expect(result.current.state.selfRole).toBe("dm");
  });

  it("재마운트(=새로고침 시나리오)하면 새 소켓으로 다시 연결해 스냅샷을 복원한다", async () => {
    vi.stubGlobal("WebSocket", MockSocket as unknown as typeof WebSocket);

    const { result, unmount } = renderHook(() => useTableSocket("table-1", "플레이어닉"));
    const firstSocket = MockSocket.instances[0]!;
    firstSocket.triggerOpen();
    firstSocket.triggerMessage({
      type: "state.snapshot",
      payload: {
        name: "방",
        ownerNickname: "DM닉",
        map: { path: null },
        grid: { cellSize: 32, offsetX: 0, offsetY: 0 },
        tokens: [{ id: "t1", ownerNickname: null, label: "X", x: 1, y: 1, colorSeed: "X", locked: false }],
        participants: [],
        log: [],
        seq: 1,
      },
    });
    await waitFor(() => expect(result.current.state.room?.tokens).toHaveLength(1));

    unmount();
    expect(firstSocket.readyState).toBe(MockSocket.CLOSED);

    // 새 컴포넌트 마운트 — 완전히 새 상태에서 시작하고, 새 소켓 연결 + hello + 스냅샷으로 복원된다.
    const { result: result2 } = renderHook(() => useTableSocket("table-1", "플레이어닉"));
    expect(MockSocket.instances).toHaveLength(2);
    expect(result2.current.state.room).toBeNull();

    const secondSocket = MockSocket.instances[1]!;
    secondSocket.triggerOpen();
    secondSocket.triggerMessage({
      type: "state.snapshot",
      payload: {
        name: "방",
        ownerNickname: "DM닉",
        map: { path: null },
        grid: { cellSize: 32, offsetX: 0, offsetY: 0 },
        tokens: [{ id: "t1", ownerNickname: null, label: "X", x: 1, y: 1, colorSeed: "X", locked: false }],
        participants: [],
        log: [],
        seq: 1,
      },
    });
    await waitFor(() => expect(result2.current.state.room?.tokens).toHaveLength(1));
  });

  it("sendOp은 소켓이 OPEN일 때만 실제로 전송한다", () => {
    vi.stubGlobal("WebSocket", MockSocket as unknown as typeof WebSocket);
    const { result } = renderHook(() => useTableSocket("table-1", "DM닉"));
    const socket = MockSocket.instances[0]!;

    result.current.sendOp("token.move", { tokenId: "t1", x: 1, y: 1 });
    expect(socket.sent).toHaveLength(0); // 아직 OPEN이 아니다

    socket.triggerOpen();
    result.current.sendOp("token.move", { tokenId: "t1", x: 1, y: 1 });
    expect(socket.sent.some((s) => s.includes("token.move"))).toBe(true);
  });
});
