"use client";

import React from "react";

type Variant = "primary" | "secondary" | "ghost";

type ButtonOwnProps = {
  variant?: Variant;
  leftIcon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

type ButtonProps =
  | (ButtonOwnProps & { as?: "button" } & React.ButtonHTMLAttributes<HTMLButtonElement>)
  | (ButtonOwnProps & { as: "a" } & React.AnchorHTMLAttributes<HTMLAnchorElement>);

// Base recipe matches the Invest CTA: rounded-md, pl-2.5 pr-3.5 py-1.5,
// text-[11.5px] font-medium with text-primary inverted bg.
const BASE = "inline-flex items-center rounded-md font-medium transition-opacity accent-ring";

const VARIANT_CLS: Record<Variant, string> = {
  primary:
    "pl-2.5 pr-3.5 py-1.5 text-[11.5px] hover:opacity-90 disabled:opacity-50",
  secondary:
    "px-3.5 py-1.5 text-[12px] border border-subtle text-secondary hover:bg-[var(--bg-subtle)]",
  ghost:
    "px-2 py-1 text-[12px] text-tertiary hover:text-primary",
};

const VARIANT_STYLE: Record<Variant, React.CSSProperties> = {
  primary: { background: "var(--text-primary)", color: "var(--bg-card)" },
  secondary: {},
  ghost: {},
};

export function Button(props: ButtonProps) {
  const { variant = "primary", leftIcon, className = "", children, ...rest } = props;
  const cls = `${BASE} ${VARIANT_CLS[variant]} ${leftIcon ? "gap-1" : ""} ${className}`;
  const style = { ...VARIANT_STYLE[variant], ...(rest as { style?: React.CSSProperties }).style };
  const inner = (
    <>
      {leftIcon}
      {children}
    </>
  );
  if ("as" in props && props.as === "a") {
    const { as: _as, ...anchorRest } = rest as React.AnchorHTMLAttributes<HTMLAnchorElement> & { as?: string };
    return (
      <a className={cls} style={style} {...anchorRest}>
        {inner}
      </a>
    );
  }
  const { as: _as, ...btnRest } = rest as React.ButtonHTMLAttributes<HTMLButtonElement> & { as?: string };
  return (
    <button className={cls} style={style} {...btnRest}>
      {inner}
    </button>
  );
}

export default Button;
