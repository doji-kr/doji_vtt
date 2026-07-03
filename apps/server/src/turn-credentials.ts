import { createHmac } from "node:crypto";

/**
 * coturn의 REST API 장기 자격증명 방식(`use-auth-secret`)과 동일한 규칙으로 단기
 * TURN 자격증명을 만든다 — DB에 사용자별 TURN 계정을 새로 만들지 않는다.
 * username = "<만료 유닉스초>:<nickname>", credential = base64(HMAC-SHA1(secret, username)).
 * coturn 쪽 turnserver.conf에 같은 secret을 `static-auth-secret`로 넣어두면 그대로 맞는다.
 */
export function generateTurnCredential(
  secret: string,
  nickname: string,
  ttlSeconds: number,
  now: number = Date.now(),
): { username: string; credential: string; ttl: number } {
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiresAt}:${nickname}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential, ttl: ttlSeconds };
}
