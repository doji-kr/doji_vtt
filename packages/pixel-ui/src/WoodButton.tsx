import type { ButtonHTMLAttributes } from "react";

export interface WoodButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary";
}

export function WoodButton({ variant = "default", className, ...rest }: WoodButtonProps) {
  return (
    <button
      className={["hs-wood-button", `hs-wood-button--${variant}`, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
