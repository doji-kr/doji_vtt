import type { ReactNode } from "react";

export function ParchmentPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["hs-parchment-panel", className].filter(Boolean).join(" ")}>{children}</div>;
}
