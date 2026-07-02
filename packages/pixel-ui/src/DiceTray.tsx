import { useState } from "react";
import { WoodButton } from "./WoodButton.js";

export interface DiceTrayProps {
  skill: string;
  dc: number;
  onResolve: (total: number) => void;
}

export function DiceTray({ skill, dc, onResolve }: DiceTrayProps) {
  const [modifier, setModifier] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [manualTotal, setManualTotal] = useState("");

  function rollD20() {
    if (rolling) return;
    setRolling(true);
    const d20 = 1 + Math.floor(Math.random() * 20);
    window.setTimeout(() => {
      setLastRoll(d20);
      setRolling(false);
      onResolve(d20 + modifier);
    }, 480);
  }

  function submitManual() {
    const total = Number.parseInt(manualTotal, 10);
    if (Number.isNaN(total)) return;
    onResolve(total);
  }

  return (
    <div className="hs-dice-tray">
      <p className="hs-dice-tray__prompt">
        [판정] {skill} DC {dc}
      </p>
      <div className="hs-dice-tray__row">
        <div className={["hs-dice-tray__d20", rolling ? "hs-dice-tray__d20--rolling" : ""].filter(Boolean).join(" ")}>
          {lastRoll ?? "d20"}
        </div>
        <label>
          보너스{" "}
          <input
            className="hs-dice-tray__input"
            type="number"
            value={modifier}
            onChange={(e) => setModifier(Number(e.target.value) || 0)}
          />
        </label>
        <WoodButton variant="primary" onClick={rollD20} disabled={rolling}>
          굴리기
        </WoodButton>
      </div>
      <div className="hs-dice-tray__row">
        <span>합계 직접 입력:</span>
        <input
          className="hs-dice-tray__input"
          type="number"
          value={manualTotal}
          onChange={(e) => setManualTotal(e.target.value)}
        />
        <WoodButton onClick={submitManual} disabled={manualTotal === ""}>
          확정
        </WoodButton>
      </div>
    </div>
  );
}
