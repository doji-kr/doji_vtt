// 라우터 없는 최소 경로 파싱 — CLAUDE.md §3(새 런타임 의존성 최소화)에 따라 라우터 라이브러리를
// 쓰지 않는다. 초대 링크(/t/:token)와 테이블 화면(/table/:id)만 실제 URL로 다뤄야 해서
// window.location.pathname을 부팅 시 한 번 읽고, 내부 이동은 history.pushState로 처리한다.

export type Route = { name: "home" } | { name: "invite"; token: string } | { name: "table"; id: string };

const INVITE_RE = /^\/t\/([^/]+)\/?$/;
const TABLE_RE = /^\/table\/([^/]+)\/?$/;

/** 순수 함수 — pathname만 보고 Route를 결정한다. 알 수 없는 경로는 home으로 떨어진다. */
export function parsePath(pathname: string): Route {
  const inviteMatch = INVITE_RE.exec(pathname);
  if (inviteMatch) return { name: "invite", token: decodeURIComponent(inviteMatch[1]!) };

  const tableMatch = TABLE_RE.exec(pathname);
  if (tableMatch) return { name: "table", id: decodeURIComponent(tableMatch[1]!) };

  return { name: "home" };
}

export function inviteUrl(token: string): string {
  return `/t/${encodeURIComponent(token)}`;
}

export function tableUrl(id: string): string {
  return `/table/${encodeURIComponent(id)}`;
}

/** history.pushState로 URL만 바꾼다 — 실제 페이지 이동은 없다(수동 라우팅). */
export function pushRoute(path: string): void {
  window.history.pushState(null, "", path);
}

/** 자동 리다이렉트(초대 링크 해석 후)처럼 히스토리에 남기지 않아야 할 이동. */
export function replaceRoute(path: string): void {
  window.history.replaceState(null, "", path);
}
