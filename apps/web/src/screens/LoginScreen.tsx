import { useState } from "react";
import { ParchmentPanel, WoodButton } from "@hearthside/pixel-ui";
import { api } from "../api.js";

export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [inviteCode, setInviteCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(inviteCode, nickname);
      onLoggedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "3rem 1rem" }}>
      <ParchmentPanel>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minWidth: 260 }}>
          <p style={{ margin: 0 }}>화롯불 곁으로 들어오려면 초대코드와 이름이 필요하다.</p>
          <input placeholder="초대코드" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          <input placeholder="닉네임" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          {error && <p style={{ color: "var(--hs-ember)" }}>{error}</p>}
          <WoodButton type="submit" variant="primary" disabled={busy}>
            들어가기
          </WoodButton>
        </form>
      </ParchmentPanel>
    </div>
  );
}
