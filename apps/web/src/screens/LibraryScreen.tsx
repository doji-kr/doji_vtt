import { useEffect, useState } from "react";
import { CandleLoading, PosterCard, WoodButton } from "@hearthside/pixel-ui";
import type { Effect } from "@hearthside/runtime";
import { api, type ModuleSummary, type PlaySummary } from "../api.js";

export function LibraryScreen({
  onEnterPlay,
  onGoToTables,
}: {
  onEnterPlay: (playId: string, moduleId: string, effects: Effect[], ended: boolean) => void;
  onGoToTables: () => void;
}) {
  const [modules, setModules] = useState<ModuleSummary[] | null>(null);
  const [myPlays, setMyPlays] = useState<PlaySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listModules(), api.listMyPlays()])
      .then(([m, p]) => {
        setModules(m);
        setMyPlays(p);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  async function startNew(moduleId: string) {
    const res = await api.createPlay(moduleId);
    onEnterPlay(res.play_id, moduleId, res.effects, res.ended);
  }

  async function resume(play: PlaySummary) {
    const res = await api.getPlay(play.id);
    onEnterPlay(play.id, play.module_id, res.effects, res.ended);
  }

  if (error) return <p style={{ color: "var(--hs-ember)" }}>{error}</p>;
  if (!modules || !myPlays) return <CandleLoading />;

  const inProgress = myPlays.filter((p) => !p.ended);
  const titleOf = (moduleId: string) => modules.find((m) => m.id === moduleId)?.title ?? moduleId;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* 4단계 §1: 이중 프로필의 최소 진입점 — "모험가 수첩"(이 화면, 내 플레이)과
          "이야기꾼의 서재"(내가 만든 라이브 테이블)를 구분해서 보여준다. 완전히 분리된
          대시보드는 v0.5 나머지(스튜디오 에디터) 몫이라 손대지 않는다. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ fontFamily: "var(--hs-font-pixel)", color: "var(--hs-candle)", margin: 0 }}>모험가 수첩</h2>
        <WoodButton onClick={onGoToTables}>이야기꾼의 서재로 (라이브 테이블)</WoodButton>
      </div>

      {inProgress.length > 0 && (
        <section>
          <h2 style={{ fontFamily: "var(--hs-font-pixel)", color: "var(--hs-candle)" }}>이어서 하기</h2>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {inProgress.map((p) => (
              <WoodButton key={p.id} onClick={() => resume(p)}>
                {titleOf(p.module_id)}
              </WoodButton>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 style={{ fontFamily: "var(--hs-font-pixel)", color: "var(--hs-candle)" }}>서가</h2>
        {modules.length === 0 ? (
          <p>첫 모험의 무대를 펼쳐볼까요? — 아직 서가가 비어 있다.</p>
        ) : (
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {modules.map((m) => (
              <PosterCard
                key={m.id}
                id={m.id}
                title={m.title}
                logline={m.logline}
                soloPlayable={m.soloPlayable}
                posterUrl={m.poster_url}
                onClick={() => startNew(m.id)}
                {...(m.difficulty !== undefined ? { difficulty: m.difficulty } : {})}
                {...(m.estimated_minutes !== undefined ? { estimatedMinutes: m.estimated_minutes } : {})}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
