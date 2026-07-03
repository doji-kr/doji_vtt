import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JoinByInvite } from "./JoinByInvite.js";
import { api } from "../api.js";

vi.mock("../api.js", () => ({
  api: {
    resolveInvite: vi.fn(),
  },
}));

describe("JoinByInvite — 초대 링크 입장 흐름", () => {
  it("초대 토큰을 테이블 id로 바꿔 onResolved를 호출한다", async () => {
    vi.mocked(api.resolveInvite).mockResolvedValue({ id: "table-42", name: "금요일 밤" });
    const onResolved = vi.fn();

    render(<JoinByInvite token="tok-abc" onResolved={onResolved} />);

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith("table-42"));
    expect(api.resolveInvite).toHaveBeenCalledWith("tok-abc");
  });

  it("초대 링크가 유효하지 않으면 에러 메시지를 보여주고 onResolved는 호출하지 않는다", async () => {
    vi.mocked(api.resolveInvite).mockRejectedValue(new Error("초대 링크가 유효하지 않다."));
    const onResolved = vi.fn();

    render(<JoinByInvite token="dead-token" onResolved={onResolved} />);

    expect(await screen.findByText("초대 링크가 유효하지 않다.")).toBeInTheDocument();
    expect(onResolved).not.toHaveBeenCalled();
  });
});
