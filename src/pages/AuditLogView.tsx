import { useMemo, useState } from "react";
import { Activity, Search } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/shared/Mono";
import { useStore } from "@/lib/store";
import { relativeTime } from "@/lib/utils";
import { useI18n } from "@/i18n";

export default function AuditLogView() {
  const { t } = useI18n();
  const lab = useStore((s) => s.lab);
  const auditLog = useStore((s) => s.auditLog);
  const [query, setQuery] = useState("");

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return auditLog;
    return auditLog.filter((entry) =>
      [
        entry.summary,
        entry.action,
        entry.user,
        entry.entityType,
        entry.entityId,
        entry.ts,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [auditLog, query]);

  const actionCounts = useMemo(() => {
    return auditLog.reduce<Record<string, number>>((acc, entry) => {
      const group = entry.action.split(".")[0] || "other";
      acc[group] = (acc[group] ?? 0) + 1;
      return acc;
    }, {});
  }, [auditLog]);

  return (
    <>
      <TopBar
        subtitle={lab.name}
        title={t("Audit log")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {auditLog.length} loaded entries
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <AuditStat label="Entries" value={auditLog.length} />
          <AuditStat label={t("Devices")} value={actionCounts.device ?? 0} />
          <AuditStat label={t("Ports")} value={actionCounts.port ?? 0} />
          <AuditStat label={t("Users")} value={actionCounts.user ?? 0} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <CardLabel>Activity</CardLabel>
              <CardHeading>Recent audit entries</CardHeading>
            </CardTitle>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search action, user, entity..."
                className="h-8 pl-8 text-xs"
              />
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <div className="rk-table-shell">
              <table className="rk-table min-w-[920px]">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>User</th>
                    <th>Entity</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <div className="space-y-0.5">
                          <Mono className="text-[var(--text-secondary)]">
                            {relativeTime(entry.ts)}
                          </Mono>
                          <div className="font-mono text-[10px] text-[var(--text-muted)]">
                            {new Date(entry.ts).toLocaleString()}
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge tone={actionTone(entry.action)}>
                          {entry.action}
                        </Badge>
                      </td>
                      <td>
                        <Mono className="text-[var(--text-secondary)]">
                          {entry.user}
                        </Mono>
                      </td>
                      <td>
                        <div className="space-y-0.5">
                          <div className="text-xs text-[var(--text-primary)]">
                            {entry.entityType}
                          </div>
                          <Mono className="text-[10px] text-[var(--text-tertiary)]">
                            {entry.entityId}
                          </Mono>
                        </div>
                      </td>
                      <td className="text-sm text-[var(--text-secondary)]">
                        {entry.summary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredEntries.length === 0 && (
                <div className="rk-empty m-4">
                  <div className="rk-empty-title">No matching audit entries</div>
                  <div className="rk-empty-copy">
                    Broaden the search to see more of the loaded activity log.
                  </div>
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <div className="mt-4 text-xs text-[var(--text-tertiary)]">
          Showing the latest loaded audit history for this lab. Device-specific
          activity is also available from each device page.
        </div>
      </div>
    </>
  );
}

function AuditStat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardBody className="flex items-center justify-between gap-3 p-4">
        <div>
          <div className="rk-kicker">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
            {value}
          </div>
        </div>
        <div className="grid size-10 place-items-center rounded-[var(--radius-md)] border border-[var(--accent-secondary-border)] bg-[var(--accent-secondary-soft)] text-[var(--accent-secondary)]">
          <Activity className="size-4" />
        </div>
      </CardBody>
    </Card>
  );
}

function actionTone(action: string) {
  if (action.startsWith("device.")) return "accent" as const;
  if (action.startsWith("port.") || action.startsWith("cable.")) {
    return "cyan" as const;
  }
  if (action.startsWith("user.") || action.startsWith("auth.")) {
    return "info" as const;
  }
  if (action.startsWith("discovery.")) return "warn" as const;
  if (action.startsWith("alert.")) return "err" as const;
  return "neutral" as const;
}
