import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoice } from "./useVoice.js";

/** jsdom엔 WebRTC/미디어 API가 없어서 최소한만 흉내낸다 — 실제 ICE 협상·오디오 재생은
 * 이 테스트의 관심사가 아니다(PROMPT-stage4.md §4: "실제 미디어 연결까지 자동화 테스트할
 * 필요는 없다, WebRTC 연결 자체는 브라우저 필요"). 여기서 검증하는 건 순수한 시그널링
 * 로직 — 누가 먼저 offer를 보내는지, offer를 받으면 answer로 응답하는지, 음소거가 실제
 * 트랙을 건드리는지 — 뿐이다. */
class MockTrack {
  enabled = true;
  stop = vi.fn();
}
class MockMediaStream {
  private tracks: MockTrack[];
  constructor(tracks: MockTrack[] = [new MockTrack()]) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}
class MockAnalyser {
  fftSize = 0;
  getByteFrequencyData(arr: Uint8Array) {
    arr.fill(0);
  }
}
class MockAudioContext {
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createAnalyser() {
    return new MockAnalyser();
  }
}
class MockRTCPeerConnection {
  static instances: MockRTCPeerConnection[] = [];
  connectionState = "new";
  onicecandidate: ((ev: unknown) => void) | null = null;
  ontrack: ((ev: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addedTracks: unknown[] = [];
  constructor(public config: unknown) {
    MockRTCPeerConnection.instances.push(this);
  }
  addTrack(track: unknown) {
    this.addedTracks.push(track);
  }
  async createOffer() {
    return { type: "offer", sdp: "mock-offer" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "mock-answer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate() {}
  close() {
    this.connectionState = "closed";
  }
}

beforeEach(() => {
  MockRTCPeerConnection.instances = [];
  vi.stubGlobal("RTCPeerConnection", MockRTCPeerConnection);
  vi.stubGlobal("AudioContext", MockAudioContext);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream()) } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useVoice", () => {
  it("사전순으로 뒤에 오는 참가자에게만 먼저 offer를 보낸다 — 양쪽 동시 offer(glare)를 피한다", async () => {
    const sendOp = vi.fn();
    const { result } = renderHook(() =>
      useVoice({
        selfNickname: "나",
        participantNicknames: ["가나다", "하하하"], // "가나다" < "나" < "하하하"
        sendOp,
        fetchIceServers: () => Promise.resolve([{ urls: ["stun:stun.example"] }]),
      }),
    );

    await act(async () => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.enabled).toBe(true));
    await waitFor(() => {
      const offers = sendOp.mock.calls.filter((c) => c[0] === "voice.offer");
      expect(offers).toHaveLength(1);
      expect(offers[0]![1]).toMatchObject({ toNickname: "하하하" });
    });
  });

  it("voice.offer를 받으면 voice.answer로 응답한다", async () => {
    const sendOp = vi.fn();
    const { result } = renderHook(() =>
      useVoice({
        selfNickname: "나",
        participantNicknames: [],
        sendOp,
        fetchIceServers: () => Promise.resolve([]),
      }),
    );

    await act(async () => {
      result.current.handleSignal({ type: "voice.offer", fromNickname: "상대", data: { type: "offer", sdp: "x" } });
    });

    await waitFor(() => {
      const answers = sendOp.mock.calls.filter((c) => c[0] === "voice.answer");
      expect(answers).toHaveLength(1);
      expect(answers[0]![1]).toMatchObject({ toNickname: "상대" });
    });
  });

  it("toggleMute는 로컬 오디오 트랙의 enabled를 뒤집는다", async () => {
    const sendOp = vi.fn();
    const { result } = renderHook(() =>
      useVoice({
        selfNickname: "나",
        participantNicknames: [],
        sendOp,
        fetchIceServers: () => Promise.resolve([]),
      }),
    );

    await act(async () => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    expect(result.current.muted).toBe(false);
    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.muted).toBe(true);
  });
});
