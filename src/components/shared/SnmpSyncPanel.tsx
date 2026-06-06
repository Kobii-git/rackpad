import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import type {
  SnmpCredential,
  SnmpSyncPolicy,
  SnmpSyncPreview,
  SnmpSyncProfile,
} from "@/lib/types";

function actionTone(action: string) {
  if (action === "create") return "ok" as const;
  if (action === "update") return "info" as const;
  if (action === "delete") return "warn" as const;
  return "neutral" as const;
}

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
        if (items.length > 0 && !items.some((entry) => entry.id === profileId)) {
          setProfileId(items[0].id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setProfiles([]);
        setFeatureEnabled(false);
        setError(
          err instanceof Error
            ? err.message
            : "SNMP inventory sync is unavailable.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingProfiles(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setError(
        t("Set a management IP or SNMP target before previewing sync."),
      );
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
      setError(err instanceof Error ? err.message : "SNMP sync preview failed.");
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
        `Applied ${result.createdVlanIds.length} VLAN(s) and ${result.createdSubnetIds.length} subnet(s).`,
      );
      setPreview(null);
      await onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "SNMP sync apply failed.");
    } finally {
      setApplyLoading(false);
    }
  }

  if (loadingProfiles) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-3 text-sm text-[var(--color-fg-subtle)]">
        Loading SNMP sync profiles...
      </div>
    );
  }

  if (!featureEnabled) {
    return (
      <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-3 text-sm text-[var(--color-fg-subtle)]">
        SNMP inventory sync is disabled on this server. Set{" "}
        <code className="font-mono text-[11px]">SNMP_INVENTORY_SYNC=1</code> to
        enable VLAN and subnet preview/apply.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-[var(--color-fg)]">
            SNMP inventory sync
          </div>
          <div className="text-xs text-[var(--color-fg-subtle)]">
            Preview VLAN and subnet inventory from this device before applying
            changes to the lab.
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
          <span className="rk-field-label">Profile</span>
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
          <span className="rk-field-label">Policy</span>
          <select
            value={policy}
            disabled={disabled}
            onChange={(event) =>
              setPolicy(event.target.value as SnmpSyncPolicy)
            }
            className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2 text-sm"
          >
            <option value="merge">Merge (add missing only)</option>
            <option value="mirror">Mirror (create, update, delete)</option>
          </select>
        </label>
        <label className="block text-xs">
          <span className="rk-field-label">Credential</span>
          <select
            value={credentialId}
            disabled={disabled}
            onChange={(event) => setCredentialId(event.target.value)}
            className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2 text-sm"
          >
            <option value="">Inline / device default</option>
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
          {selectedProfile.description} Collects:{" "}
          {selectedProfile.collects.join(", ")}.
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
              +{preview.summary.vlanCreates} VLAN / +
              {preview.summary.subnetCreates} subnet
            </span>
            {preview.summary.vlanUpdates + preview.summary.subnetUpdates > 0 ? (
              <span className="text-[var(--color-fg-subtle)]">
                {preview.summary.vlanUpdates + preview.summary.subnetUpdates}{" "}
                update(s)
              </span>
            ) : null}
            {preview.summary.vlanDeletes + preview.summary.subnetDeletes > 0 ? (
              <span className="text-[var(--color-warning)]">
                {preview.summary.vlanDeletes + preview.summary.subnetDeletes}{" "}
                delete(s) previewed
              </span>
            ) : null}
          </div>

          {preview.warnings.map((warning) => (
            <div
              key={warning}
              className="text-xs text-[var(--color-warning)]"
            >
              {warning}
            </div>
          ))}

          {preview.vlans.length > 0 ? (
            <DiffSection title={t("VLANs")} rows={preview.vlans.map((entry) => ({
              key: String(entry.vlanNumber),
              label: `VLAN ${entry.vlanNumber}`,
              detail: entry.name,
              action: entry.action,
              note: entry.changes?.join("; ") ?? entry.blockedReason ?? undefined,
            }))} />
          ) : null}

          {preview.subnets.length > 0 ? (
            <DiffSection
              title={t("Subnets")}
              rows={preview.subnets.map((entry) => ({
                key: entry.cidr,
                label: entry.cidr,
                detail: entry.name,
                action: entry.action,
                note: entry.changes?.join("; ") ?? entry.blockedReason ?? undefined,
              }))}
            />
          ) : null}

          {!hasChanges ? (
            <div className="text-sm text-[var(--color-fg-subtle)]">
              Rackpad already matches the SNMP inventory for this profile.
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
              preview.summary.vlanDeletes + preview.summary.subnetDeletes > 0 ? (
                <label className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
                  <input
                    type="checkbox"
                    checked={allowDeletes}
                    onChange={(event) => setAllowDeletes(event.target.checked)}
                  />
                  Allow deletes for unreferenced VLANs/subnets
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
              Administrator access is required to apply SNMP sync changes.
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
                {row.note ? ` · ${row.note}` : ""}
              </div>
            </div>
            <Badge tone={actionTone(row.action)}>{row.action}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
