import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
import { TopBar } from "@/components/layout/TopBar";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { StatusDot } from "@/components/shared/StatusDot";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { Mono } from "@/components/shared/Mono";
import { PortGrid } from "@/components/ports/PortGrid";
import { PortList } from "@/components/ports/PortList";
import { api } from "@/lib/api";
import {
  canEditInventory,
  createDeviceImageRecord,
  createDeviceMonitorConfig,
  deleteDevice,
  deleteDeviceImageRecord,
  deleteDeviceMonitorConfig,
  loadAll,
  runDeviceMonitorCheck,
  runDeviceMonitorChecksForDevice,
  unassignIp,
  updateDeviceMonitorConfig,
  useStore,
} from "@/lib/store";
import type {
  Device,
  DeviceImage,
  DeviceMonitor,
  Port,
  PortLink,
  Vlan,
} from "@/lib/types";
import {
  ArrowLeft,
  ImagePlus,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { formatPortLabel, relativeTime, statusLabel } from "@/lib/utils";
import { formatDeviceAddress } from "@/lib/network-labels";
import {
  defaultImageLabel,
  imageSizeLimitLabel,
  readImageFileAsDataUrl,
} from "@/lib/image-data-url";

type MonitorForm = {
  name: string;
  enabled: boolean;
  type: DeviceMonitor["type"];
  target: string;
  port: string;
  path: string;
  intervalMinutes: string;
};

const EMPTY_MONITOR_FORM: MonitorForm = {
  name: "",
  enabled: false,
  type: "none",
  target: "",
  port: "",
  path: "",
  intervalMinutes: "5",
};

const NEW_MONITOR_ID = "__new_monitor__";

export default function DeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const devices = useStore((s) => s.devices);
  const ports = useStore((s) => s.ports);
  const portLinks = useStore((s) => s.portLinks);
  const virtualSwitches = useStore((s) => s.virtualSwitches);
  const vlans = useStore((s) => s.vlans);
  const ipAssignments = useStore((s) => s.ipAssignments);
  const auditLog = useStore((s) => s.auditLog);
  const racks = useStore((s) => s.racks);
  const deviceMonitors = useStore((s) => s.deviceMonitors);
  const deviceImages = useStore((s) => s.deviceImages);
  const canEdit = canEditInventory(currentUser);
  const canManageMonitoring = currentUser?.role === "admin";

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [selectedPortId, setSelectedPortId] = useState<string | undefined>();
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(
    null,
  );
  const [monitorForm, setMonitorForm] =
    useState<MonitorForm>(EMPTY_MONITOR_FORM);
  const [monitorSaving, setMonitorSaving] = useState(false);
  const [monitorRunning, setMonitorRunning] = useState(false);
  const [allMonitorsRunning, setAllMonitorsRunning] = useState(false);
  const [monitorDeleting, setMonitorDeleting] = useState(false);
  const [monitorError, setMonitorError] = useState("");
  const [activityEntries, setActivityEntries] = useState<typeof auditLog>([]);
  const [activityLimit, setActivityLimit] = useState(500);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [imageLabel, setImageLabel] = useState("");
  const [imageNotes, setImageNotes] = useState("");
  const [imageSaving, setImageSaving] = useState(false);
  const [imageDeletingId, setImageDeletingId] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const device = id ? devices.find((entry) => entry.id === id) : undefined;
  const deviceMonitorList = useMemo(
    () => (id ? deviceMonitors.filter((entry) => entry.deviceId === id) : []),
    [deviceMonitors, id],
  );
  const deviceImageList = useMemo(
    () => (id ? deviceImages.filter((entry) => entry.deviceId === id) : []),
    [deviceImages, id],
  );
  const selectedMonitor =
    selectedMonitorId && selectedMonitorId !== NEW_MONITOR_ID
      ? deviceMonitorList.find((entry) => entry.id === selectedMonitorId)
      : undefined;

  const portsByDeviceId = useMemo(() => {
    return ports.reduce<Record<string, Port[]>>((acc, port) => {
      (acc[port.deviceId] ??= []).push(port);
      return acc;
    }, {});
  }, [ports]);

  const linkByPortId = useMemo(() => {
    return portLinks.reduce<Record<string, PortLink>>((acc, link) => {
      acc[link.fromPortId] = link;
      acc[link.toPortId] = link;
      return acc;
    }, {});
  }, [portLinks]);

  const portById = useMemo(() => {
    return ports.reduce<Record<string, Port>>((acc, port) => {
      acc[port.id] = port;
      return acc;
    }, {});
  }, [ports]);

  const deviceById = useMemo(() => {
    return devices.reduce<Record<string, Device>>((acc, entry) => {
      acc[entry.id] = entry;
      return acc;
    }, {});
  }, [devices]);
  const vlanById = useMemo(() => {
    return vlans.reduce<Record<string, Vlan>>((acc, entry) => {
      acc[entry.id] = entry;
      return acc;
    }, {});
  }, [vlans]);
  const virtualSwitchById = useMemo(() => {
    return virtualSwitches.reduce<
      Record<string, (typeof virtualSwitches)[number]>
    >((acc, entry) => {
      acc[entry.id] = entry;
      return acc;
    }, {});
  }, [virtualSwitches]);

  useEffect(() => {
    setSelectedMonitorId(null);
    setImageLabel("");
    setImageNotes("");
    setImageError("");
  }, [device?.id]);

  useEffect(() => {
    if (!device) return;
    if (deviceMonitorList.length === 0) {
      if (selectedMonitorId !== NEW_MONITOR_ID) {
        setSelectedMonitorId(NEW_MONITOR_ID);
      }
      return;
    }
    if (
      !selectedMonitorId ||
      (selectedMonitorId !== NEW_MONITOR_ID &&
        !deviceMonitorList.some((entry) => entry.id === selectedMonitorId))
    ) {
      setSelectedMonitorId(deviceMonitorList[0].id);
    }
  }, [device, deviceMonitorList, selectedMonitorId]);

  useEffect(() => {
    if (!device) return;

    if (selectedMonitor) {
      setMonitorForm(monitorToForm(selectedMonitor, device));
    } else {
      setMonitorForm(buildNewMonitorForm(device, deviceMonitorList.length));
    }
    setMonitorError("");
  }, [device, selectedMonitor, deviceMonitorList.length]);

  const devicePorts = device?.id ? (portsByDeviceId[device.id] ?? []) : [];
  const rack = device?.rackId
    ? racks.find((entry) => entry.id === device.rackId)
    : undefined;
  const deviceIps = device?.id
    ? ipAssignments.filter((assignment) => assignment.deviceId === device.id)
    : [];
  const parentDevice = device?.parentDeviceId
    ? deviceById[device.parentDeviceId]
    : undefined;
  const childDevices = device
    ? devices.filter((entry) => entry.parentDeviceId === device.id)
    : [];
  const childCapacity = useMemo(
    () => ({
      cpu: childDevices.reduce((sum, entry) => sum + (entry.cpuCores ?? 0), 0),
      memory: childDevices.reduce(
        (sum, entry) => sum + (entry.memoryGb ?? 0),
        0,
      ),
      storage: childDevices.reduce(
        (sum, entry) => sum + (entry.storageGb ?? 0),
        0,
      ),
    }),
    [childDevices],
  );
  const selectedPort = selectedPortId
    ? devicePorts.find((port) => port.id === selectedPortId)
    : undefined;
  const selectedLink = selectedPort ? linkByPortId[selectedPort.id] : undefined;
  const peerPortId =
    selectedPort && selectedLink
      ? selectedLink.fromPortId === selectedPort.id
        ? selectedLink.toPortId
        : selectedLink.fromPortId
      : undefined;
  const peerPort = peerPortId ? portById[peerPortId] : undefined;
  const peerDevice = peerPort ? deviceById[peerPort.deviceId] : undefined;
  const linkedCount = devicePorts.filter(
    (port) => port.linkState === "up",
  ).length;
  const isVisualGrid =
    device?.deviceType === "switch" || device?.deviceType === "router";
  const hardwareMeta = [device?.manufacturer, device?.model]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!devicePorts.length) {
      setSelectedPortId(undefined);
      return;
    }
    if (
      !selectedPortId ||
      !devicePorts.some((port) => port.id === selectedPortId)
    ) {
      setSelectedPortId(devicePorts[0].id);
    }
  }, [devicePorts, selectedPortId]);

  useEffect(() => {
    if (!device) {
      setActivityEntries([]);
      return;
    }
    const filtered = auditLog.filter((entry) => entry.entityId === device.id);
    setActivityEntries(filtered);
    setActivityLimit(Math.max(500, filtered.length || 0));
    setActivityError("");
  }, [auditLog, device]);

  if (!device) {
    return (
      <>
        <TopBar subtitle="Devices" title="Not found" />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mb-3 text-sm text-[var(--color-fg-subtle)]">
              Device not found.
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/devices">
                <ArrowLeft />
                Back to devices
              </Link>
            </Button>
          </div>
        </div>
      </>
    );
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadAll(true);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete() {
    if (!device) return;
    if (
      !window.confirm(
        `Delete ${device.hostname}? This will remove its ports and IP assignments too.`,
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const deleted = await deleteDevice(device.id);
      if (deleted) {
        navigate("/devices");
      }
    } finally {
      setDeleting(false);
    }
  }

  async function handleUnassignIp(assignmentId: string) {
    setReleasingId(assignmentId);
    try {
      await unassignIp(assignmentId);
    } finally {
      setReleasingId(null);
    }
  }

  async function handleImageSelected(file: File | undefined) {
    if (!file || !device || !canEdit) return;
    setImageSaving(true);
    setImageError("");
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      await createDeviceImageRecord({
        deviceId: device.id,
        label: imageLabel.trim() || defaultImageLabel(file.name),
        fileName: file.name,
        mimeType: file.type,
        dataUrl,
        notes: imageNotes.trim() || null,
      });
      setImageLabel("");
      setImageNotes("");
    } catch (err) {
      setImageError(
        err instanceof Error ? err.message : "Failed to add image.",
      );
    } finally {
      setImageSaving(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function handleDeleteImage(image: DeviceImage) {
    if (!window.confirm(`Delete image ${image.label}?`)) return;
    setImageDeletingId(image.id);
    setImageError("");
    try {
      await deleteDeviceImageRecord(image.id);
    } catch (err) {
      setImageError(
        err instanceof Error ? err.message : "Failed to delete image.",
      );
    } finally {
      setImageDeletingId(null);
    }
  }

  async function handleSaveMonitor() {
    if (!device) return;
    setMonitorSaving(true);
    setMonitorError("");
    try {
      const usesPort =
        monitorForm.type === "tcp" ||
        monitorForm.type === "http" ||
        monitorForm.type === "https";
      const usesPath =
        monitorForm.type === "http" || monitorForm.type === "https";
      const payload = {
        name: monitorForm.name.trim() || null,
        enabled: monitorForm.enabled,
        type: monitorForm.enabled ? monitorForm.type : "none",
        target: monitorForm.target.trim() || null,
        port:
          usesPort && monitorForm.port.trim()
            ? Number.parseInt(monitorForm.port, 10)
            : null,
        path: usesPath ? monitorForm.path.trim() || null : null,
        intervalMs:
          Math.max(1, Number.parseInt(monitorForm.intervalMinutes, 10) || 5) *
          60 *
          1000,
      };

      if (selectedMonitor) {
        const updated = await updateDeviceMonitorConfig(
          selectedMonitor.id,
          payload,
        );
        if (updated && monitorForm.enabled && monitorForm.type !== "none") {
          await runDeviceMonitorCheck(updated.id);
        }
        return;
      }

      const created = await createDeviceMonitorConfig(device.id, payload);
      setSelectedMonitorId(created.id);
      if (monitorForm.enabled && monitorForm.type !== "none") {
        await runDeviceMonitorCheck(created.id);
      }
    } catch (err) {
      setMonitorError(
        err instanceof Error ? err.message : "Failed to save monitor.",
      );
    } finally {
      setMonitorSaving(false);
    }
  }

  async function handleRunMonitor() {
    if (!selectedMonitor) return;
    setMonitorRunning(true);
    setMonitorError("");
    try {
      await runDeviceMonitorCheck(selectedMonitor.id);
    } catch (err) {
      setMonitorError(
        err instanceof Error ? err.message : "Failed to run monitor.",
      );
    } finally {
      setMonitorRunning(false);
    }
  }

  async function handleRunAllMonitors() {
    if (!device) return;
    setAllMonitorsRunning(true);
    setMonitorError("");
    try {
      await runDeviceMonitorChecksForDevice(device.id);
    } catch (err) {
      setMonitorError(
        err instanceof Error ? err.message : "Failed to run device monitors.",
      );
    } finally {
      setAllMonitorsRunning(false);
    }
  }

  async function handleDeleteMonitor() {
    if (!selectedMonitor) return;
    if (!window.confirm(`Delete monitor target "${selectedMonitor.name}"?`)) {
      return;
    }

    setMonitorDeleting(true);
    setMonitorError("");
    try {
      const deleted = await deleteDeviceMonitorConfig(selectedMonitor.id);
      if (deleted) {
        setSelectedMonitorId(
          deviceMonitorList.length > 1 ? null : NEW_MONITOR_ID,
        );
      }
    } catch (err) {
      setMonitorError(
        err instanceof Error ? err.message : "Failed to delete monitor.",
      );
    } finally {
      setMonitorDeleting(false);
    }
  }

  function startNewMonitor() {
    if (!device) return;
    setSelectedMonitorId(NEW_MONITOR_ID);
    setMonitorForm(buildNewMonitorForm(device, deviceMonitorList.length));
    setMonitorError("");
  }

  async function handleLoadMoreActivity() {
    if (!device) return;
    const nextLimit = activityLimit + 250;
    setActivityLoading(true);
    setActivityError("");
    try {
      const entries = await api.getAuditLog({
        entityId: device.id,
        limit: nextLimit,
      });
      setActivityEntries(entries);
      setActivityLimit(nextLimit);
    } catch (err) {
      setActivityError(
        err instanceof Error
          ? err.message
          : "Failed to load additional audit entries.",
      );
    } finally {
      setActivityLoading(false);
    }
  }

  const showMonitorPortField =
    monitorForm.type === "tcp" ||
    monitorForm.type === "http" ||
    monitorForm.type === "https";
  const showMonitorPathField =
    monitorForm.type === "http" || monitorForm.type === "https";
  const monitorTypeDescription = describeMonitorType(monitorForm.type);
  const monitorStateTone =
    device.status === "online"
      ? "ok"
      : device.status === "offline"
        ? "err"
        : "neutral";
  const activeMonitorCount = deviceMonitorList.filter(
    (entry) => entry.enabled && entry.type !== "none",
  ).length;

  return (
    <>
      <TopBar
        subtitle={
          rack ? (
            <>
              Devices |{" "}
              <Link
                to={`/racks?rackId=${rack.id}`}
                className="hover:text-[var(--color-fg-muted)]"
              >
                {rack.name}
              </Link>
            </>
          ) : (
            "Devices"
          )
        }
        title={device.hostname}
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot status={device.status} />
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
                {statusLabel[device.status]}
              </span>
            </span>
            {hardwareMeta && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                | {hardwareMeta}
              </span>
            )}
          </>
        }
        actions={
          <>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDrawerOpen(true)}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
            >
              <RefreshCcw className="size-3.5" />
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
            {canEdit && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                <Trash2 className="size-3.5" />
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            )}
          </>
        }
      />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => void handleImageSelected(event.target.files?.[0])}
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/devices">
              <ArrowLeft className="size-3.5" />
              Devices
            </Link>
          </Button>
        </div>

        <Card className="relative mb-4 overflow-hidden">
          <span className="absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-[var(--color-accent)] to-transparent opacity-60" />
          <div className="flex items-center gap-5 px-5 py-4">
            <div className="grid size-12 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)]">
              <DeviceTypeIcon
                type={device.deviceType}
                className="size-5 text-[var(--color-accent)]"
              />
            </div>
            <div className="flex-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                {device.deviceType.replace("_", " ")}
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                {device.hostname}
              </h1>
              <div className="mt-0.5 text-xs text-[var(--color-fg-subtle)]">
                {device.displayName}
                {rack && (
                  <>
                    <span className="mx-1.5 text-[var(--color-fg-faint)]">
                      |
                    </span>
                    {device.placement === "shelf" && parentDevice
                      ? `${rack.name} | shelf ${parentDevice.hostname}`
                      : `${rack.name} U${device.startU}${
                          (device.heightU ?? 1) > 1
                            ? `-${device.startU! + device.heightU! - 1}`
                            : ""
                        }`}
                  </>
                )}
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-[11px]">
              <Stat
                label="Mgmt IP / MAC"
                value={formatDeviceAddress(device)}
                mono
              />
              <Stat label="Serial" value={device.serial} mono />
              <Stat label="Last seen" value={relativeTime(device.lastSeen)} />
              <Stat
                label="Ports"
                value={`${linkedCount}/${devicePorts.length} linked`}
              />
              <Stat label="IPs" value={String(deviceIps.length)} />
              <Stat label="Tags" value={device.tags?.join(", ") ?? "-"} />
            </dl>
          </div>
        </Card>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="ports">
              Ports | {devicePorts.length}
            </TabsTrigger>
            <TabsTrigger value="network">
              Network | {deviceIps.length}
            </TabsTrigger>
            <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
            <TabsTrigger value="images">
              Images | {deviceImageList.length}
            </TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="pt-4">
            <div className="grid grid-cols-12 gap-3">
              <Card className="col-span-12 md:col-span-6">
                <CardHeader>
                  <CardTitle>
                    <CardLabel>Hardware</CardLabel>
                    <CardHeading>Specifications</CardHeading>
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  <dl className="space-y-2 text-xs">
                    <Row label="Manufacturer" value={device.manufacturer} />
                    <Row label="Model" value={device.model} mono />
                    <Row label="Serial" value={device.serial} mono />
                    <Row
                      label="Type"
                      value={device.deviceType.replace("_", " ")}
                    />
                    <Row
                      label="CPU cores"
                      value={formatCapacityValue(device.cpuCores)}
                      mono
                    />
                    <Row
                      label="Memory"
                      value={formatCapacityUnit(device.memoryGb, "GB")}
                      mono
                    />
                    <Row
                      label="Storage"
                      value={formatCapacityUnit(device.storageGb, "GB")}
                      mono
                    />
                  </dl>
                  {device.specs && (
                    <div className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-fg-subtle)]">
                      {device.specs}
                    </div>
                  )}
                </CardBody>
              </Card>
              <Card className="col-span-12 md:col-span-6">
                <CardHeader>
                  <CardTitle>
                    <CardLabel>Placement</CardLabel>
                    <CardHeading>Rack position</CardHeading>
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  <dl className="space-y-2 text-xs">
                    <Row
                      label="Placement"
                      value={formatPlacement(device.placement)}
                    />
                    <Row label="Rack" value={rack?.name} />
                    <Row
                      label={
                        device.placement === "wireless"
                          ? "Connected AP"
                          : device.placement === "virtual"
                            ? "Host device"
                            : device.placement === "shelf"
                              ? "Rack shelf"
                              : "Parent"
                      }
                      value={parentDevice?.hostname}
                    />
                    <Row label="Face" value={device.face} />
                    <Row
                      label="U position"
                      value={
                        device.startU
                          ? `U${device.startU}${(device.heightU ?? 1) > 1 ? `-${device.startU + (device.heightU ?? 1) - 1}` : ""} (${device.heightU ?? 1}U)`
                          : undefined
                      }
                    />
                    <Row
                      label="Last seen"
                      value={relativeTime(device.lastSeen)}
                    />
                  </dl>
                </CardBody>
              </Card>
              {childDevices.length > 0 && (
                <Card className="col-span-12">
                  <CardHeader>
                    <CardTitle>
                      <CardLabel>Relationships</CardLabel>
                      <CardHeading>
                        {device.deviceType === "ap"
                          ? "Connected clients"
                          : "Hosted / child devices"}
                      </CardHeading>
                    </CardTitle>
                  </CardHeader>
                  <CardBody>
                    {(device.cpuCores ||
                      device.memoryGb ||
                      device.storageGb) && (
                      <div className="mb-3 grid gap-2 md:grid-cols-3">
                        <SummaryPill
                          label="CPU"
                          value={`${formatCapacityValue(childCapacity.cpu)} / ${formatCapacityValue(device.cpuCores)}`}
                        />
                        <SummaryPill
                          label="Memory"
                          value={`${formatCapacityValue(childCapacity.memory)} / ${formatCapacityValue(device.memoryGb)} GB`}
                        />
                        <SummaryPill
                          label="Storage"
                          value={`${formatCapacityValue(childCapacity.storage)} / ${formatCapacityValue(device.storageGb)} GB`}
                        />
                      </div>
                    )}
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {childDevices
                        .sort((a, b) => a.hostname.localeCompare(b.hostname))
                        .map((child) => (
                          <Link
                            key={child.id}
                            to={`/devices/${child.id}`}
                            className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 transition-colors hover:border-[var(--color-line-strong)] hover:bg-[var(--color-surface)]"
                          >
                            <div className="flex items-center gap-2">
                              <DeviceTypeIcon
                                type={child.deviceType}
                                className="size-4 text-[var(--color-accent)]"
                              />
                              <span className="text-sm text-[var(--color-fg)]">
                                {child.hostname}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
                              {child.displayName ||
                                formatDeviceAddress(child) ||
                                formatPlacement(child.placement)}
                            </div>
                          </Link>
                        ))}
                    </div>
                  </CardBody>
                </Card>
              )}
              {device.tags && device.tags.length > 0 && (
                <Card className="col-span-12">
                  <CardHeader>
                    <CardTitle>
                      <CardLabel>Metadata</CardLabel>
                      <CardHeading>Tags</CardHeading>
                    </CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="flex flex-wrap gap-1.5">
                      {device.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="ports" className="pt-4">
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 xl:col-span-8">
                {devicePorts.length === 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <CardLabel>Interfaces</CardLabel>
                        <CardHeading>No ports documented</CardHeading>
                      </CardTitle>
                    </CardHeader>
                    <CardBody>
                      <div className="text-sm text-[var(--color-fg-subtle)]">
                        Add or template ports for this device to inspect
                        cabling, VLANs, and interface notes here.
                      </div>
                    </CardBody>
                  </Card>
                ) : isVisualGrid ? (
                  <div className="space-y-4">
                    <PortGrid
                      device={device}
                      ports={devicePorts}
                      links={linkByPortId}
                      portsById={portById}
                      devicesById={deviceById}
                      vlansById={vlanById}
                      virtualSwitchesById={virtualSwitchById}
                      onSelectPort={setSelectedPortId}
                      selectedPortId={selectedPortId}
                    />
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          <CardLabel>Table</CardLabel>
                          <CardHeading>All ports</CardHeading>
                        </CardTitle>
                      </CardHeader>
                      <CardBody className="p-0">
                        <PortList
                          ports={devicePorts}
                          links={linkByPortId}
                          portsById={portById}
                          devicesById={deviceById}
                          vlansById={vlanById}
                          virtualSwitchesById={virtualSwitchById}
                          onSelectPort={setSelectedPortId}
                          selectedPortId={selectedPortId}
                        />
                      </CardBody>
                    </Card>
                  </div>
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <CardLabel>Interfaces</CardLabel>
                        <CardHeading>{devicePorts.length} ports</CardHeading>
                      </CardTitle>
                    </CardHeader>
                    <CardBody className="p-0">
                      <PortList
                        ports={devicePorts}
                        links={linkByPortId}
                        portsById={portById}
                        devicesById={deviceById}
                        vlansById={vlanById}
                        virtualSwitchesById={virtualSwitchById}
                        onSelectPort={setSelectedPortId}
                        selectedPortId={selectedPortId}
                      />
                    </CardBody>
                  </Card>
                )}
              </div>

              <div className="col-span-12 xl:col-span-4">
                <PortInspectorCard
                  port={selectedPort}
                  peerPort={peerPort}
                  peerDevice={peerDevice}
                  link={selectedLink}
                  vlansById={vlanById}
                  virtualSwitchesById={virtualSwitchById}
                  showFaceInHeading={device.deviceType === "patch_panel"}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="network" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>Addresses</CardLabel>
                  <CardHeading>IP assignments</CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-[var(--color-line)]">
                  {deviceIps.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-[var(--color-fg-subtle)]">
                      No IPs assigned to this device.
                    </div>
                  ) : (
                    deviceIps.map((ip) => (
                      <div
                        key={ip.id}
                        className="grid grid-cols-12 items-center gap-3 px-4 py-2"
                      >
                        <Mono className="col-span-3 text-[var(--color-fg)]">
                          {ip.ipAddress}
                        </Mono>
                        <div className="col-span-3 text-xs">{ip.hostname}</div>
                        <div className="col-span-4 text-[11px] text-[var(--color-fg-subtle)]">
                          {ip.description ?? "-"}
                        </div>
                        <div className="col-span-2 flex items-center justify-end gap-2">
                          <Badge tone="cyan">{ip.assignmentType}</Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={releasingId === ip.id || !canEdit}
                            onClick={() => void handleUnassignIp(ip.id)}
                          >
                            {releasingId === ip.id
                              ? "Releasing..."
                              : "Unassign"}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardBody>
            </Card>
          </TabsContent>

          <TabsContent value="monitoring" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>Health checks</CardLabel>
                  <CardHeading>Automated device monitoring</CardHeading>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge tone={monitorStateTone}>
                    <ShieldCheck className="size-3" />
                    {device.status}
                  </Badge>
                  <Badge tone="neutral">
                    {activeMonitorCount}/{deviceMonitorList.length} active
                    targets
                  </Badge>
                </div>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg-subtle)]">
                  Rackpad runs these checks from the server or Docker container
                  itself. A device stays
                  <span className="mx-1 font-mono text-[var(--color-fg)]">
                    unknown
                  </span>
                  until at least one enabled target has run.
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2">
                  <div className="text-sm text-[var(--color-fg-subtle)]">
                    Use separate targets for management IPs, storage NICs,
                    service ports, or VIPs on the same device.
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleRunAllMonitors()}
                      disabled={
                        !canManageMonitoring ||
                        allMonitorsRunning ||
                        activeMonitorCount === 0
                      }
                    >
                      <ShieldCheck className="size-3.5" />
                      {allMonitorsRunning
                        ? "Running all..."
                        : "Run all targets"}
                    </Button>
                    {canManageMonitoring && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={startNewMonitor}
                      >
                        <Plus className="size-3.5" />
                        Add target
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="space-y-2">
                    {deviceMonitorList.length === 0 ? (
                      <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-4 text-sm text-[var(--color-fg-subtle)]">
                        No monitor targets documented yet.
                      </div>
                    ) : (
                      deviceMonitorList.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => setSelectedMonitorId(entry.id)}
                          className={[
                            "w-full rounded-[var(--radius-sm)] border px-3 py-3 text-left transition-colors",
                            selectedMonitorId === entry.id
                              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                              : "border-[var(--color-line)] bg-[var(--color-bg)] hover:border-[var(--color-line-strong)]",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium text-[var(--color-fg)]">
                              {entry.name}
                            </div>
                            <Badge
                              tone={
                                entry.lastResult === "online"
                                  ? "ok"
                                  : entry.lastResult === "offline"
                                    ? "err"
                                    : "neutral"
                              }
                            >
                              {entry.lastResult ?? "unknown"}
                            </Badge>
                          </div>
                          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                            {entry.type}
                            {entry.target ? ` | ${entry.target}` : ""}
                            {entry.port ? `:${entry.port}` : ""}
                          </div>
                          <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                            {entry.lastMessage ?? "No checks have run yet."}
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="space-y-4 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                          {selectedMonitor ? "Monitor editor" : "New target"}
                        </div>
                        <div className="text-base font-medium text-[var(--color-fg)]">
                          {selectedMonitor
                            ? selectedMonitor.name
                            : "Create a new monitor target"}
                        </div>
                      </div>
                      {selectedMonitor && (
                        <Badge
                          tone={
                            selectedMonitor.lastResult === "online"
                              ? "ok"
                              : selectedMonitor.lastResult === "offline"
                                ? "err"
                                : "neutral"
                          }
                        >
                          {selectedMonitor.lastResult ?? "unknown"}
                        </Badge>
                      )}
                    </div>

                    <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)]">
                      <input
                        type="checkbox"
                        checked={monitorForm.enabled}
                        disabled={!canManageMonitoring}
                        onChange={(event) =>
                          setMonitorForm((prev) => ({
                            ...prev,
                            enabled: event.target.checked,
                          }))
                        }
                      />
                      Enable health checks for this target
                    </label>

                    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg-subtle)]">
                      {monitorTypeDescription}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <Field label="Name">
                        <Input
                          value={monitorForm.name}
                          disabled={!canManageMonitoring}
                          onChange={(event) =>
                            setMonitorForm((prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          placeholder="Management, Storage, WAN, VIP..."
                        />
                      </Field>
                      <Field label="Type">
                        <Select
                          value={monitorForm.type}
                          onChange={(value) =>
                            setMonitorForm((prev) => ({
                              ...prev,
                              type: value as MonitorForm["type"],
                            }))
                          }
                          disabled={!canManageMonitoring}
                        >
                          <option value="none">none</option>
                          <option value="icmp">icmp</option>
                          <option value="tcp">tcp</option>
                          <option value="http">http</option>
                          <option value="https">https</option>
                        </Select>
                      </Field>
                      <Field label="Target">
                        <Input
                          value={monitorForm.target}
                          disabled={!canManageMonitoring}
                          onChange={(event) =>
                            setMonitorForm((prev) => ({
                              ...prev,
                              target: event.target.value,
                            }))
                          }
                          placeholder="10.0.10.12 or host.example"
                        />
                      </Field>
                      <Field label="Every (minutes)">
                        <Input
                          value={monitorForm.intervalMinutes}
                          disabled={!canManageMonitoring}
                          onChange={(event) =>
                            setMonitorForm((prev) => ({
                              ...prev,
                              intervalMinutes: event.target.value,
                            }))
                          }
                          placeholder="5"
                        />
                      </Field>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {showMonitorPortField && (
                        <Field label="Port">
                          <Input
                            value={monitorForm.port}
                            disabled={!canManageMonitoring}
                            onChange={(event) =>
                              setMonitorForm((prev) => ({
                                ...prev,
                                port: event.target.value,
                              }))
                            }
                            placeholder={
                              monitorForm.type === "tcp"
                                ? "22, 443, 8006"
                                : monitorForm.type === "https"
                                  ? "443"
                                  : "80"
                            }
                          />
                        </Field>
                      )}
                      {showMonitorPathField && (
                        <Field label="HTTP path">
                          <Input
                            value={monitorForm.path}
                            disabled={!canManageMonitoring}
                            onChange={(event) =>
                              setMonitorForm((prev) => ({
                                ...prev,
                                path: event.target.value,
                              }))
                            }
                            placeholder="/health"
                          />
                        </Field>
                      )}
                    </div>

                    <div className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 md:grid-cols-3">
                      <MonitorStat
                        label="Last check"
                        value={
                          selectedMonitor?.lastCheckAt
                            ? new Date(
                                selectedMonitor.lastCheckAt,
                              ).toLocaleString()
                            : "Never"
                        }
                      />
                      <MonitorStat
                        label="Last result"
                        value={selectedMonitor?.lastResult ?? "unknown"}
                      />
                      <MonitorStat
                        label="Message"
                        value={
                          selectedMonitor?.lastMessage ??
                          "No checks have run yet."
                        }
                      />
                    </div>
                  </div>
                </div>

                {monitorError && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                    {monitorError}
                  </div>
                )}

                {!canManageMonitoring && (
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-info)]/30 bg-[var(--color-info-bg)] px-3 py-2 text-sm text-[var(--color-info)]">
                    Only administrators can create, edit, delete, or run active
                    monitor targets.
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRunMonitor()}
                    disabled={
                      !canManageMonitoring || monitorRunning || !selectedMonitor
                    }
                  >
                    <ShieldCheck className="size-3.5" />
                    {monitorRunning ? "Running..." : "Run now"}
                  </Button>
                  {canManageMonitoring && selectedMonitor && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleDeleteMonitor()}
                      disabled={monitorDeleting}
                    >
                      <Trash2 className="size-3.5" />
                      {monitorDeleting ? "Deleting..." : "Delete target"}
                    </Button>
                  )}
                  {canManageMonitoring && (
                    <Button
                      size="sm"
                      onClick={() => void handleSaveMonitor()}
                      disabled={monitorSaving}
                    >
                      <Save className="size-3.5" />
                      {monitorSaving
                        ? "Saving..."
                        : selectedMonitor
                          ? "Save target"
                          : "Create target"}
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          </TabsContent>

          <TabsContent value="images" className="pt-4">
            <div className="grid grid-cols-12 gap-4">
              {canEdit && (
                <Card className="col-span-12 lg:col-span-4">
                  <CardHeader>
                    <CardTitle>
                      <CardLabel>Reference</CardLabel>
                      <CardHeading>Add image</CardHeading>
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="space-y-3">
                    {imageError && (
                      <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                        {imageError}
                      </div>
                    )}
                    <Input
                      value={imageLabel}
                      onChange={(event) => setImageLabel(event.target.value)}
                      placeholder="Label"
                    />
                    <textarea
                      value={imageNotes}
                      onChange={(event) => setImageNotes(event.target.value)}
                      className="rk-control rk-textarea min-h-24 w-full text-sm"
                      placeholder="Notes"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                        {imageSizeLimitLabel()} max
                      </Mono>
                      <Button
                        size="sm"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={imageSaving}
                      >
                        <ImagePlus className="size-3.5" />
                        {imageSaving ? "Adding..." : "Choose image"}
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              )}

              <Card
                className={
                  canEdit ? "col-span-12 lg:col-span-8" : "col-span-12"
                }
              >
                <CardHeader>
                  <CardTitle>
                    <CardLabel>Reference</CardLabel>
                    <CardHeading>{deviceImageList.length} images</CardHeading>
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  {deviceImageList.length === 0 ? (
                    <div className="text-sm text-[var(--color-fg-subtle)]">
                      No images attached to this device yet.
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {deviceImageList.map((image) => (
                        <div
                          key={image.id}
                          className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bg)]"
                        >
                          <img
                            src={image.dataUrl}
                            alt={image.label}
                            className="h-56 w-full bg-black/20 object-contain"
                            loading="lazy"
                          />
                          <div className="space-y-2 border-t border-[var(--color-line)] p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                                  {image.label}
                                </div>
                                <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                                  {relativeTime(image.createdAt)}
                                </Mono>
                              </div>
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => void handleDeleteImage(image)}
                                  disabled={imageDeletingId === image.id}
                                >
                                  <Trash2 />
                                </Button>
                              )}
                            </div>
                            {image.notes && (
                              <div className="text-xs leading-5 text-[var(--color-fg-subtle)]">
                                {image.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="notes" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>Documentation</CardLabel>
                  <CardHeading>Device notes</CardHeading>
                </CardTitle>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDrawerOpen(true)}
                  >
                    <Pencil className="size-3.5" />
                    Edit notes
                  </Button>
                )}
              </CardHeader>
              <CardBody>
                {device.notes?.trim() ? (
                  <div className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-fg)]">
                    {device.notes}
                  </div>
                ) : (
                  <div className="text-sm text-[var(--color-fg-subtle)]">
                    No notes documented for this device yet.
                  </div>
                )}
              </CardBody>
            </Card>
          </TabsContent>

          <TabsContent value="activity" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>History</CardLabel>
                  <CardHeading>Audit log</CardHeading>
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleLoadMoreActivity()}
                  disabled={activityLoading}
                >
                  <RefreshCcw className="size-3.5" />
                  {activityLoading ? "Loading..." : "Load more"}
                </Button>
              </CardHeader>
              <CardBody className="p-0">
                {activityError && (
                  <div className="border-b border-[var(--color-line)] px-4 py-3 text-sm text-[var(--color-err)]">
                    {activityError}
                  </div>
                )}
                <ul className="divide-y divide-[var(--color-line)]">
                  {activityEntries.length === 0 ? (
                    <li className="px-4 py-6 text-center text-xs text-[var(--color-fg-subtle)]">
                      No audit entries for this device.
                    </li>
                  ) : (
                    activityEntries.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-start gap-3 px-4 py-2.5 hover:bg-[var(--color-surface)]/40"
                      >
                        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs">{entry.summary}</div>
                          <div className="mt-0.5 flex items-center gap-2">
                            <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                              {entry.user}
                            </Mono>
                            <span className="text-[10px] text-[var(--color-fg-faint)]">
                              |
                            </span>
                            <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                              {entry.action}
                            </Mono>
                          </div>
                        </div>
                        <span className="whitespace-nowrap font-mono text-[10px] text-[var(--color-fg-faint)]">
                          {relativeTime(entry.ts)}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </CardBody>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {canEdit && (
        <DeviceDrawer
          device={device}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  );
}

function PortInspectorCard({
  port,
  peerPort,
  peerDevice,
  link,
  vlansById,
  virtualSwitchesById,
  showFaceInHeading = false,
}: {
  port?: Port;
  peerPort?: Port;
  peerDevice?: Device;
  link?: PortLink;
  vlansById: Record<string, Vlan>;
  virtualSwitchesById: Record<string, { id: string; name: string }>;
  showFaceInHeading?: boolean;
}) {
  const primaryVlan = port?.vlanId ? vlansById[port.vlanId] : undefined;
  const allowedVlanLabels =
    port?.allowedVlanIds?.map((vlanId) =>
      formatVlanReference(vlanId, vlansById),
    ) ?? [];
  const virtualSwitch = port?.virtualSwitchId
    ? virtualSwitchesById[port.virtualSwitchId]
    : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>Inspector</CardLabel>
          <CardHeading>
            {port
              ? formatPortLabel(port, {
                  includeFace: showFaceInHeading || port.face === "rear",
                })
              : "Select a port"}
          </CardHeading>
        </CardTitle>
        {port ? <Badge tone="cyan">{port.kind.replace("_", " ")}</Badge> : null}
      </CardHeader>
      <CardBody className="space-y-4">
        {!port ? (
          <div className="text-sm text-[var(--color-fg-subtle)]">
            Click a port to inspect its speed, VLAN, description, and cable
            peer.
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
              <InspectorRow label="State">
                <span className="inline-flex items-center gap-2 text-sm text-[var(--color-fg)]">
                  <StatusDot link={port.linkState} />
                  {formatLinkState(port.linkState)}
                </span>
              </InspectorRow>
              <InspectorRow
                label="Speed"
                value={port.speed ?? "Not set"}
                mono
              />
              <InspectorRow label="Mode" value={port.mode ?? "access"} />
              <InspectorRow label="Face" value={port.face ?? "front"} />
              <InspectorRow
                label="Position"
                value={String(port.position)}
                mono
              />
              <InspectorRow
                label={port.mode === "trunk" ? "Native VLAN" : "Access VLAN"}
                value={
                  primaryVlan
                    ? formatVlanReference(primaryVlan.id, vlansById)
                    : port.mode === "trunk"
                      ? "None (tagged only)"
                      : "Unassigned"
                }
              />
              {port.mode === "trunk" && (
                <InspectorRow
                  label="Tagged VLANs"
                  value={
                    allowedVlanLabels.length > 0
                      ? allowedVlanLabels.join(", ")
                      : "None documented"
                  }
                />
              )}
              <InspectorRow
                label="Virtual switch"
                value={
                  virtualSwitch?.name ??
                  (port.virtualSwitchId ? port.virtualSwitchId : "None")
                }
              />
              <InspectorRow label="Type" value={port.kind.replace("_", " ")} />
            </div>

            <div className="space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                Description
              </div>
              <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]">
                {port.description?.trim() || "No description documented."}
              </div>
            </div>

            <div className="space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                Link peer
              </div>
              <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2">
                {peerDevice && peerPort ? (
                  <div className="space-y-1 text-sm">
                    <div className="text-[var(--color-fg)]">
                      {peerDevice.hostname}
                      <span className="mx-1 text-[var(--color-fg-faint)]">
                        |
                      </span>
                      <Mono className="text-[var(--color-cyan)]">
                        {formatPortLabel(peerPort, { includeFace: true })}
                      </Mono>
                    </div>
                    <div className="text-[11px] text-[var(--color-fg-subtle)]">
                      {link?.cableType ?? "Cable"} |{" "}
                      {link?.cableLength ?? "length n/a"}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-[var(--color-fg-subtle)]">
                    No linked cable.
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" asChild>
                <Link to="/ports">Open in ports workspace</Link>
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function InspectorRow({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      {children ?? (
        <div
          className={`mt-1 text-sm text-[var(--color-fg)] ${mono ? "font-mono" : ""}`}
        >
          {value ?? "-"}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2 text-sm text-[var(--color-fg)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]"
    >
      {children}
    </select>
  );
}

function MonitorStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="mt-1 text-sm text-[var(--color-fg)]">{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 capitalize">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
        {label}
      </dt>
      <dd
        className={`text-right text-[var(--color-fg)] normal-case ${mono ? "font-mono text-[11px]" : "text-xs"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
        {label}
      </dt>
      <dd
        className={
          mono ? "font-mono text-[var(--color-fg)]" : "text-[var(--color-fg)]"
        }
      >
        {value ?? "-"}
      </dd>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="mt-1 text-sm text-[var(--color-fg)]">{value}</div>
    </div>
  );
}

function buildNewMonitorForm(
  device: Device,
  existingCount: number,
): MonitorForm {
  const defaultTarget = existingCount === 0 ? (device.managementIp ?? "") : "";
  return {
    name: existingCount === 0 ? "Management" : `Target ${existingCount + 1}`,
    enabled: Boolean(defaultTarget),
    type: defaultTarget ? "icmp" : "none",
    target: defaultTarget,
    port: "",
    path: "",
    intervalMinutes: "5",
  };
}

function monitorToForm(monitor: DeviceMonitor, device: Device): MonitorForm {
  return {
    name: monitor.name,
    enabled: monitor.enabled,
    type: monitor.type,
    target: monitor.target ?? device.managementIp ?? "",
    port: monitor.port != null ? String(monitor.port) : "",
    path: monitor.path ?? "",
    intervalMinutes:
      monitor.intervalMs != null
        ? String(Math.max(1, Math.round(monitor.intervalMs / 60000)))
        : "5",
  };
}

function describeMonitorType(type: MonitorForm["type"]) {
  switch (type) {
    case "icmp":
      return 'ICMP is best for simple reachability. It answers "can the Rackpad server or container reach this host on the network?"';
    case "tcp":
      return "TCP checks a specific service port from the Rackpad server. Port 22 only shows online when SSH itself is reachable from the server or container.";
    case "http":
      return "HTTP checks fetch a URL from the Rackpad server and expect a successful response.";
    case "https":
      return "HTTPS checks fetch a secure URL from the Rackpad server and expect a successful response.";
    default:
      return "Choose a monitor type to enable automated health checks for this device.";
  }
}

function formatLinkState(state: Port["linkState"]) {
  switch (state) {
    case "up":
      return "Up";
    case "down":
      return "Down";
    case "disabled":
      return "Disabled";
    default:
      return "Unknown";
  }
}

function formatVlanReference(vlanId: string, vlansById: Record<string, Vlan>) {
  const vlan = vlansById[vlanId];
  return vlan ? `${vlan.vlanId} - ${vlan.name}` : vlanId;
}

function formatPlacement(placement?: Device["placement"]) {
  switch (placement) {
    case "rack":
      return "Rack mounted";
    case "wireless":
      return "WiFi linked";
    case "virtual":
      return "Virtual";
    case "shelf":
      return "On rack shelf";
    case "room":
      return "Loose / room";
    default:
      return "Loose / room";
  }
}

function formatCapacityValue(value?: number) {
  if (value == null) return "-";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatCapacityUnit(value: number | undefined, unit: string) {
  const formatted = formatCapacityValue(value);
  return formatted === "-" ? undefined : `${formatted} ${unit}`;
}
