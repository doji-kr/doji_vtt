import { autoPosterSvg } from "./autoPoster.js";

export interface PosterCardProps {
  id: string;
  title: string;
  logline: string;
  difficulty?: "easy" | "normal" | "hard";
  estimatedMinutes?: number;
  soloPlayable: boolean;
  posterUrl?: string | null;
  onClick?: () => void;
}

const DIFFICULTY_LABEL: Record<string, string> = { easy: "쉬움", normal: "보통", hard: "어려움" };

export function PosterCard({ id, title, logline, difficulty, estimatedMinutes, soloPlayable, posterUrl, onClick }: PosterCardProps) {
  const art = posterUrl ?? autoPosterSvg(id, title);
  return (
    <div className="hs-poster-card" onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
      <img className="hs-poster-card__art" src={art} alt={`${title} 포스터`} />
      <div className="hs-poster-card__body">
        <p className="hs-poster-card__title">{title}</p>
        <p className="hs-poster-card__logline">{logline}</p>
        <div className="hs-poster-card__meta">
          {soloPlayable && <span className="hs-badge hs-badge--solo">솔로 플레이 가능</span>}
          {difficulty && <span className="hs-badge hs-badge--difficulty">{DIFFICULTY_LABEL[difficulty]}</span>}
          {estimatedMinutes && <span className="hs-badge hs-badge--difficulty">{estimatedMinutes}분</span>}
        </div>
      </div>
    </div>
  );
}
