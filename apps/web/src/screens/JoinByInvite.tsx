import { useEffect, useState } from "react";
import { CandleLoading, ParchmentPanel, WoodButton } from "@hearthside/pixel-ui";
import { api } from "../api.js";

type Phase =
  | { name: "checking" }
  | { name: "choose" }
  | { name: "guestForm" }
  | { name: "registerForm" }
  | { name: "resolving" }
  | { name: "error"; message: string };

/**
 * `/t/:token` 진입점. 4단계부터는 로그인이 이미 끝나 있다고 가정하지 않는다 — 이 화면
 * 자체가 인증 두 갈래(게스트/회원가입)의 진입로다(PROMPT-stage4.md §1):
 *  - "이 이름으로 그냥 들어가기": 계정 없이 표시 이름만 정해 즉시 참가(기존 게스트 흐름).
 *  - "가입하고 들어가기": 그 자리에서 회원가입 후 같은 표시 이름으로 참가.
 * 이미 유효한 세션(게스트든 회원이든)이 있으면 선택 화면 없이 바로 초대를 해석한다
 * (재방문·새로고침 시나리오).
 */
export function JoinByInvite({ token, onResolved }: { token: string; onResolved: (tableId: string) => void }) {
  const [phase, setPhase] = useState<Phase>({ name: "checking" });
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .whoAmI()
      .then(() => {
        if (!cancelled) setPhase({ name: "resolving" });
      })
      .catch(() => {
        if (!cancelled) setPhase({ name: "choose" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (phase.name !== "resolving") return;
    let cancelled = false;
    api
      .resolveInvite(token)
      .then((res) => {
        if (!cancelled) onResolved(res.id);
      })
      .catch((err) => {
        if (!cancelled) setPhase({ name: "error", message: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [phase.name, token]);

  async function submitGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      await api.loginGuest(inviteCode, displayName.trim());
      setPhase({ name: "resolving" });
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password || !displayName.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      await api.register(username.trim(), password, displayName.trim(), inviteCode);
      setPhase({ name: "resolving" });
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (phase.name === "error") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "3rem 1rem" }}>
        <ParchmentPanel>
          <p style={{ margin: "0 0 0.75rem" }}>{phase.message}</p>
          <WoodButton onClick={() => (window.location.href = "/")}>서가로</WoodButton>
        </ParchmentPanel>
      </div>
    );
  }

  if (phase.name === "checking" || phase.name === "resolving") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "3rem 1rem" }}>
        <CandleLoading />
      </div>
    );
  }

  if (phase.name === "guestForm") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "3rem 1rem" }}>
        <ParchmentPanel>
          <form onSubmit={submitGuest} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 260 }}>
            <p style={{ margin: 0 }}>화롯불 곁에 잠깐 앉으려면 이름과 초대코드가 필요하다.</p>
            <input placeholder="초대코드" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
            <input placeholder="이 자리에서 쓸 이름" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            {formError && <p style={{ color: "var(--hs-ember)" }}>{formError}</p>}
            <WoodButton type="submit" variant="primary" disabled={busy || !displayName.trim()}>
              이 이름으로 들어가기
            </WoodButton>
            <WoodButton type="button" onClick={() => setPhase({ name: "choose" })}>
              뒤로
            </WoodButton>
          </form>
        </ParchmentPanel>
      </div>
    );
  }

  if (phase.name === "registerForm") {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "3rem 1rem" }}>
        <ParchmentPanel>
          <form onSubmit={submitRegister} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 260 }}>
            <p style={{ margin: 0 }}>이야기꾼의 서재에 계속 남으려면 계정을 만들어달라.</p>
            <input placeholder="초대코드" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
            <input placeholder="아이디 (영문/숫자)" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            <input
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <input placeholder="표시 이름 (닉네임)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            {formError && <p style={{ color: "var(--hs-ember)" }}>{formError}</p>}
            <WoodButton type="submit" variant="primary" disabled={busy}>
              가입하고 들어가기
            </WoodButton>
            <WoodButton type="button" onClick={() => setPhase({ name: "choose" })}>
              뒤로
            </WoodButton>
          </form>
        </ParchmentPanel>
      </div>
    );
  }

  // phase.name === "choose"
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "3rem 1rem" }}>
      <ParchmentPanel>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 260 }}>
          <p style={{ margin: 0 }}>화롯불 곁으로 초대받았다 — 어떻게 들어올까?</p>
          <WoodButton variant="primary" onClick={() => setPhase({ name: "guestForm" })}>
            이 이름으로 그냥 들어가기
          </WoodButton>
          <WoodButton onClick={() => setPhase({ name: "registerForm" })}>가입하고 들어가기</WoodButton>
        </div>
      </ParchmentPanel>
    </div>
  );
}
