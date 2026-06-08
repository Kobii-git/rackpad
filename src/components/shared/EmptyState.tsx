import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rk-empty flex flex-col items-center text-center", className)}>
      {Icon ? (
        <Icon className="mb-2 size-6 text-[var(--text-muted)]" />
      ) : null}
      <div className="rk-empty-title">{title}</div>
      {description ? <p className="rk-empty-copy">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
