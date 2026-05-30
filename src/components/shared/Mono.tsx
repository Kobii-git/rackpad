import { cn } from "@/lib/utils";
import * as React from "react";

export function Mono({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "font-mono text-[12px] tracking-normal text-[var(--color-fg)]",
        className,
      )}
      {...props}
    />
  );
}
