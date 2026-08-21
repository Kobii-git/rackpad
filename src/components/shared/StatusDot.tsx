import { cn } from "@/lib/utils";
import type { DeviceStatus, LinkState } from "@/lib/types";

interface StatusDotProps {
  status?: DeviceStatus;
  link?: LinkState;
  size?: "sm" | "md";
  className?: string;
}

export function StatusDot({
  status,
  link,
  size = "sm",
  className,
}: StatusDotProps) {
  let color = "var(--neutral)";
  let glow = "transparent";
  let pulse = false;

  if (link !== undefined) {
    if (link === "up") {
      color = "var(--accent-secondary)";
      glow = "var(--accent-secondary-glow)";
      pulse = true;
    } else if (link === "down") {
      color = "var(--danger)";
    } else if (link === "disabled") {
      color = "var(--text-muted)";
    }
  } else if (status !== undefined) {
    switch (status) {
      case "online":
        color = "var(--success)";
        glow = "var(--success-soft)";
        pulse = true;
        break;
      case "offline":
        color = "var(--danger)";
        glow = "var(--danger-soft)";
        break;
      case "warning":
        color = "var(--warning)";
        glow = "var(--warning-soft)";
        break;
      case "maintenance":
        color = "var(--info)";
        glow = "var(--info-soft)";
        break;
      case "unknown":
      case "unmanaged":
        color = "var(--neutral)";
        break;
    }
  }

  const dim = size === "sm" ? 6 : 8;

  return (
    <span
      className={cn(
        "relative inline-block shrink-0 rounded-full",
        pulse && "animate-pulse-slow",
        className,
      )}
      style={{
        width: dim,
        height: dim,
        backgroundColor: color,
        boxShadow:
          glow === "transparent"
            ? `0 0 0 1px rgb(255 255 255 / 0.08) inset`
            : `0 0 0 ${size === "sm" ? 2 : 3}px ${glow}`,
      }}
      aria-hidden
    />
  );
}
