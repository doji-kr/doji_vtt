import type { Effect, Input } from "@hearthside/runtime";

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

export interface PlaySummary {
  id: string;
  module_id: string;
  updated_at: string;
  ended: boolean;
  ending_id: string | null;
}

export interface PlayEffectsResponse {
  effects: Effect[];
  ended: boolean;
  ending_id?: string | null;
}

export interface TableSummary {
  id: string;
  name: string;
  invite_token: string;
  updated_at: string;
}

export interface TableDetail {
  id: string;
  name: string;
  ownerNickname: string;
  isOwner: boolean;
}

/** 4단계 §1: 계정 본편. 회원(kind:"member")과 게스트(kind:"guest")가 공존한다 — 어느
 * 쪽이든 표시 이름은 displayName 하나로 정규화되어 있다. */
export type SessionInfo =
  | { kind: "member"; userId: string; username: string; displayName: string }
  | { kind: "guest"; displayName: string };

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(body.message ?? "요청이 실패했다.", res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  ApiError,
  /** 게스트 세션 발급(3단계부터 있던 그대로) — 초대 링크로 들어와 계정 없이 참가할 때 쓴다. */
  loginGuest: (inviteCode: string, nickname: string) =>
    request<{ kind: "guest"; displayName: string }>("/api/session", {
      method: "POST",
      body: JSON.stringify({ invite_code: inviteCode, nickname }),
    }),
  register: (username: string, password: string, displayName: string, inviteCode: string) =>
    request<{ kind: "member"; userId: string; username: string; displayName: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, display_name: displayName, invite_code: inviteCode }),
    }),
  loginMember: (username: string, password: string) =>
    request<{ kind: "member"; userId: string; username: string; displayName: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  listModules: () => request<ModuleSummary[]>("/api/modules"),
  listMyPlays: () => request<PlaySummary[]>("/api/plays"),
  createPlay: (moduleId: string) =>
    request<{ play_id: string; effects: Effect[]; ended: boolean }>("/api/plays", {
      method: "POST",
      body: JSON.stringify({ module_id: moduleId }),
    }),
  getPlay: (playId: string) => request<PlayEffectsResponse>(`/api/plays/${playId}`),
  sendInput: (playId: string, input: Input) =>
    request<{ effects: Effect[]; ended: boolean }>(`/api/plays/${playId}/inputs`, {
      method: "POST",
      body: JSON.stringify({ input }),
    }),
  whoAmI: () => request<SessionInfo>("/api/session"),
  createTable: (name: string) =>
    request<{ id: string; name: string; invite_token: string }>("/api/tables", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  listTables: () => request<TableSummary[]>("/api/tables"),
  getTable: (id: string) => request<TableDetail>(`/api/tables/${id}`),
  resolveInvite: (token: string) => request<{ id: string; name: string }>(`/api/tables/by-invite/${token}`),
  /** 4단계 §4: WebRTC 음성. TURN_SECRET이 서버에 없으면 STUN 항목 하나만 온다. */
  getTurnCredentials: (tableId: string) =>
    request<{ iceServers: RTCIceServer[]; ttl: number }>(`/api/tables/${tableId}/turn-credentials`),
  uploadMap: async (tableId: string, file: File): Promise<{ path: string }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/tables/${tableId}/map`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(body.message ?? "지도 업로드가 실패했다.", res.status);
    }
    return res.json() as Promise<{ path: string }>;
  },
};
