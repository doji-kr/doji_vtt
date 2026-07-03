import { useEffect, useState } from "react";
import { CandleLoading, ParchmentPanel, WoodButton } from "@hearthside/pixel-ui";
import { api } from "../api.js";

/**
 * `/t/:token` 진입점. 이 컴포넌트가 렌더될 시점엔 이미 로그인이 끝나 있다고 가정한다
 * (App.tsx가 세션 확인 → 필요하면 LoginScreen을 먼저 보여준 뒤에만 이 화면으로 온다).
 * 초대 토큰을 테이블 id로 바꾸는 일만 한다.
 */
export function JoinByInvite({ token, onResolved }: { token: string; onResolved: (tableId: string) => void }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .resolveInvite(token)
      .then((res) => {
        if (!cancelled) onResolved(res.id);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "3rem 1rem" }}>
        <ParchmentPanel>
          <p style={{ margin: "0 0 0.75rem" }}>{error}</p>
          <WoodButton onClick={() => (window.location.href = "/")}>서가로</WoodButton>
        </ParchmentPanel>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "3rem 1rem" }}>
      <CandleLoading />
    </div>
  );
}
