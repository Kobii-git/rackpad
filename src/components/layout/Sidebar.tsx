import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Building2,
  Server,
  Cable,
  Network,
  Boxes,
  Workflow,
  Search,
  ChevronDown,
  Shield,
  Wifi,
  Cpu,
  Activity,
  FileText,
  ScrollText,
  BookOpen,
  Route,
  UploadCloud,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { selectLab, useStore } from "@/lib/store";
import { useI18n } from "@/i18n";
import { APP_CHANNEL_LABEL, APP_IS_DEV, APP_VERSION_TAG } from "@/lib/version";

const baseNavItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/labs", icon: Building2, label: "Labs" },
  { to: "/racks", icon: Server, label: "Racks / Rooms" },
  { to: "/devices", icon: Boxes, label: "Devices" },
  { to: "/compute", icon: Cpu, label: "Compute" },
  { to: "/wifi", icon: Wifi, label: "WiFi" },
  { to: "/discovery", icon: Search, label: "Discovery" },
  { to: "/imports", icon: UploadCloud, label: "Imports" },
  { to: "/monitoring", icon: Activity, label: "Monitoring" },
  { to: "/ports", icon: Cable, label: "Ports" },
  { to: "/cables", icon: Workflow, label: "Cables" },
  { to: "/networks", icon: Network, label: "Networks" },
  { to: "/reports", icon: FileText, label: "Reports" },
  { to: "/audit-log", icon: ScrollText, label: "Audit" },
  { to: "/visualizer", icon: Route, label: "Visualizer" },
  { to: "/documentation", icon: BookOpen, label: "Docs" },
] as const;

interface SidebarProps {
  onOpenSearch?: () => void;
}

export function Sidebar({ onOpenSearch }: SidebarProps) {
  const { t } = useI18n();
  const [labMenuOpen, setLabMenuOpen] = useState(false);
  const [pendingLabId, setPendingLabId] = useState<string | null>(null);
  const labs = useStore((s) => s.labs);
  const lab = useStore((s) => s.lab);
  const currentUser = useStore((s) => s.currentUser);
  const authExpiresAt = useStore((s) => s.authExpiresAt);

  const navItems =
    currentUser?.role === "admin"
      ? ([
          ...baseNavItems,
          { to: "/admin", icon: Shield, label: "Admin" },
        ] as const)
      : baseNavItems;

  async function handleSelectLab(labId: string) {
    setPendingLabId(labId);
    try {
      await selectLab(labId);
      setLabMenuOpen(false);
    } finally {
      setPendingLabId(null);
    }
  }

  return (
    <aside className="relative flex h-full w-16 shrink-0 flex-col border-r border-[var(--border-default)] bg-[color-mix(in_srgb,var(--bg-shell)_94%,black_6%)] xl:w-60">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-[linear-gradient(180deg,transparent,var(--edge-highlight),transparent)] opacity-70" />
      <div className="flex items-center justify-center gap-3 px-2 pb-3 pt-4 xl:justify-start xl:px-4">
        <Logo />
        <div className="hidden min-w-0 xl:block">
          <div className="text-[15px] font-semibold tracking-normal text-[var(--text-primary)]">
            {t("Rackpad")}
          </div>
          <div className="text-[11px] text-[var(--text-muted)]">
            {t("Homelab inventory")}
          </div>
        </div>
        <div className="ml-auto hidden flex-col items-end gap-1 xl:flex">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {APP_VERSION_TAG}
          </span>
          {APP_CHANNEL_LABEL && (
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.16em]",
                APP_IS_DEV
                  ? "border-[var(--color-info)]/40 bg-[var(--color-info)]/10 text-[var(--color-info)]"
                  : "border-[var(--color-warn)]/35 bg-[var(--color-warn)]/10 text-[var(--color-warn)]",
              )}
            >
              {APP_CHANNEL_LABEL}
            </span>
          )}
        </div>
      </div>

      <div className="relative mx-2 mb-3 xl:mx-3">
        <button
          type="button"
          onClick={() => setLabMenuOpen((value) => !value)}
          className="rk-panel-inset flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left transition-[background-color,border-color,box-shadow] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] xl:justify-between xl:px-3"
          aria-label={t("{value1}: {name}", {
            value1: t("Lab"),
            name: lab.name,
          })}
        >
          <Building2 className="size-4 shrink-0 xl:hidden" />
          <div className="hidden min-w-0 flex-col leading-tight xl:flex">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("Lab")}
            </span>
            <span className="truncate text-sm font-medium text-[var(--text-primary)]">
              {lab.name}
            </span>
          </div>
          <ChevronDown
            className={cn(
              "hidden size-3.5 text-[var(--text-tertiary)] transition-transform xl:block",
              labMenuOpen ? "rotate-180" : "rotate-0",
            )}
          />
        </button>
        {labMenuOpen && (
          <div className="rk-panel absolute left-0 top-full z-50 mt-2 w-56 rounded-[var(--radius-md)] p-2 shadow-[var(--shadow-elev)] xl:static xl:w-auto">
            <div className="space-y-1">
              {labs.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void handleSelectLab(entry.id)}
                  disabled={pendingLabId === entry.id || entry.id === lab.id}
                  className={cn(
                    "flex w-full items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-xs transition-colors",
                    entry.id === lab.id
                      ? "bg-[var(--accent-primary-soft)] text-[var(--text-primary)] shadow-[0_0_0_1px_var(--accent-primary-border)_inset]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
                  )}
                >
                  <span className="min-w-0 truncate">{entry.name}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {pendingLabId === entry.id
                      ? "..."
                      : entry.id === lab.id
                        ? t("active")
                        : t("use")}
                  </span>
                </button>
              ))}
            </div>
            <Link
              to="/labs"
              onClick={() => setLabMenuOpen(false)}
              className="mt-2 flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[rgb(255_255_255_/_0.015)] px-2.5 py-2 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              <span>{t("Manage labs")}</span>
              <Building2 className="size-3.5" />
            </Link>
          </div>
        )}
      </div>

      <button
        onClick={onOpenSearch}
        className="mx-2 mb-3 flex w-[calc(100%-1rem)] items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgb(255_255_255_/_0.012)] px-2 py-2 text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)] xl:mx-3 xl:w-[calc(100%-1.5rem)] xl:justify-start xl:px-3"
        aria-label={t("Search...")}
      >
        <Search className="size-3.5" />
        <span className="hidden text-xs xl:inline">{t("Search...")}</span>
        <kbd className="ml-auto hidden rounded-[6px] border border-[var(--border-default)] bg-[var(--surface-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-tertiary)] xl:inline">
          Ctrl+K
        </kbd>
      </button>

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            title={t(item.label)}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-sm transition-[background-color,border-color,color,box-shadow] duration-150",
                isActive
                  ? "bg-[var(--accent-primary-soft)] text-[var(--text-primary)] shadow-[0_0_0_1px_var(--accent-primary-border)_inset]"
                  : "text-[var(--text-secondary)] hover:bg-[rgb(255_255_255_/_0.032)] hover:text-[var(--text-primary)]",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    "h-3.5 w-0.5 shrink-0 rounded-full transition-colors",
                    isActive ? "bg-[var(--accent-primary)]" : "bg-transparent",
                  )}
                />
                <item.icon className="size-4 shrink-0" />
                <span className="hidden xl:inline">{t(item.label)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {currentUser?.role === "admin" && (
        <div className="mx-2 mt-4 border-t border-[var(--border-subtle)] xl:mx-4" />
      )}

      <div className="mt-auto border-t border-[var(--border-subtle)] px-2 py-3 xl:px-4">
        {currentUser && (
          <div
            className="flex items-center gap-2.5"
            title={
              authExpiresAt
                ? t("Session expires {value1}", {
                    value1: new Date(authExpiresAt).toLocaleDateString(),
                  })
                : undefined
            }
          >
            <span className="size-1.5 shrink-0 rounded-full bg-[var(--success)] shadow-[0_0_0_2px_var(--success-soft)]" />
            <div className="hidden min-w-0 leading-tight xl:block">
              <div className="truncate text-[12px] text-[var(--text-secondary)]">
                {currentUser.displayName}
              </div>
              <div className="text-[11px] capitalize text-[var(--text-muted)]">
                {t(currentUser.role)}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden fill="none">
      {/* rack frame */}
      <rect
        x="5.5"
        y="4.5"
        width="21"
        height="23"
        rx="3"
        stroke="var(--color-accent)"
        strokeWidth="2"
      />
      {/* rack-mounted units */}
      <rect
        x="9"
        y="8.5"
        width="14"
        height="3.4"
        rx="1"
        fill="var(--color-accent)"
      />
      <rect
        x="9"
        y="14.3"
        width="14"
        height="3.4"
        rx="1"
        fill="var(--color-accent)"
        opacity="0.65"
      />
      <rect
        x="9"
        y="20.1"
        width="14"
        height="3.4"
        rx="1"
        fill="var(--color-accent)"
        opacity="0.4"
      />
    </svg>
  );
}
