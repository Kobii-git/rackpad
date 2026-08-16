import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/translations";
import { api } from "@/lib/api";
import type {
  SnmpCredential,
  SnmpSyncPolicy,
  SnmpSyncPreview,
  SnmpSyncProfile,
  SnmpSyncSchedule,
} from "@/lib/types";

function actionTone(action: string) {
  if (action === "create") return "ok" as const;
  if (action === "update") return "info" as const;
  if (action === "delete") return "warn" as const;
  return "neutral" as const;
}

const SYNC_ACTION_LABELS: Record<string, TranslationKey> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
};

export function SnmpSyncPanel({
  deviceId,
  labId,
  target,
  snmpCredentialId,
  credentials,
  disabled,
  isAdmin,
  onApplied,
}: {
  deviceId: string;
  labId: string;
  target?: string | null;
  snmpCredentialId?: string | null;
  credentials: SnmpCredential[];
  disabled?: boolean;
  isAdmin: boolean;
  onApplied: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<SnmpSyncProfile[]>([]);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [profileId, setProfileId] = useState("standard-l2-l3");
  const [policy, setPolicy] = useState<SnmpSyncPolicy>("merge");
  const [credentialId, setCredentialId] = useState(snmpCredentialId ?? "");
  const [preview, setPreview] = useState<SnmpSyncPreview | null>(null);
  const [allowDeletes, setAllowDeletes] = useState(false);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [schedule, setSchedule] = useState<SnmpSyncSchedule | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleMinutes, setScheduleMinutes] = useState("1440");
  const [scheduleLoading, setScheduleLoading] = useState(false);

  useEffect(() => {
    setCredentialId(snmpCredentialId ?? "");
  }, [snmpCredentialId]);

  useEffect(() => {
    let cancelled = false;
    setLoadingProfiles(true);
    void api
      .getSnmpSyncProfiles()
      .then((items) => {
        if (cancelled) return;
        setProfiles(items);
        setFeatureEnabled(true);
        setProfileId((current) =>
          items.length > 0 && !items.some((entry) => entry.id === current)
            ? items[0].id
            : current,
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setProfiles([]);
        setFeatureEnabled(false);
        setError(
          err instanceof Error
            ? err.message
            : t("SNMP inventory sync is unavailable."),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingProfiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void api
      .getSnmpSyncSchedules()
      .then((items) => {
        if (cancelled) return;
        const current = items.find(
          (entry) => entry.deviceId === deviceId && entry.labId === labId,
        );
        setSchedule(current ?? null);
        setScheduleEnabled(current?.enabled ?? false);
        setScheduleMinutes(String((current?.intervalMs ?? 86_400_000) / 60_000));
      })
      .catch(() => {
        if (!cancelled) setSchedule(null);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, labId]);

  const selectedProfile = useMemo(
    () => profiles.find((entry) => entry.id === profileId),
    [profileId, profiles],
  );

  const hasChanges = useMemo(() => {
    if (!preview) return false;
    const { summary } = preview;
    return (
      summary.vlanCreates +
        summary.vlanUpdates +
        summary.vlanDeletes +
        summary.subnetCreates +
        summary.subnetUpdates +
        summary.subnetDeletes >
      0
    );
  }, [preview]);

  async function handlePreview() {
    if (!target?.trim()) {
      setError(t("Set a management IP or SNMP target before previewing sync."));
      return;
    }
    setPreviewLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await api.previewSnmpSync({
        deviceId,
        profileId,
        policy,
        target: target.trim(),
        snmpCredentialId: credentialId || undefined,
      });
      setPreview(result);
      setAllowDeletes(false);
    } catch (err) {
      setPreview(null);
      setError(
        err instanceof Error ? err.message : t("SNMP sync preview failed."),
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setApplyLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await api.applySnmpSync({
        preview,
        policy,
        allowDeletes,
      });
      setMessage(
        t("Applied {vlanCount} VLAN(s) and {subnetCount} subnet(s).", {
          vlanCount: result.createdVlanIds.length,
          subnetCount: result.createdSubnetIds.length,
        }),
      );
      setPreview(null);
      await onApplied();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("SNMP sync apply failed."),
      );
    } finally {
      setApplyLoading(false);
    }
  }

  async function saveSchedule() {
    const intervalMinutes = Number(scheduleMinutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
      setError(t("Interval minutes"));
      return;
    }
    setScheduleLoading(true);
    setError("");
    try {
      const body = {
        profileId,
        policy,
        intervalMs: intervalMinutes * 60_000,
        enabled: scheduleEnabled,
      };
      const updated = schedule
        ? await api.updateSnmpSyncSchedule(schedule.id, body)
        : await api.createSnmpSyncSchedule({ deviceId, ...body });
      setSchedule(updated);
      setMessage(t("Save"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Save"));
    } finally {
      setScheduleLoading(false);
    }
  }

  async function deleteSchedule() {
    if (!schedule) return;
    setScheduleLoading(true);
    setError("");
    try {
      await api.deleteSnmpSyncSchedule(schedule.id);
      setSchedule(null);
      setScheduleEnabled(false);
      setScheduleMinutes("1440");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Delete"));
    } finally {
      setScheduleLoading(false);
    }
  }

  if (loadingProfiles) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-3 text-sm text-[var(--color-fg-subtle)]">
        {t("Loading SNMP sync profiles...")}
      </div>
    );
  }

  if (!featureEnabled) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-3 text-sm text-[var(--color-fg-subtle)]">
        {t(
          "SNMP inventory sync is disabled on this server. Set SNMP_INVENTORY_SYNC=1 to enable VLAN and subnet preview/apply.",
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-[var(--color-fg)]">
            {t("SNMP inventory sync")}
          </div>
          <div className="text-xs text-[var(--color-fg-subtle)]">
            {t(
              "Preview VLAN and subnet inventory from this device before applying changes to the lab.",
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || previewLoading || !target?.trim()}
          onClick={() => void handlePreview()}
        >
          <RefreshCcw className="size-3.5" />
          {previewLoading ? t("Previewing...") : t("Preview sync")}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="block text-xs">
          <span className="rk-field-label">{t("Profile")}</span>
          <select
            value={profileId}
            disabled={disabled}
            onChange={(event) => setProfileId(event.target.value)}
            className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2 text-sm"
          >
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <span className="rk-field-label">{t("Policy")}</span>
          <select
            value={policy}
            disabled={disabled}
            onChange={(event) =>
              setPolicy(event.target.value as SnmpSyncPolicy)
            }
            className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2 text-sm"
          >
            <option value="merge">{t("Merge (add missing only)")}</option>
            <option value="mirror">
              {t("Mirror (create, update, delete)")}
            </option>
          </select>
        </label>
        <label className="block text-xs">
          <span className="rk-field-label">{t("Credential")}</span>
          <select
            value={credentialId}
            disabled={disabled}
            onChange={(event) => setCredentialId(event.target.value)}
            className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2 text-sm"
          >
            <option value="">{t("Inline / device default")}</option>
            {credentials.map((credential) => (
              <option key={credential.id} value={credential.id}>
                {credential.name} ({credential.version})
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedProfile ? (
        <div className="text-xs text-[var(--color-fg-subtle)]">
          {t("{description} Collects: {collects}.", {
            description: selectedProfile.description,
            collects: selectedProfile.collects.join(", "),
          })}
        </div>
      ) : null}

      {isAdmin ? (
        <div className="space-y-2 border-t border-[var(--color-line)] pt-3">
          <div className="text-xs font-medium text-[var(--color-fg)]">
            {t("Scheduled scans")}
          </div>
          <div className="grid items-end gap-3 sm:grid-cols-[auto_minmax(8rem,1fr)_auto_auto]">
            <label className="flex h-8 items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                disabled={disabled || scheduleLoading}
                onChange={(event) => setScheduleEnabled(event.target.checked)}
              />
              {t("Enabled")}
            </label>
            <label className="block text-xs">
              <span className="rk-field-label">{t("Interval minutes")}</span>
              <Input
                type="number"
                min="1"
                max="525600"
                value={scheduleMinutes}
                disabled={disabled || scheduleLoading}
                onChange={(event) => setScheduleMinutes(event.target.value)}
              />
            </label>
            <Button
              size="sm"
              disabled={disabled || scheduleLoading}
              onClick={() => void saveSchedule()}
            >
              {t("Save")}
            </Button>
            {schedule ? (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || scheduleLoading}
                onClick={() => void deleteSchedule()}
              >
                {t("Delete")}
              </Button>
            ) : null}
          </div>
          {schedule ? (
            <div className="text-xs text-[var(--color-fg-subtle)]">
              {t("Last run")}: {schedule.lastRunAt ?? t("Never")}
              {schedule.lastResult
                ? t("· {value1}", {
                    value1:
                      schedule.lastResult === "success"
                        ? t("Success")
                        : t("Error"),
                  })
                : ""}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="text-sm text-[var(--color-danger)]">{error}</div>
      ) : null}
      {message ? (
        <div className="text-sm text-[var(--accent-secondary)]">{message}</div>
      ) : null}

      {preview ? (
        <div className="space-y-3 border-t border-[var(--color-line)] pt-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="info">{preview.target}</Badge>
            <Badge tone="neutral">{preview.policy}</Badge>
            <span className="text-[var(--color-fg-subtle)]">
              {t("+{vlanCreates} VLAN / +{subnetCreates} subnet", {
                vlanCreates: preview.summary.vlanCreates,
                subnetCreates: preview.summary.subnetCreates,
              })}
            </span>
            {preview.summary.vlanUpdates + preview.summary.subnetUpdates > 0 ? (
              <span className="text-[var(--color-fg-subtle)]">
                {t("{count} update(s)", {
                  count:
                    preview.summary.vlanUpdates + preview.summary.subnetUpdates,
                })}
              </span>
            ) : null}
            {preview.summary.vlanDeletes + preview.summary.subnetDeletes > 0 ? (
              <span className="text-[var(--color-warning)]">
                {t("{count} delete(s) previewed", {
                  count:
                    preview.summary.vlanDeletes + preview.summary.subnetDeletes,
                })}
              </span>
            ) : null}
          </div>

          {preview.warnings.map((warning) => (
            <div key={warning} className="text-xs text-[var(--color-warning)]">
              {warning}
            </div>
          ))}

          {preview.vlans.length > 0 ? (
            <DiffSection
              title={t("VLANs")}
              rows={preview.vlans.map((entry) => ({
                key: String(entry.vlanNumber),
                label: t("VLAN {number}", { number: entry.vlanNumber }),
                detail: entry.name,
                action: entry.action,
                note:
                  entry.changes?.join("; ") ?? entry.blockedReason ?? undefined,
              }))}
            />
          ) : null}

          {preview.subnets.length > 0 ? (
            <DiffSection
              title={t("Subnets")}
              rows={preview.subnets.map((entry) => ({
                key: entry.cidr,
                label: entry.cidr,
                detail: entry.name,
                action: entry.action,
                note:
                  entry.changes?.join("; ") ?? entry.blockedReason ?? undefined,
              }))}
            />
          ) : null}

          {!hasChanges ? (
            <div className="text-sm text-[var(--color-fg-subtle)]">
              {t(
                "Rackpad already matches the SNMP inventory for this profile.",
              )}
            </div>
          ) : null}

          {preview.dhcp.message ? (
            <div className="text-xs text-[var(--color-fg-subtle)]">
              {preview.dhcp.message}
            </div>
          ) : null}

          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-3">
              {policy === "mirror" &&
              preview.summary.vlanDeletes + preview.summary.subnetDeletes >
                0 ? (
                <label className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
                  <input
                    type="checkbox"
                    checked={allowDeletes}
                    onChange={(event) => setAllowDeletes(event.target.checked)}
                  />
                  {t("Allow deletes for unreferenced VLANs/subnets")}
                </label>
              ) : null}
              <Button
                size="sm"
                disabled={disabled || applyLoading || !hasChanges}
                onClick={() => void handleApply()}
              >
                <ShieldCheck className="size-3.5" />
                {applyLoading ? t("Applying...") : t("Apply preview")}
              </Button>
            </div>
          ) : (
            <div className="text-xs text-[var(--color-fg-subtle)]">
              {t(
                "Administrator access is required to apply SNMP sync changes.",
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DiffSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    key: string;
    label: string;
    detail: string;
    action: string;
    note?: string;
  }>;
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {title}
      </div>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {rows.map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between gap-3 rounded border border-[var(--color-line)] px-2 py-1 text-xs"
          >
            <div className="min-w-0">
              <div className="truncate font-mono text-[var(--color-fg)]">
                {row.label}
              </div>
              <div className="truncate text-[var(--color-fg-subtle)]">
                {row.detail}
                {row.note ? t("· {note}", { note: row.note }) : ""}
              </div>
            </div>
            <Badge tone={actionTone(row.action)}>
              {SYNC_ACTION_LABELS[row.action]
                ? t(SYNC_ACTION_LABELS[row.action])
                : row.action}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
