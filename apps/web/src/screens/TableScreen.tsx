import { useEffect, useMemo, useState } from "react";
import { ParchmentPanel, WoodButton } from "@hearthside/pixel-ui";
import { api } from "../api.js";
import { inviteUrl } from "../routing.js";
import { useTableSocket } from "../useTableSocket.js";
import { TableCanvas } from "../pixi/TableCanvas.js";
import type { ChatLogEntry, LogEntry, RollLogEntry } from "../table-reducer.js";

function isRoll(entry: LogEntry): entry is RollLogEntry {
  return entry.kind === "roll";
}
function isChat(entry: LogEntry): entry is ChatLogEntry {
  return entry.kind === "chat";
}

/** 장식용 판정 강조 — d20 표현식에서 실제 주사위 눈이 20/1이면 금빛/먼지 효과(§6). */
function d20FlavorClass(entry: RollLogEntry): string {
  if (!/d20\b/i.test(entry.expression)) return "";
  const chosen = entry.rolls[0] ?? [];
  if (chosen.includes(20)) return "hs-table-log__entry--nat20";
  if (chosen.includes(1)) return "hs-table-log__entry--nat1";
  return "";
}

export function TableScreen({
  tableId,
  selfNickname,
  onExit,
}: {
  tableId: string;
  selfNickname: string;
  onExit: () => void;
}) {
  const { state, connected, sendOp } = useTableSocket(tableId, selfNickname);
  const { room, lastError, selfRole, pings } = state;

  const [chatText, setChatText] = useState("");
  const [whisperTo, setWhisperTo] = useState<string>("all");
  const [secretRoll, setSecretRoll] = useState(false);
  const [resyncKey, setResyncKey] = useState(0);
  const [gridDraft, setGridDraft] = useState({ cellSize: 32, offsetX: 0, offsetY: 0 });
  const [newTokenLabel, setNewTokenLabel] = useState("");
  const [newTokenOwner, setNewTokenOwner] = useState<string>("");
  const [mapBusy, setMapBusy] = useState(false);
  const [mapUploadError, setMapUploadError] = useState<string | null>(null);

  // DM 전용 조작 실패(예: 잠긴 토큰을 억지로 옮기려는 다른 창) 등 error가 올 때마다 캔버스를
  // 서버 상태로 강제 재동기화한다 — 조용히 수렴(§6)하되, 드래그 프리뷰가 잘못된 위치에
  // 남아있지 않게.
  useEffect(() => {
    if (lastError) setResyncKey((k) => k + 1);
  }, [lastError]);

  useEffect(() => {
    if (room) setGridDraft(room.grid);
  }, [room?.grid.cellSize, room?.grid.offsetX, room?.grid.offsetY]);

  const inviteLink = useMemo(() => `${window.location.origin}${inviteUrl(tableId)}`, [tableId]);

  if (!room) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <p>{connected ? "테이블에 접속하는 중..." : "화롯불을 다시 붙이는 중... (연결 대기)"}</p>
        <WoodButton onClick={onExit}>목록으로</WoodButton>
      </div>
    );
  }

  function submitChat(e: React.FormEvent) {
    e.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    if (text.startsWith("/roll ")) {
      const expression = text.slice("/roll ".length).trim();
      sendOp("dice.roll", secretRoll ? { expression, secret: true } : { expression });
    } else {
      sendOp("chat.say", whisperTo === "all" ? { text } : { text, whisperTo });
    }
    setChatText("");
  }

  function addToken(e: React.FormEvent) {
    e.preventDefault();
    if (!newTokenLabel.trim()) return;
    sendOp("token.add", {
      label: newTokenLabel.trim().slice(0, 8),
      ownerNickname: newTokenOwner || null,
      x: 0,
      y: 0,
    });
    setNewTokenLabel("");
  }

  async function handleMapUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMapBusy(true);
    setMapUploadError(null);
    try {
      const res = await api.uploadMap(tableId, file);
      sendOp("map.set", { path: res.path });
    } catch (err) {
      setMapUploadError((err as Error).message);
    } finally {
      setMapBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", height: "80vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h2 style={{ fontFamily: "var(--hs-font-pixel)", color: "var(--hs-candle)", margin: 0 }}>{room.name}</h2>
          <p style={{ margin: "0.15rem 0 0", fontSize: "0.75rem", opacity: 0.7 }}>
            {connected ? "연결됨" : "연결 끊김 — 다시 붙이는 중"} · 초대 링크: {inviteLink}
          </p>
        </div>
        <WoodButton onClick={onExit}>나가기</WoodButton>
      </div>

      <div className="hs-table-layout" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minHeight: 0 }}>
          <TableCanvas
            mapPath={room.map.path}
            grid={room.grid}
            tokens={room.tokens}
            pings={pings}
            selfNickname={selfNickname}
            selfRole={selfRole}
            resyncKey={resyncKey}
            onTokenDragEnd={(tokenId, x, y) => sendOp("token.move", { tokenId, x, y })}
            onPing={(x, y) => sendOp("ping.place", { x, y })}
          />

          {selfRole === "dm" && (
            <ParchmentPanel>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <div>
                  <strong>지도</strong>{" "}
                  <label style={{ cursor: "pointer" }}>
                    <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleMapUpload} disabled={mapBusy} />
                    <span className="hs-wood-button" style={{ display: "inline-block" }}>
                      {mapBusy ? "올리는 중..." : "지도 올리기"}
                    </span>
                  </label>
                  {mapUploadError && <span style={{ color: "var(--hs-ember)", marginLeft: "0.5rem" }}>{mapUploadError}</span>}
                </div>

                <div>
                  <strong>그리드</strong>
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.3rem" }}>
                    <label>
                      셀 크기{" "}
                      <input
                        type="range"
                        min={8}
                        max={128}
                        value={gridDraft.cellSize}
                        onChange={(e) => setGridDraft((g) => ({ ...g, cellSize: Number(e.target.value) }))}
                      />{" "}
                      {gridDraft.cellSize}px
                    </label>
                    <label>
                      X 오프셋{" "}
                      <input
                        type="range"
                        min={-200}
                        max={200}
                        value={gridDraft.offsetX}
                        onChange={(e) => setGridDraft((g) => ({ ...g, offsetX: Number(e.target.value) }))}
                      />
                    </label>
                    <label>
                      Y 오프셋{" "}
                      <input
                        type="range"
                        min={-200}
                        max={200}
                        value={gridDraft.offsetY}
                        onChange={(e) => setGridDraft((g) => ({ ...g, offsetY: Number(e.target.value) }))}
                      />
                    </label>
                    <WoodButton onClick={() => sendOp("grid.set", gridDraft)}>그리드 저장</WoodButton>
                  </div>
                </div>

                <form onSubmit={addToken} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <strong>토큰 추가</strong>
                  <input
                    placeholder="라벨 (예: 오크)"
                    value={newTokenLabel}
                    onChange={(e) => setNewTokenLabel(e.target.value)}
                    maxLength={8}
                    style={{ width: 100 }}
                  />
                  <select value={newTokenOwner} onChange={(e) => setNewTokenOwner(e.target.value)}>
                    <option value="">DM 소유 (몬스터 등)</option>
                    {room.participants
                      .filter((p) => p.nickname !== room.ownerNickname)
                      .map((p) => (
                        <option key={p.nickname} value={p.nickname}>
                          {p.nickname}
                        </option>
                      ))}
                  </select>
                  <WoodButton type="submit">놓기</WoodButton>
                </form>

                {room.tokens.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    {room.tokens.map((t) => (
                      <div key={t.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.85rem" }}>
                        <span>
                          {t.label} ({t.ownerNickname ?? "DM"})
                        </span>
                        <label>
                          <input
                            type="checkbox"
                            checked={t.locked}
                            onChange={(e) => sendOp("token.lock", { tokenId: t.id, locked: e.target.checked })}
                          />{" "}
                          잠금
                        </label>
                        <WoodButton onClick={() => sendOp("token.remove", { tokenId: t.id })}>지우기</WoodButton>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ParchmentPanel>
          )}
        </div>

        <div className="hs-table-side">
          <ParchmentPanel>
            <strong style={{ fontFamily: "var(--hs-font-pixel)", color: "var(--hs-ink)" }}>참가자</strong>
            <div className="hs-table-participants" style={{ marginTop: "0.4rem" }}>
              {room.participants.map((p) => (
                <div key={p.nickname} className="hs-table-participant">
                  <span className={["hs-table-dot", p.connected ? "" : "hs-table-dot--offline"].filter(Boolean).join(" ")} />
                  <span>
                    {p.nickname} {p.role === "dm" && "(DM)"}
                  </span>
                </div>
              ))}
            </div>
          </ParchmentPanel>

          <ParchmentPanel style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <strong style={{ fontFamily: "var(--hs-font-pixel)", color: "var(--hs-ink)" }}>모험 일지</strong>
            <div className="hs-table-log">
              {room.log.map((entry, i) =>
                isRoll(entry) ? (
                  <div key={i} className={["hs-table-log__entry", d20FlavorClass(entry)].filter(Boolean).join(" ")}>
                    🎲 {entry.actor}: {entry.expression} → <strong>{entry.total}</strong>
                    {entry.mode !== "normal" && ` (${entry.mode})`}
                    {entry.secret && " [DM 전용]"}
                  </div>
                ) : isChat(entry) ? (
                  <div key={i} className={["hs-table-log__entry", entry.whisperTo ? "hs-table-log__entry--whisper" : ""].filter(Boolean).join(" ")}>
                    {entry.whisperTo ? `(귓속말→${entry.whisperTo}) ` : ""}
                    {entry.actor}: {entry.text}
                  </div>
                ) : null,
              )}
            </div>

            <form onSubmit={submitChat} className="hs-table-chat-form" style={{ marginTop: "0.5rem" }}>
              <select value={whisperTo} onChange={(e) => setWhisperTo(e.target.value)} style={{ maxWidth: 90 }}>
                <option value="all">전체</option>
                {room.participants
                  .filter((p) => p.nickname !== selfNickname)
                  .map((p) => (
                    <option key={p.nickname} value={p.nickname}>
                      →{p.nickname}
                    </option>
                  ))}
              </select>
              <input
                type="text"
                placeholder="채팅 또는 /roll 1d20+5 adv"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
              />
              {selfRole === "dm" && (
                <label style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={secretRoll} onChange={(e) => setSecretRoll(e.target.checked)} /> 비밀
                </label>
              )}
              <WoodButton type="submit">보내기</WoodButton>
            </form>
          </ParchmentPanel>
        </div>
      </div>
    </div>
  );
}
