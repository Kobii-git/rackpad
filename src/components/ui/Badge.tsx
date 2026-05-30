import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[999px] border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.13em]",
  {
    variants: {
      tone: {
        neutral:
          "border-[var(--neutral-border)] bg-[var(--neutral-soft)] text-[var(--neutral)]",
        accent:
          "border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)] text-[var(--accent-primary-hover)]",
        ok: "border-[var(--success-border)] bg-[var(--success-soft)] text-[var(--success)]",
        warn: "border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning)]",
        err: "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)]",
        info: "border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)]",
        cyan: "border-[var(--accent-secondary-border)] bg-[var(--accent-secondary-soft)] text-[var(--accent-secondary)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ tone }), className)}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";
