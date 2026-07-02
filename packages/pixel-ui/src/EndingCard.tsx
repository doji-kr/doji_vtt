import { WoodButton } from "./WoodButton.js";

export interface EndingCardProps {
  title: string;
  text: string;
  onBackToLibrary: () => void;
  onRestart: () => void;
}

export function EndingCard({ title, text, onBackToLibrary, onRestart }: EndingCardProps) {
  return (
    <div className="hs-ending-card">
      <p className="hs-ending-card__title">{title}</p>
      <p className="hs-ending-card__text">{text}</p>
      <div className="hs-ending-card__actions">
        <WoodButton onClick={onBackToLibrary}>서가로</WoodButton>
        <WoodButton variant="primary" onClick={onRestart}>
          처음부터
        </WoodButton>
      </div>
    </div>
  );
}
