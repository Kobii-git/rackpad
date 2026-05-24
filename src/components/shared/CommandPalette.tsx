import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Search,
  Server,
  Hash,
  Network,
  LayoutDashboard,
  Cable,
  Workflow,
  Boxes,
  X,
  ChevronRight,
  Activity,
  BookOpen,
  FileText,
  Route,
  UploadCloud,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatDeviceAddress } from "@/lib/network-labels";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";

interface SearchResult {
  id: string;
  group: "Pages" | "Devices" | "VLANs" | "IPs";
  title: string;
  subtitle?: string;
  href: string;
  Icon: LucideIcon;
  accent?: string;
}

const PAGES: SearchResult[] = [
  {
    id: "p-dash",
    group: "Pages",
    title: "Dashboard",
    subtitle: "Overview",
    href: "/",
    Icon: LayoutDashboard,
  },
  {
    id: "p-racks",
    group: "Pages",
    title: "Racks",
    subtitle: "Physical layout",
    href: "/racks",
    Icon: Server,
  },
  {
    id: "p-devices",
    group: "Pages",
    title: "Devices",
    subtitle: "Inventory",
    href: "/devices",
    Icon: Boxes,
  },
  {
    id: "p-monitoring",
    group: "Pages",
    title: "Monitoring",
    subtitle: "Health overview",
    href: "/monitoring",
    Icon: Activity,
  },
  {
    id: "p-imports",
    group: "Pages",
    title: "Imports",
    subtitle: "Hyper-V and Proxmox import",
    href: "/imports",
    Icon: UploadCloud,
  },
  {
    id: "p-ports",
    group: "Pages",
    title: "Ports",
    subtitle: "Port management",
    href: "/ports",
    Icon: Cable,
  },
  {
    id: "p-cables",
    group: "Pages",
    title: "Cables",
    subtitle: "Connections",
    href: "/cables",
    Icon: Workflow,
  },
  {
    id: "p-visualizer",
    group: "Pages",
    title: "Visualizer",
    subtitle: "Rack cable map",
    href: "/visualizer",
    Icon: Route,
  },
  {
    id: "p-vlans",
    group: "Pages",
    title: "VLANs",
    subtitle: "Layer 2 segmentation",
    href: "/vlans",
    Icon: Hash,
  },
  {
    id: "p-ipam",
    group: "Pages",
    title: "IPAM",
    subtitle: "Address management",
    href: "/ipam",
    Icon: Network,
  },
  {
    id: "p-reports",
    group: "Pages",
    title: "Reports",
    subtitle: "Export and print",
    href: "/reports",
    Icon: FileText,
  },
  {
    id: "p-documentation",
    group: "Pages",
    title: "Documentation",
    subtitle: "Markdown notes",
    href: "/documentation",
    Icon: BookOpen,
  },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const devices = useStore((s) => s.devices);
  const documentationPages = useStore((s) => s.documentationPages);
  const vlans = useStore((s) => s.vlans);
  const ipAssignments = useStore((s) => s.ipAssignments);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.toLowerCase().trim();
    if (!q) return PAGES;

    const out: SearchResult[] = [];

    for (const device of devices) {
      const haystack = [
        device.hostname,
        device.displayName,
        device.manufacturer,
        device.model,
        device.managementIp,
        device.macAddress,
        ...(device.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (haystack.includes(q)) {
        out.push({
          id: device.id,
          group: "Devices",
          title: device.hostname,
          subtitle: [
            device.deviceType.replace("_", " "),
            device.manufacturer,
            device.model,
            formatDeviceAddress(device),
          ]
            .filter(Boolean)
            .join(" · "),
          href: `/devices/${device.id}`,
          Icon: Server,
        });
      }
    }

    for (const vlan of vlans) {
      const haystack = [String(vlan.vlanId), vlan.name, vlan.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (haystack.includes(q)) {
        out.push({
          id: vlan.id,
          group: "VLANs",
          title: `VLAN ${vlan.vlanId} · ${vlan.name}`,
          subtitle: vlan.description,
          href: "/vlans",
          Icon: Hash,
          accent: vlan.color,
        });
      }
    }

    for (const assignment of ipAssignments) {
      const haystack = [
        assignment.ipAddress,
        assignment.hostname,
        assignment.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (haystack.includes(q)) {
        out.push({
          id: assignment.id,
          group: "IPs",
          title: assignment.ipAddress,
          subtitle: [assignment.hostname, assignment.assignmentType]
            .filter(Boolean)
            .join(" · "),
          href: "/ipam",
          Icon: Network,
        });
      }
    }

    for (const page of documentationPages) {
      const haystack = [page.title, page.content]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (haystack.includes(q)) {
        out.push({
          id: `doc-${page.id}`,
          group: "Pages",
          title: page.title,
          subtitle: "Documentation",
          href: `/documentation?pageId=${page.id}`,
          Icon: BookOpen,
        });
      }
    }

    for (const page of PAGES) {
      if (page.title.toLowerCase().includes(q)) out.push(page);
    }

    return out;
  }, [devices, documentationPages, ipAssignments, query, vlans]);

  const grouped = useMemo(() => {
    const groups: {
      label: string;
      items: { result: SearchResult; flatIdx: number }[];
    }[] = [];
    const seen = new Set<string>();
    let flatIdx = 0;

    for (const result of results) {
      if (!seen.has(result.group)) {
        seen.add(result.group);
        groups.push({ label: result.group, items: [] });
      }
      groups[groups.length - 1].items.push({ result, flatIdx });
      flatIdx += 1;
    }

    return groups;
  }, [results]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [results.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector(
      '[data-active="true"]',
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function select(result: SearchResult) {
    navigate(result.href);
    onClose();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        if (results[activeIdx]) select(results[activeIdx]);
        break;
      case "Escape":
        onClose();
        break;
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="palette-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
          />

          <motion.div
            key="palette-panel"
            initial={{ opacity: 0, scale: 0.97, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -10 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-[14%] z-50 w-full max-w-[560px] -translate-x-1/2 px-4"
          >
            <div
              className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line-strong)]"
              style={{
                background: "var(--color-bg-2)",
                boxShadow:
                  "0 24px 64px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.03) inset",
              }}
            >
              <div className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-3">
                <Search className="size-4 shrink-0 text-[var(--color-fg-subtle)]" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search devices, VLANs, IPs, pages..."
                  className="flex-1 bg-transparent text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-faint)] focus:outline-none"
                />
                {query ? (
                  <button
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    className="text-[var(--color-fg-faint)] transition-colors hover:text-[var(--color-fg-subtle)]"
                    tabIndex={-1}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
                <kbd className="rounded-[var(--radius-xs)] border border-[var(--color-line-strong)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--color-fg-faint)]">
                  esc
                </kbd>
              </div>

              <div ref={listRef} className="max-h-[340px] overflow-y-auto">
                {results.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-[var(--color-fg-subtle)]">
                    No results for{" "}
                    <span className="text-[var(--color-fg)]">"{query}"</span>
                  </div>
                ) : (
                  <div className="py-1.5">
                    {grouped.map((group) => (
                      <div key={group.label}>
                        <div className="flex items-center gap-2 px-4 pb-1 pt-2">
                          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-fg-faint)]">
                            {group.label}
                          </span>
                          <span className="flex-1 border-t border-[var(--color-line)]" />
                        </div>

                        {group.items.map(({ result, flatIdx }) => {
                          const isActive = flatIdx === activeIdx;
                          return (
                            <button
                              key={result.id}
                              data-active={isActive}
                              onClick={() => select(result)}
                              onMouseEnter={() => setActiveIdx(flatIdx)}
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                                isActive
                                  ? "bg-[var(--color-surface)]"
                                  : "hover:bg-[var(--color-surface)]/60",
                              )}
                            >
                              <div
                                className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-line)]"
                                style={{
                                  background: result.accent
                                    ? `${result.accent}18`
                                    : "var(--color-surface)",
                                }}
                              >
                                <result.Icon
                                  className="size-3.5"
                                  style={{
                                    color:
                                      result.accent ?? "var(--color-fg-subtle)",
                                  }}
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div
                                  className="truncate text-sm"
                                  style={{
                                    color: isActive
                                      ? "var(--color-fg)"
                                      : "var(--color-fg-muted)",
                                  }}
                                >
                                  {result.title}
                                </div>
                                {result.subtitle && (
                                  <div className="truncate font-mono text-[10px] text-[var(--color-fg-faint)]">
                                    {result.subtitle}
                                  </div>
                                )}
                              </div>

                              {isActive && (
                                <ChevronRight className="size-3.5 shrink-0 text-[var(--color-accent)]" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 border-t border-[var(--color-line)] px-4 py-2">
                <KbdHint keys="↑↓" label="navigate" />
                <KbdHint keys="↵" label="open" />
                <KbdHint keys="esc" label="close" />
                <span className="ml-auto font-mono text-[10px] text-[var(--color-fg-faint)]">
                  {results.length} result{results.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function KbdHint({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <kbd className="rounded-[var(--radius-xs)] border border-[var(--color-line-strong)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--color-fg-faint)]">
        {keys}
      </kbd>
      <span className="text-[10px] text-[var(--color-fg-faint)]">{label}</span>
    </div>
  );
}
