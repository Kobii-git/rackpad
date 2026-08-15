import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  DownloadCloud,
  Pencil,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/translations";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/shared/Mono";
import { IntegrationIcon } from "@/components/import/IntegrationIcons";
import { api } from "@/lib/api";
import type {
  IntegrationAuthKind,
  IntegrationConnection,
  IntegrationDevicePreview,
  IntegrationInventoryResponse,
  IntegrationProvider,
  IntegrationProviderInfo,
  ProxmoxIntegrationNode,
  SnmpSyncPolicy,
} from "@/lib/types";
import { canEditInventory, isAdmin, loadAll, useStore } from "@/lib/store";

interface ConnectionForm {
  provider: IntegrationProvider;
  name: string;
  baseUrl: string;
  authKind: IntegrationAuthKind;
  authId: string;
  authSecret: string;
  siteRef: string;
  verifyTls: boolean;
  syncVlans: boolean;
  syncSubnets: boolean;
  syncDhcp: boolean;
}

const EMPTY_FORM: ConnectionForm = {
  provider: "proxmox",
  name: "",
  baseUrl: "",
  authKind: "api-token",
  authId: "",
  authSecret: "",
  siteRef: "",
  verifyTls: true,
  syncVlans: true,
  syncSubnets: true,
  syncDhcp: true,
};

const BASE_URL_PLACEHOLDERS: Record<IntegrationProvider, string> = {
  proxmox: "https://pve.example.internal:8006",
  unifi: "https://unifi.example.internal",
  omada: "https://omada.example.internal:8043",
  opnsense: "https://firewall.example.internal",
  dockhand: "http://dockhand.example.internal:3000",
};

const AUTH_ID_LABELS: Record<IntegrationAuthKind, TranslationKey | null> = {
  "api-token": "API token ID (user@realm!token)",
  "api-key": null,
  "username-password": "Username",
  "client-credentials": "Client ID",
  "key-secret": "API key",
};

const AUTH_SECRET_LABELS: Record<IntegrationAuthKind, TranslationKey> = {
  "api-token": "API token secret",
  "api-key": "API key",
  "username-password": "Password",
  "client-credentials": "Client secret",
  "key-secret": "API secret",
};

const AUTH_KIND_LABELS: Record<IntegrationAuthKind, TranslationKey> = {
  "api-token": "API token",
  "api-key": "API key",
  "username-password": "Username / password",
  "client-credentials": "Client credentials",
  "key-secret": "Key / secret",
};

const DEVICE_KIND_LABELS: Record<
  IntegrationDevicePreview["kind"],
  TranslationKey
> = {
  host: "Host",
  vm: "VM",
  container: "Container",
  switch: "Switch",
  gateway: "Gateway",
  "access-point": "Access point",
  firewall: "Firewall",
  bridge: "Bridge",
  interface: "Interface",
  other: "Other",
};

function statusTone(status: IntegrationConnection["lastStatus"]) {
  if (status === "ok") return "ok" as const;
  if (status === "error") return "err" as const;
  return "neutral" as const;
}

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
  unchanged: "Unchanged",
};

export function IntegrationsPanel({
  onStageProxmoxPayload,
}: {
  onStageProxmoxPayload?: (payload: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const canEdit = canEditInventory(currentUser);
  const admin = isAdmin(currentUser);

  const [providers, setProviders] = useState<IntegrationProviderInfo[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [form, setForm] = useState<ConnectionForm>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pull, setPull] = useState<
    (IntegrationInventoryResponse & { connectionId: string }) | null
  >(null);
  const [policy, setPolicy] = useState<SnmpSyncPolicy>("merge");
  const [allowDeletes, setAllowDeletes] = useState(false);
  const [applying, setApplying] = useState(false);
  const [proxmoxNodes, setProxmoxNodes] = useState<
    Record<string, ProxmoxIntegrationNode[]>
  >({});
  const [proxmoxNodeChoice, setProxmoxNodeChoice] = useState<
    Record<string, string>
  >({});

  const providerById = useMemo(
    () =>
      providers.reduce<Record<string, IntegrationProviderInfo>>(
        (acc, provider) => {
          acc[provider.id] = provider;
          return acc;
        },
        {},
      ),
    [providers],
  );

  async function loadConnections() {
    try {
      setConnections(await api.getIntegrationConnections({ labId: lab.id }));
    } catch {
      setConnections([]);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        setProviders(await api.getIntegrationProviders());
      } catch {
        setProviders([]);
      }
    })();
  }, []);

  useEffect(() => {
    setPull(null);
    void loadConnections();
  }, [lab.id]);

  function resetMessages() {
    setError("");
    setSuccess("");
  }

  function openCreateForm(provider: IntegrationProvider) {
    const info = providerById[provider];
    setForm({
      ...EMPTY_FORM,
      provider,
      authKind: info?.defaultAuthKind ?? EMPTY_FORM.authKind,
    });
    setEditingId("");
    setFormOpen(true);
    resetMessages();
  }

  function openEditForm(connection: IntegrationConnection) {
    setForm({
      provider: connection.provider,
      name: connection.name,
      baseUrl: connection.baseUrl,
      authKind: connection.authKind,
      authId: connection.authId ?? "",
      authSecret: "",
      siteRef: connection.siteRef ?? "",
      verifyTls: connection.verifyTls,
      syncVlans: connection.syncVlans,
      syncSubnets: connection.syncSubnets,
      syncDhcp: connection.syncDhcp,
    });
    setEditingId(connection.id);
    setFormOpen(true);
    resetMessages();
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId("");
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    setSaving(true);
    resetMessages();
    try {
      if (editingId) {
        await api.updateIntegrationConnection(editingId, {
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          authKind: form.authKind,
          authId: form.authId.trim() || null,
          ...(form.authSecret.trim()
            ? { authSecret: form.authSecret.trim() }
            : {}),
          siteRef: form.siteRef.trim() || null,
          verifyTls: form.verifyTls,
          syncVlans: form.syncVlans,
          syncSubnets: form.syncSubnets,
          syncDhcp: form.syncDhcp,
        });
        setSuccess(t("Integration connection updated."));
      } else {
        await api.createIntegrationConnection({
          labId: lab.id,
          provider: form.provider,
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          authKind: form.authKind,
          authId: form.authId.trim() || undefined,
          authSecret: form.authSecret.trim(),
          siteRef: form.siteRef.trim() || undefined,
          verifyTls: form.verifyTls,
          syncVlans: form.syncVlans,
          syncSubnets: form.syncSubnets,
          syncDhcp: form.syncDhcp,
        });
        setSuccess(t("Integration connection saved."));
      }
      closeForm();
      await loadConnections();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Saving the integration connection failed."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(connection: IntegrationConnection) {
    setBusyId(connection.id);
    resetMessages();
    try {
      await api.deleteIntegrationConnection(connection.id);
      if (pull?.connectionId === connection.id) setPull(null);
      setSuccess(t("Integration connection deleted."));
      await loadConnections();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Deleting the integration connection failed."),
      );
    } finally {
      setBusyId("");
    }
  }

  async function handleTest(connection: IntegrationConnection) {
    setBusyId(connection.id);
    resetMessages();
    try {
      const outcome = await api.testIntegrationConnection(connection.id);
      const version = outcome.result.version
        ? ` ${outcome.result.version}`
        : "";
      setSuccess(
        t("Connected to {product}.", {
          product: `${outcome.result.product}${version}`,
        }),
      );
      await loadConnections();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Connection test failed."),
      );
      await loadConnections();
    } finally {
      setBusyId("");
    }
  }

  async function handlePull(connection: IntegrationConnection) {
    setBusyId(connection.id);
    resetMessages();
    setPull(null);
    setAllowDeletes(false);
    try {
      const result = await api.pullIntegrationInventory(connection.id, {
        policy,
      });
      setPull({ ...result, connectionId: connection.id });
      await loadConnections();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Inventory pull failed."),
      );
      await loadConnections();
    } finally {
      setBusyId("");
    }
  }

  async function handleApply() {
    if (!pull) return;
    setApplying(true);
    resetMessages();
    try {
      const result = await api.applyIntegrationPreview(pull.connectionId, {
        preview: pull.preview,
        policy,
        allowDeletes,
      });
      setSuccess(
        t("Applied {vlanCount} VLAN(s) and {subnetCount} subnet(s).", {
          vlanCount: result.createdVlanIds.length,
          subnetCount: result.createdSubnetIds.length,
        }),
      );
      setPull(null);
      await loadAll();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Applying the preview failed."),
      );
    } finally {
      setApplying(false);
    }
  }

  async function handleStageProxmox(connection: IntegrationConnection) {
    if (!onStageProxmoxPayload) return;
    setBusyId(connection.id);
    resetMessages();
    try {
      let nodes = proxmoxNodes[connection.id];
      if (!nodes) {
        nodes = (await api.getProxmoxIntegrationNodes(connection.id)).nodes;
        setProxmoxNodes((current) => ({ ...current, [connection.id]: nodes! }));
        if (nodes.length > 1 && !proxmoxNodeChoice[connection.id]) {
          setProxmoxNodeChoice((current) => ({
            ...current,
            [connection.id]: nodes![0].node,
          }));
          setSuccess(t("Select the Proxmox node to stage, then pull again."));
          return;
        }
      }
      const node =
        proxmoxNodeChoice[connection.id] ?? nodes[0]?.node ?? undefined;
      const payload = await api.pullProxmoxStagedInventory(connection.id, {
        node,
      });
      onStageProxmoxPayload(payload);
      setSuccess(
        t("Staged the Proxmox inventory below. Review it, then import."),
      );
      await loadConnections();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Inventory staging failed."),
      );
      await loadConnections();
    } finally {
      setBusyId("");
    }
  }

  const authIdLabel = AUTH_ID_LABELS[form.authKind];
  const formProviderInfo = providerById[form.provider];
  const pullConnection = pull
    ? connections.find((entry) => entry.id === pull.connectionId)
    : undefined;
  const hasChanges = pull
    ? pull.preview.summary.vlanCreates +
        pull.preview.summary.vlanUpdates +
        pull.preview.summary.vlanDeletes +
        pull.preview.summary.subnetCreates +
        pull.preview.summary.subnetUpdates +
        pull.preview.summary.subnetDeletes >
      0
    : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("Controller APIs")}</CardLabel>
          <CardHeading>{t("Integrations")}</CardHeading>
        </CardTitle>
        <Badge tone="cyan">
          <PlugZap className="size-3" />
          {t("Live inventory")}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-[var(--text-tertiary)]">
          {t(
            "Connect Proxmox VE, UniFi Network, Omada, OPNsense, and Dockhand to pull devices, VLANs, networks, DHCP ranges, and containers. Credentials are encrypted at rest with {secretKey}; nothing is written without a reviewed preview.",
            { secretKey: "RACKPAD_SECRET_KEY" },
          )}
        </p>

        <div className="flex flex-wrap gap-2">
          {providers.map((provider) => (
            <Button
              key={provider.id}
              variant="outline"
              size="sm"
              disabled={!canEdit}
              onClick={() => openCreateForm(provider.id)}
            >
              <IntegrationIcon
                provider={provider.id}
                className="size-3.5"
                title={provider.label}
              />
              {t("Add {name}", { name: provider.label })}
            </Button>
          ))}
        </div>

        {formOpen && (
          <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <IntegrationIcon provider={form.provider} className="size-4" />
              {editingId
                ? t("Edit {name} connection", {
                    name: formProviderInfo?.label ?? form.provider,
                  })
                : t("New {name} connection", {
                    name: formProviderInfo?.label ?? form.provider,
                  })}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-[var(--text-secondary)]">
                  {t("Name")}
                </span>
                <Input
                  value={form.name}
                  disabled={saving}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder={t("Core controller")}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-[var(--text-secondary)]">
                  {t("Controller URL")}
                </span>
                <Input
                  value={form.baseUrl}
                  disabled={saving}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder={BASE_URL_PLACEHOLDERS[form.provider]}
                />
              </label>
              {(formProviderInfo?.authKinds.length ?? 0) > 1 && (
                <label className="space-y-1 text-sm">
                  <span className="text-[var(--text-secondary)]">
                    {t("Authentication")}
                  </span>
                  <select
                    className="rk-control w-full"
                    value={form.authKind}
                    disabled={saving}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        authKind: event.target.value as IntegrationAuthKind,
                      }))
                    }
                  >
                    {formProviderInfo?.authKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(AUTH_KIND_LABELS[kind])}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {authIdLabel && (
                <label className="space-y-1 text-sm">
                  <span className="text-[var(--text-secondary)]">
                    {t(authIdLabel)}
                  </span>
                  <Input
                    value={form.authId}
                    disabled={saving}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        authId: event.target.value,
                      }))
                    }
                  />
                </label>
              )}
              <label className="space-y-1 text-sm">
                <span className="text-[var(--text-secondary)]">
                  {t(AUTH_SECRET_LABELS[form.authKind])}
                </span>
                <Input
                  type="password"
                  value={form.authSecret}
                  disabled={saving}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      authSecret: event.target.value,
                    }))
                  }
                  placeholder={
                    editingId ? t("Leave blank to keep the stored secret") : ""
                  }
                />
              </label>
              {formProviderInfo?.supportsSiteRef && (
                <label className="space-y-1 text-sm">
                  <span className="text-[var(--text-secondary)]">
                    {form.provider === "dockhand"
                      ? t(
                          "Environment (optional, defaults to all environments)",
                        )
                      : t("Site (optional, defaults to the first site)")}
                  </span>
                  <Input
                    value={form.siteRef}
                    disabled={saving}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        siteRef: event.target.value,
                      }))
                    }
                  />
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.verifyTls}
                  disabled={saving}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      verifyTls: event.target.checked,
                    }))
                  }
                />
                {t("Verify TLS certificate")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.syncVlans}
                  disabled={saving}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      syncVlans: event.target.checked,
                    }))
                  }
                />
                {t("Pull VLANs")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.syncSubnets}
                  disabled={saving}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      syncSubnets: event.target.checked,
                    }))
                  }
                />
                {t("Pull subnets")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.syncDhcp}
                  disabled={saving}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      syncDhcp: event.target.checked,
                    }))
                  }
                />
                {t("Pull DHCP (preview only)")}
              </label>
            </div>
            <p className="text-xs text-[var(--text-tertiary)]">
              {t(
                "Mixed setups: keep VLANs on the switch controller connection and subnets/DHCP on the firewall connection so each source owns what it terminates.",
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={
                  saving ||
                  !form.name.trim() ||
                  !form.baseUrl.trim() ||
                  (!editingId && !form.authSecret.trim())
                }
                onClick={() => void handleSave()}
              >
                <CheckCircle2 className="size-3.5" />
                {saving
                  ? t("Saving...")
                  : editingId
                    ? t("Save changes")
                    : t("Add connection")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={closeForm}
              >
                {t("Cancel")}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-[var(--radius-md)] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-[var(--radius-md)] border border-[var(--success-border)] bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
            {success}
          </div>
        )}

        {connections.length === 0 && !formOpen && (
          <p className="text-sm text-[var(--text-tertiary)]">
            {t(
              "No integration connections yet. Add a controller above to pull live inventory.",
            )}
          </p>
        )}

        {connections.map((connection) => {
          const info = providerById[connection.provider];
          const busy = busyId === connection.id;
          const summaryProduct = connection.lastSummary?.product;
          const summaryVersion = connection.lastSummary?.version;
          const nodes = proxmoxNodes[connection.id] ?? [];
          return (
            <div
              key={connection.id}
              className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-3">
                <IntegrationIcon
                  provider={connection.provider}
                  className="size-5 shrink-0 text-[var(--accent-secondary)]"
                  title={info?.label ?? connection.provider}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {connection.name}
                    </span>
                    <Badge tone={statusTone(connection.lastStatus)}>
                      {connection.lastStatus === "ok"
                        ? t("Connected")
                        : connection.lastStatus === "error"
                          ? t("Error")
                          : t("Untested")}
                    </Badge>
                    {!connection.enabled && (
                      <Badge tone="neutral">{t("Disabled")}</Badge>
                    )}
                    {typeof summaryProduct === "string" && (
                      <span className="text-xs text-[var(--text-tertiary)]">
                        {[summaryProduct, summaryVersion]
                          .filter((part) => typeof part === "string")
                          .join(" ")}
                      </span>
                    )}
                  </div>
                  <Mono className="block truncate text-[10px] text-[var(--text-tertiary)]">
                    {connection.baseUrl}
                  </Mono>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canEdit || busy}
                    onClick={() => void handleTest(connection)}
                  >
                    <PlugZap className="size-3.5" />
                    {busy ? t("Working...") : t("Test")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canEdit || busy || !connection.enabled}
                    onClick={() => void handlePull(connection)}
                  >
                    <RefreshCw className="size-3.5" />
                    {t("Pull inventory")}
                  </Button>
                  {connection.provider === "proxmox" &&
                    onStageProxmoxPayload && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canEdit || busy || !connection.enabled}
                        onClick={() => void handleStageProxmox(connection)}
                      >
                        <DownloadCloud className="size-3.5" />
                        {t("Stage import")}
                      </Button>
                    )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canEdit || busy}
                    onClick={() => openEditForm(connection)}
                  >
                    <Pencil className="size-3.5" />
                    {t("Edit")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canEdit || busy}
                    onClick={() => void handleDelete(connection)}
                  >
                    <Trash2 className="size-3.5" />
                    {t("Delete")}
                  </Button>
                </div>
              </div>
              {connection.lastStatus === "error" && connection.lastError && (
                <div className="text-xs text-[var(--danger)]">
                  {connection.lastError}
                </div>
              )}
              {connection.provider === "proxmox" && nodes.length > 1 && (
                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  {t("Proxmox node")}
                  <select
                    className="rk-control"
                    value={proxmoxNodeChoice[connection.id] ?? nodes[0].node}
                    onChange={(event) =>
                      setProxmoxNodeChoice((current) => ({
                        ...current,
                        [connection.id]: event.target.value,
                      }))
                    }
                  >
                    {nodes.map((node) => (
                      <option key={node.node} value={node.node}>
                        {node.node}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          );
        })}

        {pull && (
          <div className="space-y-3 border-t border-[var(--color-line)] pt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {t("Inventory preview")}
              </span>
              {pullConnection && (
                <Badge tone="info">{pullConnection.name}</Badge>
              )}
              <Badge tone="neutral">{pull.preview.policy}</Badge>
              <span className="text-[var(--color-fg-subtle)]">
                {t("+{vlanCreates} VLAN / +{subnetCreates} subnet", {
                  vlanCreates: pull.preview.summary.vlanCreates,
                  subnetCreates: pull.preview.summary.subnetCreates,
                })}
              </span>
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                {t("Policy")}
                <select
                  className="rk-control"
                  value={policy}
                  onChange={(event) =>
                    setPolicy(event.target.value as SnmpSyncPolicy)
                  }
                >
                  <option value="merge">{t("Merge (add missing only)")}</option>
                  <option value="mirror">
                    {t("Mirror (create, update, delete)")}
                  </option>
                </select>
              </label>
            </div>

            {[...pull.warnings, ...pull.preview.warnings].map((warning) => (
              <div key={warning} className="text-xs text-[var(--warning)]">
                {warning}
              </div>
            ))}

            {pull.preview.vlans.length > 0 && (
              <IntegrationDiffSection
                title={t("VLANs")}
                rows={pull.preview.vlans.map((entry) => ({
                  key: `vlan-${entry.vlanNumber}`,
                  label: t("VLAN {number}", { number: entry.vlanNumber }),
                  detail: entry.name,
                  action: entry.action,
                  note:
                    entry.changes?.join("; ") ??
                    entry.blockedReason ??
                    undefined,
                }))}
              />
            )}
            {pull.preview.subnets.length > 0 && (
              <IntegrationDiffSection
                title={t("Subnets")}
                rows={pull.preview.subnets.map((entry) => ({
                  key: `subnet-${entry.cidr}`,
                  label: entry.cidr,
                  detail: entry.name,
                  action: entry.action,
                  note:
                    entry.changes?.join("; ") ??
                    entry.blockedReason ??
                    undefined,
                }))}
              />
            )}
            {pull.preview.dhcp.scopes.length > 0 && (
              <IntegrationDiffSection
                title={t("DHCP ranges (preview only)")}
                rows={pull.preview.dhcp.scopes.map((scope, index) => ({
                  key: `dhcp-${index}`,
                  label: `${scope.startIp} – ${scope.endIp}`,
                  detail: scope.name,
                  action: "unchanged",
                  note: scope.subnetCidr ?? undefined,
                }))}
              />
            )}

            {pull.devices.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                  {t("Controller devices (read-only)")}
                </div>
                <div className="rk-table-shell max-h-56 overflow-y-auto">
                  <table className="rk-table">
                    <thead>
                      <tr>
                        <th>{t("Name")}</th>
                        <th>{t("Type")}</th>
                        <th>{t("Model")}</th>
                        <th>{t("MAC")}</th>
                        <th>{t("IP")}</th>
                        <th>{t("Status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pull.devices.map((device, index) => (
                        <tr key={`${device.name}-${index}`}>
                          <td className="font-medium text-[var(--text-primary)]">
                            {device.name}
                          </td>
                          <td>{t(DEVICE_KIND_LABELS[device.kind])}</td>
                          <td>{device.model ?? ""}</td>
                          <td>
                            {device.macAddress ? (
                              <Mono>{device.macAddress}</Mono>
                            ) : (
                              ""
                            )}
                          </td>
                          <td>
                            {device.ipAddress ? (
                              <Mono>{device.ipAddress}</Mono>
                            ) : (
                              ""
                            )}
                          </td>
                          <td>{device.status ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!hasChanges && (
              <div className="text-sm text-[var(--color-fg-subtle)]">
                {t("Rackpad already matches this controller's inventory.")}
              </div>
            )}

            {admin ? (
              <div className="flex flex-wrap items-center gap-3">
                {policy === "mirror" &&
                  pull.preview.summary.vlanDeletes +
                    pull.preview.summary.subnetDeletes >
                    0 && (
                    <label className="flex items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
                      <input
                        type="checkbox"
                        checked={allowDeletes}
                        onChange={(event) =>
                          setAllowDeletes(event.target.checked)
                        }
                      />
                      {t("Allow deletes for unreferenced VLANs/subnets")}
                    </label>
                  )}
                <Button
                  size="sm"
                  disabled={applying || !hasChanges}
                  onClick={() => void handleApply()}
                >
                  <ShieldCheck className="size-3.5" />
                  {applying ? t("Applying...") : t("Apply preview")}
                </Button>
              </div>
            ) : (
              <div className="text-xs text-[var(--color-fg-subtle)]">
                {t(
                  "Administrator access is required to apply integration changes.",
                )}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function IntegrationDiffSection({
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
