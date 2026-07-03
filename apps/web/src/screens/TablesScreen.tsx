import { useEffect, useState } from "react";
import { CandleLoading, ParchmentPanel, WoodButton } from "@hearthside/pixel-ui";
import { api, type TableSummary } from "../api.js";
import { inviteUrl } from "../routing.js";

export function TablesScreen({
  onEnterTable,
  onBackToLibrary,
}: {
  onEnterTable: (tableId: string) => void;
  onBackToLibrary: () => void;
}) {
  const [tables, setTables] = useState<TableSummary[] | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justCreated, setJustCreated] = useState<{ id: string; invite_token: string } | null>(null);

  function reload() {
    api
      .listTables()
      .then(setTables)
      .catch((err) => setError((err as Error).message));
  }

  useEffect(reload, []);

  async function createTable(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const table = await api.createTable(newName.trim());
      setJustCreated(table);
      setNewName("");
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inviteLink = justCreated ? `${window.location.origin}${inviteUrl(justCreated.invite_token)}` : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontFamily: "var(--hs-font-pixel)", color: "var(--hs-candle)", margin: 0 }}>라이브 테이블</h2>
        <WoodButton onClick={onBackToLibrary}>서가로</WoodButton>
      </div>

      <ParchmentPanel>
        <form onSubmit={createTable} style={{ display: "flex", gap: "0.5rem" }}>
          <input
            placeholder="새 테이블 이름 (예: 지하실의 쥐들 — 금요일 밤)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1 }}
          />
          <WoodButton type="submit" variant="primary" disabled={busy || !newName.trim()}>
            방 열기
          </WoodButton>
        </form>
        {inviteLink && justCreated && (
          <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            초대 링크: <code>{inviteLink}</code>{" "}
            <WoodButton onClick={() => onEnterTable(justCreated.id)}>바로 들어가기</WoodButton>
          </p>
        )}
      </ParchmentPanel>

      {error && <p style={{ color: "var(--hs-ember)" }}>{error}</p>}

      {!tables ? (
        <CandleLoading />
      ) : tables.length === 0 ? (
        <p>아직 연 테이블이 없다 — 화롯불을 하나 지펴볼까요?</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {tables.map((t) => (
            <ParchmentPanel key={t.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{t.name}</strong>
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", opacity: 0.75 }}>
                    초대 링크: {window.location.origin}
                    {inviteUrl(t.invite_token)}
                  </p>
                </div>
                <WoodButton variant="primary" onClick={() => onEnterTable(t.id)}>
                  입장
                </WoodButton>
              </div>
            </ParchmentPanel>
          ))}
        </div>
      )}
    </div>
  );
}
