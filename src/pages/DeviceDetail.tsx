import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
import { TopBar } from "@/components/layout/TopBar";
import { useI18n } from "@/i18n";
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
import {
  SnmpCredentialsPanel,
} from "@/components/shared/SnmpCredentialsPanel";
import { SnmpSyncPanel } from "@/components/shared/SnmpSyncPanel";
import { api } from "@/lib/api";
import { buildSnmpVerifiedPortIdsForDevice } from "@/lib/snmp-port-status";
import {
  canEditInventory,
  createIpAssignmentRecord,
  createDeviceImageRecord,
  createDeviceMonitorConfig,
  createDeviceServiceRecord,
  deleteDevice,
  deleteDeviceImageRecord,
  deleteDeviceMonitorConfig,
  deleteDeviceServiceRecord,
  loadAll,
  runDeviceMonitorCheck,
  runDeviceMonitorChecksForDevice,
  unassignIp,
  updateDeviceMonitorConfig,
  updateDeviceServiceRecord,
  useStore,
} from "@/lib/store";
import type {
  Device,
  DeviceImage,
  DeviceMonitor,
  DeviceService,
  DeviceServiceType,
  DiscoveredSnmpInterface,
  IpAllocationMode,
  IpAssignment,
  IpAssignmentType,
  Port,
  PortLink,
  SnmpCredential,
  Subnet,
  Vlan,
} from "@/lib/types";
import {
  ArrowLeft,
  Download,
  ExternalLink,
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
import { downloadImageAsset, openImageAsset } from "@/lib/image-actions";

type MonitorForm = {
  name: string;
  enabled: boolean;
  type: DeviceMonitor["type"];
  target: string;
  port: string;
  path: string;
  snmpVersion: "1" | "2c";
  snmpCommunity: string;
  snmpOid: string;
  snmpExpectedValue: string;
  snmpMatchMode: NonNullable<DeviceMonitor["snmpMatchMode"]>;
  portId: string;
  snmpIfIndex: string;
  snmpCredentialId: string;
  intervalMinutes: string;
};

const SNMP_MATCH_MODE_OPTIONS: Array<{
  value: NonNullable<DeviceMonitor["snmpMatchMode"]>;
  label: string;
}> = [
  { value: "any", label: "Any response" },
  { value: "equals", label: "Equals" },
  { value: "notEquals", label: "Not equals" },
  { value: "in", label: "In list (comma-separated)" },
];

const SNMP_OID_PRESETS = [
  {
    id: "custom",
    label: "Custom OID",
    oid: "",
    expected: "",
    matchMode: "equals" as const,
  },
  {
    id: "sysUpTime",
    label: "sysUpTime (uptime)",
    oid: "1.3.6.1.2.1.1.3.0",
    expected: "",
    matchMode: "any" as const,
  },
  {
    id: "ifOperStatus",
    label: "ifOperStatus (link up)",
    oid: "1.3.6.1.2.1.2.2.1.8",
    expected: "1",
    matchMode: "equals" as const,
  },
];

const EMPTY_MONITOR_FORM: MonitorForm = {
  name: "",
  enabled: false,
  type: "none",
  target: "",
  port: "",
  path: "",
  snmpVersion: "2c",
  snmpCommunity: "public",
  snmpOid: "",
  snmpExpectedValue: "",
  snmpMatchMode: "equals",
  portId: "",
  snmpIfIndex: "",
  snmpCredentialId: "",
  intervalMinutes: "5",
};

type NetworkIpForm = {
  subnetId: string;
  ipAddress: string;
  assignmentType: IpAssignmentType;
  allocationMode: IpAllocationMode;
  dhcpScopeId: string;
  portId: string;
  description: string;
};

const EMPTY_NETWORK_IP_FORM: NetworkIpForm = {
  subnetId: "",
  ipAddress: "",
  assignmentType: "interface",
  allocationMode: "static",
  dhcpScopeId: "",
  portId: "",
  description: "",
};

type ServiceForm = {
  name: string;
  serviceType: DeviceServiceType;
  ipAssignmentId: string;
  portId: string;
  vlanId: string;
  monitorId: string;
  url: string;
  notes: string;
};

const SERVICE_TYPES: DeviceServiceType[] = [
  "dhcp",
  "dns",
  "vpn",
  "ntp",
  "snmp",
  "syslog",
  "http",
  "https",
  "database",
  "app",
  "custom",
];

const EMPTY_SERVICE_FORM: ServiceForm = {
  name: "",
  serviceType: "app",
  ipAssignmentId: "",
  portId: "",
  vlanId: "",
  monitorId: "",
  url: "",
  notes: "",
};

const NEW_MONITOR_ID = "__new_monitor__";
const NEW_SERVICE_ID = "__new_service__";

export default function DeviceDetail() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const currentUser = useStore((s) => s.currentUser);
  const devices = useStore((s) => s.devices);
  const ports = useStore((s) => s.ports);
  const portLinks = useStore((s) => s.portLinks);
  const virtualSwitches = useStore((s) => s.virtualSwitches);
  const vlans = useStore((s) => s.vlans);
  const ipAssignments = useStore((s) => s.ipAssignments);
  const subnets = useStore((s) => s.subnets);
  const scopes = useStore((s) => s.scopes);
  const auditLog = useStore((s) => s.auditLog);
  const racks = useStore((s) => s.racks);
  const deviceMonitors = useStore((s) => s.deviceMonitors);
  const deviceImages = useStore((s) => s.deviceImages);
  const deviceServices = useStore((s) => s.deviceServices);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [networkForm, setNetworkForm] = useState<NetworkIpForm>(
    EMPTY_NETWORK_IP_FORM,
  );
  const [networkSaving, setNetworkSaving] = useState(false);
  const [networkError, setNetworkError] = useState("");
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
  const [snmpDiscoverLoading, setSnmpDiscoverLoading] = useState(false);
  const [snmpImportLoading, setSnmpImportLoading] = useState(false);
  const [snmpInterfaces, setSnmpInterfaces] = useState<DiscoveredSnmpInterface[]>(
    [],
  );
  const [snmpDiscoverError, setSnmpDiscoverError] = useState("");
  const [snmpCredentials, setSnmpCredentials] = useState<SnmpCredential[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
  const [serviceForm, setServiceForm] =
    useState<ServiceForm>(EMPTY_SERVICE_FORM);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceDeleting, setServiceDeleting] = useState(false);
  const [serviceError, setServiceError] = useState("");
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
  const canEdit = canEditInventory(currentUser, device?.labId);
  const canManageMonitoring = canEditInventory(currentUser, device?.labId);

  useEffect(() => {
    if (!device?.labId) {
      setSnmpCredentials([]);
      return;
    }
    void api
      .getSnmpCredentials({ labId: device.labId })
      .then(setSnmpCredentials)
      .catch(() => setSnmpCredentials([]));
  }, [device?.labId]);

  const deviceMonitorList = useMemo(
    () => (id ? deviceMonitors.filter((entry) => entry.deviceId === id) : []),
    [deviceMonitors, id],
  );
  const snmpVerifiedPortIds = useMemo(
    () =>
      id
        ? buildSnmpVerifiedPortIdsForDevice(deviceMonitors, id, ports)
        : new Set<string>(),
    [deviceMonitors, id, ports],
  );
  const deviceImageList = useMemo(
    () => (id ? deviceImages.filter((entry) => entry.deviceId === id) : []),
    [deviceImages, id],
  );
  const deviceServiceList = useMemo(
    () =>
      id
        ? deviceServices
            .filter((entry) => entry.deviceId === id)
            .sort(
              (a, b) =>
                a.serviceType.localeCompare(b.serviceType) ||
                a.name.localeCompare(b.name),
            )
        : [],
    [deviceServices, id],
  );
  const selectedMonitor =
    selectedMonitorId && selectedMonitorId !== NEW_MONITOR_ID
      ? deviceMonitorList.find((entry) => entry.id === selectedMonitorId)
      : undefined;
  const selectedService =
    selectedServiceId && selectedServiceId !== NEW_SERVICE_ID
      ? deviceServiceList.find((entry) => entry.id === selectedServiceId)
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
  const subnetById = useMemo(() => {
    return subnets.reduce<Record<string, Subnet>>((acc, entry) => {
      acc[entry.id] = entry;
      return acc;
    }, {});
  }, [subnets]);
  const scopesForNetworkSubnet = useMemo(
    () => scopes.filter((scope) => scope.subnetId === networkForm.subnetId),
    [networkForm.subnetId, scopes],
  );
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
    setNetworkForm({
      ...EMPTY_NETWORK_IP_FORM,
      subnetId: subnets[0]?.id ?? "",
    });
    setNetworkError("");
    setSelectedServiceId(null);
    setServiceForm(EMPTY_SERVICE_FORM);
    setServiceError("");
  }, [device?.id, subnets]);

  useEffect(() => {
    if (!subnets.length) return;
    setNetworkForm((prev) =>
      prev.subnetId && subnets.some((entry) => entry.id === prev.subnetId)
        ? prev
        : { ...prev, subnetId: subnets[0].id },
    );
  }, [subnets]);

  useEffect(() => {
    if (networkForm.allocationMode !== "dhcp-reservation") return;
    if (
      networkForm.dhcpScopeId &&
      scopesForNetworkSubnet.some(
        (scope) => scope.id === networkForm.dhcpScopeId,
      )
    ) {
      return;
    }
    setNetworkForm((prev) => ({
      ...prev,
      dhcpScopeId: scopesForNetworkSubnet[0]?.id ?? "",
    }));
  }, [
    networkForm.allocationMode,
    networkForm.dhcpScopeId,
    scopesForNetworkSubnet,
  ]);

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

  useEffect(() => {
    if (!device) return;
    if (deviceServiceList.length === 0) {
      if (selectedServiceId !== NEW_SERVICE_ID) {
        setSelectedServiceId(NEW_SERVICE_ID);
      }
      return;
    }
    if (
      !selectedServiceId ||
      (selectedServiceId !== NEW_SERVICE_ID &&
        !deviceServiceList.some((entry) => entry.id === selectedServiceId))
    ) {
      setSelectedServiceId(deviceServiceList[0].id);
    }
  }, [device, deviceServiceList, selectedServiceId]);

  useEffect(() => {
    if (selectedService) {
      setServiceForm(serviceToForm(selectedService));
    } else {
      setServiceForm(EMPTY_SERVICE_FORM);
    }
    setServiceError("");
  }, [selectedService]);

  const devicePorts = device?.id ? (portsByDeviceId[device.id] ?? []) : [];
  const networkAssignablePorts = devicePorts.filter(
    (port) => port.kind !== "power",
  );
  const rack = device?.rackId
    ? racks.find((entry) => entry.id === device.rackId)
    : undefined;
  const deviceIps = device?.id
    ? ipAssignments.filter((assignment) => assignment.deviceId === device.id)
    : [];
  const hostSharedAssignment =
    device?.managementIp && device.parentDeviceId
      ? ipAssignments.find(
          (assignment) =>
            assignment.deviceId === device.parentDeviceId &&
            assignment.ipAddress === device.managementIp,
        )
      : undefined;
  const displayedDeviceIpCount =
    deviceIps.length + (hostSharedAssignment ? 1 : 0);
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
        <TopBar subtitle={t("Devices")} title={t("Not found")} />
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

  function setNetworkField<K extends keyof NetworkIpForm>(
    key: K,
    value: NetworkIpForm[K],
  ) {
    setNetworkForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleAssignIp() {
    if (!device || !canEdit) return;
    setNetworkError("");

    const ipAddress = networkForm.ipAddress.trim();
    const subnetId = networkForm.subnetId.trim();
    if (!subnetId) {
      setNetworkError("Select the subnet for this address.");
      return;
    }
    if (!ipAddress) {
      setNetworkError("IP address is required.");
      return;
    }

    setNetworkSaving(true);
    try {
      await createIpAssignmentRecord({
        subnetId,
        ipAddress,
        assignmentType: networkForm.assignmentType,
        allocationMode: networkForm.allocationMode,
        dhcpScopeId:
          networkForm.allocationMode === "dhcp-reservation"
            ? networkForm.dhcpScopeId || undefined
            : undefined,
        deviceId: device.id,
        portId: networkForm.portId || undefined,
        hostname: device.hostname,
        description:
          networkForm.description.trim() ||
          (networkForm.portId
            ? `Interface ${portById[networkForm.portId]?.name ?? ""}`.trim()
            : "Device address"),
      });
      setNetworkForm((prev) => ({
        ...EMPTY_NETWORK_IP_FORM,
        subnetId: prev.subnetId,
        assignmentType: prev.assignmentType,
        allocationMode: prev.allocationMode,
        dhcpScopeId: prev.dhcpScopeId,
      }));
    } catch (err) {
      setNetworkError(
        err instanceof Error ? err.message : "Failed to assign IP address.",
      );
    } finally {
      setNetworkSaving(false);
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

  function handleOpenImage(image: DeviceImage) {
    openImageAsset(image);
  }

  function handleDownloadImage(image: DeviceImage) {
    downloadImageAsset(image);
  }

  function snmpDiscoveryPayload() {
    if (!device) return null;
    return {
      deviceId: device.id,
      target: monitorForm.target.trim() || device.managementIp || undefined,
      port: monitorForm.port.trim()
        ? Number.parseInt(monitorForm.port, 10)
        : undefined,
      snmpCredentialId: monitorForm.snmpCredentialId.trim() || undefined,
      snmpVersion: monitorForm.snmpCredentialId.trim()
        ? undefined
        : monitorForm.snmpVersion,
      snmpCommunity: monitorForm.snmpCredentialId.trim()
        ? undefined
        : monitorForm.snmpCommunity.trim() || "public",
    };
  }

  async function handleDiscoverSnmpInterfaces() {
    if (!device) return;
    const payload = snmpDiscoveryPayload();
    if (!payload?.target) {
      setSnmpDiscoverError("Set a management IP or SNMP target first.");
      return;
    }

    setSnmpDiscoverLoading(true);
    setSnmpDiscoverError("");
    try {
      const result = await api.discoverSnmpInterfaces(payload);
      setSnmpInterfaces(result.interfaces);
    } catch (error) {
      setSnmpDiscoverError(
        error instanceof Error ? error.message : "SNMP discovery failed.",
      );
      setSnmpInterfaces([]);
    } finally {
      setSnmpDiscoverLoading(false);
    }
  }

  async function handleImportSnmpInterfaces(ifIndexes?: number[]) {
    if (!device) return;
    const payload = snmpDiscoveryPayload();
    if (!payload?.target) {
      setSnmpDiscoverError("Set a management IP or SNMP target first.");
      return;
    }

    setSnmpImportLoading(true);
    setSnmpDiscoverError("");
    try {
      const result = await api.importSnmpInterfaceMonitors({
        ...payload,
        ifIndexes,
        skipExisting: true,
        intervalMs:
          Math.max(1, Number.parseInt(monitorForm.intervalMinutes, 10) || 5) *
          60 *
          1000,
        expectedOperStatus: "1",
      });
      await loadAll(true);
      if (result.created[0]) {
        setSelectedMonitorId(result.created[0].id);
      }
      setSnmpInterfaces([]);
    } catch (error) {
      setSnmpDiscoverError(
        error instanceof Error ? error.message : "Failed to import SNMP monitors.",
      );
    } finally {
      setSnmpImportLoading(false);
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
        monitorForm.type === "https" ||
        monitorForm.type === "snmp";
      const usesPath =
        monitorForm.type === "http" || monitorForm.type === "https";
      const usesSnmp = monitorForm.type === "snmp";
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
        snmpVersion: usesSnmp ? monitorForm.snmpVersion : null,
        snmpCommunity: usesSnmp
          ? monitorForm.snmpCommunity.trim() || "public"
          : null,
        snmpOid: usesSnmp ? monitorForm.snmpOid.trim() || null : null,
        snmpExpectedValue: usesSnmp
          ? monitorForm.snmpExpectedValue.trim() || null
          : null,
        snmpMatchMode: usesSnmp ? monitorForm.snmpMatchMode : null,
        portId: usesSnmp ? monitorForm.portId.trim() || null : null,
        snmpIfIndex:
          usesSnmp && monitorForm.snmpIfIndex.trim()
            ? Number.parseInt(monitorForm.snmpIfIndex, 10)
            : null,
        snmpCredentialId: usesSnmp
          ? monitorForm.snmpCredentialId.trim() || null
          : null,
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

  function setServiceField<K extends keyof ServiceForm>(
    key: K,
    value: ServiceForm[K],
  ) {
    setServiceForm((prev) => ({ ...prev, [key]: value }));
  }

  function startNewService() {
    setSelectedServiceId(NEW_SERVICE_ID);
    setServiceForm(EMPTY_SERVICE_FORM);
    setServiceError("");
  }

  async function handleSaveService() {
    if (!device || !canManageMonitoring) return;
    const name = serviceForm.name.trim();
    if (!name) {
      setServiceError("Service name is required.");
      return;
    }

    setServiceSaving(true);
    setServiceError("");
    const payload = {
      deviceId: device.id,
      name,
      serviceType: serviceForm.serviceType,
      ipAssignmentId: serviceForm.ipAssignmentId || null,
      portId: serviceForm.portId || null,
      vlanId: serviceForm.vlanId || null,
      monitorId: serviceForm.monitorId || null,
      url: serviceForm.url.trim() || null,
      notes: serviceForm.notes.trim() || null,
    };

    try {
      if (selectedService) {
        await updateDeviceServiceRecord(selectedService.id, payload);
      } else {
        const created = await createDeviceServiceRecord(payload);
        setSelectedServiceId(created.id);
      }
    } catch (err) {
      setServiceError(
        err instanceof Error ? err.message : "Failed to save service.",
      );
    } finally {
      setServiceSaving(false);
    }
  }

  async function handleDeleteService() {
    if (!selectedService) return;
    if (!window.confirm(`Delete service "${selectedService.name}"?`)) return;
    setServiceDeleting(true);
    setServiceError("");
    try {
      await deleteDeviceServiceRecord(selectedService.id);
      setSelectedServiceId(
        deviceServiceList.length > 1 ? null : NEW_SERVICE_ID,
      );
    } catch (err) {
      setServiceError(
        err instanceof Error ? err.message : "Failed to delete service.",
      );
    } finally {
      setServiceDeleting(false);
    }
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
    monitorForm.type === "https" ||
    monitorForm.type === "snmp";
  const showMonitorPathField =
    monitorForm.type === "http" || monitorForm.type === "https";
  const showMonitorSnmpFields = monitorForm.type === "snmp";
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
            t("Devices")
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
                {t("Edit")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
            >
              <RefreshCcw className="size-3.5" />
              {refreshing ? "Refreshing..." : t("Refresh")}
            </Button>
            {canEdit && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                <Trash2 className="size-3.5" />
                {deleting ? t("Deleting...") : t("Delete")}
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
              {t("Devices")}
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
              <Stat label={t("Serial")} value={device.serial} mono />
              <Stat label={t("Last seen")} value={relativeTime(device.lastSeen)} />
              <Stat
                label={t("Ports")}
                value={`${linkedCount}/${devicePorts.length} linked`}
              />
              <Stat label="IPs" value={String(displayedDeviceIpCount)} />
              <Stat label={t("Tags")} value={device.tags?.join(", ") ?? "-"} />
            </dl>
          </div>
        </Card>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{t("Overview")}</TabsTrigger>
            <TabsTrigger value="ports">
              {t("Ports")} | {devicePorts.length}
            </TabsTrigger>
            <TabsTrigger value="network">
              {t("Network")} | {displayedDeviceIpCount}
            </TabsTrigger>
            <TabsTrigger value="monitoring">{t("Monitoring")}</TabsTrigger>
            <TabsTrigger value="services">
              Services | {deviceServiceList.length}
            </TabsTrigger>
            <TabsTrigger value="images">
              Images | {deviceImageList.length}
            </TabsTrigger>
            <TabsTrigger value="notes">{t("Notes")}</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="pt-4">
            <div className="grid grid-cols-12 gap-3">
              <Card className="col-span-12 md:col-span-6">
                <CardHeader>
                  <CardTitle>
                    <CardLabel>{t("Hardware")}</CardLabel>
                    <CardHeading>{t("Specifications")}</CardHeading>
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  <dl className="space-y-2 text-xs">
                    <Row label="Manufacturer" value={device.manufacturer} />
                    <Row label="Model" value={device.model} mono />
                    <Row label={t("Serial")} value={device.serial} mono />
                    <Row
                      label={t("Type")}
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
                    <CardLabel>{t("Placement")}</CardLabel>
                    <CardHeading>{t("Rack position")}</CardHeading>
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
                      <CardLabel>{t("Relationships")}</CardLabel>
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
                      <CardLabel>{t("Metadata")}</CardLabel>
                      <CardHeading>{t("Tags")}</CardHeading>
                    </CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="flex flex-wrap gap-1.5" data-no-i18n>
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
                        <CardLabel>{t("Interfaces")}</CardLabel>
                        <CardHeading>{t("No ports documented")}</CardHeading>
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
                      snmpVerifiedPortIds={snmpVerifiedPortIds}
                      onSelectPort={setSelectedPortId}
                      selectedPortId={selectedPortId}
                    />
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          <CardLabel>{t("Table")}</CardLabel>
                          <CardHeading>{t("All ports")}</CardHeading>
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
                          snmpVerifiedPortIds={snmpVerifiedPortIds}
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
                        <CardLabel>{t("Interfaces")}</CardLabel>
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
            {canEdit && (
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle>
                    <CardLabel>{t("Assign address")}</CardLabel>
                    <CardHeading>{t("Add device or interface IP")}</CardHeading>
                  </CardTitle>
                </CardHeader>
                <CardBody className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <Field label="Subnet">
                      <Select
                        value={networkForm.subnetId}
                        onChange={(value) => setNetworkField("subnetId", value)}
                        disabled={subnets.length === 0}
                      >
                        <option value="">Select subnet</option>
                        {subnets.map((subnet) => (
                          <option key={subnet.id} value={subnet.id}>
                            {subnet.cidr} - {subnet.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="IP address">
                      <Input
                        value={networkForm.ipAddress}
                        onChange={(event) =>
                          setNetworkField("ipAddress", event.target.value)
                        }
                        placeholder="192.168.10.1"
                      />
                    </Field>
                    <Field label={t("Type")}>
                      <Select
                        value={networkForm.assignmentType}
                        onChange={(value) =>
                          setNetworkField(
                            "assignmentType",
                            value as IpAssignmentType,
                          )
                        }
                      >
                        <option value="interface">Interface</option>
                        <option value="device">Device</option>
                        <option value="infrastructure">Infrastructure</option>
                        <option value="reserved">Reserved</option>
                        <option value="vm">VM</option>
                        <option value="container">Container</option>
                      </Select>
                    </Field>
                    <Field label="Allocation">
                      <Select
                        value={networkForm.allocationMode}
                        onChange={(value) =>
                          setNetworkField(
                            "allocationMode",
                            value as IpAllocationMode,
                          )
                        }
                      >
                        <option value="static">Static</option>
                        <option value="dhcp-reservation">
                          DHCP reservation
                        </option>
                      </Select>
                    </Field>
                    <Field label="DHCP scope">
                      <Select
                        value={networkForm.dhcpScopeId}
                        onChange={(value) =>
                          setNetworkField("dhcpScopeId", value)
                        }
                        disabled={
                          networkForm.allocationMode !== "dhcp-reservation"
                        }
                      >
                        <option value="">Auto / none</option>
                        {scopesForNetworkSubnet.map((scope) => (
                          <option key={scope.id} value={scope.id}>
                            {scope.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Port">
                      <Select
                        value={networkForm.portId}
                        onChange={(value) => setNetworkField("portId", value)}
                      >
                        <option value="">Device-level</option>
                        {networkAssignablePorts.map((port) => (
                          <option key={port.id} value={port.id}>
                            {formatPortLabel(port, { includeFace: true })}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                    <Field label={t("Description")}>
                      <Input
                        value={networkForm.description}
                        onChange={(event) =>
                          setNetworkField("description", event.target.value)
                        }
                        placeholder="Gateway, docker0, WAN, storage NIC..."
                      />
                    </Field>
                    <Button
                      size="sm"
                      onClick={() => void handleAssignIp()}
                      disabled={networkSaving || subnets.length === 0}
                    >
                      <Plus className="size-3.5" />
                      {networkSaving ? "Assigning..." : "Assign IP"}
                    </Button>
                  </div>
                  {networkError && (
                    <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-xs text-[var(--color-err)]">
                      {networkError}
                    </div>
                  )}
                </CardBody>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Addresses")}</CardLabel>
                  <CardHeading>{t("IP assignments")}</CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-[var(--color-line)]">
                  {displayedDeviceIpCount === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-[var(--color-fg-subtle)]">
                      No IPs assigned to this device.
                    </div>
                  ) : (
                    <>
                      {hostSharedAssignment && parentDevice && (
                        <div className="grid grid-cols-12 items-center gap-3 px-4 py-2">
                          <Mono className="col-span-3 text-[var(--color-fg)]">
                            {hostSharedAssignment.ipAddress}
                          </Mono>
                          <div className="col-span-3 text-xs">
                            {parentDevice.hostname}
                            <Mono className="mt-0.5 block text-[10px] text-[var(--color-fg-muted)]">
                              shared parent address
                            </Mono>
                          </div>
                          <div className="col-span-4 text-[11px] text-[var(--color-fg-subtle)]">
                            Host-network child using parent host IP
                          </div>
                          <div className="col-span-2 flex items-center justify-end">
                            <Badge tone="neutral">host network</Badge>
                          </div>
                        </div>
                      )}
                      {[...deviceIps]
                        .sort((a, b) =>
                          a.ipAddress.localeCompare(b.ipAddress, undefined, {
                            numeric: true,
                          }),
                        )
                        .map((ip) => (
                          <div
                            key={ip.id}
                            className="grid grid-cols-12 items-center gap-3 px-4 py-2"
                          >
                            <Mono className="col-span-3 text-[var(--color-fg)]">
                              {ip.ipAddress}
                            </Mono>
                            <div className="col-span-3 text-xs">
                              {subnetById[ip.subnetId]?.name ??
                                ip.hostname ??
                                "-"}
                              <Mono className="mt-0.5 block text-[10px] text-[var(--color-fg-muted)]">
                                {subnetById[ip.subnetId]?.cidr ?? ""}
                              </Mono>
                            </div>
                            <div className="col-span-4 text-[11px] text-[var(--color-fg-subtle)]">
                              <div>{ip.description ?? "-"}</div>
                              {ip.portId && portById[ip.portId] && (
                                <Mono className="mt-0.5 block text-[10px] text-[var(--color-fg-muted)]">
                                  {formatPortLabel(portById[ip.portId], {
                                    includeFace: true,
                                  })}
                                </Mono>
                              )}
                            </div>
                            <div className="col-span-2 flex items-center justify-end gap-2">
                              {ip.allocationMode === "dhcp-reservation" && (
                                <Badge tone="neutral">DHCP res</Badge>
                              )}
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
                        ))}
                    </>
                  )}
                </div>
              </CardBody>
            </Card>
          </TabsContent>

          <TabsContent value="monitoring" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Health checks")}</CardLabel>
                  <CardHeading>{t("Automated device monitoring")}</CardHeading>
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
                  until at least one enabled target has run. For near-real-time
                  link events, forward SNMP traps to this Rackpad host on UDP
                  port 1162 (or map host 162 → container 1162).
                </div>

                {canManageMonitoring && device?.labId && (
                  <SnmpCredentialsPanel
                    labId={device.labId}
                    credentials={snmpCredentials}
                    disabled={!canManageMonitoring}
                    onChanged={async () => {
                      if (!device.labId) return;
                      setSnmpCredentials(
                        await api.getSnmpCredentials({ labId: device.labId }),
                      );
                    }}
                  />
                )}

                {canManageMonitoring && device?.labId && (
                  <SnmpSyncPanel
                    deviceId={device.id}
                    labId={device.labId}
                    target={monitorForm.target.trim() || device.managementIp}
                    snmpCredentialId={device.snmpCredentialId}
                    credentials={snmpCredentials}
                    disabled={!canManageMonitoring}
                    isAdmin={currentUser?.role === "admin"}
                    onApplied={async () => {
                      await loadAll(true);
                    }}
                  />
                )}

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
                        onClick={() => void handleDiscoverSnmpInterfaces()}
                        disabled={
                          snmpDiscoverLoading ||
                          snmpImportLoading ||
                          !(monitorForm.target.trim() || device.managementIp)
                        }
                      >
                        <RefreshCcw className="size-3.5" />
                        {snmpDiscoverLoading
                          ? "Discovering..."
                          : "Discover SNMP interfaces"}
                      </Button>
                    )}
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

                {(snmpDiscoverError || snmpInterfaces.length > 0) && (
                  <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-3">
                    {snmpDiscoverError && (
                      <div className="text-sm text-[var(--color-danger)]">
                        {snmpDiscoverError}
                      </div>
                    )}
                    {snmpInterfaces.length > 0 && (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm text-[var(--color-fg)]">
                            Found {snmpInterfaces.length} SNMP interface
                            {snmpInterfaces.length === 1 ? "" : "s"} via IF-MIB.
                          </div>
                          <Button
                            size="sm"
                            onClick={() => void handleImportSnmpInterfaces()}
                            disabled={snmpImportLoading}
                          >
                            {snmpImportLoading
                              ? "Creating monitors..."
                              : "Create ifOperStatus monitors"}
                          </Button>
                        </div>
                        <div className="max-h-48 space-y-1 overflow-y-auto text-xs text-[var(--color-fg-subtle)]">
                          {snmpInterfaces.map((entry) => (
                            <div
                              key={entry.ifIndex}
                              className="flex items-center justify-between gap-3 rounded border border-[var(--color-line)] px-2 py-1"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {entry.name || entry.descr} (ifIndex{" "}
                                {entry.ifIndex})
                                {entry.matchedPortName ? (
                                  <span className="ml-2 text-[var(--accent-secondary)]">
                                    → {entry.matchedPortName}
                                  </span>
                                ) : (
                                  <span className="ml-2 text-[var(--text-muted)]">
                                    · no port match
                                  </span>
                                )}
                                {entry.highSpeedMbps ? (
                                  <span className="ml-2 font-mono text-[var(--text-tertiary)]">
                                    {entry.highSpeedMbps >= 1000
                                      ? `${entry.highSpeedMbps / 1000}G`
                                      : `${entry.highSpeedMbps}M`}
                                  </span>
                                ) : null}
                              </span>
                              <span className="shrink-0 font-mono">
                                {entry.operStatusLabel ?? "unknown"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

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
                      <Field label={t("Name")}>
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
                      <Field label={t("Type")}>
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
                          <option value="snmp">snmp</option>
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
                                  : monitorForm.type === "snmp"
                                    ? "161"
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

                    {showMonitorSnmpFields && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="OID preset">
                          <Select
                            value=""
                            disabled={!canManageMonitoring}
                            onChange={(value) => {
                              const preset = SNMP_OID_PRESETS.find(
                                (entry) => entry.id === value,
                              );
                              if (!preset || preset.id === "custom") return;
                              setMonitorForm((prev) => {
                                const ifIndex = prev.snmpIfIndex.trim()
                                  ? Number.parseInt(prev.snmpIfIndex, 10)
                                  : null;
                                const oid =
                                  preset.id === "ifOperStatus" && ifIndex != null
                                    ? `${preset.oid}.${ifIndex}`
                                    : preset.oid;
                                return {
                                  ...prev,
                                  snmpOid: oid,
                                  snmpExpectedValue: preset.expected,
                                  snmpMatchMode: preset.matchMode,
                                };
                              });
                            }}
                          >
                            <option value="">Apply preset…</option>
                            {SNMP_OID_PRESETS.filter(
                              (entry) => entry.id !== "custom",
                            ).map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.label}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Match mode">
                          <Select
                            value={monitorForm.snmpMatchMode}
                            disabled={!canManageMonitoring}
                            onChange={(value) =>
                              setMonitorForm((prev) => ({
                                ...prev,
                                snmpMatchMode:
                                  value as MonitorForm["snmpMatchMode"],
                              }))
                            }
                          >
                            {SNMP_MATCH_MODE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Linked port">
                          <Select
                            value={monitorForm.portId}
                            disabled={!canManageMonitoring}
                            onChange={(value) => {
                              const linkedPort = devicePorts.find(
                                (port) => port.id === value,
                              );
                              setMonitorForm((prev) => {
                                const ifIndex =
                                  linkedPort?.snmpIfIndex != null
                                    ? String(linkedPort.snmpIfIndex)
                                    : prev.snmpIfIndex;
                                const nextOid =
                                  prev.snmpOid.startsWith(
                                    "1.3.6.1.2.1.2.2.1.8",
                                  ) && linkedPort?.snmpIfIndex != null
                                    ? `1.3.6.1.2.1.2.2.1.8.${linkedPort.snmpIfIndex}`
                                    : prev.snmpOid;
                                return {
                                  ...prev,
                                  portId: value,
                                  snmpIfIndex: ifIndex,
                                  snmpOid: nextOid,
                                };
                              });
                            }}
                          >
                            <option value="">None</option>
                            {devicePorts.map((port) => (
                              <option key={port.id} value={port.id}>
                                {port.name}
                                {port.snmpIfIndex != null
                                  ? ` (ifIndex ${port.snmpIfIndex})`
                                  : ""}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="ifIndex">
                          <Input
                            value={monitorForm.snmpIfIndex}
                            disabled={!canManageMonitoring}
                            onChange={(event) =>
                              setMonitorForm((prev) => ({
                                ...prev,
                                snmpIfIndex: event.target.value,
                              }))
                            }
                            placeholder="Optional SNMP ifIndex"
                          />
                        </Field>
                        <Field label="Credential">
                          <Select
                            value={monitorForm.snmpCredentialId}
                            disabled={!canManageMonitoring}
                            onChange={(value) =>
                              setMonitorForm((prev) => ({
                                ...prev,
                                snmpCredentialId: value,
                              }))
                            }
                          >
                            <option value="">Inline community / version</option>
                            {snmpCredentials.map((credential) => (
                              <option key={credential.id} value={credential.id}>
                                {credential.name} (v{credential.version})
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="SNMP version">
                          <Select
                            value={monitorForm.snmpVersion}
                            disabled={
                              !canManageMonitoring ||
                              Boolean(monitorForm.snmpCredentialId)
                            }
                            onChange={(value) =>
                              setMonitorForm((prev) => ({
                                ...prev,
                                snmpVersion: value as MonitorForm["snmpVersion"],
                              }))
                            }
                          >
                            <option value="2c">v2c</option>
                            <option value="1">v1</option>
                          </Select>
                        </Field>
                        <Field label="Community">
                          <Input
                            value={monitorForm.snmpCommunity}
                            disabled={
                              !canManageMonitoring ||
                              Boolean(monitorForm.snmpCredentialId)
                            }
                            onChange={(event) =>
                              setMonitorForm((prev) => ({
                                ...prev,
                                snmpCommunity: event.target.value,
                              }))
                            }
                            placeholder="public"
                          />
                        </Field>
                        <Field label="OID">
                          <Input
                            value={monitorForm.snmpOid}
                            disabled={!canManageMonitoring}
                            onChange={(event) =>
                              setMonitorForm((prev) => ({
                                ...prev,
                                snmpOid: event.target.value,
                              }))
                            }
                            placeholder=".1.3.6.1.2.1.2.2.1.8.1"
                          />
                        </Field>
                        <Field label="Expected value">
                          <Input
                            value={monitorForm.snmpExpectedValue}
                            disabled={!canManageMonitoring}
                            onChange={(event) =>
                              setMonitorForm((prev) => ({
                                ...prev,
                                snmpExpectedValue: event.target.value,
                              }))
                            }
                            placeholder="Optional, e.g. 1 for ifOperStatus up"
                          />
                        </Field>
                      </div>
                    )}

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

          <TabsContent value="services" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Service inventory")}</CardLabel>
                  <CardHeading>{t("Applications and network services")}</CardHeading>
                </CardTitle>
                {canManageMonitoring && (
                  <Button variant="outline" size="sm" onClick={startNewService}>
                    <Plus className="size-3.5" />
                    Add service
                  </Button>
                )}
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="space-y-2">
                    {deviceServiceList.length === 0 ? (
                      <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-4 text-sm text-[var(--color-fg-subtle)]">
                        No services documented yet.
                      </div>
                    ) : (
                      deviceServiceList.map((service) => (
                        <button
                          key={service.id}
                          type="button"
                          onClick={() => setSelectedServiceId(service.id)}
                          className={[
                            "w-full rounded-[var(--radius-sm)] border px-3 py-3 text-left transition-colors",
                            selectedServiceId === service.id
                              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                              : "border-[var(--color-line)] bg-[var(--color-bg)] hover:border-[var(--color-line-strong)]",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                              {service.name}
                            </div>
                            <Badge tone="neutral">
                              {serviceTypeLabel(service.serviceType)}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                            {service.url ||
                              service.notes ||
                              linkedServiceSummary(
                                service,
                                ipAssignments,
                                portById,
                                vlanById,
                                deviceMonitorList,
                              )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="space-y-4 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                          {selectedService ? "Service editor" : "New service"}
                        </div>
                        <div className="text-base font-medium text-[var(--color-fg)]">
                          {selectedService
                            ? selectedService.name
                            : "Document a service on this device"}
                        </div>
                      </div>
                      {selectedService && (
                        <Badge tone="neutral">
                          {serviceTypeLabel(selectedService.serviceType)}
                        </Badge>
                      )}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label={t("Name")}>
                        <Input
                          value={serviceForm.name}
                          disabled={!canManageMonitoring}
                          onChange={(event) =>
                            setServiceField("name", event.target.value)
                          }
                          placeholder="e.g. DHCP, Grafana, Portainer"
                        />
                      </Field>
                      <Field label={t("Type")}>
                        <Select
                          value={serviceForm.serviceType}
                          disabled={!canManageMonitoring}
                          onChange={(value) =>
                            setServiceField(
                              "serviceType",
                              value as DeviceServiceType,
                            )
                          }
                        >
                          {SERVICE_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {serviceTypeLabel(type)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="IP">
                        <Select
                          value={serviceForm.ipAssignmentId}
                          disabled={!canManageMonitoring}
                          onChange={(value) =>
                            setServiceField("ipAssignmentId", value)
                          }
                        >
                          <option value="">No IP link</option>
                          {deviceIps.map((assignment) => (
                            <option key={assignment.id} value={assignment.id}>
                              {assignment.ipAddress} ·{" "}
                              {subnetById[assignment.subnetId]?.name ??
                                assignment.assignmentType}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Port">
                        <Select
                          value={serviceForm.portId}
                          disabled={!canManageMonitoring}
                          onChange={(value) => setServiceField("portId", value)}
                        >
                          <option value="">No port link</option>
                          {devicePorts.map((port) => (
                            <option key={port.id} value={port.id}>
                              {formatPortLabel(port, { includeFace: true })}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="VLAN">
                        <Select
                          value={serviceForm.vlanId}
                          disabled={!canManageMonitoring}
                          onChange={(value) => setServiceField("vlanId", value)}
                        >
                          <option value="">No VLAN link</option>
                          {vlans.map((vlan) => (
                            <option key={vlan.id} value={vlan.id}>
                              VLAN {vlan.vlanId} · {vlan.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Monitor">
                        <Select
                          value={serviceForm.monitorId}
                          disabled={!canManageMonitoring}
                          onChange={(value) =>
                            setServiceField("monitorId", value)
                          }
                        >
                          <option value="">No monitor link</option>
                          {deviceMonitorList.map((monitor) => (
                            <option key={monitor.id} value={monitor.id}>
                              {monitor.name} · {monitor.type}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>

                    <Field label="URL">
                      <Input
                        value={serviceForm.url}
                        disabled={!canManageMonitoring}
                        onChange={(event) =>
                          setServiceField("url", event.target.value)
                        }
                        placeholder="https://host.example:8443/"
                      />
                    </Field>
                    <Field label="Notes">
                      <textarea
                        value={serviceForm.notes}
                        disabled={!canManageMonitoring}
                        onChange={(event) =>
                          setServiceField("notes", event.target.value)
                        }
                        rows={3}
                        className="rk-control rk-textarea w-full text-sm"
                        placeholder="Owner, role, dependencies, or failover notes..."
                      />
                    </Field>

                    {serviceError && (
                      <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                        {serviceError}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      {canManageMonitoring && selectedService && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void handleDeleteService()}
                          disabled={serviceDeleting}
                        >
                          <Trash2 className="size-3.5" />
                          {serviceDeleting ? "Deleting..." : "Delete service"}
                        </Button>
                      )}
                      {canManageMonitoring && (
                        <Button
                          size="sm"
                          onClick={() => void handleSaveService()}
                          disabled={serviceSaving}
                        >
                          <Save className="size-3.5" />
                          {serviceSaving
                            ? "Saving..."
                            : selectedService
                              ? "Save service"
                              : "Create service"}
                        </Button>
                      )}
                    </div>
                  </div>
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
                      <CardLabel>{t("Reference")}</CardLabel>
                      <CardHeading>{t("Add image")}</CardHeading>
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
                    <CardLabel>{t("Reference")}</CardLabel>
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
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleOpenImage(image)}
                                  aria-label={`Open ${image.label} larger`}
                                >
                                  <ExternalLink />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDownloadImage(image)}
                                  aria-label={`Download ${image.label}`}
                                >
                                  <Download />
                                </Button>
                                {canEdit && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      void handleDeleteImage(image)
                                    }
                                    disabled={imageDeletingId === image.id}
                                    aria-label={`Delete ${image.label}`}
                                  >
                                    <Trash2 />
                                  </Button>
                                )}
                              </div>
                            </div>
                            {image.notes && (
                              <div
                                className="text-xs leading-5 text-[var(--color-fg-subtle)]"
                                data-no-i18n
                              >
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
                  <CardLabel>{t("Documentation")}</CardLabel>
                  <CardHeading>{t("Device notes")}</CardHeading>
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
                  <div
                    className="whitespace-pre-wrap text-sm leading-6 text-[var(--color-fg)]"
                    data-no-i18n
                  >
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
                  <CardLabel>{t("History")}</CardLabel>
                  <CardHeading>{t("Audit log")}</CardHeading>
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
  const { t } = useI18n();
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
          <CardLabel>{t("Inspector")}</CardLabel>
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
              <InspectorRow label={t("Type")} value={port.kind.replace("_", " ")} />
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
                <Link to={`/ports?deviceId=${port.deviceId}&portId=${port.id}`}>
                  Open in ports workspace
                </Link>
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

function serviceToForm(service: DeviceService): ServiceForm {
  return {
    name: service.name,
    serviceType: service.serviceType,
    ipAssignmentId: service.ipAssignmentId ?? "",
    portId: service.portId ?? "",
    vlanId: service.vlanId ?? "",
    monitorId: service.monitorId ?? "",
    url: service.url ?? "",
    notes: service.notes ?? "",
  };
}

function serviceTypeLabel(type: DeviceServiceType) {
  switch (type) {
    case "dhcp":
      return "DHCP";
    case "dns":
      return "DNS";
    case "vpn":
      return "VPN";
    case "ntp":
      return "NTP";
    case "snmp":
      return "SNMP";
    case "syslog":
      return "Syslog";
    case "http":
      return "HTTP";
    case "https":
      return "HTTPS";
    case "database":
      return "Database";
    case "app":
      return "App";
    default:
      return "Custom";
  }
}

function linkedServiceSummary(
  service: DeviceService,
  assignments: IpAssignment[],
  portsById: Record<string, Port>,
  vlansById: Record<string, Vlan>,
  monitors: DeviceMonitor[],
) {
  const ip = service.ipAssignmentId
    ? assignments.find((entry) => entry.id === service.ipAssignmentId)
    : undefined;
  const port = service.portId ? portsById[service.portId] : undefined;
  const vlan = service.vlanId ? vlansById[service.vlanId] : undefined;
  const monitor = service.monitorId
    ? monitors.find((entry) => entry.id === service.monitorId)
    : undefined;

  return (
    [
      ip?.ipAddress,
      port?.name,
      vlan ? `VLAN ${vlan.vlanId}` : undefined,
      monitor?.name,
    ]
      .filter(Boolean)
      .join(" | ") || "No linked target"
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
    snmpVersion: "2c",
    snmpCommunity: "public",
    snmpOid: "",
    snmpExpectedValue: "",
    snmpMatchMode: "equals",
    portId: "",
    snmpIfIndex: "",
    snmpCredentialId: "",
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
    snmpVersion:
      monitor.snmpVersion === "1" || monitor.snmpVersion === "2c"
        ? monitor.snmpVersion
        : "2c",
    snmpCommunity: monitor.snmpCommunity ?? "public",
    snmpOid: monitor.snmpOid ?? "",
    snmpExpectedValue: monitor.snmpExpectedValue ?? "",
    snmpMatchMode: monitor.snmpMatchMode ?? "equals",
    portId: monitor.portId ?? "",
    snmpIfIndex:
      monitor.snmpIfIndex != null ? String(monitor.snmpIfIndex) : "",
    snmpCredentialId: monitor.snmpCredentialId ?? "",
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
    case "snmp":
      return "SNMP polls one OID from the Rackpad server. Use an expected value for interface checks, such as ifOperStatus = 1 for up.";
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
