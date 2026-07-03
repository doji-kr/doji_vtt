import { describe, expect, it } from "vitest";
import { generateTurnCredential } from "./turn-credentials.js";

describe("generateTurnCredential", () => {
  it("username은 만료 유닉스초:nickname 형태다", () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const { username } = generateTurnCredential("secret", "안개DM", 3600, now);
    expect(username).toBe(`${Math.floor(now / 1000) + 3600}:안개DM`);
  });

  it("같은 입력이면 같은 credential을 결정론적으로 만든다", () => {
    const now = Date.UTC(2026, 0, 1);
    const a = generateTurnCredential("shared-secret", "플레이어", 3600, now);
    const b = generateTurnCredential("shared-secret", "플레이어", 3600, now);
    expect(a.credential).toBe(b.credential);
  });

  it("secret이 다르면 credential도 다르다", () => {
    const now = Date.UTC(2026, 0, 1);
    const a = generateTurnCredential("secret-a", "플레이어", 3600, now);
    const b = generateTurnCredential("secret-b", "플레이어", 3600, now);
    expect(a.credential).not.toBe(b.credential);
  });

  it("ttl을 그대로 반환한다", () => {
    const { ttl } = generateTurnCredential("secret", "닉네임", 1800, Date.now());
    expect(ttl).toBe(1800);
  });
});
