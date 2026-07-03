import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const defaultContentDir = resolve(here, "../../../content/modules");
const defaultWebDist = resolve(here, "../../web/dist");
const defaultDataDir = resolve(here, "../data");

function warnedRandomSecret(): string {
  const secret = randomBytes(32).toString("hex");
  console.warn(
    "[경고] SESSION_SECRET 환경변수가 없어 임시 비밀키를 생성했다 — 서버를 재시작하면 기존 쿠키가 전부 무효화된다. " +
      "운영 배포에서는 반드시 SESSION_SECRET을 고정해라.",
  );
  return secret;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.DATA_DIR ?? defaultDataDir,
  contentDir: process.env.CONTENT_DIR ?? defaultContentDir,
  webDist: process.env.WEB_DIST ?? defaultWebDist,
  inviteCode: process.env.INVITE_CODE ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? warnedRandomSecret(),
  // 4단계 §4: WebRTC 음성. TURN_SECRET이 없으면 coturn 없이도(STUN만으로) 음성이 동작하는
  // 가정용 네트워크 전제로 TURN 자격증명 발급을 건너뛴다 — coturn은 NAT 통과 실패 시의
  // 안전망일 뿐 필수 인프라가 아니다.
  turnSecret: process.env.TURN_SECRET ?? "",
  turnUrls: (process.env.TURN_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
};
