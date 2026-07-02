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
  login: (inviteCode: string, nickname: string) =>
    request<{ nickname: string }>("/api/session", {
      method: "POST",
      body: JSON.stringify({ invite_code: inviteCode, nickname }),
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
};
