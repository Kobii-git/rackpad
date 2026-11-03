import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Search } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/shared/EmptyState";
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
import { Button } from "@/components/ui/Button";
import { Mono } from "@/components/shared/Mono";
import { useStore } from "@/lib/store";
import { relativeTime } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { api, getAuthToken } from "@/lib/api";
import type { AuditEntry, Lab } from "@/lib/types";

const PAGE_SIZE = 100;

export default function AuditLogView() {
  const lab = useStore((s) => s.lab);
  const user = useStore((s) => s.currentUser);
  return <AuditHistory key={`${lab.id}:${user?.id}`} lab={lab} />;
}

function AuditHistory({ lab }: { lab: Lab }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [reload, setReload] = useState(0);
  const requestId = useRef(0);
  const pending = useRef(false);
  const normalizedQuery = query.trim();
  const normalizedAction = action.trim();

  useEffect(() => {
    const id = ++requestId.current;
    const token = getAuthToken();
    pending.current = false;
    setAuditLog([]);
    setLoading(true);
    setFailed(false);
    setHasMore(false);
    const timer = window.setTimeout(() => {
      void api
        .getAuditLog({
          labId: lab.id,
          limit: PAGE_SIZE,
          search: normalizedQuery || undefined,
          action: normalizedAction || undefined,
        })
        .then((entries) => {
          if (id !== requestId.current || token !== getAuthToken()) return;
          setAuditLog(entries);
          setHasMore(entries.length === PAGE_SIZE);
          setLoading(false);
        })
        .catch(() => {
          if (id !== requestId.current || token !== getAuthToken()) return;
          setFailed(true);
          setLoading(false);
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      requestId.current = id + 1;
    };
  }, [lab.id, normalizedQuery, normalizedAction, reload]);

  async function loadMore() {
    const last = auditLog.at(-1);
    if (!last || pending.current || loading) return;
    pending.current = true;
    setLoading(true);
    setFailed(false);
    const id = requestId.current;
    const token = getAuthToken();
    try {
      const entries = await api.getAuditLog({
        labId: lab.id,
        limit: PAGE_SIZE,
        search: normalizedQuery || undefined,
        action: normalizedAction || undefined,
        beforeTs: last.ts,
        beforeId: last.id,
      });
      if (id !== requestId.current || token !== getAuthToken()) return;
      setAuditLog((previous) => [...previous, ...entries]);
      setHasMore(entries.length === PAGE_SIZE);
    } catch {
      if (id === requestId.current && token === getAuthToken()) setFailed(true);
    } finally {
      if (id === requestId.current && token === getAuthToken()) {
        pending.current = false;
        setLoading(false);
      }
    }
  }

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
            {auditLog.length} {t("loaded entries")}
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <AuditStat label={t("Entries")} value={auditLog.length} />
          <AuditStat label={t("Devices")} value={actionCounts.device ?? 0} />
          <AuditStat label={t("Ports")} value={actionCounts.port ?? 0} />
          <AuditStat
            label={t("Users")}
            value={new Set(auditLog.map((entry) => entry.user)).size}
          />
        </div>

        <Card>
          <CardHeader className="flex-col xl:flex-row xl:items-center">
            <CardTitle className="shrink-0">
              <CardLabel>{t("Activity")}</CardLabel>
              <CardHeading>{t("Recent audit entries")}</CardHeading>
            </CardTitle>
            <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto">
              <label className="flex items-center gap-2 text-xs">
                {t("Action")}
                <Input
                  value={action}
                  onChange={(event) => setAction(event.target.value)}
                  placeholder={t("All")}
                  maxLength={120}
                  className="w-40"
                />
              </label>
              <Button size="sm" onClick={() => setReload((value) => value + 1)}>
                {t("Refresh")}
              </Button>
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Search action, user, entity...")}
                  aria-label={t("Search action, user, entity...")}
                  maxLength={500}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <div
              tabIndex={0}
              aria-label={t("Recent audit entries")}
              className="rk-table-shell max-h-[calc(100vh-20rem)] overflow-y-auto"
            >
              <table className="rk-table min-w-[920px]">
                <thead>
                  <tr>
                    <th>{t("Time")}</th>
                    <th>{t("Action")}</th>
                    <th>{t("User")}</th>
                    <th>{t("Entity")}</th>
                    <th>{t("Summary")}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((entry) => (
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
              {!loading && !failed && auditLog.length === 0 && (
                <EmptyState
                  icon={Search}
                  className="m-4"
                  title={t("No matching audit entries")}
                  description={t(
                    "Broaden the search to see more of the loaded activity log.",
                  )}
                />
              )}
            </div>
            <div className="flex items-center gap-3 p-4" aria-live="polite">
              {loading && <span>{t("Loading...")}</span>}
              {failed && <span role="alert">{t("Couldn't load data")}</span>}
              {failed && auditLog.length === 0 && (
                <Button
                  size="sm"
                  onClick={() => setReload((value) => value + 1)}
                >
                  {t("Retry")}
                </Button>
              )}
              {hasMore && (
                <Button
                  size="sm"
                  disabled={loading}
                  onClick={() => void loadMore()}
                >
                  {t("Load more")}
                </Button>
              )}
            </div>
          </CardBody>
        </Card>

        <div className="mt-4 text-xs text-[var(--text-tertiary)]">
          {t(
            "Showing the latest loaded audit history for this lab. Device-specific activity is also available from each device page.",
          )}
        </div>
      </div>
    </>
  );
}

function AuditStat({ label, value }: { label: string; value: number }) {
  return (
    <Card role="group" aria-label={label}>
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
