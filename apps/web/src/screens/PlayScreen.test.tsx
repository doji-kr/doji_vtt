import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Effect } from "@hearthside/runtime";
import { PlayScreen } from "./PlayScreen.js";
import { api } from "../api.js";

vi.mock("../api.js", () => ({
  api: {
    sendInput: vi.fn(),
  },
}));

describe("PlayScreen 상태 전이", () => {
  it("showChoices 옵션을 클릭하면 입력을 보내고 다음 effect를 렌더한다", async () => {
    const initialEffects: Effect[] = [
      { type: "showReadAloud", sceneId: "start", text: "문이 삐걱 열린다." },
      {
        type: "showChoices",
        blockId: "go",
        options: [{ id: "enter", label: "들어간다" }],
      },
    ];
    vi.mocked(api.sendInput).mockResolvedValue({
      effects: [{ type: "showReadAloud", sceneId: "next", text: "다음 장면이다." }],
      ended: false,
    });

    render(
      <PlayScreen
        playId="p1"
        initialEffects={initialEffects}
        initialEnded={false}
        onBackToLibrary={() => {}}
        onRestart={() => {}}
      />,
    );

    expect(screen.getByText("문이 삐걱 열린다.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("들어간다"));

    await waitFor(() => expect(api.sendInput).toHaveBeenCalledWith("p1", { type: "choose", optionId: "enter" }));
    expect(await screen.findByText("다음 장면이다.")).toBeInTheDocument();
  });

  it("엔딩이면 EndingCard를 보여주고 서가로 버튼이 동작한다", () => {
    const onBack = vi.fn();
    const initialEffects: Effect[] = [
      { type: "showReadAloud", sceneId: "end", text: "이야기가 끝난다." },
      { type: "end", endingId: "the_end", title: "끝" },
    ];

    render(
      <PlayScreen
        playId="p1"
        initialEffects={initialEffects}
        initialEnded={true}
        onBackToLibrary={onBack}
        onRestart={() => {}}
      />,
    );

    expect(screen.getByText("끝")).toBeInTheDocument();
    fireEvent.click(screen.getByText("서가로"));
    expect(onBack).toHaveBeenCalled();
  });
});
