import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  HardDriveDownload,
  Pencil,
  PlayCircle,
  Plus,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Mono } from "@/components/shared/Mono";
import { IntegrationIcon } from "@/components/import/IntegrationIcons";
import { api } from "@/lib/api";
import type {
  IntegrationAuthKind,
  IntegrationAutoSyncMode,
  IntegrationConnection,
  IntegrationDevicePreview,
  IntegrationInventoryResponse,
  IntegrationProvider,
  IntegrationProviderInfo,
  IntegrationScope,
  IntegrationScopeKind,
  IntegrationSyncSchedule,
} from "@/lib/types";
import { canEditInventory, isAdmin, loadAll, useStore } from "@/lib/store";

interface ConnectionForm {
  provider: IntegrationProvider;
  name: string;
  baseUrl: string;
  authKind: IntegrationAuthKind;
  authId: string;
  authSecret: string;
  scopeRefs: string[];
  verifyTls: boolean;
  syncVlans: boolean;
  syncSubnets: boolean;
  syncDhcp: boolean;
  syncSwitches: boolean;
  syncGateways: boolean;
  syncAccessPoints: boolean;
  syncHosts: boolean;
  syncGuests: boolean;
  syncWifi: boolean;
}

const EMPTY_FORM: ConnectionForm = {
  provider: "proxmox",
  name: "",
  baseUrl: "",
  authKind: "api-token",
  authId: "",
  authSecret: "",
  scopeRefs: [],
  verifyTls: true,
  syncVlans: true,
  syncSubnets: true,
  syncDhcp: true,
  syncSwitches: true,
  syncGateways: true,
  syncAccessPoints: true,
  syncHosts: true,
  syncGuests: true,
  syncWifi: true,
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

// One concise line under the connection form instead of a paragraph of
// prose on the panel.
const PROVIDER_DESCRIPTIONS: Record<IntegrationProvider, TranslationKey> = {
  proxmox:
    "Pulls nodes, VMs, containers, bridges, and SDN networks, and imports the whole stack from the host down.",
  unifi:
    "Pulls switches, gateways, and APs plus networks, VLANs, and DHCP ranges per site.",
  omada:
    "Pulls switches, gateways, and APs plus LAN networks, VLANs, and DHCP ranges per site.",
  opnsense:
    "Pulls interfaces, VLAN definitions, gateways, and DHCP ranges from the firewall.",
  dockhand:
    "Pulls Docker environments, containers, stacks, and networks as read-only previews.",
};

interface PullToggleCopy {
  label: TranslationKey;
  hint: TranslationKey;
}

// Provider-correlated pull toggles: each checkbox says what it actually
// brings in for that integration, with a hover for the fine print.
const PULL_TOGGLES: Record<
  IntegrationProvider,
  {
    vlans: PullToggleCopy | null;
    subnets: PullToggleCopy | null;
    dhcp: PullToggleCopy | null;
    hosts: PullToggleCopy | null;
    guests: PullToggleCopy | null;
    switches: PullToggleCopy | null;
    gateways: PullToggleCopy | null;
    aps: PullToggleCopy | null;
    wifi: PullToggleCopy | null;
  }
> = {
  proxmox: {
    vlans: {
      label: "SDN VLANs",
      hint: "VLAN ids from Proxmox SDN zones and vnets. These live on the host overlay fabric and may not match your physical switch VLANs.",
    },
    subnets: {
      label: "Bridge and SDN subnets",
      hint: "IPv4 networks from node bridges, VLAN interfaces, and SDN subnets.",
    },
    dhcp: {
      label: "SDN DHCP ranges",
      hint: "DHCP ranges defined on SDN subnets. Shown for review only, never applied.",
    },
    hosts: {
      label: "Hosts",
      hint: "Imports the selected Proxmox nodes as Rackpad server devices with their bridges as virtual switches, placed as loose gear.",
    },
    guests: {
      label: "VMs & containers",
      hint: "Imports QEMU VMs and LXC containers as virtual devices under their host, with NICs, MACs, VLAN tags, virtual switch links, and IPs. Templates are skipped.",
    },
    switches: null,
    gateways: null,
    aps: null,
    wifi: null,
  },
  unifi: {
    vlans: {
      label: "Network VLANs",
      hint: "VLAN ids from UniFi corporate and VLAN-only networks.",
    },
    subnets: {
      label: "Network subnets",
      hint: "IPv4 subnets of gateway-managed networks. WAN and VPN networks are excluded.",
    },
    dhcp: {
      label: "DHCP server ranges",
      hint: "UniFi DHCP server pools. Shown for review only, never applied.",
    },
    hosts: null,
    guests: null,
    switches: {
      label: "Switches",
      hint: "Imports switches as Rackpad devices with their full port list (media type, speed, link state). New records land as loose gear until you rack them; existing devices are matched by MAC or hostname and never modified.",
    },
    gateways: {
      label: "Gateways",
      hint: "Imports gateways and routers as Rackpad devices, placed as loose gear. Existing devices are never modified.",
    },
    aps: {
      label: "Access points",
      hint: "Imports access points as Rackpad devices and links them to the WiFi controller when SSIDs are pulled.",
    },
    wifi: {
      label: "SSIDs",
      hint: "Creates the WiFi controller, links AP devices to it, and imports SSIDs with their VLAN associations.",
    },
  },
  omada: {
    vlans: {
      label: "LAN VLANs",
      hint: "VLAN ids from Omada LAN networks and interfaces.",
    },
    subnets: {
      label: "LAN subnets",
      hint: "Gateway subnets of Omada LAN networks.",
    },
    dhcp: {
      label: "DHCP server ranges",
      hint: "Omada DHCP server pools. Shown for review only, never applied.",
    },
    hosts: null,
    guests: null,
    switches: {
      label: "Switches",
      hint: "Imports switches as Rackpad devices with their full port list (media type, speed, link state). New records land as loose gear until you rack them; existing devices are matched by MAC or hostname and never modified.",
    },
    gateways: {
      label: "Gateways",
      hint: "Imports gateways and routers as Rackpad devices, placed as loose gear. Existing devices are never modified.",
    },
    aps: {
      label: "Access points",
      hint: "Imports access points as Rackpad devices and links them to the WiFi controller when SSIDs are pulled.",
    },
    wifi: {
      label: "SSIDs",
      hint: "Creates the WiFi controller, links AP devices to it, and imports SSIDs with their VLAN associations.",
    },
  },
  opnsense: {
    vlans: {
      label: "Interface VLANs",
      hint: "802.1Q VLAN definitions from the firewall. Existing subnets without a VLAN are associated when the ids match.",
    },
    subnets: {
      label: "Interface subnets",
      hint: "IPv4 networks of configured interfaces.",
    },
    dhcp: {
      label: "Kea and Dnsmasq ranges",
      hint: "DHCP pools from Kea and Dnsmasq. ISC dhcpd does not expose ranges. Shown for review only, never applied.",
    },
    hosts: null,
    guests: null,
    switches: null,
    gateways: {
      label: "Firewall device",
      hint: "Imports the firewall itself as a Rackpad device record, placed as loose gear.",
    },
    aps: null,
    wifi: null,
  },
  dockhand: {
    vlans: null,
    subnets: null,
    dhcp: null,
    hosts: null,
    guests: null,
    switches: null,
    gateways: null,
    aps: null,
    wifi: null,
  },
};

const PULL_TOGGLE_FIELDS = [
  ["vlans", "syncVlans"],
  ["subnets", "syncSubnets"],
  ["dhcp", "syncDhcp"],
  ["hosts", "syncHosts"],
  ["guests", "syncGuests"],
  ["switches", "syncSwitches"],
  ["gateways", "syncGateways"],
  ["aps", "syncAccessPoints"],
  ["wifi", "syncWifi"],
] as const;

const SCOPE_KIND_LABELS: Record<IntegrationScopeKind, TranslationKey> = {
  sites: "Sites",
  nodes: "Cluster nodes",
  environments: "Environments",
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

const IMPORT_TYPE_LABELS: Record<string, TranslationKey> = {
  switch: "Switch",
  vm: "VM",
  container: "Container",
  router: "Router",
  firewall: "Firewall",
  ap: "Access point",
  server: "Host",
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
  exists: "Already tracked",
};

// Basic selectors first; cron stays available as the advanced option.
const SCHEDULE_PRESETS: Array<{
  id: string;
  cron: string | null;
  label: TranslationKey;
}> = [
  { id: "15m", cron: "*/15 * * * *", label: "Every 15 minutes" },
  { id: "30m", cron: "*/30 * * * *", label: "Every 30 minutes" },
  { id: "1h", cron: "0 * * * *", label: "Hourly" },
  { id: "6h", cron: "0 */6 * * *", label: "Every 6 hours" },
  { id: "daily", cron: "0 2 * * *", label: "Daily at 02:00" },
  { id: "weekly", cron: "0 2 * * 0", label: "Weekly on Sunday at 02:00" },
  { id: "custom", cron: null, label: "Custom cron (advanced)" },
];

const AUTO_SYNC_MODE_LABELS: Record<IntegrationAutoSyncMode, TranslationKey> = {
  merge: "Merge",
  skip: "Skip",
};

interface ScheduleDraft {
  name: string;
  enabled: boolean;
  mode: IntegrationAutoSyncMode;
  preset: string;
  cron: string;
  labIds: string[];
}

function draftFromSchedule(schedule: IntegrationSyncSchedule): ScheduleDraft {
  const preset =
    SCHEDULE_PRESETS.find((entry) => entry.cron && entry.cron === schedule.cron)
      ?.id ?? "custom";
  return {
    name: schedule.name,
    enabled: schedule.enabled,
    mode: schedule.mode,
    preset,
    cron: schedule.cron,
    labIds: schedule.labIds,
  };
}

function emptyScheduleDraft(labId: string): ScheduleDraft {
  return {
    name: "",
    enabled: true,
    mode: "merge",
    preset: "daily",
    cron: "",
    labIds: [labId],
  };
}

function runStatusTone(status: IntegrationSyncSchedule["lastRunStatus"]) {
  if (status === "ok") return "ok" as const;
  if (status === "drift") return "warn" as const;
  if (status === "error") return "err" as const;
  return "neutral" as const;
}

function connectionScopes(connection: IntegrationConnection) {
  if (connection.scopeRefs.length > 0) return connection.scopeRefs;
  return connection.siteRef ? [connection.siteRef] : [];
}

export function IntegrationsPanel() {
  const { t } = useI18n();
  const syncModeHint = `${t("Merge")}: ${t("Create")}. ${t("Skip")}: ${t("Create")} + ${t("Update")}; 0 ${t("Delete")}.`;
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const labs = useStore((s) => s.labs);
  const canEdit = canEditInventory(currentUser);
  const admin = isAdmin(currentUser);

  const [providers, setProviders] = useState<IntegrationProviderInfo[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [schedules, setSchedules] = useState<IntegrationSyncSchedule[]>([]);
  const [form, setForm] = useState<ConnectionForm>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoveredScopes, setDiscoveredScopes] = useState<
    IntegrationScope[] | null
  >(null);
  const [pull, setPull] = useState<
    (IntegrationInventoryResponse & { connectionId: string }) | null
  >(null);
  const [selectedProviderRecordIds, setSelectedProviderRecordIds] = useState<
    Set<string>
  >(new Set());
  const [syncMode, setSyncMode] = useState<IntegrationAutoSyncMode>("merge");
  const [applying, setApplying] = useState(false);
  const [importingDevices, setImportingDevices] = useState(false);
  const [previewTab, setPreviewTab] = useState("vlans");
  const [syncOpenFor, setSyncOpenFor] = useState<Record<string, boolean>>({});
  const [scheduleDrafts, setScheduleDrafts] = useState<
    Record<string, ScheduleDraft>
  >({});
  const [newScheduleFor, setNewScheduleFor] = useState<
    Record<string, ScheduleDraft | undefined>
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

  const schedulesByConnection = useMemo(() => {
    const map: Record<string, IntegrationSyncSchedule[]> = {};
    for (const schedule of schedules) {
      (map[schedule.connectionId] ??= []).push(schedule);
    }
    return map;
  }, [schedules]);

  const loadConnections = useCallback(async () => {
    try {
      setConnections(await api.getIntegrationConnections({ labId: lab.id }));
    } catch {
      setConnections([]);
    }
    try {
      setSchedules(await api.getIntegrationSchedules());
    } catch {
      setSchedules([]);
    }
  }, [lab.id]);

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
    setScheduleDrafts({});
    setNewScheduleFor({});
    void loadConnections();
  }, [loadConnections]);

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
    setDiscoveredScopes(null);
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
      scopeRefs: connectionScopes(connection),
      verifyTls: connection.verifyTls,
      syncVlans: connection.syncVlans,
      syncSubnets: connection.syncSubnets,
      syncDhcp: connection.syncDhcp,
      syncSwitches: connection.syncSwitches,
      syncGateways: connection.syncGateways,
      syncAccessPoints: connection.syncAccessPoints,
      syncHosts: connection.syncHosts,
      syncGuests: connection.syncGuests,
      syncWifi: connection.syncWifi,
    });
    setEditingId(connection.id);
    setDiscoveredScopes(null);
    setFormOpen(true);
    resetMessages();
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId("");
    setDiscoveredScopes(null);
    setForm(EMPTY_FORM);
  }

  async function handleDiscover() {
    setDiscovering(true);
    resetMessages();
    try {
      const response =
        editingId && !form.authSecret.trim()
          ? await api.discoverIntegrationScopes({ connectionId: editingId })
          : await api.discoverIntegrationScopes({
              labId: lab.id,
              provider: form.provider,
              baseUrl: form.baseUrl.trim(),
              authKind: form.authKind,
              authId: form.authId.trim() || undefined,
              authSecret: form.authSecret.trim() || undefined,
              verifyTls: form.verifyTls,
            });
      const version = response.result.version
        ? ` ${response.result.version}`
        : "";
      setSuccess(
        t("Connected to {product}.", {
          product: `${response.result.product}${version}`,
        }),
      );
      setDiscoveredScopes(response.scopes);
    } catch (err) {
      setDiscoveredScopes(null);
      setError(
        err instanceof Error ? err.message : t("Connection test failed."),
      );
    } finally {
      setDiscovering(false);
    }
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
          scopeRefs: form.scopeRefs,
          verifyTls: form.verifyTls,
          syncVlans: form.syncVlans,
          syncSubnets: form.syncSubnets,
          syncDhcp: form.syncDhcp,
          syncSwitches: form.syncSwitches,
          syncGateways: form.syncGateways,
          syncAccessPoints: form.syncAccessPoints,
          syncHosts: form.syncHosts,
          syncGuests: form.syncGuests,
          syncWifi: form.syncWifi,
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
          scopeRefs: form.scopeRefs,
          verifyTls: form.verifyTls,
          syncVlans: form.syncVlans,
          syncSubnets: form.syncSubnets,
          syncDhcp: form.syncDhcp,
          syncSwitches: form.syncSwitches,
          syncGateways: form.syncGateways,
          syncAccessPoints: form.syncAccessPoints,
          syncHosts: form.syncHosts,
          syncGuests: form.syncGuests,
          syncWifi: form.syncWifi,
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

  async function handlePullToggle(
    connection: IntegrationConnection,
    field: (typeof PULL_TOGGLE_FIELDS)[number][1],
    checked: boolean,
  ) {
    setBusyId(connection.id);
    resetMessages();
    try {
      await api.updateIntegrationConnection(connection.id, {
        syncVlans: field === "syncVlans" ? checked : connection.syncVlans,
        syncSubnets: field === "syncSubnets" ? checked : connection.syncSubnets,
        syncDhcp: field === "syncDhcp" ? checked : connection.syncDhcp,
        syncSwitches:
          field === "syncSwitches" ? checked : connection.syncSwitches,
        syncGateways:
          field === "syncGateways" ? checked : connection.syncGateways,
        syncAccessPoints:
          field === "syncAccessPoints" ? checked : connection.syncAccessPoints,
        syncHosts: field === "syncHosts" ? checked : connection.syncHosts,
        syncGuests: field === "syncGuests" ? checked : connection.syncGuests,
        syncWifi: field === "syncWifi" ? checked : connection.syncWifi,
      });
      await loadConnections();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Saving the integration connection failed."),
      );
      await loadConnections();
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

  async function handlePull(
    connection: IntegrationConnection,
    options?: { keepOpen?: boolean; mode?: IntegrationAutoSyncMode },
  ) {
    const mode = options?.mode ?? syncMode;
    setBusyId(connection.id);
    resetMessages();
    if (!options?.keepOpen) setPull(null);
    try {
      const result = await api.pullIntegrationInventory(connection.id, {
        mode,
      });
      setPull({ ...result, connectionId: connection.id });
      setSelectedProviderRecordIds(
        new Set([
          ...result.deviceSync.devices
            .filter((entry) => entry.action === "create")
            .map((entry) => entry.providerRecordId),
          ...result.deviceSync.virtualSwitches
            .filter((entry) => entry.action === "create")
            .map((entry) => entry.providerRecordId),
          ...result.deviceSync.ssids
            .filter((entry) => entry.action === "create")
            .map((entry) => entry.providerRecordId),
        ]),
      );
      const counts = {
        vlans: result.preview.vlans.length,
        subnets: result.preview.subnets.length,
        dhcp: result.preview.dhcp.scopes.length,
        devices: result.devices.length,
        import:
          result.deviceSync.devices.length +
          result.deviceSync.ssids.length +
          result.deviceSync.virtualSwitches.length,
      };
      setPreviewTab(
        (["vlans", "subnets", "dhcp", "devices", "import"] as const).find(
          (tab) => counts[tab] > 0,
        ) ?? "devices",
      );
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
        previewToken: pull.networkPreviewToken,
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

  async function handleImportDevices() {
    if (!pull) return;
    setImportingDevices(true);
    resetMessages();
    try {
      const result = await api.applyIntegrationDevices(pull.connectionId, {
        snapshotToken: pull.deviceSnapshotToken,
        selectedProviderRecordIds: [...selectedProviderRecordIds],
      });
      setSuccess(
        t(
          "Imported {deviceCount} device(s) with {portCount} port(s), {vswitchCount} virtual switch(es), {ssidCount} SSID(s), and {ipCount} IP assignment(s).",
          {
            deviceCount: result.createdDeviceIds.length,
            portCount: result.createdPortCount,
            vswitchCount: result.createdVirtualSwitchIds.length,
            ssidCount: result.createdSsidIds.length,
            ipCount: result.createdIpAssignmentIds.length,
          },
        ),
      );
      setPull(null);
      await loadAll();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Importing devices failed."),
      );
    } finally {
      setImportingDevices(false);
    }
  }

  function updateScheduleDraft(
    schedule: IntegrationSyncSchedule,
    patch: Partial<ScheduleDraft>,
  ) {
    setScheduleDrafts((prev) => ({
      ...prev,
      [schedule.id]: {
        ...(prev[schedule.id] ?? draftFromSchedule(schedule)),
        ...patch,
      },
    }));
  }

  async function handleScheduleSave(schedule: IntegrationSyncSchedule) {
    const draft = scheduleDrafts[schedule.id] ?? draftFromSchedule(schedule);
    const preset = SCHEDULE_PRESETS.find((entry) => entry.id === draft.preset);
    const cron = preset?.cron ?? draft.cron.trim();
    setBusyId(schedule.id);
    resetMessages();
    try {
      await api.updateIntegrationSchedule(schedule.id, {
        name: draft.name.trim() || schedule.name,
        enabled: draft.enabled,
        mode: draft.mode,
        cron,
        labIds: draft.labIds,
      });
      setSuccess(t("Auto-sync settings saved."));
      setScheduleDrafts((prev) => {
        const next = { ...prev };
        delete next[schedule.id];
        return next;
      });
      await loadConnections();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Saving the auto-sync settings failed."),
      );
    } finally {
      setBusyId("");
    }
  }

  async function handleScheduleCreate(connection: IntegrationConnection) {
    const draft = newScheduleFor[connection.id];
    if (!draft) return;
    const preset = SCHEDULE_PRESETS.find((entry) => entry.id === draft.preset);
    const cron = preset?.cron ?? draft.cron.trim();
    setBusyId(connection.id);
    resetMessages();
    try {
      await api.createIntegrationSchedule({
        connectionId: connection.id,
        name: draft.name.trim() || t("New schedule"),
        enabled: draft.enabled,
        mode: draft.mode,
        cron,
        labIds: draft.labIds,
      });
      setSuccess(t("Schedule created."));
      setNewScheduleFor((prev) => ({ ...prev, [connection.id]: undefined }));
      await loadConnections();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Creating the schedule failed."),
      );
    } finally {
      setBusyId("");
    }
  }

  async function handleScheduleDelete(schedule: IntegrationSyncSchedule) {
    setBusyId(schedule.id);
    resetMessages();
    try {
      await api.deleteIntegrationSchedule(schedule.id);
      setSuccess(t("Schedule deleted."));
      await loadConnections();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Deleting the schedule failed."),
      );
    } finally {
      setBusyId("");
    }
  }

  async function handleScheduleRun(schedule: IntegrationSyncSchedule) {
    setBusyId(schedule.id);
    resetMessages();
    try {
      const { result } = await api.runIntegrationSchedule(schedule.id);
      if (result.status === "error") {
        setError(result.message);
      } else {
        setSuccess(result.message);
      }
      await loadConnections();
      if (result.status === "ok") {
        await loadAll();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Auto-sync run failed."));
      await loadConnections();
    } finally {
      setBusyId("");
    }
  }

  function multiSelectPopover(options: {
    items: Array<{ id: string; label: string }>;
    selected: string[];
    disabled: boolean;
    triggerLabel: string;
    triggerTitle?: string;
    onChange: (ids: string[]) => void;
  }) {
    const { items, selected, disabled, triggerLabel, triggerTitle, onChange } =
      options;
    const allSelected = items.length > 0 && selected.length === items.length;
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-between"
            disabled={disabled}
            title={triggerTitle}
          >
            {triggerLabel}
            <ChevronDown className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-1">
          <label className="flex items-center gap-2 rounded border-b border-[var(--color-line)] px-1 pb-1 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={disabled || items.length === 0}
              onChange={(event) =>
                onChange(
                  event.target.checked ? items.map((item) => item.id) : [],
                )
              }
            />
            {t("Select all")}
          </label>
          {items.map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-2 rounded px-1 py-0.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                disabled={disabled}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, item.id]
                      : selected.filter((id) => id !== item.id),
                  )
                }
              />
              {item.label}
            </label>
          ))}
        </PopoverContent>
      </Popover>
    );
  }

  function scheduleEditor(
    draft: ScheduleDraft,
    busy: boolean,
    onDraftChange: (patch: Partial<ScheduleDraft>) => void,
  ) {
    return (
      <>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--text-secondary)]">
              {t("Schedule name")}
            </span>
            <Input
              value={draft.name}
              disabled={!admin || busy}
              onChange={(event) => onDraftChange({ name: event.target.value })}
              placeholder={t("Nightly staging sync")}
            />
          </label>
          <label className="space-y-1 text-sm" title={syncModeHint}>
            <span className="text-[var(--text-secondary)]">
              {t("Sync mode")}
            </span>
            <select
              className="rk-control w-full"
              value={draft.mode}
              disabled={!admin || busy}
              onChange={(event) =>
                onDraftChange({
                  mode: event.target.value as IntegrationAutoSyncMode,
                })
              }
            >
              {(
                Object.keys(AUTO_SYNC_MODE_LABELS) as IntegrationAutoSyncMode[]
              ).map((mode) => (
                <option key={mode} value={mode}>
                  {t(AUTO_SYNC_MODE_LABELS[mode])}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[var(--text-secondary)]">
              {t("When to sync")} ({t("UTC")})
            </span>
            <select
              className="rk-control w-full"
              value={draft.preset}
              disabled={!admin || busy}
              onChange={(event) =>
                onDraftChange({ preset: event.target.value })
              }
            >
              {SCHEDULE_PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t(entry.label)}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-1 text-sm">
            <span className="block text-[var(--text-secondary)]">
              {t("Where to sync to")}
            </span>
            {multiSelectPopover({
              items: labs.map((entry) => ({
                id: entry.id,
                label: entry.name,
              })),
              selected: draft.labIds,
              disabled: !admin || busy,
              triggerLabel: t("{count} lab(s)", {
                count: draft.labIds.length,
              }),
              onChange: (labIds) => onDraftChange({ labIds }),
            })}
          </div>
        </div>
        {draft.preset === "custom" && (
          <label className="block space-y-1 text-sm md:max-w-sm">
            <span className="text-[var(--text-secondary)]">
              {t("Cron expression (minute hour day month weekday)")} ({t("UTC")}
              )
            </span>
            <Input
              value={draft.cron}
              disabled={!admin || busy}
              onChange={(event) => onDraftChange({ cron: event.target.value })}
              placeholder="30 2 * * *"
            />
          </label>
        )}
      </>
    );
  }

  const authIdLabel = AUTH_ID_LABELS[form.authKind];
  const formProviderInfo = providerById[form.provider];
  const formPullToggles = PULL_TOGGLES[form.provider];
  const formScopeKind = formProviderInfo?.scopeKind ?? null;
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
  const importCreates = pull ? selectedProviderRecordIds.size : 0;
  const previewTabCounts = pull
    ? {
        vlans: pull.preview.vlans.length,
        subnets: pull.preview.subnets.length,
        dhcp: pull.preview.dhcp.scopes.length,
        devices: pull.devices.length,
        import:
          pull.deviceSync.devices.length +
          pull.deviceSync.ssids.length +
          pull.deviceSync.virtualSwitches.length,
      }
    : null;
  // Only offer tabs the product actually returned data for; Devices is
  // the fallback so the dialog always has one tab.
  const visiblePreviewTabs: string[] = previewTabCounts
    ? ["vlans", "subnets", "dhcp", "devices", "import"].filter(
        (tab) =>
          tab === "devices" ||
          previewTabCounts[tab as keyof typeof previewTabCounts] > 0,
      )
    : [];
  const activePreviewTab = visiblePreviewTabs.includes(previewTab)
    ? previewTab
    : (visiblePreviewTabs[0] ?? "devices");
  const isNetworkPreviewTab =
    activePreviewTab === "vlans" ||
    activePreviewTab === "subnets" ||
    activePreviewTab === "dhcp";

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("Controller APIs")}</CardLabel>
          <CardHeading>{t("Integrations")}</CardHeading>
        </CardTitle>
        <Badge
          tone="cyan"
          title={t(
            "Credentials are stored encrypted. Inventory is only written after a reviewed preview or an explicit auto-sync schedule.",
          )}
        >
          <PlugZap className="size-3" />
          {t("Live inventory")}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="space-y-4">
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

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {providers.map((provider) => (
                <Button
                  key={provider.id}
                  variant="outline"
                  size="sm"
                  disabled={!canEdit}
                  title={t(PROVIDER_DESCRIPTIONS[provider.id])}
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
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                    <IntegrationIcon
                      provider={form.provider}
                      className="size-4"
                    />
                    {editingId
                      ? t("Edit {name} connection", {
                          name: formProviderInfo?.label ?? form.provider,
                        })
                      : t("New {name} connection", {
                          name: formProviderInfo?.label ?? form.provider,
                        })}
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    {t(PROVIDER_DESCRIPTIONS[form.provider])}
                  </p>
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
                        setForm((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
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
                        editingId
                          ? t("Leave blank to keep the stored secret")
                          : ""
                      }
                    />
                  </label>
                </div>

                <label
                  className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"
                  title={t(
                    "Turn off for controllers with self-signed certificates.",
                  )}
                >
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

                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                    {t("What to sync")}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
                    {PULL_TOGGLE_FIELDS.map(([toggleKey, formKey]) => {
                      const copy = formPullToggles[toggleKey];
                      if (!copy) return null;
                      return (
                        <label
                          key={toggleKey}
                          className="flex items-center gap-2"
                          title={t(copy.hint)}
                        >
                          <input
                            type="checkbox"
                            checked={form[formKey]}
                            disabled={saving}
                            onChange={(event) =>
                              setForm((prev) => ({
                                ...prev,
                                [formKey]: event.target.checked,
                              }))
                            }
                          />
                          {t(copy.label)}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {formScopeKind && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        saving ||
                        discovering ||
                        !form.baseUrl.trim() ||
                        (!editingId && !form.authSecret.trim())
                      }
                      title={t(
                        "Tests the credentials and lists what you can pull from.",
                      )}
                      onClick={() => void handleDiscover()}
                    >
                      <PlugZap className="size-3.5" />
                      {discovering ? t("Testing…") : t("Test & discover")}
                    </Button>
                    <div className="w-64 space-y-1 text-sm">
                      {multiSelectPopover({
                        items: (discoveredScopes ?? []).map((scope) => ({
                          id: scope.id,
                          label: scope.label,
                        })),
                        selected: form.scopeRefs,
                        disabled: saving || !discoveredScopes,
                        triggerTitle: discoveredScopes
                          ? undefined
                          : t("Run Test & discover first to list the choices."),
                        triggerLabel:
                          form.scopeRefs.length > 0
                            ? t("{count} of {kind} selected", {
                                count: form.scopeRefs.length,
                                kind: t(SCOPE_KIND_LABELS[formScopeKind]),
                              })
                            : t("{kind}: default selection", {
                                kind: t(SCOPE_KIND_LABELS[formScopeKind]),
                              }),
                        onChange: (scopeRefs) =>
                          setForm((prev) => ({ ...prev, scopeRefs })),
                      })}
                    </div>
                    {!discoveredScopes && form.scopeRefs.length > 0 && (
                      <Mono className="text-[10px] text-[var(--text-tertiary)]">
                        {form.scopeRefs.join(", ")}
                      </Mono>
                    )}
                  </div>
                )}

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

            {connections.length > 0 && (
              <div className="space-y-1">
                <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                  {t("Existing connections ({count})", {
                    count: connections.length,
                  })}
                </div>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {t(
                    "Auto-sync is opt-in per schedule and runs on the server without a review step. Each connection can have several schedules with their own cadence, mode, and target labs. Repeated failures back off automatically and surface here.",
                  )}
                </p>
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
              const connectionSchedules =
                schedulesByConnection[connection.id] ?? [];
              const newDraft = newScheduleFor[connection.id];
              const syncOpen = syncOpenFor[connection.id] === true;
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
                        <Badge tone="neutral">
                          {info?.label ?? connection.provider}
                        </Badge>
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
                        {[
                          connection.baseUrl,
                          connectionScopes(connection).join(", "),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Mono>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canEdit || busy}
                        title={t(
                          "Checks reachability and refreshes product and version.",
                        )}
                        onClick={() => void handleTest(connection)}
                      >
                        <PlugZap className="size-3.5" />
                        {busy ? t("Working...") : t("Test")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canEdit || busy || !connection.enabled}
                        title={t(
                          "Fetches inventory and opens a review preview. Nothing is written yet.",
                        )}
                        onClick={() => void handlePull(connection)}
                      >
                        <RefreshCw className="size-3.5" />
                        {t("Pull inventory")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        title={t(
                          "What this connection syncs, on which schedules, into which labs.",
                        )}
                        onClick={() =>
                          setSyncOpenFor((prev) => ({
                            ...prev,
                            [connection.id]: !prev[connection.id],
                          }))
                        }
                      >
                        <CalendarClock className="size-3.5" />
                        {t("Auto-sync")}
                        {/* i18n-ignore -- numeric schedule-count badge, no translatable copy. */}
                        {connectionSchedules.length > 0
                          ? ` (${connectionSchedules.length})`
                          : ""}
                        <ChevronDown
                          className={
                            syncOpen
                              ? "size-3 rotate-180 transition-transform"
                              : "size-3 transition-transform"
                          }
                        />
                      </Button>
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
                  {connection.lastStatus === "error" &&
                    connection.lastError && (
                      <div className="text-xs text-[var(--danger)]">
                        {connection.lastError}
                      </div>
                    )}
                  {syncOpen && (
                    <div className="space-y-3 border-t border-[var(--color-line)] pt-2">
                      <div className="space-y-1">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                          {t("What to sync")}
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
                          {PULL_TOGGLE_FIELDS.map(([toggleKey, field]) => {
                            const copy =
                              PULL_TOGGLES[connection.provider][toggleKey];
                            if (!copy) return null;
                            return (
                              <label
                                key={toggleKey}
                                className="flex items-center gap-2"
                                title={t(copy.hint)}
                              >
                                <input
                                  type="checkbox"
                                  checked={connection[field]}
                                  disabled={!canEdit || busy}
                                  onChange={(event) =>
                                    void handlePullToggle(
                                      connection,
                                      field,
                                      event.target.checked,
                                    )
                                  }
                                />
                                {t(copy.label)}
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                            {t("When to sync")}
                          </div>
                          <Badge tone="neutral">
                            {t("{count} schedule(s)", {
                              count: connectionSchedules.length,
                            })}
                          </Badge>
                          <div className="ml-auto">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                !admin || busy || newDraft !== undefined
                              }
                              onClick={() =>
                                setNewScheduleFor((prev) => ({
                                  ...prev,
                                  [connection.id]: emptyScheduleDraft(
                                    connection.labId,
                                  ),
                                }))
                              }
                            >
                              <Plus className="size-3.5" />
                              {t("Add schedule")}
                            </Button>
                          </div>
                        </div>

                        {newDraft && (
                          <div className="space-y-3 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] p-3">
                            {scheduleEditor(newDraft, busy, (patch) =>
                              setNewScheduleFor((prev) => ({
                                ...prev,
                                [connection.id]: { ...newDraft, ...patch },
                              })),
                            )}
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                disabled={
                                  !admin ||
                                  busy ||
                                  !newDraft.name.trim() ||
                                  (newDraft.preset === "custom" &&
                                    !newDraft.cron.trim())
                                }
                                onClick={() =>
                                  void handleScheduleCreate(connection)
                                }
                              >
                                <CheckCircle2 className="size-3.5" />
                                {t("Create schedule")}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  setNewScheduleFor((prev) => ({
                                    ...prev,
                                    [connection.id]: undefined,
                                  }))
                                }
                              >
                                {t("Cancel")}
                              </Button>
                            </div>
                          </div>
                        )}

                        {connectionSchedules.map((schedule) => {
                          const draft =
                            scheduleDrafts[schedule.id] ??
                            draftFromSchedule(schedule);
                          const scheduleBusy = busyId === schedule.id;
                          const paused =
                            schedule.pausedUntil &&
                            new Date(schedule.pausedUntil).getTime() >
                              Date.now();
                          return (
                            <div
                              key={schedule.id}
                              className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                                  <input
                                    type="checkbox"
                                    checked={draft.enabled}
                                    disabled={!admin || scheduleBusy}
                                    onChange={(event) =>
                                      updateScheduleDraft(schedule, {
                                        enabled: event.target.checked,
                                      })
                                    }
                                  />
                                  {schedule.name}
                                </label>
                                <Badge
                                  tone={
                                    schedule.enabled
                                      ? runStatusTone(schedule.lastRunStatus)
                                      : "neutral"
                                  }
                                >
                                  {!schedule.enabled
                                    ? t("Auto-sync off")
                                    : schedule.lastRunStatus === "ok"
                                      ? t("Synced")
                                      : schedule.lastRunStatus === "drift"
                                        ? t("Drift")
                                        : schedule.lastRunStatus === "error"
                                          ? t("Error")
                                          : t("Never run")}
                                </Badge>
                                {paused && (
                                  <Badge tone="warn">{t("Backing off")}</Badge>
                                )}
                                {schedule.lastRunAt && (
                                  <span className="text-xs text-[var(--text-tertiary)]">
                                    {t("Last run: {time}", {
                                      time: new Date(
                                        schedule.lastRunAt,
                                      ).toLocaleString(undefined, {
                                        timeZone: "UTC",
                                        timeZoneName: "short",
                                      }),
                                    })}
                                  </span>
                                )}
                              </div>
                              {schedule.lastRunMessage &&
                                schedule.lastRunStatus !== "ok" && (
                                  <div
                                    className={
                                      schedule.lastRunStatus === "error"
                                        ? "text-xs text-[var(--danger)]"
                                        : "text-xs text-[var(--warning)]"
                                    }
                                  >
                                    {schedule.lastRunMessage}
                                  </div>
                                )}

                              {scheduleEditor(draft, scheduleBusy, (patch) =>
                                updateScheduleDraft(schedule, patch),
                              )}

                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  disabled={
                                    !admin ||
                                    scheduleBusy ||
                                    (draft.preset === "custom" &&
                                      !draft.cron.trim())
                                  }
                                  onClick={() =>
                                    void handleScheduleSave(schedule)
                                  }
                                >
                                  <CheckCircle2 className="size-3.5" />
                                  {scheduleBusy
                                    ? t("Saving...")
                                    : t("Save schedule")}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={
                                    !admin ||
                                    scheduleBusy ||
                                    !connection.enabled
                                  }
                                  onClick={() =>
                                    void handleScheduleRun(schedule)
                                  }
                                >
                                  <PlayCircle className="size-3.5" />
                                  {scheduleBusy
                                    ? t("Working...")
                                    : t("Run now")}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={!admin || scheduleBusy}
                                  onClick={() =>
                                    void handleScheduleDelete(schedule)
                                  }
                                >
                                  <Trash2 className="size-3.5" />
                                  {t("Delete")}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                        {!admin && (
                          <span className="text-xs text-[var(--color-fg-subtle)]">
                            {t(
                              "Administrator access is required to configure auto-sync.",
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {pull && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
            <div className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-2)] p-4 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {t("Inventory preview")}
                  </span>
                  {pullConnection && (
                    <Badge tone="info">{pullConnection.name}</Badge>
                  )}
                  <Badge tone="neutral">
                    {t(AUTO_SYNC_MODE_LABELS[syncMode])}
                  </Badge>
                  <span className="text-xs text-[var(--color-fg-subtle)]">
                    {t("+{vlanCreates} VLAN / +{subnetCreates} subnet", {
                      vlanCreates: pull.preview.summary.vlanCreates,
                      subnetCreates: pull.preview.summary.subnetCreates,
                    })}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPull(null)}
                  aria-label={t("Close")}
                >
                  <X className="size-3.5" />
                </Button>
              </div>

              {[...pull.warnings, ...pull.preview.warnings].map((warning) => (
                <div key={warning} className="text-xs text-[var(--warning)]">
                  {warning}
                </div>
              ))}

              <Tabs
                value={activePreviewTab}
                onValueChange={setPreviewTab}
                className="flex min-h-0 flex-1 flex-col gap-3"
              >
                <TabsList className="max-w-full overflow-x-auto [&>*]:shrink-0">
                  {visiblePreviewTabs.includes("vlans") && (
                    <TabsTrigger value="vlans">
                      {t("VLANs")} ({pull.preview.vlans.length})
                    </TabsTrigger>
                  )}
                  {visiblePreviewTabs.includes("subnets") && (
                    <TabsTrigger value="subnets">
                      {t("Subnets")} ({pull.preview.subnets.length})
                    </TabsTrigger>
                  )}
                  {visiblePreviewTabs.includes("dhcp") && (
                    <TabsTrigger value="dhcp">
                      {t("DHCP")} ({pull.preview.dhcp.scopes.length})
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="devices">
                    {t("Devices")} ({pull.devices.length})
                  </TabsTrigger>
                  {visiblePreviewTabs.includes("import") && (
                    <TabsTrigger value="import">
                      {t("Import")} (
                      {pull.deviceSync.devices.length +
                        pull.deviceSync.ssids.length +
                        pull.deviceSync.virtualSwitches.length}
                      )
                    </TabsTrigger>
                  )}
                </TabsList>

                <TabsContent
                  value="vlans"
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  <IntegrationDiffRows
                    emptyText={t("The controller reported no VLANs.")}
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
                </TabsContent>
                <TabsContent
                  value="subnets"
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  <IntegrationDiffRows
                    emptyText={t("The controller reported no subnets.")}
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
                </TabsContent>
                <TabsContent
                  value="dhcp"
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  <IntegrationDiffRows
                    emptyText={t("The controller reported no DHCP ranges.")}
                    rows={pull.preview.dhcp.scopes.map((scope, index) => ({
                      key: `dhcp-${index}`,
                      label: `${scope.startIp} – ${scope.endIp}`,
                      detail: scope.name,
                      action: "unchanged",
                      note: scope.subnetCidr ?? undefined,
                    }))}
                  />
                  {pull.preview.dhcp.scopes.length > 0 && (
                    <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
                      {t("DHCP ranges are shown for review and never applied.")}
                    </p>
                  )}
                </TabsContent>
                <TabsContent
                  value="devices"
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  {pull.devices.length === 0 ? (
                    <p className="text-sm text-[var(--color-fg-subtle)]">
                      {t("The controller reported no devices.")}
                    </p>
                  ) : (
                    <div className="rk-table-shell">
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
                  )}
                </TabsContent>
                <TabsContent
                  value="import"
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto"
                >
                  {pull.deviceSync.devices.length === 0 &&
                  pull.deviceSync.ssids.length === 0 &&
                  pull.deviceSync.virtualSwitches.length === 0 ? (
                    <p className="text-sm text-[var(--color-fg-subtle)]">
                      {t(
                        "Nothing importable — enable the device or SSID pull options on the connection.",
                      )}
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        {t(
                          "Physical gear is created as loose gear (no rack) with its ports; VMs and containers attach under their host with their virtual NICs. Matched records are never modified, and device IPs inside a known subnet are linked as IP assignments.",
                        )}
                      </p>
                      <IntegrationDiffRows
                        emptyText={t("The controller reported no devices.")}
                        rows={pull.deviceSync.devices.map((entry, index) => ({
                          key: `import-${entry.name}-${index}`,
                          label: entry.name,
                          detail: [
                            t(IMPORT_TYPE_LABELS[entry.deviceType] ?? "Other"),
                            entry.model ?? "",
                            entry.portCount > 0
                              ? t("{count} port(s)", {
                                  count: entry.portCount,
                                })
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · "),
                          action: entry.action,
                          selectId: entry.providerRecordId,
                          note: entry.existingHostname
                            ? t("matches {name}", {
                                name: entry.existingHostname,
                              })
                            : undefined,
                        }))}
                        selectedIds={selectedProviderRecordIds}
                        onSelectionChange={setSelectedProviderRecordIds}
                      />
                      {pull.deviceSync.virtualSwitches.length > 0 && (
                        <IntegrationDiffRows
                          emptyText={t("The controller reported no devices.")}
                          rows={pull.deviceSync.virtualSwitches.map(
                            (entry, index) => ({
                              key: `vswitch-${entry.name}-${index}`,
                              label: entry.name,
                              detail: t("Virtual switch on {name}", {
                                name: entry.hostName,
                              }),
                              action: entry.action,
                              selectId: entry.providerRecordId,
                            }),
                          )}
                          selectedIds={selectedProviderRecordIds}
                          onSelectionChange={setSelectedProviderRecordIds}
                        />
                      )}
                      {pull.deviceSync.ssids.length > 0 && (
                        <IntegrationDiffRows
                          emptyText={t("The controller reported no devices.")}
                          rows={pull.deviceSync.ssids.map((entry, index) => ({
                            key: `ssid-${entry.name}-${index}`,
                            label: entry.name,
                            detail: entry.vlanNumber
                              ? t("SSID · VLAN {number}", {
                                  number: entry.vlanNumber,
                                })
                              : t("SSID"),
                            action: entry.action,
                            selectId: entry.providerRecordId,
                          }))}
                          selectedIds={selectedProviderRecordIds}
                          onSelectionChange={setSelectedProviderRecordIds}
                        />
                      )}
                    </>
                  )}
                </TabsContent>
              </Tabs>

              <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-line)] pt-3">
                {isNetworkPreviewTab && (
                  <label
                    className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"
                    title={syncModeHint}
                  >
                    {t("Sync mode")}
                    <select
                      className="rk-control"
                      value={syncMode}
                      disabled={busyId === pull.connectionId}
                      onChange={(event) => {
                        const next = event.target
                          .value as IntegrationAutoSyncMode;
                        setSyncMode(next);
                        if (pullConnection) {
                          void handlePull(pullConnection, {
                            keepOpen: true,
                            mode: next,
                          });
                        }
                      }}
                    >
                      {(
                        Object.keys(
                          AUTO_SYNC_MODE_LABELS,
                        ) as IntegrationAutoSyncMode[]
                      ).map((mode) => (
                        <option key={mode} value={mode}>
                          {t(AUTO_SYNC_MODE_LABELS[mode])}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {isNetworkPreviewTab && !hasChanges && (
                  <span className="text-xs text-[var(--color-fg-subtle)]">
                    {t("Rackpad already matches this controller's inventory.")}
                  </span>
                )}
                {!isNetworkPreviewTab && importCreates === 0 && (
                  <span className="text-xs text-[var(--color-fg-subtle)]">
                    {t("Rackpad already matches this controller's inventory.")}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {admin ? (
                    isNetworkPreviewTab ? (
                      <Button
                        size="sm"
                        disabled={applying || !hasChanges}
                        onClick={() => void handleApply()}
                      >
                        <ShieldCheck className="size-3.5" />
                        {applying ? t("Applying...") : t("Apply networks")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={importingDevices || importCreates === 0}
                        title={t(
                          "Creates the new devices, ports, and SSIDs shown on the Import tab.",
                        )}
                        onClick={() => void handleImportDevices()}
                      >
                        <HardDriveDownload className="size-3.5" />
                        {importingDevices
                          ? t("Importing...")
                          : t("Import devices")}
                      </Button>
                    )
                  ) : (
                    <span className="text-xs text-[var(--color-fg-subtle)]">
                      {t(
                        "Administrator access is required to apply integration changes.",
                      )}
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPull(null)}
                  >
                    {t("Close")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function IntegrationDiffRows({
  rows,
  emptyText,
  selectedIds,
  onSelectionChange,
}: {
  rows: Array<{
    key: string;
    label: string;
    detail: string;
    action: string;
    note?: string;
    selectId?: string;
  }>;
  emptyText: string;
  selectedIds?: Set<string>;
  onSelectionChange?: (selected: Set<string>) => void;
}) {
  const { t } = useI18n();
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-fg-subtle)]">{emptyText}</p>;
  }
  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex items-center justify-between gap-3 rounded border border-[var(--color-line)] px-2 py-1 text-xs"
        >
          {row.selectId && selectedIds && onSelectionChange && (
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-[var(--accent-primary)]"
              checked={selectedIds.has(row.selectId)}
              disabled={row.action !== "create"}
              aria-label={t("Select {hostname}", { hostname: row.label })}
              onChange={(event) => {
                const next = new Set(selectedIds);
                if (event.target.checked) next.add(row.selectId!);
                else next.delete(row.selectId!);
                onSelectionChange(next);
              }}
            />
          )}
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
  );
}
