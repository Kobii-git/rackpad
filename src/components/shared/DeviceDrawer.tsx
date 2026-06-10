import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { X, Save, Network, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Separator } from "@/components/ui/Separator";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import {
  createDevice,
  createDeviceTypeRecord,
  previewNextIpAllocation,
  updateDevice,
  updateDiscoveredDeviceRecord,
  useStore,
} from "@/lib/store";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/translations";
import { deviceTypeLabel } from "@/lib/device-types";
import { statusLabel } from "@/lib/utils";
import type {
  Device,
  DeviceStatus,
  DeviceType,
  DiscoveredDevice,
  IpAllocationMode,
  IpAssignmentType,
  RackFace,
} from "@/lib/types";

const STATUS_OPTIONS: DeviceStatus[] = [
  "online",
  "offline",
  "warning",
  "maintenance",
  "unknown",
];

interface FormState {
  hostname: string;
  displayName: string;
  deviceType: DeviceType;
  manufacturer: string;
  model: string;
  serial: string;
  managementIp: string;
  macAddress: string;
  networkMode: NonNullable<Device["networkMode"]>;
  ipAllocationMode: IpAllocationMode;
  ipSubnetId: string;
  dhcpScopeId: string;
  status: DeviceStatus;
  placement: NonNullable<Device["placement"]>;
  parentDeviceId: string;
  roomId: string;
  cpuCores: string;
  memoryGb: string;
  storageGb: string;
  specs: string;
  rackId: string;
  startU: string;
  heightU: string;
  face: RackFace;
  portTemplateId: string;
  tags: string;
  notes: string;
}

interface ShelfFormState {
  hostname: string;
  rackId: string;
  startU: string;
  heightU: string;
  face: RackFace;
}

function blankForm(defaults?: Partial<FormState>): FormState {
  return {
    hostname: "",
    displayName: "",
    deviceType: "server",
    manufacturer: "",
    model: "",
    serial: "",
    managementIp: "",
    macAddress: "",
    networkMode: "normal",
    ipAllocationMode: "static",
    ipSubnetId: "",
    dhcpScopeId: "",
    status: "unknown",
    placement: defaults?.rackId ? "rack" : "room",
    parentDeviceId: "",
    roomId: "",
    cpuCores: "",
    memoryGb: "",
    storageGb: "",
    specs: "",
    rackId: "",
    startU: "",
    heightU: "1",
    face: "front",
    portTemplateId: "",
    tags: "",
    notes: "",
    ...defaults,
  };
}

function blankShelfForm(defaultRackId?: string): ShelfFormState {
  return {
    hostname: "",
    rackId: defaultRackId ?? "",
    startU: "",
    heightU: "1",
    face: "front",
  };
}

function deviceToForm(device: Device): FormState {
  return {
    hostname: device.hostname,
    displayName: device.displayName ?? "",
    deviceType: device.deviceType,
    manufacturer: device.manufacturer ?? "",
    model: device.model ?? "",
    serial: device.serial ?? "",
    managementIp: device.managementIp ?? "",
    macAddress: device.macAddress ?? "",
    networkMode: device.networkMode ?? "normal",
    ipAllocationMode: "static",
    ipSubnetId: "",
    dhcpScopeId: "",
    status: device.status,
    placement: device.placement ?? (device.rackId ? "rack" : "room"),
    parentDeviceId: device.parentDeviceId ?? "",
    roomId: device.roomId ?? "",
    cpuCores: device.cpuCores != null ? String(device.cpuCores) : "",
    memoryGb: device.memoryGb != null ? String(device.memoryGb) : "",
    storageGb: device.storageGb != null ? String(device.storageGb) : "",
    specs: device.specs ?? "",
    rackId: device.rackId ?? "",
    startU: device.startU != null ? String(device.startU) : "",
    heightU: device.heightU != null ? String(device.heightU) : "1",
    face: device.face ?? "front",
    portTemplateId: "",
    tags: (device.tags ?? []).join(", "),
    notes: device.notes ?? "",
  };
}

interface DeviceDrawerProps {
  device?: Device;
  defaultRackId?: string;
  defaults?: Partial<FormState>;
  open: boolean;
  onClose: () => void;
  onSaved?: (device: Device) => void;
}

export function DeviceDrawer({
  device,
  defaultRackId,
  defaults,
  open,
  onClose,
  onSaved,
}: DeviceDrawerProps) {
  const { t } = useI18n();
  const racks = useStore((s) => s.racks);
  const rooms = useStore((s) => s.rooms);
  const devices = useStore((s) => s.devices);
  const discoveredDevices = useStore((s) => s.discoveredDevices);
  const deviceTypes = useStore((s) => s.deviceTypes);
  const ports = useStore((s) => s.ports);
  const portTemplates = useStore((s) => s.portTemplates);
  const subnets = useStore((s) => s.subnets);
  const scopes = useStore((s) => s.scopes);
  const isEdit = !!device;
  const [form, setForm] = useState<FormState>(() =>
    device
      ? deviceToForm(device)
      : blankForm({ rackId: defaultRackId ?? "", ...defaults }),
  );
  const [error, setError] = useState("");
  const [shelfError, setShelfError] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingShelf, setCreatingShelf] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [creatingType, setCreatingType] = useState(false);
  const [customTypeLabel, setCustomTypeLabel] = useState("");
  const [shelfForm, setShelfForm] = useState<ShelfFormState>(() =>
    blankShelfForm(defaultRackId),
  );
  const [selectedDiscoveryId, setSelectedDiscoveryId] = useState("");

  useEffect(() => {
    if (open) {
      setForm(
        device
          ? deviceToForm(device)
          : blankForm({ rackId: defaultRackId ?? "", ...defaults }),
      );
      setError("");
      setShelfError("");
      setAddingType(false);
      setCreatingType(false);
      setCustomTypeLabel("");
      setShelfForm(blankShelfForm(defaultRackId));
      setSelectedDiscoveryId("");
    }
  }, [defaultRackId, defaults, device, open]);

  const availableDeviceTypes = useMemo(() => {
    if (deviceTypes.some((entry) => entry.id === form.deviceType)) {
      return deviceTypes;
    }
    return [
      ...deviceTypes,
      {
        id: form.deviceType,
        label: deviceTypeLabel(form.deviceType, deviceTypes),
        builtIn: false,
      },
    ];
  }, [deviceTypes, form.deviceType]);

  const devicePortCount = useMemo(
    () =>
      device ? ports.filter((port) => port.deviceId === device.id).length : 0,
    [device, ports],
  );

  const canApplyTemplate = !device || devicePortCount === 0;
  const selectedTemplate = portTemplates.find(
    (template) => template.id === form.portTemplateId,
  );
  const compatibleTemplates = useMemo(
    () =>
      portTemplates.filter((template) =>
        template.deviceTypes.includes(form.deviceType),
      ),
    [form.deviceType, portTemplates],
  );
  const isRackMounted = form.placement === "rack";
  const isShelfMounted = form.placement === "shelf";
  const parentCandidates = useMemo(() => {
    return devices
      .filter((entry) => !device || entry.id !== device.id)
      .filter((entry) => {
        if (form.placement === "wireless") return entry.deviceType === "ap";
        if (form.placement === "virtual")
          return !["vm", "container"].includes(entry.deviceType);
        if (form.placement === "shelf")
          return entry.deviceType === "rack_shelf";
        return true;
      })
      .sort((a, b) => a.hostname.localeCompare(b.hostname));
  }, [device, devices, form.placement]);
  const showParentSelector =
    form.placement === "wireless" ||
    form.placement === "virtual" ||
    form.placement === "shelf";
  const discoveryCandidates = useMemo(() => {
    if (isEdit) return [];
    return discoveredDevices
      .filter(
        (entry) => !entry.importedDeviceId && !entry.technicalRole,
      )
      .sort((a, b) =>
        discoverySortLabel(a).localeCompare(discoverySortLabel(b)),
      );
  }, [discoveredDevices, isEdit]);
  const parentLabel = useMemo(() => {
    if (form.placement === "wireless") return t("Connected AP");
    if (form.placement === "shelf") return t("Rack shelf / tray");
    return t("Host device");
  }, [form.placement, t]);
  const parentHost = form.parentDeviceId
    ? devices.find((entry) => entry.id === form.parentDeviceId)
    : undefined;
  const canUseHostSharedNetworking =
    form.placement === "virtual" &&
    (form.deviceType === "vm" || form.deviceType === "container") &&
    Boolean(form.parentDeviceId);
  const managementIp = form.managementIp.trim();
  const managementSubnet = managementIp
    ? subnets.find((subnet) => cidrContainsIp(subnet.cidr, managementIp))
    : undefined;
  const selectedIpSubnetId =
    form.ipSubnetId || managementSubnet?.id || subnets[0]?.id || "";
  const scopesForSelectedSubnet = useMemo(
    () => scopes.filter((scope) => scope.subnetId === selectedIpSubnetId),
    [scopes, selectedIpSubnetId],
  );
  const matchingDhcpScope = managementIp
    ? scopesForSelectedSubnet.find((scope) =>
        ipInRange(managementIp, scope.startIp, scope.endIp),
      )
    : undefined;
  const effectiveDhcpScopeId =
    form.dhcpScopeId ||
    matchingDhcpScope?.id ||
    scopesForSelectedSubnet[0]?.id ||
    "";
  const managementAssignmentType = useMemo<IpAssignmentType>(() => {
    if (form.deviceType === "vm") return "vm";
    if (form.deviceType === "container") return "container";
    return "device";
  }, [form.deviceType]);
  const nextIpPreview = useMemo(() => {
    if (isEdit || canUseHostSharedNetworking || !selectedIpSubnetId)
      return null;
    return previewNextIpAllocation(
      selectedIpSubnetId,
      managementAssignmentType,
      {
        allocationMode: form.ipAllocationMode,
        dhcpScopeId:
          form.ipAllocationMode === "dhcp-reservation"
            ? effectiveDhcpScopeId || null
            : null,
      },
    );
  }, [
    canUseHostSharedNetworking,
    effectiveDhcpScopeId,
    form.ipAllocationMode,
    isEdit,
    managementAssignmentType,
    selectedIpSubnetId,
  ]);
  const managementIpInDhcpPool = Boolean(matchingDhcpScope);

  useEffect(() => {
    if (!form.portTemplateId) return;
    if (
      compatibleTemplates.some(
        (template) => template.id === form.portTemplateId,
      )
    )
      return;
    setForm((prev) => ({ ...prev, portTemplateId: "" }));
  }, [compatibleTemplates, form.portTemplateId]);

  useEffect(() => {
    if (form.placement === "rack") return;
    setForm((prev) => ({
      ...prev,
      rackId: "",
      startU: "",
      heightU: form.placement === "shelf" ? prev.heightU || "1" : "1",
      face: "front",
    }));
  }, [form.placement]);

  useEffect(() => {
    if (form.deviceType !== "rack_shelf") return;
    if (form.placement === "rack") return;
    setForm((prev) => ({ ...prev, placement: "rack", parentDeviceId: "" }));
  }, [form.deviceType, form.placement]);

  useEffect(() => {
    if (showParentSelector) return;
    if (!form.parentDeviceId) return;
    setForm((prev) => ({ ...prev, parentDeviceId: "" }));
  }, [form.parentDeviceId, showParentSelector]);

  useEffect(() => {
    if (canUseHostSharedNetworking) return;
    if (form.networkMode === "normal") return;
    setForm((prev) => ({ ...prev, networkMode: "normal" }));
  }, [canUseHostSharedNetworking, form.networkMode]);

  useEffect(() => {
    if (isEdit) return;
    if (!selectedIpSubnetId || form.ipSubnetId) return;
    setForm((prev) => ({ ...prev, ipSubnetId: selectedIpSubnetId }));
  }, [form.ipSubnetId, isEdit, selectedIpSubnetId]);

  useEffect(() => {
    if (isEdit || form.ipAllocationMode !== "dhcp-reservation") return;
    if (
      form.dhcpScopeId &&
      scopesForSelectedSubnet.some((scope) => scope.id === form.dhcpScopeId)
    ) {
      return;
    }
    setForm((prev) => ({
      ...prev,
      dhcpScopeId:
        matchingDhcpScope?.id ?? scopesForSelectedSubnet[0]?.id ?? "",
    }));
  }, [
    form.dhcpScopeId,
    form.ipAllocationMode,
    isEdit,
    matchingDhcpScope?.id,
    scopesForSelectedSubnet,
  ]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setShelf<K extends keyof ShelfFormState>(
    key: K,
    value: ShelfFormState[K],
  ) {
    setShelfForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyDiscoveredHost(discoveryId: string) {
    setSelectedDiscoveryId(discoveryId);
    if (!discoveryId) return;
    const discovered = discoveryCandidates.find(
      (entry) => entry.id === discoveryId,
    );
    if (!discovered) return;

    setForm((prev) => ({
      ...prev,
      hostname: discoveredHostname(discovered) || prev.hostname,
      displayName: discovered.displayName?.trim() || prev.displayName,
      deviceType: discovered.deviceType ?? prev.deviceType,
      manufacturer: discovered.vendor?.trim() || prev.manufacturer,
      managementIp: discovered.ipAddress,
      macAddress: discovered.macAddress?.trim() || prev.macAddress,
      status: prev.status === "unknown" ? "online" : prev.status,
      placement: shouldUseDiscoveryPlacement(defaults, prev, discovered)
        ? discovered.placement!
        : prev.placement,
      tags: mergeTagText(prev.tags, ["discovered", discovered.source]),
      notes: mergeNoteText(prev.notes, discovered.notes),
    }));
  }

  async function handleCreateShelf() {
    setShelfError("");

    const hostname = shelfForm.hostname.trim();
    const rackId = shelfForm.rackId.trim();
    const startU = Number.parseInt(shelfForm.startU, 10);
    const heightU = Number.parseInt(shelfForm.heightU, 10) || 1;

    if (!hostname) {
      setShelfError(t("Shelf hostname is required."));
      return;
    }
    if (!rackId) {
      setShelfError(t("Select the rack that contains this shelf / tray."));
      return;
    }
    if (!Number.isFinite(startU) || startU < 1) {
      setShelfError(t("Start U must be 1 or higher."));
      return;
    }

    setCreatingShelf(true);
    try {
      const created = await createDevice({
        hostname,
        deviceType: "rack_shelf",
        status: "unknown",
        placement: "rack",
        rackId,
        startU,
        heightU,
        face: shelfForm.face,
        tags: ["shelf"],
      });

      setForm((prev) => ({
        ...prev,
        placement: "shelf",
        parentDeviceId: created.id,
      }));
      setShelfForm(blankShelfForm(rackId));
    } catch (err) {
      setShelfError(
        err instanceof Error
          ? err.message
          : t("Failed to create rack shelf / tray."),
      );
    } finally {
      setCreatingShelf(false);
    }
  }

  async function handleCreateDeviceType() {
    setError("");
    const label = customTypeLabel.trim();
    if (!label) {
      setError(t("Device type name is required."));
      return;
    }

    setCreatingType(true);
    try {
      const created = await createDeviceTypeRecord({ label });
      set("deviceType", created.id);
      setCustomTypeLabel("");
      setAddingType(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Failed to create device type."),
      );
    } finally {
      setCreatingType(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const usesHostSharedNetworking =
      canUseHostSharedNetworking && form.networkMode === "host-shared";

    if (!form.hostname.trim()) {
      setError(t("Hostname is required."));
      return;
    }
    if (
      !isEdit &&
      !usesHostSharedNetworking &&
      managementIp &&
      managementIpInDhcpPool &&
      form.ipAllocationMode !== "dhcp-reservation"
    ) {
      setError(
        t(
          "This management IP is inside a DHCP pool. Choose DHCP reservation for the device assignment.",
        ),
      );
      return;
    }
    if (
      !isEdit &&
      !usesHostSharedNetworking &&
      managementIp &&
      form.ipAllocationMode === "dhcp-reservation" &&
      !effectiveDhcpScopeId
    ) {
      setError(t("Select a DHCP pool for this reservation."));
      return;
    }

    setSaving(true);
    try {
      const tags = form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const nextNetworkMode: NonNullable<Device["networkMode"]> =
        usesHostSharedNetworking ? "host-shared" : "normal";

      const basePayload = {
        hostname: form.hostname.trim(),
        displayName: form.displayName.trim() || undefined,
        deviceType: form.deviceType,
        manufacturer: form.manufacturer.trim() || undefined,
        model: form.model.trim() || undefined,
        serial: form.serial.trim() || undefined,
        managementIp: usesHostSharedNetworking
          ? form.managementIp.trim() || parentHost?.managementIp || undefined
          : form.managementIp.trim() || undefined,
        macAddress: form.macAddress.trim() || undefined,
        networkMode: nextNetworkMode,
        status: form.status,
        placement: form.placement,
        parentDeviceId:
          showParentSelector && form.parentDeviceId
            ? form.parentDeviceId
            : undefined,
        cpuCores: form.cpuCores.trim()
          ? Number.parseInt(form.cpuCores, 10)
          : undefined,
        memoryGb: form.memoryGb.trim()
          ? Number.parseFloat(form.memoryGb)
          : undefined,
        storageGb: form.storageGb.trim()
          ? Number.parseFloat(form.storageGb)
          : undefined,
        specs: form.specs.trim() || undefined,
        rackId: isRackMounted ? form.rackId : undefined,
        roomId: !isRackMounted && form.roomId ? form.roomId : undefined,
        startU:
          isRackMounted && form.startU
            ? Number.parseInt(form.startU, 10)
            : undefined,
        heightU:
          isRackMounted || isShelfMounted
            ? form.heightU
              ? Number.parseInt(form.heightU, 10)
              : 1
            : undefined,
        face: isRackMounted ? form.face : undefined,
        portTemplateId:
          canApplyTemplate && form.portTemplateId
            ? form.portTemplateId
            : undefined,
        tags: tags.length > 0 ? tags : undefined,
        notes: form.notes.trim() || undefined,
      };

      const saved =
        isEdit && device
          ? await updateDevice(device.id, basePayload)
          : await createDevice({
              ...basePayload,
              ipAllocationMode: form.ipAllocationMode,
              dhcpScopeId:
                form.ipAllocationMode === "dhcp-reservation"
                  ? effectiveDhcpScopeId || undefined
                  : undefined,
            });

      if (saved) {
        if (!isEdit && selectedDiscoveryId) {
          await updateDiscoveredDeviceRecord(selectedDiscoveryId, {
            status: "imported",
            importedDeviceId: saved.id,
            hostname: saved.hostname,
            displayName: saved.displayName ?? null,
            deviceType: saved.deviceType,
            placement: saved.placement ?? null,
            lastSeen: saved.lastSeen ?? new Date().toISOString(),
          });
        }
        onSaved?.(saved);
        onClose();
      } else {
        setError(t("Failed to save device. Please try again."));
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to save device. Please try again."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/40"
            onClick={onClose}
          />

          <motion.aside
            key="drawer-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 z-40 flex h-full w-[460px] flex-col border-l border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--bg-shell)_94%,black_6%)]"
            style={{ boxShadow: "-16px 0 48px rgb(0 0 0 / 0.4)" }}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-3.5">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                  {isEdit ? t("Edit") : t("New")}
                </div>
                <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
                  {isEdit ? device.hostname : t("Add device")}
                </h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label={t("Close")}
              >
                <X />
              </Button>
            </div>

            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                {!isEdit && discoveryCandidates.length > 0 && (
                  <>
                    <Section label={t("Discovery")}>
                      <Field label={t("Use discovered host")}>
                        <Select
                          value={selectedDiscoveryId}
                          onChange={applyDiscoveredHost}
                        >
                          <option value="">{t("Start blank")}</option>
                          {discoveryCandidates.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {discoveryOptionLabel(entry)}
                            </option>
                          ))}
                        </Select>
                        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                          {selectedDiscoveryId
                            ? t(
                                "Selected discovery data will be marked imported when this device is saved.",
                              )
                            : t(
                                "Populate hostname, IP, MAC, vendor, and device type from a discovered host.",
                              )}
                        </p>
                      </Field>
                    </Section>
                    <Separator />
                  </>
                )}

                <Section label={t("Identity")}>
                  <Field label={t("Hostname *")}>
                    <Input
                      value={form.hostname}
                      onChange={(event) => set("hostname", event.target.value)}
                      placeholder="e.g. core-sw-01"
                      autoFocus
                    />
                  </Field>
                  <Field label={t("Display name")}>
                    <Input
                      value={form.displayName}
                      onChange={(event) =>
                        set("displayName", event.target.value)
                      }
                      placeholder="e.g. Core Switch"
                    />
                  </Field>
                  <div className="block">
                    <span className="rk-field-label">{t("Device type")}</span>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <Select
                        value={form.deviceType}
                        onChange={(value) =>
                          set("deviceType", value as DeviceType)
                        }
                      >
                        {availableDeviceTypes.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.label}
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAddingType((value) => !value)}
                      >
                        <Plus className="size-3.5" />
                        {t("Type")}
                      </Button>
                    </div>
                    {addingType && (
                      <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                        <Input
                          value={customTypeLabel}
                          onChange={(event) =>
                            setCustomTypeLabel(event.target.value)
                          }
                          placeholder="e.g. Camera"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleCreateDeviceType()}
                          disabled={creatingType}
                        >
                          {creatingType ? t("Adding...") : t("Add")}
                        </Button>
                      </div>
                    )}
                  </div>
                  <Field label={t("Status")}>
                    <div className="flex flex-wrap gap-1.5">
                      {STATUS_OPTIONS.map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => set("status", status)}
                          className={cn(
                            "rounded-[var(--radius-xs)] border px-2 py-1 font-mono text-[10px] uppercase tracking-wider capitalize transition-colors",
                            form.status === status
                              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                              : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]",
                          )}
                        >
                          {t(statusLabel[status] as TranslationKey)}
                        </button>
                      ))}
                    </div>
                  </Field>
                </Section>

                <Separator />

                <Section label={t("Hardware")}>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t("Manufacturer")}>
                      <Input
                        value={form.manufacturer}
                        onChange={(event) =>
                          set("manufacturer", event.target.value)
                        }
                        placeholder="e.g. Cisco"
                      />
                    </Field>
                    <Field label={t("Model")}>
                      <Input
                        value={form.model}
                        onChange={(event) => set("model", event.target.value)}
                        placeholder="e.g. C9300-48P"
                      />
                    </Field>
                  </div>
                  <Field label={t("Serial number")}>
                    <Input
                      value={form.serial}
                      onChange={(event) => set("serial", event.target.value)}
                      placeholder="e.g. FOC2134X0AB"
                    />
                  </Field>
                  <Field label={t("Management IP")}>
                    <Input
                      value={form.managementIp}
                      onChange={(event) =>
                        set("managementIp", event.target.value)
                      }
                      placeholder="e.g. 10.0.10.12"
                    />
                  </Field>
                  {!isEdit &&
                    !canUseHostSharedNetworking &&
                    subnets.length > 0 && (
                      <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--surface-1)] p-3">
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {(["static", "dhcp-reservation"] as const).map(
                            (mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() =>
                                  setForm((prev) => ({
                                    ...prev,
                                    ipAllocationMode: mode,
                                    dhcpScopeId:
                                      mode === "dhcp-reservation"
                                        ? effectiveDhcpScopeId
                                        : "",
                                  }))
                                }
                                className={cn(
                                  "rounded-[var(--radius-xs)] border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                                  form.ipAllocationMode === mode
                                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                                    : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]",
                                )}
                              >
                                {mode === "dhcp-reservation"
                                  ? t("DHCP reservation")
                                  : t("Static IP")}
                              </button>
                            ),
                          )}
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <Field label={t("Subnet")}>
                            <Select
                              value={selectedIpSubnetId}
                              onChange={(value) =>
                                setForm((prev) => ({
                                  ...prev,
                                  ipSubnetId: value,
                                  dhcpScopeId: "",
                                }))
                              }
                            >
                              {subnets.map((subnet) => (
                                <option key={subnet.id} value={subnet.id}>
                                  {subnet.cidr} · {subnet.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          {form.ipAllocationMode === "dhcp-reservation" ? (
                            <Field label={t("DHCP pool")}>
                              <Select
                                value={effectiveDhcpScopeId}
                                onChange={(value) => set("dhcpScopeId", value)}
                                disabled={scopesForSelectedSubnet.length === 0}
                              >
                                {scopesForSelectedSubnet.length === 0 ? (
                                  <option value="">{t("No DHCP pool")}</option>
                                ) : (
                                  scopesForSelectedSubnet.map((scope) => (
                                    <option key={scope.id} value={scope.id}>
                                      {scope.name}
                                    </option>
                                  ))
                                )}
                              </Select>
                            </Field>
                          ) : (
                            <div />
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 text-xs text-[var(--color-fg-subtle)]">
                            {managementIp && managementIpInDhcpPool
                              ? t("{ip} is in {scope}.", {
                                  ip: managementIp,
                                  scope: matchingDhcpScope?.name ?? "",
                                })
                              : nextIpPreview
                                ? form.ipAllocationMode === "dhcp-reservation"
                                  ? t("Next reservation IP: {ipAddress}", {
                                      ipAddress: nextIpPreview.ipAddress,
                                    })
                                  : t("Next static IP: {ipAddress}", {
                                      ipAddress: nextIpPreview.ipAddress,
                                    })
                                : t("No available address for this selection.")}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!nextIpPreview}
                            onClick={() => {
                              if (!nextIpPreview) return;
                              setForm((prev) => ({
                                ...prev,
                                managementIp: nextIpPreview.ipAddress,
                                ipAllocationMode: nextIpPreview.allocationMode,
                                dhcpScopeId: nextIpPreview.dhcpScopeId ?? "",
                              }));
                            }}
                          >
                            {t("Use next IP")}
                          </Button>
                        </div>
                      </div>
                    )}
                  {canUseHostSharedNetworking && (
                    <Field label={t("Network mode")}>
                      <div className="grid grid-cols-2 gap-1">
                        {(["normal", "host-shared"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                networkMode: mode,
                                managementIp:
                                  mode === "host-shared" &&
                                  parentHost?.managementIp
                                    ? parentHost.managementIp
                                    : prev.managementIp,
                              }))
                            }
                            className={cn(
                              "rounded-[var(--radius-xs)] border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
                              form.networkMode === mode
                                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                                : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]",
                            )}
                          >
                            {mode === "host-shared"
                              ? t("Host shared")
                              : t("Normal")}
                          </button>
                        ))}
                      </div>
                      {form.networkMode === "host-shared" && (
                        <p className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--surface-1)] px-3 py-2 text-[11px] text-[var(--color-fg-subtle)]">
                          {parentHost?.managementIp
                            ? t(
                                "Shares {hostname} at {ip}. Leave the inherited IP here or blank; Rackpad will not create a duplicate IPAM row for this child.",
                                {
                                  hostname:
                                    parentHost.hostname ?? t("the parent host"),
                                  ip: parentHost.managementIp,
                                },
                              )
                            : t(
                                "Shares {hostname}'s management IP. Leave the inherited IP here or blank; Rackpad will not create a duplicate IPAM row for this child.",
                                {
                                  hostname:
                                    parentHost?.hostname ??
                                    t("the parent host"),
                                },
                              )}
                        </p>
                      )}
                    </Field>
                  )}
                  <Field label={t("MAC address")}>
                    <Input
                      value={form.macAddress}
                      onChange={(event) =>
                        set("macAddress", event.target.value)
                      }
                      placeholder="e.g. aa:bb:cc:dd:ee:ff"
                    />
                  </Field>
                </Section>

                <Separator />

                <Section label={t("Capacity & specs")}>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label={t("CPU cores")}>
                      <Input
                        type="number"
                        min={1}
                        value={form.cpuCores}
                        onChange={(event) =>
                          set("cpuCores", event.target.value)
                        }
                        placeholder="e.g. 8"
                      />
                    </Field>
                    <Field label={t("Memory (GB)")}>
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        value={form.memoryGb}
                        onChange={(event) =>
                          set("memoryGb", event.target.value)
                        }
                        placeholder="64"
                      />
                    </Field>
                    <Field label={t("Storage (GB)")}>
                      <Input
                        type="number"
                        min={0}
                        step="1"
                        value={form.storageGb}
                        onChange={(event) =>
                          set("storageGb", event.target.value)
                        }
                        placeholder="2000"
                      />
                    </Field>
                  </div>
                  <Field label={t("Specs")}>
                    <textarea
                      value={form.specs}
                      onChange={(event) => set("specs", event.target.value)}
                      placeholder={t(
                        "CPU generation, RAID layout, GPU, NIC details, or VM sizing notes...",
                      )}
                      rows={3}
                      className="rk-control rk-textarea w-full text-sm font-sans"
                    />
                  </Field>
                </Section>

                <Separator />

                <Section label={t("Placement")}>
                  <Field label={t("Placement")}>
                    <Select
                      value={form.placement}
                      onChange={(value) =>
                        set("placement", value as FormState["placement"])
                      }
                    >
                      <option value="rack">{t("Rack mounted")}</option>
                      <option value="room">{t("Loose / room tech")}</option>
                      {form.deviceType !== "rack_shelf" && (
                        <option value="shelf">
                          {t("On rack shelf / tray")}
                        </option>
                      )}
                      <option value="wireless">{t("WiFi / AP linked")}</option>
                      <option value="virtual">{t("Virtual / hosted")}</option>
                    </Select>
                  </Field>

                  {showParentSelector && (
                    <>
                      <Field label={parentLabel}>
                        <Select
                          value={form.parentDeviceId}
                          onChange={(value) => set("parentDeviceId", value)}
                        >
                          <option value="">
                            {form.placement === "wireless"
                              ? t("No AP selected")
                              : form.placement === "shelf"
                                ? t("No rack shelf selected")
                                : t("No host selected")}
                          </option>
                          {parentCandidates.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.hostname}
                            </option>
                          ))}
                        </Select>
                      </Field>

                      {form.placement === "shelf" && !form.parentDeviceId && (
                        <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--surface-1)] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold text-[var(--color-fg)]">
                                {t("Need a shelf / tray first?")}
                              </div>
                              <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                                {t(
                                  "Create the rack shelf here, then this device can be attached to it without closing the drawer.",
                                )}
                              </div>
                            </div>
                            <Badge tone="neutral">{t("Rack device")}</Badge>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-3">
                            <Field label={t("Shelf hostname")}>
                              <Input
                                value={shelfForm.hostname}
                                onChange={(event) =>
                                  setShelf("hostname", event.target.value)
                                }
                                placeholder="e.g. cmp-shelf-u32"
                              />
                            </Field>
                            <Field label={t("Rack")}>
                              <Select
                                value={shelfForm.rackId}
                                onChange={(value) => setShelf("rackId", value)}
                              >
                                <option value="">{t("Select rack")}</option>
                                {racks.map((rack) => (
                                  <option key={rack.id} value={rack.id}>
                                    {rack.name}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label={t("Start U")}>
                              <Input
                                type="number"
                                min={1}
                                value={shelfForm.startU}
                                onChange={(event) =>
                                  setShelf("startU", event.target.value)
                                }
                                placeholder="e.g. 32"
                              />
                            </Field>
                            <Field label={t("Height (U)")}>
                              <Input
                                type="number"
                                min={1}
                                value={shelfForm.heightU}
                                onChange={(event) =>
                                  setShelf("heightU", event.target.value)
                                }
                              />
                            </Field>
                          </div>

                          <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
                            <Field label={t("Face")}>
                              <Select
                                value={shelfForm.face}
                                onChange={(value) =>
                                  setShelf("face", value as RackFace)
                                }
                              >
                                <option value="front">{t("Front")}</option>
                                <option value="rear">{t("Rear")}</option>
                              </Select>
                            </Field>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void handleCreateShelf()}
                              disabled={creatingShelf}
                            >
                              <Plus className="size-3.5" />
                              {creatingShelf
                                ? t("Creating...")
                                : t("Create shelf")}
                            </Button>
                          </div>

                          {shelfError && (
                            <div className="mt-3 rounded-[var(--radius-sm)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                              {shelfError}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {!isRackMounted && (
                    <Field label={t("Room")}>
                      <Select
                        value={form.roomId}
                        onChange={(value) => set("roomId", value)}
                      >
                        <option value="">{t("No room selected")}</option>
                        {rooms.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </Select>
                      {rooms.length === 0 && (
                        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                          {t(
                            "Create rooms from the Racks workspace to group loose, wireless, and shelf-adjacent gear.",
                          )}
                        </p>
                      )}
                    </Field>
                  )}
                </Section>

                <Separator />

                <Section label={t("Ports")}>
                  <Field label={t("Port template")}>
                    <Select
                      value={form.portTemplateId}
                      onChange={(value) => set("portTemplateId", value)}
                      disabled={!canApplyTemplate}
                    >
                      <option value="">{t("No template")}</option>
                      {compatibleTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {!canApplyTemplate ? (
                    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-fg-subtle)]">
                      {t(
                        "This device already has {count} ports. Templates can only be applied to empty devices.",
                        { count: devicePortCount },
                      )}
                    </div>
                  ) : selectedTemplate ? (
                    <div className="rounded-[var(--radius-sm)] border border-[var(--color-accent-soft)]/30 bg-[var(--color-accent)]/5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                            {t("Template preview")}
                          </div>
                          <div className="text-sm text-[var(--color-fg)]">
                            {selectedTemplate.description}
                          </div>
                        </div>
                        <Badge tone="accent">
                          <Network className="size-3" />
                          {t("{count} ports", {
                            count: selectedTemplate.ports.length,
                          })}
                        </Badge>
                      </div>
                    </div>
                  ) : null}
                </Section>

                <Separator />

                <Section
                  label={
                    isShelfMounted ? t("Shelf footprint") : t("Rack placement")
                  }
                >
                  {isRackMounted && (
                    <Field label={t("Rack")}>
                      <Select
                        value={form.rackId}
                        onChange={(value) => set("rackId", value)}
                      >
                        <option value="">{t("Unracked")}</option>
                        {racks.map((rack) => (
                          <option key={rack.id} value={rack.id}>
                            {rack.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}

                  {isRackMounted && (
                    <div className="grid grid-cols-3 gap-3">
                      <Field label={t("Start U")}>
                        <Input
                          type="number"
                          min={1}
                          max={48}
                          value={form.startU}
                          onChange={(event) =>
                            set("startU", event.target.value)
                          }
                          placeholder="e.g. 12"
                        />
                      </Field>
                      <Field label={t("Height (U)")}>
                        <Input
                          type="number"
                          min={1}
                          max={12}
                          value={form.heightU}
                          onChange={(event) =>
                            set("heightU", event.target.value)
                          }
                          placeholder="1"
                        />
                      </Field>
                      <Field label={t("Face")}>
                        <Select
                          value={form.face}
                          onChange={(value) => set("face", value as RackFace)}
                        >
                          <option value="front">{t("Front")}</option>
                          <option value="rear">{t("Rear")}</option>
                        </Select>
                      </Field>
                    </div>
                  )}

                  {isShelfMounted && (
                    <Field label={t("Device footprint (U)")}>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={form.heightU}
                        onChange={(event) => set("heightU", event.target.value)}
                        placeholder="1"
                      />
                      <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
                        {t(
                          "Used by rack and visualizer views to size devices inside multi-U shelves.",
                        )}
                      </p>
                    </Field>
                  )}
                </Section>

                <Separator />

                <Section label={t("Metadata")}>
                  <Field label={t("Tags (comma-separated)")}>
                    <Input
                      value={form.tags}
                      onChange={(event) => set("tags", event.target.value)}
                      placeholder="e.g. core, managed, poe"
                    />
                  </Field>
                  <Field label={t("Notes")}>
                    <textarea
                      value={form.notes}
                      onChange={(event) => set("notes", event.target.value)}
                      placeholder={t("Any additional notes...")}
                      rows={3}
                      className="rk-control rk-textarea w-full text-sm font-sans"
                    />
                  </Field>
                </Section>
              </div>

              <div className="border-t border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-1)_24%,transparent)] px-5 py-3">
                {error && (
                  <p className="mb-2 text-xs text-[var(--color-err)]">
                    {error}
                  </p>
                )}
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                  >
                    {t("Cancel")}
                  </Button>
                  <Button
                    type="submit"
                    variant="default"
                    size="sm"
                    disabled={saving}
                  >
                    <Save className="size-3.5" />
                    {isEdit ? t("Save changes") : t("Add device")}
                  </Button>
                </div>
              </div>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="rk-kicker">{label}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="rk-field-label">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={cn(
        "rk-control h-8 w-full px-2 text-sm font-sans",
        "text-[var(--text-primary)]",
      )}
    >
      {children}
    </select>
  );
}

function discoverySortLabel(discovered: DiscoveredDevice) {
  return (
    discovered.hostname?.trim() ||
    discovered.displayName?.trim() ||
    discovered.ipAddress
  ).toLowerCase();
}

function discoveryOptionLabel(discovered: DiscoveredDevice) {
  return [
    discovered.hostname?.trim() || discovered.displayName?.trim(),
    discovered.ipAddress,
    discovered.macAddress?.trim(),
    discovered.vendor?.trim(),
  ]
    .filter(Boolean)
    .join(" | ");
}

function discoveredHostname(discovered: DiscoveredDevice) {
  return (
    discovered.hostname?.trim() ||
    discovered.displayName?.trim() ||
    `host-${discovered.ipAddress.replaceAll(".", "-")}`
  );
}

function shouldUseDiscoveryPlacement(
  defaults: Partial<FormState> | undefined,
  form: FormState,
  discovered: DiscoveredDevice,
) {
  if (defaults?.placement || form.parentDeviceId || form.rackId) return false;
  return discovered.placement === "room";
}

function mergeTagText(existing: string, additions: Array<string | null>) {
  const tags = new Set(
    existing
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  );
  for (const tag of additions) {
    const value = tag?.trim();
    if (value) tags.add(value);
  }
  return [...tags].join(", ");
}

function mergeNoteText(existing: string, incoming?: string | null) {
  const next = incoming?.trim();
  if (!next) return existing;
  if (!existing.trim()) return next;
  if (existing.includes(next)) return existing;
  return `${existing}\n\n${next}`;
}

function cidrContainsIp(cidr: string, ipAddress: string) {
  const [networkAddress, prefixRaw] = cidr.split("/");
  const network = ipv4ToInt(networkAddress);
  const target = ipv4ToInt(ipAddress);
  const prefix = Number.parseInt(prefixRaw ?? "", 10);
  if (network == null || target == null || !Number.isInteger(prefix)) {
    return false;
  }
  if (prefix < 0 || prefix > 32) return false;
  const hostBits = 32 - prefix;
  const broadcast = hostBits === 0 ? network : network + (2 ** hostBits - 1);
  return target >= network && target <= broadcast;
}

function ipInRange(ipAddress: string, startIp: string, endIp: string) {
  const target = ipv4ToInt(ipAddress);
  const start = ipv4ToInt(startIp);
  const end = ipv4ToInt(endIp);
  if (target == null || start == null || end == null) return false;
  return target >= start && target <= end;
}

function ipv4ToInt(ipAddress: string) {
  const octets = ipAddress.split(".");
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    if (!/^\d+$/.test(octet)) return null;
    const parsed = Number.parseInt(octet, 10);
    if (parsed < 0 || parsed > 255) return null;
    value = (value << 8) + parsed;
  }
  return value >>> 0;
}
