import { useEffect, useState } from "react";
import { CandleLoading } from "@hearthside/pixel-ui";
import type { Effect } from "@hearthside/runtime";
import { api, type SessionInfo } from "./api.js";
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

/** 홈(서가/이야기꾼의 서재)은 회원 전용이다 — 게스트는 초대 링크로만 참가하고 이 화면
 * 자체에 도달하지 않는다(CLAUDE.md, PROMPT-stage4.md §1). 초대·테이블 화면은 게스트도
 * 접근할 수 있어야 하므로 여기서 걸러지지 않는다. */
function requiresMember(route: Route): boolean {
  return route.name === "home";
}

export function App() {
  const [view, setView] = useState<View>({ name: "checking" });
  const [session, setSession] = useState<SessionInfo | null>(null);

  function routeToView(route: Route, s: SessionInfo | null): View {
    if (requiresMember(route) && s?.kind !== "member") {
      return { name: "login", afterLogin: route };
    }
    return viewForRoute(route);
  }

  useEffect(() => {
    const route = parsePath(window.location.pathname);
    api
      .whoAmI()
      .then((res) => {
        setSession(res);
        setView(routeToView(route, res));
      })
      .catch(() => {
        // 세션이 아예 없다 — 초대 링크는 JoinByInvite가 자체적으로 인증 두 갈래를
        // 제공하니 그대로 보여주고, 그 외 경로는 회원 로그인 화면으로 보낸다.
        if (route.name === "invite") {
          setView(viewForRoute(route));
        } else {
          setView({ name: "login", afterLogin: route });
        }
      });
  }, []);

  // 뒤로/앞으로 가기 — 세션이 확인된 상태에서만 URL을 다시 읽어 화면을 맞춘다(라우터 없이
  // 최소한만 지원, CLAUDE.md §3의 "새 의존성 최소화" 원칙에 따라 라이브러리는 안 쓴다).
  useEffect(() => {
    function onPopState() {
      const route = parsePath(window.location.pathname);
      if (route.name === "invite") {
        setView(viewForRoute(route));
        return;
      }
      if (!session) return;
      setView(routeToView(route, session));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [session]);

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
   * 돌아가지 않도록 push가 아니라 replace로 URL을 바꾼다. JoinByInvite가 그 자리에서
   * 게스트/회원 세션을 새로 발급했을 수 있으니 세션을 다시 읽는다. */
  function replaceToTable(tableId: string) {
    api.whoAmI().then(setSession).catch(() => setSession(null));
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

  const displayName = session?.displayName ?? null;

  return (
    <div className="hs-root" style={{ padding: "2rem 1.25rem" }}>
      <h1 style={{ fontFamily: "var(--hs-font-pixel)", color: "var(--hs-candle)", textAlign: "center" }}>화롯가</h1>
      {view.name === "checking" && <CandleLoading />}
      {view.name === "login" && (
        <LoginScreen
          onLoggedIn={() => {
            api.whoAmI().then((res) => {
              setSession(res);
              setView(routeToView(view.afterLogin, res));
            });
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
      {view.name === "table" && displayName && (
        <TableScreen tableId={view.tableId} selfNickname={displayName} onExit={goToTables} />
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
