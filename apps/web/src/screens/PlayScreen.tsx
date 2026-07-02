import { useEffect, useRef, useState } from "react";
import { DiceTray, EndingCard, ParchmentPanel, WoodButton } from "@hearthside/pixel-ui";
import type { Effect, Input } from "@hearthside/runtime";
import { api } from "../api.js";

type ActiveControl = Extract<Effect, { type: "requestCheck" | "showChoices" | "end" }> | null;

function pickActiveControl(effects: Effect[]): ActiveControl {
  const end = effects.find((e): e is Extract<Effect, { type: "end" }> => e.type === "end");
  if (end) return end;
  const check = effects.find((e): e is Extract<Effect, { type: "requestCheck" }> => e.type === "requestCheck");
  if (check) return check;
  const choices = effects.find((e): e is Extract<Effect, { type: "showChoices" }> => e.type === "showChoices");
  if (choices) return choices;
  return null;
}

function EffectBlock({ effect }: { effect: Effect }) {
  switch (effect.type) {
    case "showReadAloud":
      return <ParchmentPanel>{effect.text}</ParchmentPanel>;
    case "narrate":
      return <p style={{ fontStyle: "italic", color: "var(--hs-moon)" }}>» {effect.text}</p>;
    case "startEncounter":
      return (
        <ParchmentPanel>
          <strong>[조우] {effect.name}</strong>
          {effect.readAloud && <p>{effect.readAloud}</p>}
          {effect.monsters && <p>상대: {effect.monsters.join(", ")}</p>}
        </ParchmentPanel>
      );
    case "giveHandout":
      return (
        <ParchmentPanel>
          <strong>[핸드아웃] {effect.title}</strong>
          {effect.text && <p>{effect.text}</p>}
        </ParchmentPanel>
      );
    case "revealSecret":
      return (
        <ParchmentPanel>
          <em>[비밀] {effect.text}</em>
        </ParchmentPanel>
      );
    default:
      return null; // requestCheck/showChoices/end/setFlag는 하단 컨트롤 영역이 담당한다
  }
}

export function PlayScreen({
  playId,
  initialEffects,
  initialEnded,
  onBackToLibrary,
  onRestart,
}: {
  playId: string;
  initialEffects: Effect[];
  initialEnded: boolean;
  onBackToLibrary: () => void;
  onRestart: () => void;
}) {
  const [history, setHistory] = useState<Effect[]>(initialEffects);
  const [activeControl, setActiveControl] = useState<ActiveControl>(pickActiveControl(initialEffects));
  const [ended, setEnded] = useState(initialEnded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function submit(input: Input) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.sendInput(playId, input);
      setHistory((h) => [...h, ...res.effects]);
      setActiveControl(pickActiveControl(res.effects));
      setEnded(res.ended);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const endingEffect = ended && activeControl?.type === "end" ? activeControl : null;
  const endingReadAloud = endingEffect
    ? [...history].reverse().find((e) => e.type === "showReadAloud")
    : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 640, margin: "0 auto" }}>
      {history.map((effect, i) => (
        <EffectBlock effect={effect} key={i} />
      ))}

      {error && <p style={{ color: "var(--hs-ember)" }}>{error}</p>}

      {endingEffect ? (
        <EndingCard
          title={endingEffect.title ?? endingEffect.endingId}
          text={endingReadAloud && endingReadAloud.type === "showReadAloud" ? endingReadAloud.text : ""}
          onBackToLibrary={onBackToLibrary}
          onRestart={onRestart}
        />
      ) : activeControl?.type === "requestCheck" ? (
        <DiceTray skill={activeControl.skill} dc={activeControl.dc} onResolve={(total) => submit({ type: "resolveCheck", total })} />
      ) : activeControl?.type === "showChoices" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-start" }}>
          {activeControl.prompt && <p>{activeControl.prompt}</p>}
          {activeControl.options.map((opt) => (
            <WoodButton key={opt.id} disabled={busy} onClick={() => submit({ type: "choose", optionId: opt.id })}>
              {opt.label}
            </WoodButton>
          ))}
        </div>
      ) : (
        <WoodButton variant="primary" disabled={busy} onClick={() => submit({ type: "continue" })}>
          계속
        </WoodButton>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
