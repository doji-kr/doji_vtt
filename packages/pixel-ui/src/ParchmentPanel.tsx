import type { CSSProperties, ReactNode } from "react";

export function ParchmentPanel({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={["hs-parchment-panel", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
  );
}
