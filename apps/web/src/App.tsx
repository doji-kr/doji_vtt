import { useEffect, useState } from "react";
import { CandleLoading } from "@hearthside/pixel-ui";
import type { Effect } from "@hearthside/runtime";
import { api } from "./api.js";
import { parsePath, pushRoute, replaceRoute, tableUrl, type Route } from "./routing.js";
import { LibraryScreen } from "./screens/LibraryScreen.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { PlayScreen } from "./screens/PlayScreen.js";
import { TablesScreen } from "./screens/TablesScreen.js";
import { TableScreen } from "./screens/TableScreen.js";
import { JoinByInvite } from "./screens/JoinByInvite.js";

type View =
  | { name: "checking" }
  | { name: "login"; afterLogin: Route }
  | { name: "library" }
  | { name: "tables" }
  | { name: "invite"; token: string }
  | { name: "table"; tableId: string }
  | { name: "play"; playId: string; moduleId: string; effects: Effect[]; ended: boolean; key: number };

function viewForRoute(route: Route): View {
  switch (route.name) {
    case "invite":
      return { name: "invite", token: route.token };
    case "table":
      return { name: "table", tableId: route.id };
    default:
      return { name: "library" };
  }
}

export function App() {
  const [view, setView] = useState<View>({ name: "checking" });
  const [nickname, setNickname] = useState<string | null>(null);

  useEffect(() => {
    const route = parsePath(window.location.pathname);
    api
      .whoAmI()
      .then((res) => {
        setNickname(res.nickname);
        setView(viewForRoute(route));
      })
      .catch(() => setView({ name: "login", afterLogin: route }));
  }, []);

  // 뒤로/앞으로 가기 — 이미 로그인된 상태에서만 URL을 다시 읽어 화면을 맞춘다(라우터 없이
  // 최소한만 지원, CLAUDE.md §3의 "새 의존성 최소화" 원칙에 따라 라이브러리는 안 쓴다).
  useEffect(() => {
    function onPopState() {
      if (!nickname) return;
      setView(viewForRoute(parsePath(window.location.pathname)));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [nickname]);

  function goToLibrary() {
    pushRoute("/");
    setView({ name: "library" });
  }

  function goToTables() {
    setView({ name: "tables" });
  }

  function goToTable(tableId: string) {
    pushRoute(tableUrl(tableId));
    setView({ name: "table", tableId });
  }

  /** 초대 링크(/t/:token) 해석 후 자동 이동 — 뒤로가기를 눌렀을 때 죽은 초대 링크로
   * 돌아가지 않도록 push가 아니라 replace로 URL을 바꾼다. */
  function replaceToTable(tableId: string) {
    replaceRoute(tableUrl(tableId));
    setView({ name: "table", tableId });
  }

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
      {view.name === "login" && (
        <LoginScreen
          onLoggedIn={() => {
            api.whoAmI().then((res) => setNickname(res.nickname));
            setView(viewForRoute(view.afterLogin));
          }}
        />
      )}
      {view.name === "library" && (
        <LibraryScreen
          onEnterPlay={(playId, moduleId, effects, ended) => enterPlay(playId, moduleId, effects, ended)}
          onGoToTables={goToTables}
        />
      )}
      {view.name === "tables" && <TablesScreen onEnterTable={goToTable} onBackToLibrary={goToLibrary} />}
      {view.name === "invite" && <JoinByInvite token={view.token} onResolved={replaceToTable} />}
      {view.name === "table" && nickname && (
        <TableScreen tableId={view.tableId} selfNickname={nickname} onExit={goToTables} />
      )}
      {view.name === "play" && (
        <PlayScreen
          key={view.key}
          playId={view.playId}
          initialEffects={view.effects}
          initialEnded={view.ended}
          onBackToLibrary={goToLibrary}
          onRestart={() => restart(view.moduleId)}
        />
      )}
    </div>
  );
}
