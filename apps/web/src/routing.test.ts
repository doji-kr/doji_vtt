import { describe, expect, it } from "vitest";
import { inviteUrl, parsePath, tableUrl } from "./routing.js";

describe("parsePath — 라우터 없는 최소 경로 파싱", () => {
  it("/t/:token 을 invite 라우트로 파싱한다", () => {
    expect(parsePath("/t/abc123")).toEqual({ name: "invite", token: "abc123" });
  });

  it("트레일링 슬래시가 있어도 파싱된다", () => {
    expect(parsePath("/t/abc123/")).toEqual({ name: "invite", token: "abc123" });
  });

  it("/table/:id 를 table 라우트로 파싱한다", () => {
    expect(parsePath("/table/0840c1b8-8b66-40c4-aff0-c6e2088086a4")).toEqual({
      name: "table",
      id: "0840c1b8-8b66-40c4-aff0-c6e2088086a4",
    });
  });

  it("알 수 없는 경로는 home으로 떨어진다", () => {
    expect(parsePath("/")).toEqual({ name: "home" });
    expect(parsePath("/whatever/else")).toEqual({ name: "home" });
    expect(parsePath("")).toEqual({ name: "home" });
  });

  it("URL 인코딩된 토큰/id를 디코딩한다", () => {
    expect(parsePath("/t/a%20b")).toEqual({ name: "invite", token: "a b" });
  });
});

describe("inviteUrl / tableUrl", () => {
  it("경로 문자열을 만든다", () => {
    expect(inviteUrl("tok-1")).toBe("/t/tok-1");
    expect(tableUrl("id-1")).toBe("/table/id-1");
  });
});
