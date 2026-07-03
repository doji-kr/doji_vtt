import { useCallback, useEffect, useRef, useState } from "react";

/** 4단계 §4: WebRTC 음성 mesh. 서버는 SDP/ICE를 해석하지 않고 순수 릴레이만 하므로
 * (docs/PROTOCOL.md) 연결 성립·오디오 라우팅은 전부 클라이언트 책임이다. */
export interface VoiceSignalMessage {
  type: "voice.offer" | "voice.answer" | "voice.ice";
  fromNickname: string;
  data: unknown;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  analyser: AnalyserNode | null;
}

export interface UseVoiceResult {
  enabled: boolean;
  muted: boolean;
  connecting: boolean;
  error: string | null;
  /** 지금 소리를 내고 있다고 판단된 닉네임 집합(자기 자신 포함) — 토큰 글로우에 쓴다. */
  speaking: Set<string>;
  start: () => void;
  stop: () => void;
  toggleMute: () => void;
  handleSignal: (msg: VoiceSignalMessage) => void;
}

const SPEAKING_VOLUME_THRESHOLD = 12; // 0~255 스케일 평균 — 조용한 방 잡음보다는 크게
const SPEAKING_POLL_MS = 200;
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];

function averageVolume(data: Uint8Array): number {
  let sum = 0;
  for (const v of data) sum += v;
  return data.length === 0 ? 0 : sum / data.length;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export function useVoice(opts: {
  selfNickname: string;
  /** 나를 제외한, 지금 방에 접속 중인 참가자 닉네임 목록. */
  participantNicknames: string[];
  sendOp: (type: string, payload: unknown) => void;
  fetchIceServers: () => Promise<RTCIceServer[]>;
}): UseVoiceResult {
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());

  // TableCanvas.tsx의 propsRef 패턴과 동일하게, 매 렌더 최신값을 ref에 반영해서
  // 내부 헬퍼 함수들이 stale closure 없이 항상 최신 sendOp/참가자 목록을 본다.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const localStreamRef = useRef<MediaStream | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const iceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);

  const ensureAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  }, []);

  const teardownPeer = useCallback((nickname: string): void => {
    const entry = peersRef.current.get(nickname);
    if (!entry) return;
    entry.pc.close();
    entry.audioEl.remove();
    peersRef.current.delete(nickname);
  }, []);

  const ensurePeer = useCallback(
    (nickname: string): PeerEntry => {
      const existing = peersRef.current.get(nickname);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
      const entry: PeerEntry = { pc, audioEl, analyser: null };
      peersRef.current.set(nickname, entry);

      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          optsRef.current.sendOp("voice.ice", { toNickname: nickname, data: ev.candidate.toJSON() });
        }
      };
      pc.ontrack = (ev) => {
        const stream = ev.streams[0];
        if (!stream) return;
        audioEl.srcObject = stream;
        const ctx = ensureAudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        entry.analyser = analyser;
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") teardownPeer(nickname);
      };

      return entry;
    },
    [ensureAudioCtx, teardownPeer],
  );

  const connectTo = useCallback(
    async (nickname: string): Promise<void> => {
      const entry = ensurePeer(nickname);
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      optsRef.current.sendOp("voice.offer", { toNickname: nickname, data: offer });
    },
    [ensurePeer],
  );

  const start = useCallback(async () => {
    if (peersRef.current.size > 0 || localStreamRef.current) return;
    setConnecting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const ctx = ensureAudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      localAnalyserRef.current = analyser;

      iceServersRef.current = await optsRef.current.fetchIceServers().catch(() => DEFAULT_ICE_SERVERS);

      setEnabled(true);
      // 나보다 닉네임이 사전순으로 뒤인 상대에게만 내가 먼저 offer를 보낸다 — 양쪽이 동시에
      // offer를 보내는 glare를 두 소켓 모두 같은 규칙을 쓰는 것만으로 피한다(별도
      // rollback/perfect-negotiation 없이 mesh 규모(≤6인)에서는 이걸로 충분하다).
      for (const nickname of optsRef.current.participantNicknames) {
        if (optsRef.current.selfNickname < nickname) void connectTo(nickname);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "마이크에 접근할 수 없다.");
    } finally {
      setConnecting(false);
    }
  }, [connectTo, ensureAudioCtx]);

  const stop = useCallback(() => {
    for (const nickname of [...peersRef.current.keys()]) teardownPeer(nickname);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    localAnalyserRef.current = null;
    setEnabled(false);
    setMuted(false);
    setSpeaking(new Set());
  }, [teardownPeer]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      localStreamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      return next;
    });
  }, []);

  const handleSignal = useCallback(
    (msg: VoiceSignalMessage) => {
      void (async () => {
        if (msg.type === "voice.offer") {
          const entry = ensurePeer(msg.fromNickname);
          await entry.pc.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          optsRef.current.sendOp("voice.answer", { toNickname: msg.fromNickname, data: answer });
        } else if (msg.type === "voice.answer") {
          const entry = peersRef.current.get(msg.fromNickname);
          if (entry) await entry.pc.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
        } else if (msg.type === "voice.ice") {
          const entry = peersRef.current.get(msg.fromNickname);
          if (entry) await entry.pc.addIceCandidate(msg.data as RTCIceCandidateInit).catch(() => {});
        }
      })();
    },
    [ensurePeer],
  );

  // 음성이 켜진 동안 참가자 목록이 바뀌면 mesh를 따라 확장/정리한다(중간 입장/퇴장 대응).
  const participantsKey = opts.participantNicknames.join(",");
  useEffect(() => {
    if (!enabled) return;
    for (const nickname of opts.participantNicknames) {
      if (!peersRef.current.has(nickname) && opts.selfNickname < nickname) void connectTo(nickname);
    }
    for (const nickname of [...peersRef.current.keys()]) {
      if (!opts.participantNicknames.includes(nickname)) teardownPeer(nickname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, participantsKey]);

  // 말하는 사람 감지 — 로컬/원격 오디오 트랙 각각의 AnalyserNode를 짧은 주기로 폴링한다.
  useEffect(() => {
    if (!enabled) return;
    const buffer = new Uint8Array(128);
    const timer = setInterval(() => {
      const next = new Set<string>();
      if (!muted && localAnalyserRef.current) {
        localAnalyserRef.current.getByteFrequencyData(buffer);
        if (averageVolume(buffer) > SPEAKING_VOLUME_THRESHOLD) next.add(optsRef.current.selfNickname);
      }
      for (const [nickname, entry] of peersRef.current) {
        if (!entry.analyser) continue;
        entry.analyser.getByteFrequencyData(buffer);
        if (averageVolume(buffer) > SPEAKING_VOLUME_THRESHOLD) next.add(nickname);
      }
      setSpeaking((prev) => (setsEqual(prev, next) ? prev : next));
    }, SPEAKING_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, muted]);

  // 언마운트(테이블 화면 떠남) 시 마이크·연결을 반드시 정리한다.
  useEffect(() => {
    return () => {
      for (const nickname of [...peersRef.current.keys()]) teardownPeer(nickname);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { enabled, muted, connecting, error, speaking, start, stop, toggleMute, handleSignal };
}
