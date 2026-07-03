import { useState } from "react";
import { ParchmentPanel, WoodButton } from "@hearthside/pixel-ui";
import { api } from "../api.js";

/**
 * 홈(서가/이야기꾼의 서재) 진입점 — 4단계부터 실제 회원 계정 로그인/가입 화면이다.
 * 게스트는 이 화면에 오지 않는다(게스트는 오직 초대 링크 → JoinByInvite로만 참가한다).
 */
export function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await api.loginMember(username, password);
      } else {
        await api.register(username, password, displayName || username, inviteCode);
      }
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
          <p style={{ margin: 0 }}>
            {mode === "login" ? "화롯불 곁 서재로 돌아왔다 — 아이디와 비밀번호를 알려달라." : "새 이야기꾼으로 초대코드와 함께 등록해달라."}
          </p>
          <input placeholder="아이디 (영문/숫자)" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          <input
            type="password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {mode === "register" && (
            <>
              <input placeholder="표시 이름 (닉네임)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              <input placeholder="초대코드" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
            </>
          )}
          {error && <p style={{ color: "var(--hs-ember)" }}>{error}</p>}
          <WoodButton type="submit" variant="primary" disabled={busy}>
            {mode === "login" ? "들어가기" : "가입하고 들어가기"}
          </WoodButton>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
            style={{ background: "none", border: "none", color: "var(--hs-moon)", cursor: "pointer", fontSize: "0.85rem" }}
          >
            {mode === "login" ? "처음이라면 — 가입하기" : "이미 계정이 있다면 — 로그인"}
          </button>
        </form>
      </ParchmentPanel>
    </div>
  );
}
