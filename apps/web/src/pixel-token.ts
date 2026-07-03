// 제너레이티브 픽셀 토큰 v0 (PROMPT-stage3.md §4) — 프리셋 스프라이트는 v1.0 몫이라 지금은
// "닉네임 이니셜 + 결정적 팔레트 링 컬러"만 만든다. 시드가 같으면 항상 같은 색이 나와야
// 한다(재접속·다른 브라우저에서도 같은 토큰이 같은 색으로 보이게).

// CLAUDE.md §6 팔레트에서 배경(char/wood/parchment/ink)을 뺀, 링으로 쓸만한 강조색들.
const RING_PALETTE = ["#E8A13D", "#C75146", "#8FA872", "#7FA3B8", "#F4BE6C"] as const;

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** 시드 문자열 -> 팔레트 링 컬러(hex). 같은 시드는 항상 같은 색. */
export function ringColorFor(seed: string): string {
  const idx = hashSeed(seed) % RING_PALETTE.length;
  return RING_PALETTE[idx]!;
}

/** 라벨(닉네임 등)에서 토큰에 그려 넣을 한 글자를 뽑는다. */
export function initialOf(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : "?";
}
