import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JoinByInvite } from "./JoinByInvite.js";
import { api } from "../api.js";

vi.mock("../api.js", () => ({
  api: {
    whoAmI: vi.fn(),
    resolveInvite: vi.fn(),
    loginGuest: vi.fn(),
    register: vi.fn(),
  },
}));

describe("JoinByInvite — 초대 링크 입장 흐름", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("이미 유효한 세션이 있으면 선택 화면 없이 바로 초대를 해석해 onResolved를 호출한다", async () => {
    vi.mocked(api.whoAmI).mockResolvedValue({ kind: "guest", displayName: "이미로그인됨" });
    vi.mocked(api.resolveInvite).mockResolvedValue({ id: "table-42", name: "금요일 밤" });
    const onResolved = vi.fn();

    render(<JoinByInvite token="tok-abc" onResolved={onResolved} />);

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith("table-42"));
    expect(api.resolveInvite).toHaveBeenCalledWith("tok-abc");
  });

  it("세션이 없으면 게스트/가입 두 선택지를 보여준다", async () => {
    vi.mocked(api.whoAmI).mockRejectedValue(new Error("no session"));

    render(<JoinByInvite token="tok-choose" onResolved={vi.fn()} />);

    expect(await screen.findByText("이 이름으로 그냥 들어가기")).toBeInTheDocument();
    expect(screen.getByText("가입하고 들어가기")).toBeInTheDocument();
    expect(api.resolveInvite).not.toHaveBeenCalled();
  });

  it("초대 링크가 유효하지 않으면(이미 세션 있음) 에러 메시지를 보여주고 onResolved는 호출하지 않는다", async () => {
    vi.mocked(api.whoAmI).mockResolvedValue({ kind: "guest", displayName: "누군가" });
    vi.mocked(api.resolveInvite).mockRejectedValue(new Error("초대 링크가 유효하지 않다."));
    const onResolved = vi.fn();

    render(<JoinByInvite token="dead-token" onResolved={onResolved} />);

    expect(await screen.findByText("초대 링크가 유효하지 않다.")).toBeInTheDocument();
    expect(onResolved).not.toHaveBeenCalled();
  });

  it("'이 이름으로 그냥 들어가기'를 고르면 게스트 로그인 후 초대를 해석한다", async () => {
    vi.mocked(api.whoAmI).mockRejectedValue(new Error("no session"));
    vi.mocked(api.loginGuest).mockResolvedValue({ kind: "guest", displayName: "손님" });
    vi.mocked(api.resolveInvite).mockResolvedValue({ id: "table-99", name: "게스트 테스트 방" });
    const onResolved = vi.fn();

    render(<JoinByInvite token="tok-guest" onResolved={onResolved} />);

    fireEvent.click(await screen.findByText("이 이름으로 그냥 들어가기"));
    fireEvent.change(screen.getByPlaceholderText("이 자리에서 쓸 이름"), { target: { value: "손님" } });
    fireEvent.click(screen.getByText("이 이름으로 들어가기"));

    await waitFor(() => expect(api.loginGuest).toHaveBeenCalledWith("", "손님"));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith("table-99"));
  });

  it("'가입하고 들어가기'를 고르면 회원가입 후 초대를 해석한다", async () => {
    vi.mocked(api.whoAmI).mockRejectedValue(new Error("no session"));
    vi.mocked(api.register).mockResolvedValue({ kind: "member", userId: "u1", username: "newbie", displayName: "새친구" });
    vi.mocked(api.resolveInvite).mockResolvedValue({ id: "table-77", name: "가입 테스트 방" });
    const onResolved = vi.fn();

    render(<JoinByInvite token="tok-register" onResolved={onResolved} />);

    fireEvent.click(await screen.findByText("가입하고 들어가기"));
    fireEvent.change(screen.getByPlaceholderText("아이디 (영문/숫자)"), { target: { value: "newbie" } });
    fireEvent.change(screen.getByPlaceholderText("비밀번호"), { target: { value: "hunter2pass" } });
    fireEvent.change(screen.getByPlaceholderText("표시 이름 (닉네임)"), { target: { value: "새친구" } });
    fireEvent.click(screen.getByText("가입하고 들어가기", { selector: "button[type=submit]" }));

    await waitFor(() => expect(api.register).toHaveBeenCalledWith("newbie", "hunter2pass", "새친구", ""));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith("table-77"));
  });
});
