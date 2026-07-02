import { useEffect, useState } from "react";
import { CandleLoading } from "@hearthside/pixel-ui";
import type { Effect } from "@hearthside/runtime";
import { api } from "./api.js";
import { LibraryScreen } from "./screens/LibraryScreen.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { PlayScreen } from "./screens/PlayScreen.js";

type View =
  | { name: "checking" }
  | { name: "login" }
  | { name: "library" }
  | { name: "play"; playId: string; moduleId: string; effects: Effect[]; ended: boolean; key: number };

export function App() {
  const [view, setView] = useState<View>({ name: "checking" });

  useEffect(() => {
    api
      .listMyPlays()
      .then(() => setView({ name: "library" }))
      .catch(() => setView({ name: "login" }));
  }, []);

  function enterPlay(playId: string, moduleId: string, effects: Effect[], ended: boolean) {
    setView({ name: "play", playId, moduleId, effects, ended, key: Date.now() });
  }

  async function restart(moduleId: string) {
    const res = await api.createPlay(moduleId);
    enterPlay(res.play_id, moduleId, res.effects, res.ended);
  }

  return (
    <div className="hs-root" style={{ padding: "2rem 1.25rem" }}>
      <h1 style={{ fontFamily: "var(--hs-font-pixel)", color: "var(--hs-candle)", textAlign: "center" }}>화롯가</h1>
      {view.name === "checking" && <CandleLoading />}
      {view.name === "login" && <LoginScreen onLoggedIn={() => setView({ name: "library" })} />}
      {view.name === "library" && (
        <LibraryScreen onEnterPlay={(playId, moduleId, effects, ended) => enterPlay(playId, moduleId, effects, ended)} />
      )}
      {view.name === "play" && (
        <PlayScreen
          key={view.key}
          playId={view.playId}
          initialEffects={view.effects}
          initialEnded={view.ended}
          onBackToLibrary={() => setView({ name: "library" })}
          onRestart={() => restart(view.moduleId)}
        />
      )}
    </div>
  );
}
