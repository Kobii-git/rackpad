import type { ReactNode } from "react";
import { Shield, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { logout, useStore } from "@/lib/store";

interface TopBarProps {
  title?: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function TopBar({ title, subtitle, meta, actions }: TopBarProps) {
  const currentUser = useStore((s) => s.currentUser);

  return (
    <header
      className={cn(
        "relative flex h-14 shrink-0 items-center justify-between gap-4 px-6",
        "border-b border-[var(--border-default)] bg-[color-mix(in_srgb,var(--bg-shell)_96%,transparent)] shadow-[0_10px_24px_rgb(0_0_0_/_0.12)]",
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--edge-highlight),transparent)] opacity-80" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-4">
          <div className="min-w-0">
            {subtitle && <div className="rk-kicker">{subtitle}</div>}
            {title && (
              <h1 className="truncate text-[17px] font-semibold leading-tight tracking-normal text-[var(--text-primary)]">
                {title}
              </h1>
            )}
          </div>
          {meta && (
            <div className="hidden items-center gap-3 border-l border-[var(--border-subtle)] pl-4 md:flex">
              {meta}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {actions}
        {currentUser && (
          <>
            <Badge
              tone={
                currentUser.role === "admin"
                  ? "accent"
                  : currentUser.role === "editor"
                    ? "info"
                    : "neutral"
              }
            >
              <Shield className="size-3" />
              {currentUser.role}
            </Badge>
            <div className="hidden text-right md:block">
              <div className="text-xs font-medium text-[var(--text-primary)]">
                {currentUser.displayName}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                @{currentUser.username}
              </div>
            </div>
          </>
        )}
        <ThemeToggle />
        {currentUser && (
          <>
            <div
              className="grid size-8 place-items-center rounded-full border border-[var(--border-default)] bg-[var(--surface-3)] font-mono text-[11px] text-[var(--text-primary)] shadow-[0_1px_0_rgb(255_255_255_/_0.05)_inset]"
              aria-label="Account"
              title={currentUser.displayName}
            >
              {initials(currentUser.displayName || currentUser.username)}
            </div>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </>
        )}
      </div>
    </header>
  );
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "RP";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
