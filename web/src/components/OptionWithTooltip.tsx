import type { ReactNode } from "react";

type Props = {
  /** Shown immediately on hover (no native title delay). */
  hint: string;
  children: ReactNode;
};

/**
 * Wraps a checkbox label so a custom tooltip appears instantly on hover / focus-within.
 */
export default function OptionWithTooltip({ hint, children }: Props) {
  return (
    <span className="qa-option-hint">
      {children}
      <span className="qa-option-hint__tip" role="tooltip">
        {hint}
      </span>
    </span>
  );
}
