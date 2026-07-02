const PALETTE = ["#E8A13D", "#C75146", "#8FA872", "#7FA3B8", "#4C3A27"];

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/** 포스터가 없는 모듈을 위한 결정적(모듈 id 시드) SVG 자동 포스터 v0. */
export function autoPosterSvg(moduleId: string, title: string): string {
  const h = hash(moduleId);
  const colorA = PALETTE[h % PALETTE.length];
  const colorB = PALETTE[(h >> 3) % PALETTE.length];
  const escapedTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${colorA}"/>
          <stop offset="1" stop-color="${colorB}"/>
        </linearGradient>
      </defs>
      <rect width="400" height="600" fill="#1B1410"/>
      <rect x="20" y="20" width="360" height="560" fill="url(#g)" opacity="0.85"/>
      <circle cx="200" cy="220" r="70" fill="#EFDFB8" opacity="0.18"/>
      <text x="200" y="480" text-anchor="middle" font-family="Galmuri11, monospace" font-size="28" fill="#EFDFB8">
        ${escapedTitle}
      </text>
    </svg>
  `)}`;
}
