import type { FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { getUserById } from "./user-store.js";

// 4단계 §1: 계정 본편. 두 종류의 서명 쿠키가 공존한다 —
//  - hs_session(게스트): 지금까지 그대로, nickname 문자열을 서명해서 담는다. 초대 링크로
//    들어온 사람이 계정 없이 표시 이름만 정하고 참가할 때 쓴다.
//  - hs_member(회원): 새로 추가. user_id를 서명해서 담는다. 매 요청마다 users 테이블에서
//    현재 username/display_name을 조회한다(캐시하지 않음 — 나중에 표시 이름 변경 기능이
//    생겨도 쿠키가 오래된 이름을 들고 있는 일이 없게).
//
// requireSession은 회원 쿠키를 우선 확인하고, 없거나 무효하면 게스트 쿠키로 폴백한다.
// 소유권·권한 판단(테이블 생성 등)은 반드시 request.userId만 봐야 한다 — 게스트는 애초에
// userId가 없으므로 자동으로 걸러진다. 표시용 이름이 필요한 코드는
// request.displayName ?? request.guestName (= request.nickname, 하위호환용으로 계속 채워준다)을 쓴다.

const GUEST_COOKIE_NAME = "hs_session";
const MEMBER_COOKIE_NAME = "hs_member";

declare module "fastify" {
  interface FastifyRequest {
    /** 회원 계정 id. 게스트면 undefined. 소유권·권한 판단에는 반드시 이 필드만 쓴다. */
    userId?: string;
    username?: string;
    /** 회원의 화면 표시 이름. */
    displayName?: string;
    /** 게스트의 화면 표시 이름(예전의 nickname 그 자체). */
    guestName?: string;
    /**
     * 표시용으로 정규화된 이름 — displayName ?? guestName. 소유권 판단에 쓰면 안 된다
     * (게스트도 값이 채워지므로). 3단계까지 쓰이던 필드를 하위호환으로 유지한다.
     */
    nickname?: string;
  }
}

export function setGuestCookie(reply: FastifyReply, nickname: string): void {
  reply.setCookie(GUEST_COOKIE_NAME, nickname, {
    signed: true,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function setMemberCookie(reply: FastifyReply, userId: string): void {
  reply.setCookie(MEMBER_COOKIE_NAME, userId, {
    signed: true,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** 보호 라우트 preHandler 팩토리 — 회원 조회에 db가 필요해서 db를 주입받는다. */
export function makeRequireSession(
  db: Database.Database,
): (request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => void {
  return function requireSession(request, reply, done) {
    const memberRaw = request.cookies[MEMBER_COOKIE_NAME];
    if (memberRaw) {
      const result = request.unsignCookie(memberRaw);
      if (result.valid && result.value) {
        const user = getUserById(db, result.value);
        if (user) {
          request.userId = user.id;
          request.username = user.username;
          request.displayName = user.display_name;
          request.nickname = user.display_name;
          done();
          return;
        }
      }
      // 회원 쿠키가 있는데 무효/삭제된 계정이면 게스트 쿠키로 폴백을 시도한다(아래).
    }

    const guestRaw = request.cookies[GUEST_COOKIE_NAME];
    if (guestRaw) {
      const result = request.unsignCookie(guestRaw);
      if (result.valid && result.value) {
        request.guestName = result.value;
        request.nickname = result.value;
        done();
        return;
      }
    }

    reply.code(401).send({ error: "no_session", message: "브렌다가 문 앞에서 막아선다 — 먼저 초대코드로 들어와야 한다." });
  };
}
