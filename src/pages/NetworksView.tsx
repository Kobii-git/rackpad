import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/shared/EmptyState";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/translations";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/shared/Mono";
import { IpUtilizationBar } from "@/components/ip/IpUtilizationBar";
import { IpZoneBar } from "@/components/vlan/IpZoneBar";
import { VlanRangeBar } from "@/components/vlan/VlanRangeBar";
import { AllocatePanel } from "@/components/shared/AllocatePanel";
import { ColorInput } from "@/components/shared/ColorInput";
import {
  canEditInventory,
  createDhcpScopeRecord,
  createIpZoneRecord,
  createNetworkRecord,
  createSubnetRecord,
  createVlanRangeRecord,
  deleteDhcpScopeRecord,
  deleteIpZoneRecord,
  deleteSubnetRecord,
  deleteVlan,
  deleteVlanRangeRecord,
  unassignIp,
  updateDhcpScopeRecord,
  updateIpZoneRecord,
  updateSubnetRecord,
  updateVlanRangeRecord,
  updateVlanRecord,
  useStore,
} from "@/lib/store";
import type {
  Device,
  DhcpScope,
  IpAssignment,
  IpZone,
  IpZoneKind,
  Subnet,
  Vlan,
  VlanRange,
} from "@/lib/types";
import {
  ChevronDown,
  ChevronUp,
  Filter,
  Hash,
  Network,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { cidrSize } from "@/lib/utils";
import { formatDeviceMac } from "@/lib/network-labels";

const ASSIGNMENT_HEADING_KEYS: Record<
  IpAssignment["assignmentType"],
  TranslationKey
> = {
  device: "Devices",
  interface: "Interfaces",
  vm: "VMs",
  container: "Containers",
  reserved: "Reservations",
  infrastructure: "Infrastructure",
};

const ASSIGNMENT_BADGE_KEYS: Record<
  IpAssignment["assignmentType"],
  TranslationKey
> = {
  device: "Device",
  interface: "Interface",
  vm: "VM",
  container: "Container",
  reserved: "Reserved",
  infrastructure: "Infrastructure",
};

const ZONE_KIND_KEYS: Record<IpZone["kind"], TranslationKey> = {
  static: "static",
  dhcp: "dhcp",
  reserved: "reserved",
  infrastructure: "infrastructure",
};

const USER_ZONE_KINDS: IpZone["kind"][] = ["static", "dhcp", "reserved"];
const USER_ZONE_KIND_SET = new Set<IpZone["kind"]>(USER_ZONE_KINDS);

const VISIBLE_ASSIGNMENT_TYPES: IpAssignment["assignmentType"][] = [
  "device",
  "interface",
  "vm",
  "container",
  "reserved",
  "infrastructure",
];

type SubnetForm = {
  cidr: string;
  name: string;
  description: string;
  gateway: string;
  dnsServers: string;
  vlanId: string;
};

type ScopeForm = {
  name: string;
  startIp: string;
  endIp: string;
  gateway: string;
  dnsServers: string;
  description: string;
};

type ZoneForm = {
  kind: IpZone["kind"];
  startIp: string;
  endIp: string;
  description: string;
};

type VlanForm = {
  vlanId: string;
  name: string;
  description: string;
  color: string;
};

type RangeForm = {
  name: string;
  startVlan: string;
  endVlan: string;
  purpose: string;
  color: string;
};

type NetworkForm = {
  mode: "tagged" | "untagged";
  vlanId: string;
  name: string;
  description: string;
  color: string;
  cidr: string;
  subnetName: string;
  subnetDescription: string;
  gateway: string;
  dnsServers: string;
  enableDhcp: boolean;
  dhcpName: string;
  dhcpStartIp: string;
  dhcpEndIp: string;
  dhcpDescription: string;
  staticStartIp: string;
  staticEndIp: string;
  reservedStartIp: string;
  reservedEndIp: string;
};

type NetworkRow =
  | {
      id: string;
      kind: "subnet";
      subnet: Subnet;
      vlan?: Vlan;
      dhcpScopes: DhcpScope[];
      zones: IpZone[];
      assignments: IpAssignment[];
    }
  | {
      id: string;
      kind: "vlan-only";
      vlan: Vlan;
      dhcpScopes: [];
      zones: [];
      assignments: [];
    };

const EMPTY_SUBNET_FORM: SubnetForm = {
  cidr: "",
  name: "",
  description: "",
  gateway: "",
  dnsServers: "",
  vlanId: "",
};

const EMPTY_SCOPE_FORM: ScopeForm = {
  name: "",
  startIp: "",
  endIp: "",
  gateway: "",
  dnsServers: "",
  description: "",
};

const EMPTY_ZONE_FORM: ZoneForm = {
  kind: "static",
  startIp: "",
  endIp: "",
  description: "",
};

const EMPTY_VLAN_FORM: VlanForm = {
  vlanId: "",
  name: "",
  description: "",
  color: "",
};

const EMPTY_RANGE_FORM: RangeForm = {
  name: "",
  startVlan: "",
  endVlan: "",
  purpose: "",
  color: "",
};

const EMPTY_NETWORK_FORM: NetworkForm = {
  mode: "tagged",
  vlanId: "",
  name: "",
  description: "",
  color: "",
  cidr: "",
  subnetName: "",
  subnetDescription: "",
  gateway: "",
  dnsServers: "",
  enableDhcp: true,
  dhcpName: "",
  dhcpStartIp: "",
  dhcpEndIp: "",
  dhcpDescription: "",
  staticStartIp: "",
  staticEndIp: "",
  reservedStartIp: "",
  reservedEndIp: "",
};

export default function NetworksView() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useStore((s) => s.currentUser);
  const activeLab = useStore((s) => s.lab);
  const ranges = useStore((s) => s.vlanRanges);
  const subnets = useStore((s) => s.subnets);
  const vlans = useStore((s) => s.vlans);
  const devices = useStore((s) => s.devices);
  const allAssignments = useStore((s) => s.ipAssignments);
  const allScopes = useStore((s) => s.scopes);
  const allZones = useStore((s) => s.ipZones);
  const canEdit = canEditInventory(currentUser);

  const [selectedNetworkId, setSelectedNetworkId] = useState("");
  const [query, setQuery] = useState("");
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const [creatingNetwork, setCreatingNetwork] = useState(false);
  const [networkForm, setNetworkForm] =
    useState<NetworkForm>(EMPTY_NETWORK_FORM);
  const [networkSaving, setNetworkSaving] = useState(false);
  const [networkError, setNetworkError] = useState("");

  const [creatingSubnet, setCreatingSubnet] = useState(false);
  const [subnetForm, setSubnetForm] = useState<SubnetForm>(EMPTY_SUBNET_FORM);
  const [subnetSaving, setSubnetSaving] = useState(false);
  const [subnetDeleting, setSubnetDeleting] = useState(false);
  const [subnetError, setSubnetError] = useState("");

  const [vlanForm, setVlanForm] = useState<VlanForm>(EMPTY_VLAN_FORM);
  const [vlanSaving, setVlanSaving] = useState(false);
  const [vlanDeleting, setVlanDeleting] = useState(false);
  const [vlanError, setVlanError] = useState("");

  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const [creatingScope, setCreatingScope] = useState(false);
  const [scopeForm, setScopeForm] = useState<ScopeForm>(EMPTY_SCOPE_FORM);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeDeleting, setScopeDeleting] = useState(false);
  const [scopeError, setScopeError] = useState("");

  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [creatingZone, setCreatingZone] = useState(false);
  const [zoneForm, setZoneForm] = useState<ZoneForm>(EMPTY_ZONE_FORM);
  const [zoneSaving, setZoneSaving] = useState(false);
  const [zoneDeleting, setZoneDeleting] = useState(false);
  const [zoneError, setZoneError] = useState("");

  const [selectedRangeId, setSelectedRangeId] = useState<string | undefined>();
  const [creatingRange, setCreatingRange] = useState(false);
  const [showVlanPlanning, setShowVlanPlanning] = useState(false);
  const [rangeForm, setRangeForm] = useState<RangeForm>(EMPTY_RANGE_FORM);
  const [rangeSaving, setRangeSaving] = useState(false);
  const [rangeDeleting, setRangeDeleting] = useState(false);
  const [rangeError, setRangeError] = useState("");

  const requestedSubnetId = searchParams.get("subnetId");
  const requestedVlanId = searchParams.get("vlanId") ?? "";

  const vlanById = useMemo(() => {
    return vlans.reduce<Record<string, Vlan>>((acc, vlan) => {
      acc[vlan.id] = vlan;
      return acc;
    }, {});
  }, [vlans]);

  const assignmentsBySubnetId = useMemo(() => {
    return allAssignments.reduce<Record<string, IpAssignment[]>>(
      (acc, assignment) => {
        (acc[assignment.subnetId] ??= []).push(assignment);
        return acc;
      },
      {},
    );
  }, [allAssignments]);

  const scopesBySubnetId = useMemo(() => {
    return allScopes.reduce<Record<string, DhcpScope[]>>((acc, scope) => {
      (acc[scope.subnetId] ??= []).push(scope);
      return acc;
    }, {});
  }, [allScopes]);

  const zonesBySubnetId = useMemo(() => {
    return allZones.reduce<Record<string, IpZone[]>>((acc, zone) => {
      (acc[zone.subnetId] ??= []).push(zone);
      return acc;
    }, {});
  }, [allZones]);

  const networks = useMemo<NetworkRow[]>(() => {
    const rows: NetworkRow[] = subnets.map((subnet) => ({
      id: `subnet:${subnet.id}`,
      kind: "subnet",
      subnet,
      vlan: subnet.vlanId ? vlanById[subnet.vlanId] : undefined,
      dhcpScopes: scopesBySubnetId[subnet.id] ?? [],
      zones: zonesBySubnetId[subnet.id] ?? [],
      assignments: assignmentsBySubnetId[subnet.id] ?? [],
    }));

    const subnetVlanIds = new Set(
      subnets.map((subnet) => subnet.vlanId).filter(Boolean) as string[],
    );
    for (const vlan of vlans) {
      if (!subnetVlanIds.has(vlan.id)) {
        rows.push({
          id: `vlan:${vlan.id}`,
          kind: "vlan-only",
          vlan,
          dhcpScopes: [],
          zones: [],
          assignments: [],
        });
      }
    }

    return rows.sort(compareNetworkRows);
  }, [
    assignmentsBySubnetId,
    scopesBySubnetId,
    subnets,
    vlanById,
    vlans,
    zonesBySubnetId,
  ]);

  const filteredNetworks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return networks;
    return networks.filter((network) =>
      networkSearchText(network).includes(normalized),
    );
  }, [networks, query]);

  const selectedNetwork =
    networks.find((network) => network.id === selectedNetworkId) ?? networks[0];
  const subnet =
    selectedNetwork?.kind === "subnet" ? selectedNetwork.subnet : undefined;
  const vlan =
    selectedNetwork?.kind === "subnet"
      ? selectedNetwork.vlan
      : selectedNetwork?.vlan;
  const assignments = selectedNetwork?.assignments ?? [];
  const subnetScopes = selectedNetwork?.dhcpScopes ?? [];
  const subnetZones = selectedNetwork?.zones ?? [];
  const visibleSubnetZones = useMemo(
    () => subnetZones.filter(isUserVisibleZone),
    [subnetZones],
  );
  const configuredNetworks = filteredNetworks.filter(
    (network) => network.kind === "subnet",
  );
  const planningNetworks = filteredNetworks.filter(
    (network) => network.kind === "vlan-only",
  );

  useEffect(() => {
    if (!networks.length) {
      setSelectedNetworkId("");
      return;
    }

    let nextId = "";
    if (requestedSubnetId) {
      nextId =
        networks.find(
          (network) =>
            network.kind === "subnet" &&
            network.subnet.id === requestedSubnetId,
        )?.id ?? "";
    }
    if (!nextId && requestedVlanId) {
      nextId =
        networks.find((network) => {
          if (network.kind === "subnet") {
            return network.subnet.vlanId === requestedVlanId;
          }
          return network.vlan.id === requestedVlanId;
        })?.id ?? "";
    }
    if (
      !nextId &&
      selectedNetworkId &&
      networks.some((network) => network.id === selectedNetworkId)
    ) {
      nextId = selectedNetworkId;
    }
    if (!nextId) nextId = networks[0].id;

    if (nextId !== selectedNetworkId) {
      setSelectedNetworkId(nextId);
    }
  }, [
    networks,
    requestedSubnetId,
    requestedVlanId,
    selectedNetworkId,
  ]);

  const deviceById = useMemo(() => {
    return devices.reduce<Record<string, Device>>((acc, device) => {
      acc[device.id] = device;
      return acc;
    }, {});
  }, [devices]);

  useEffect(() => {
    if (!subnet || creatingSubnet) return;
    setSubnetForm({
      cidr: subnet.cidr,
      name: subnet.name,
      description: subnet.description ?? "",
      gateway: subnet.gateway ?? "",
      dnsServers: (subnet.dnsServers ?? []).join(", "),
      vlanId: subnet.vlanId ?? "",
    });
    setSubnetError("");
  }, [creatingSubnet, subnet]);

  useEffect(() => {
    if (!subnetScopes.length) {
      setSelectedScopeId(null);
      return;
    }
    if (
      !selectedScopeId ||
      !subnetScopes.some((scope) => scope.id === selectedScopeId)
    ) {
      setSelectedScopeId(subnetScopes[0].id);
    }
  }, [selectedScopeId, subnetScopes]);

  const selectedScope = selectedScopeId
    ? subnetScopes.find((scope) => scope.id === selectedScopeId)
    : undefined;

  useEffect(() => {
    if (creatingScope) {
      setScopeForm(EMPTY_SCOPE_FORM);
      setScopeError("");
      return;
    }
    if (!selectedScope) return;
    setScopeForm({
      name: selectedScope.name,
      startIp: selectedScope.startIp,
      endIp: selectedScope.endIp,
      gateway: selectedScope.gateway ?? "",
      dnsServers: (selectedScope.dnsServers ?? []).join(", "),
      description: selectedScope.description ?? "",
    });
    setScopeError("");
  }, [creatingScope, selectedScope]);

  useEffect(() => {
    if (!visibleSubnetZones.length) {
      setSelectedZoneId(null);
      return;
    }
    if (
      !selectedZoneId ||
      !visibleSubnetZones.some((zone) => zone.id === selectedZoneId)
    ) {
      setSelectedZoneId(visibleSubnetZones[0].id);
    }
  }, [selectedZoneId, visibleSubnetZones]);

  const selectedZone = selectedZoneId
    ? visibleSubnetZones.find((zone) => zone.id === selectedZoneId)
    : undefined;

  useEffect(() => {
    if (creatingZone) {
      setZoneForm(EMPTY_ZONE_FORM);
      setZoneError("");
      return;
    }
    if (!selectedZone) return;
    setZoneForm({
      kind: selectedZone.kind,
      startIp: selectedZone.startIp,
      endIp: selectedZone.endIp,
      description: selectedZone.description ?? "",
    });
    setZoneError("");
  }, [creatingZone, selectedZone]);

  useEffect(() => {
    if (!vlan) {
      setVlanForm(EMPTY_VLAN_FORM);
      setVlanError("");
      return;
    }
    setVlanForm({
      vlanId: String(vlan.vlanId),
      name: vlan.name,
      description: vlan.description ?? "",
      color: vlan.color ?? "",
    });
    setVlanError("");
  }, [vlan]);

  const selectedRange = selectedRangeId
    ? ranges.find((range) => range.id === selectedRangeId)
    : undefined;

  useEffect(() => {
    if (selectedRangeId && !ranges.some((range) => range.id === selectedRangeId)) {
      setSelectedRangeId(undefined);
    }
  }, [ranges, selectedRangeId]);

  useEffect(() => {
    if (creatingRange) {
      setRangeForm(EMPTY_RANGE_FORM);
      setRangeError("");
      return;
    }
    if (!selectedRange) return;
    setRangeForm({
      name: selectedRange.name,
      startVlan: String(selectedRange.startVlan),
      endVlan: String(selectedRange.endVlan),
      purpose: selectedRange.purpose ?? "",
      color: selectedRange.color ?? "",
    });
    setRangeError("");
  }, [creatingRange, selectedRange]);

  const grouped = useMemo(() => {
    return assignments.reduce<Record<string, IpAssignment[]>>(
      (acc, assignment) => {
        (acc[assignment.assignmentType] ??= []).push(assignment);
        return acc;
      },
      {},
    );
  }, [assignments]);

  function selectNetwork(network: NetworkRow, replace = false) {
    setSelectedNetworkId(network.id);
    setCreatingSubnet(false);
    setCreatingScope(false);
    setCreatingZone(false);
    setSubnetError("");
    setScopeError("");
    setZoneError("");

    const next = new URLSearchParams(searchParams);
    next.delete("subnetId");
    next.delete("vlanId");
    if (network.kind === "subnet") {
      next.set("subnetId", network.subnet.id);
      if (network.subnet.vlanId) next.set("vlanId", network.subnet.vlanId);
    } else {
      next.set("vlanId", network.vlan.id);
    }
    setSearchParams(next, { replace });
  }

  function selectCreatedSubnet(id: string) {
    setSelectedNetworkId(`subnet:${id}`);
    const next = new URLSearchParams(searchParams);
    next.set("subnetId", id);
    next.delete("vlanId");
    setSearchParams(next, { replace: true });
  }

  function startSubnetForVlan(targetVlan: Vlan) {
    setCreatingSubnet(true);
    setSubnetForm({
      ...EMPTY_SUBNET_FORM,
      name: `${targetVlan.name} subnet`,
      vlanId: targetVlan.id,
    });
    setSubnetError("");
  }

  async function handleUnassign(assignmentId: string) {
    setReleasingId(assignmentId);
    try {
      await unassignIp(assignmentId);
    } finally {
      setReleasingId(null);
    }
  }

  async function handleCreateNetwork() {
    setNetworkSaving(true);
    setNetworkError("");
    try {
      const name = networkForm.name.trim();
      const cidr = networkForm.cidr.trim();
      if (!name) {
        setNetworkError(t("Network name is required."));
        return;
      }
      if (!cidr) {
        setNetworkError(t("Subnet CIDR is required."));
        return;
      }

      let vlanDraft:
        | {
            vlanId: number;
            name: string;
            description?: string;
            color?: string;
          }
        | null = null;
      if (networkForm.mode === "tagged") {
        const parsedVlanId = Number.parseInt(networkForm.vlanId, 10);
        if (!Number.isFinite(parsedVlanId)) {
          setNetworkError(t("VLAN ID is required."));
          return;
        }
        vlanDraft = {
          vlanId: parsedVlanId,
          name,
          description: networkForm.description.trim() || undefined,
          color: networkForm.color.trim() || undefined,
        };
      }

      const dnsServers = parseDnsServers(networkForm.dnsServers);
      const zones: Array<{
        kind: IpZoneKind;
        startIp: string;
        endIp: string;
        description: string;
      }> = [];

      const dhcpStartIp = networkForm.dhcpStartIp.trim();
      const dhcpEndIp = networkForm.dhcpEndIp.trim();
      const hasPartialDhcp = Boolean(dhcpStartIp || dhcpEndIp);
      const hasCompleteDhcp = Boolean(dhcpStartIp && dhcpEndIp);
      if (networkForm.enableDhcp && hasPartialDhcp && !hasCompleteDhcp) {
        setNetworkError(t("DHCP needs both a start IP and an end IP."));
        return;
      }

      let dhcpScope:
        | {
            name: string;
            startIp: string;
            endIp: string;
            gateway?: string;
            dnsServers?: string[];
            description?: string;
          }
        | null = null;
      if (networkForm.enableDhcp && dhcpStartIp && dhcpEndIp) {
        dhcpScope = {
          name:
            networkForm.dhcpName.trim() ||
            `${networkForm.subnetName.trim() || name} DHCP`,
          startIp: dhcpStartIp,
          endIp: dhcpEndIp,
          gateway: networkForm.gateway.trim() || undefined,
          dnsServers,
          description: networkForm.dhcpDescription.trim() || undefined,
        };
        zones.push({
          kind: "dhcp",
          startIp: dhcpStartIp,
          endIp: dhcpEndIp,
          description:
            networkForm.dhcpDescription.trim() || "Dynamic lease pool",
        });
      }

      const zoneDrafts = [
        {
          kind: "static" as const,
          startIp: networkForm.staticStartIp.trim(),
          endIp: networkForm.staticEndIp.trim(),
          description: "Static assignments",
        },
        {
          kind: "reserved" as const,
          startIp: networkForm.reservedStartIp.trim(),
          endIp: networkForm.reservedEndIp.trim(),
          description: "Reserved addresses",
        },
      ];
      for (const zone of zoneDrafts) {
        if (!zone.startIp && !zone.endIp) continue;
        if (!zone.startIp || !zone.endIp) {
          setNetworkError(
            t("{zone} needs both start and end IP.", {
              zone: zone.description,
            }),
          );
          return;
        }
        zones.push({
          kind: zone.kind,
          startIp: zone.startIp,
          endIp: zone.endIp,
          description: zone.description,
        });
      }

      const created = await createNetworkRecord({
        labId: activeLab.id,
        vlan: vlanDraft,
        subnet: {
          cidr,
          name: networkForm.subnetName.trim() || name,
          description:
            networkForm.subnetDescription.trim() ||
            networkForm.description.trim() ||
            undefined,
          gateway: networkForm.gateway.trim() || undefined,
          dnsServers,
        },
        dhcpScope,
        zones,
      });

      selectCreatedSubnet(created.subnet.id);
      setCreatingNetwork(false);
      setNetworkForm(EMPTY_NETWORK_FORM);
    } catch (err) {
      setNetworkError(
        err instanceof Error ? err.message : t("Failed to create network."),
      );
    } finally {
      setNetworkSaving(false);
    }
  }

  async function handleSaveVlan() {
    if (!vlan) return;
    setVlanSaving(true);
    setVlanError("");
    try {
      await updateVlanRecord(vlan.id, {
        vlanId: Number.parseInt(vlanForm.vlanId, 10),
        name: vlanForm.name.trim(),
        description: vlanForm.description.trim() || null,
        color: vlanForm.color.trim() || null,
      });
    } catch (err) {
      setVlanError(
        err instanceof Error ? err.message : t("Failed to save VLAN."),
      );
    } finally {
      setVlanSaving(false);
    }
  }

  async function handleDeleteVlan() {
    if (!vlan) return;
    if (
      !window.confirm(
        t("Delete VLAN {vlanId} ({name})?", {
          vlanId: vlan.vlanId,
          name: vlan.name,
        }),
      )
    ) {
      return;
    }
    setVlanDeleting(true);
    setVlanError("");
    try {
      await deleteVlan(vlan.id);
      setSelectedNetworkId("");
    } catch (err) {
      setVlanError(
        err instanceof Error ? err.message : t("Failed to delete VLAN."),
      );
    } finally {
      setVlanDeleting(false);
    }
  }

  async function handleSaveRange() {
    setRangeSaving(true);
    setRangeError("");
    try {
      if (creatingRange) {
        const created = await createVlanRangeRecord({
          labId: activeLab.id,
          name: rangeForm.name.trim(),
          startVlan: Number.parseInt(rangeForm.startVlan, 10),
          endVlan: Number.parseInt(rangeForm.endVlan, 10),
          purpose: rangeForm.purpose.trim() || undefined,
          color: rangeForm.color.trim() || undefined,
        });
        setSelectedRangeId(created.id);
        setCreatingRange(false);
        return;
      }

      if (!selectedRange) return;
      await updateVlanRangeRecord(selectedRange.id, {
        name: rangeForm.name.trim(),
        startVlan: Number.parseInt(rangeForm.startVlan, 10),
        endVlan: Number.parseInt(rangeForm.endVlan, 10),
        purpose: rangeForm.purpose.trim() || null,
        color: rangeForm.color.trim() || null,
      });
    } catch (err) {
      setRangeError(
        err instanceof Error ? err.message : t("Failed to save VLAN range."),
      );
    } finally {
      setRangeSaving(false);
    }
  }

  async function handleDeleteRange() {
    if (!selectedRange) return;
    if (
      !window.confirm(t("Delete VLAN range {name}?", { name: selectedRange.name }))
    ) {
      return;
    }
    setRangeDeleting(true);
    setRangeError("");
    try {
      await deleteVlanRangeRecord(selectedRange.id);
      setSelectedRangeId(undefined);
      setCreatingRange(false);
    } catch (err) {
      setRangeError(
        err instanceof Error ? err.message : t("Failed to delete VLAN range."),
      );
    } finally {
      setRangeDeleting(false);
    }
  }

  async function handleSaveSubnet() {
    if (!creatingSubnet && !subnet) return;
    setSubnetSaving(true);
    setSubnetError("");
    try {
      if (creatingSubnet) {
        const created = await createSubnetRecord({
          labId: activeLab.id,
          cidr: subnetForm.cidr.trim(),
          name: subnetForm.name.trim(),
          description: subnetForm.description.trim() || undefined,
          gateway: subnetForm.gateway.trim() || undefined,
          dnsServers: parseDnsServers(subnetForm.dnsServers),
          vlanId: subnetForm.vlanId || undefined,
        });
        selectCreatedSubnet(created.id);
        setCreatingSubnet(false);
        return;
      }

      if (!subnet) return;
      await updateSubnetRecord(subnet.id, {
        cidr: subnetForm.cidr.trim(),
        name: subnetForm.name.trim(),
        description: subnetForm.description.trim() || null,
        gateway: subnetForm.gateway.trim() || null,
        dnsServers: parseDnsServers(subnetForm.dnsServers) ?? null,
        vlanId: subnetForm.vlanId || null,
      });
    } catch (err) {
      setSubnetError(
        err instanceof Error ? err.message : t("Failed to save subnet."),
      );
    } finally {
      setSubnetSaving(false);
    }
  }

  async function handleDeleteSubnet() {
    if (!subnet) return;
    if (
      !window.confirm(
        t(
          "Delete subnet {cidr}? This also removes its scopes, zones, and assignments.",
          { cidr: subnet.cidr },
        ),
      )
    ) {
      return;
    }
    setSubnetDeleting(true);
    setSubnetError("");
    try {
      await deleteSubnetRecord(subnet.id);
      setSelectedNetworkId("");
    } catch (err) {
      setSubnetError(
        err instanceof Error ? err.message : t("Failed to delete subnet."),
      );
    } finally {
      setSubnetDeleting(false);
    }
  }

  async function handleSaveScope() {
    if (!subnet) return;
    setScopeSaving(true);
    setScopeError("");
    try {
      if (creatingScope) {
        const created = await createDhcpScopeRecord({
          subnetId: subnet.id,
          name: scopeForm.name.trim(),
          startIp: scopeForm.startIp.trim(),
          endIp: scopeForm.endIp.trim(),
          gateway: scopeForm.gateway.trim() || undefined,
          dnsServers: parseDnsServers(scopeForm.dnsServers),
          description: scopeForm.description.trim() || undefined,
        });
        setSelectedScopeId(created.id);
        setCreatingScope(false);
        return;
      }

      if (!selectedScope) return;
      await updateDhcpScopeRecord(selectedScope.id, {
        name: scopeForm.name.trim(),
        startIp: scopeForm.startIp.trim(),
        endIp: scopeForm.endIp.trim(),
        gateway: scopeForm.gateway.trim() || null,
        dnsServers: parseDnsServers(scopeForm.dnsServers) ?? null,
        description: scopeForm.description.trim() || null,
      });
    } catch (err) {
      setScopeError(
        err instanceof Error ? err.message : t("Failed to save DHCP scope."),
      );
    } finally {
      setScopeSaving(false);
    }
  }

  async function handleDeleteScope() {
    if (!selectedScope) return;
    if (
      !window.confirm(
        t("Delete DHCP scope {name}?", { name: selectedScope.name }),
      )
    )
      return;
    setScopeDeleting(true);
    setScopeError("");
    try {
      await deleteDhcpScopeRecord(selectedScope.id);
      setSelectedScopeId(null);
      setCreatingScope(false);
    } catch (err) {
      setScopeError(
        err instanceof Error ? err.message : t("Failed to delete DHCP scope."),
      );
    } finally {
      setScopeDeleting(false);
    }
  }

  async function handleSaveZone() {
    if (!subnet) return;
    setZoneSaving(true);
    setZoneError("");
    try {
      const kind = USER_ZONE_KIND_SET.has(zoneForm.kind)
        ? zoneForm.kind
        : "static";
      if (creatingZone) {
        const created = await createIpZoneRecord({
          subnetId: subnet.id,
          kind,
          startIp: zoneForm.startIp.trim(),
          endIp: zoneForm.endIp.trim(),
          description: zoneForm.description.trim() || undefined,
        });
        setSelectedZoneId(created.id);
        setCreatingZone(false);
        return;
      }

      if (!selectedZone) return;
      await updateIpZoneRecord(selectedZone.id, {
        kind,
        startIp: zoneForm.startIp.trim(),
        endIp: zoneForm.endIp.trim(),
        description: zoneForm.description.trim() || undefined,
      });
    } catch (err) {
      setZoneError(
        err instanceof Error ? err.message : t("Failed to save IP zone."),
      );
    } finally {
      setZoneSaving(false);
    }
  }

  async function handleDeleteZone() {
    if (!selectedZone) return;
    if (
      !window.confirm(
        t("Delete {kind} zone {startIp}-{endIp}?", {
          kind: selectedZone.kind,
          startIp: selectedZone.startIp,
          endIp: selectedZone.endIp,
        }),
      )
    ) {
      return;
    }
    setZoneDeleting(true);
    setZoneError("");
    try {
      await deleteIpZoneRecord(selectedZone.id);
      setSelectedZoneId(null);
      setCreatingZone(false);
    } catch (err) {
      setZoneError(
        err instanceof Error ? err.message : t("Failed to delete IP zone."),
      );
    } finally {
      setZoneDeleting(false);
    }
  }

  return (
    <>
      <TopBar
        subtitle={t("Network")}
        title={t("Networks")}
        meta={
          <>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              {t("{count} networks", { count: networks.length })}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              | {t("{count} VLANs", { count: vlans.length })}
            </span>
          </>
        }
        actions={
          <>
            {canEdit && (
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  setCreatingNetwork(true);
                  setNetworkForm(EMPTY_NETWORK_FORM);
                  setNetworkError("");
                }}
              >
                <Plus className="size-3.5" />
                {t("Add network")}
              </Button>
            )}
            <AllocatePanel
              defaultTab={subnet ? "ip" : "vlan"}
              defaultSubnetId={subnet?.id}
              defaultRangeId={selectedRangeId}
            />
          </>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-80 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-bg-2)]/40">
          <div className="space-y-3 border-b border-[var(--color-line)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                {t("Network rows")}
              </span>
              <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                {filteredNetworks.length}
              </Mono>
            </div>
            <div className="relative">
              <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-faint)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Search networks...")}
                className="pl-8"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            <NetworkListSection
              title={t("Configured networks")}
              count={configuredNetworks.length}
            >
              {configuredNetworks.map((network) => (
                <NetworkListRow
                  key={network.id}
                  network={network}
                  active={network.id === selectedNetwork?.id}
                  onSelect={() => selectNetwork(network)}
                />
              ))}
            </NetworkListSection>

            {planningNetworks.length > 0 && (
              <NetworkListSection
                title={t("VLANs needing subnet")}
                count={planningNetworks.length}
              >
                {planningNetworks.map((network) => (
                  <NetworkListRow
                    key={network.id}
                    network={network}
                    active={network.id === selectedNetwork?.id}
                    onSelect={() => selectNetwork(network)}
                  />
                ))}
              </NetworkListSection>
            )}

            {filteredNetworks.length === 0 && (
              <div className="px-4 py-6 text-xs text-[var(--color-fg-subtle)]">
                {t("No networks documented yet")}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {canEdit && creatingNetwork && (
            <NetworkSetupPanel
              form={networkForm}
              error={networkError}
              saving={networkSaving}
              onChange={setNetworkForm}
              onCancel={() => {
                setCreatingNetwork(false);
                setNetworkForm(EMPTY_NETWORK_FORM);
                setNetworkError("");
              }}
              onSave={() => void handleCreateNetwork()}
            />
          )}

          {!selectedNetwork ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Networks")}</CardLabel>
                  <CardHeading>{t("No networks documented yet")}</CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <EmptyState
                  icon={Network}
                  title={t("No networks documented yet")}
                  description={t(
                    "Create a network to document VLAN tags, subnets, DHCP scopes, zones, and address assignments together.",
                  )}
                />
              </CardBody>
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                    {selectedNetwork.kind === "vlan-only"
                      ? t("VLAN only")
                      : t("Network")}
                  </div>
                  <h2 className="flex flex-wrap items-center gap-3 text-lg font-semibold tracking-tight">
                    {subnet ? (
                      <>
                        <span className="font-mono">{subnet.cidr}</span>
                        <span className="font-sans text-[var(--color-fg-muted)]">
                          /
                        </span>
                        <span className="font-sans">{subnet.name}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-mono">VLAN {vlan?.vlanId}</span>
                        <span className="font-sans text-[var(--color-fg-muted)]">
                          /
                        </span>
                        <span className="font-sans">{vlan?.name}</span>
                      </>
                    )}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {vlan ? (
                      <span
                        className="rounded-[1px] px-1.5 py-0.5 font-mono text-[11px]"
                        style={{
                          backgroundColor: `${vlan.color}20`,
                          color: vlan.color,
                        }}
                      >
                        {t("VLAN {vlanId} - {name}", {
                          vlanId: vlan.vlanId,
                          name: vlan.name,
                        })}
                      </span>
                    ) : (
                      <Badge tone="neutral">{t("No VLAN tag")}</Badge>
                    )}
                    {subnet?.gateway && (
                      <span className="text-[11px] text-[var(--color-fg-subtle)]">
                        {t("gateway {gateway}", { gateway: subnet.gateway })}
                      </span>
                    )}
                    {(subnet?.dnsServers ?? []).length > 0 && (
                      <span className="text-[11px] text-[var(--color-fg-subtle)]">
                        {t("DNS {servers}", {
                          servers: (subnet?.dnsServers ?? []).join(", "),
                        })}
                      </span>
                    )}
                  </div>
                </div>
                {subnet && (
                  <AllocatePanel
                    defaultTab="ip"
                    defaultSubnetId={subnet.id}
                    trigger={
                      <Button variant="outline" size="sm">
                        <Plus className="size-3.5" />
                        {t("Allocate")}
                      </Button>
                    }
                  />
                )}
              </div>

              {vlan && canEdit && (
                <VlanEditor
                  form={vlanForm}
                  error={vlanError}
                  saving={vlanSaving}
                  deleting={vlanDeleting}
                  canEdit={canEdit}
                  canDelete={true}
                  onChange={setVlanForm}
                  onSave={() => void handleSaveVlan()}
                  onDelete={() => void handleDeleteVlan()}
                />
              )}

              {selectedNetwork.kind === "vlan-only" && vlan && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <CardLabel>{t("Planning VLAN")}</CardLabel>
                      <CardHeading>{t("No subnet linked yet")}</CardHeading>
                    </CardTitle>
                    {canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startSubnetForVlan(vlan)}
                      >
                        <Plus className="size-3.5" />
                        {t("Add subnet to VLAN")}
                      </Button>
                    )}
                  </CardHeader>
                  <CardBody>
                    <EmptyState
                      icon={Hash}
                      title={t("Needs subnet")}
                      description={t(
                        "This VLAN is documented, but no CIDR is linked to it yet.",
                      )}
                    />
                  </CardBody>
                </Card>
              )}

              {canEdit && (subnet || creatingSubnet) && (
                <SubnetEditor
                  creating={creatingSubnet || !subnet}
                  form={subnetForm}
                  vlans={vlans}
                  error={subnetError}
                  saving={subnetSaving}
                  deleting={subnetDeleting}
                  canDelete={Boolean(subnet && !creatingSubnet)}
                  onChange={setSubnetForm}
                  onSave={() => void handleSaveSubnet()}
                  onDelete={() => void handleDeleteSubnet()}
                  onNew={() => {
                    setCreatingSubnet(true);
                    setSubnetForm({
                      ...EMPTY_SUBNET_FORM,
                      vlanId: vlan?.id ?? "",
                    });
                    setSubnetError("");
                  }}
                />
              )}

              {subnet && (
                <>
                  {visibleSubnetZones.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          <CardLabel>{t("Layout")}</CardLabel>
                          <CardHeading>{t("Zone allocation")}</CardHeading>
                        </CardTitle>
                      </CardHeader>
                      <CardBody>
                        <IpZoneBar
                          subnet={subnet}
                          zones={visibleSubnetZones}
                          scopes={subnetScopes}
                          assignments={assignments}
                        />
                      </CardBody>
                    </Card>
                  )}

                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <CardLabel>{t("Allocation")}</CardLabel>
                        <CardHeading>{t("Address utilization")}</CardHeading>
                      </CardTitle>
                    </CardHeader>
                    <CardBody>
                      <IpUtilizationBar
                        subnet={subnet}
                        assignments={assignments}
                        scopes={subnetScopes}
                      />
                    </CardBody>
                  </Card>

                  <ScopeEditor
                    subnet={subnet}
                    scopes={subnetScopes}
                    selectedScopeId={selectedScopeId}
                    setSelectedScopeId={setSelectedScopeId}
                    creating={creatingScope}
                    setCreating={setCreatingScope}
                    form={scopeForm}
                    onChange={setScopeForm}
                    error={scopeError}
                    saving={scopeSaving}
                    deleting={scopeDeleting}
                    canEdit={canEdit}
                    onSave={() => void handleSaveScope()}
                    onDelete={() => void handleDeleteScope()}
                  />

                  <ZoneEditor
                    zones={visibleSubnetZones}
                    selectedZoneId={selectedZoneId}
                    setSelectedZoneId={setSelectedZoneId}
                    creating={creatingZone}
                    setCreating={setCreatingZone}
                    form={zoneForm}
                    onChange={setZoneForm}
                    error={zoneError}
                    saving={zoneSaving}
                    deleting={zoneDeleting}
                    canEdit={canEdit}
                    onSave={() => void handleSaveZone()}
                    onDelete={() => void handleDeleteZone()}
                  />

                  <AssignmentsSection
                    grouped={grouped}
                    deviceById={deviceById}
                    releasingId={releasingId}
                    canEdit={canEdit}
                    onUnassign={(id) => void handleUnassign(id)}
                  />
                </>
              )}
            </>
          )}

          {showVlanPlanning || creatingRange ? (
            <VlanRangesPanel
              ranges={ranges}
              vlans={vlans}
              selectedRangeId={selectedRangeId}
              selectedRange={selectedRange}
              creating={creatingRange}
              form={rangeForm}
              error={rangeError}
              saving={rangeSaving}
              deleting={rangeDeleting}
              canEdit={canEdit}
              onSelectRange={(id) => {
                setSelectedRangeId(id === selectedRangeId ? undefined : id);
                setCreatingRange(false);
              }}
              onNew={() => {
                setShowVlanPlanning(true);
                setCreatingRange(true);
                setSelectedRangeId(undefined);
                setRangeForm(EMPTY_RANGE_FORM);
                setRangeError("");
              }}
              onChange={setRangeForm}
              onCancel={() => {
                setCreatingRange(false);
                setRangeError("");
              }}
              onSave={() => void handleSaveRange()}
              onDelete={() => void handleDeleteRange()}
              onCollapse={() => {
                setShowVlanPlanning(false);
                setCreatingRange(false);
                setSelectedRangeId(undefined);
                setRangeError("");
              }}
            />
          ) : (
            <VlanPlanningSummary
              ranges={ranges}
              vlans={vlans}
              canEdit={canEdit}
              onShow={() => setShowVlanPlanning(true)}
              onNew={() => {
                setShowVlanPlanning(true);
                setCreatingRange(true);
                setSelectedRangeId(undefined);
                setRangeForm(EMPTY_RANGE_FORM);
                setRangeError("");
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

function NetworkListSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="border-b border-[var(--color-line)]/70 py-1 last:border-b-0">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-fg-faint)]">
          {title}
        </span>
        <span className="font-mono text-[9px] text-[var(--color-fg-faint)]">
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

function NetworkListRow({
  network,
  active,
  onSelect,
}: {
  network: NetworkRow;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const rowSubnet = network.kind === "subnet" ? network.subnet : undefined;
  const rowVlan = network.kind === "subnet" ? network.vlan : network.vlan;
  const pct = rowSubnet
    ? Math.round(
        (network.assignments.length / Math.max(1, cidrSize(rowSubnet.cidr) - 2)) *
          100,
      )
    : 0;
  const zoneCount = countUserVisibleZones(network.zones);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full border-l-2 px-4 py-3 text-left transition-colors ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-surface)]"
          : "border-transparent hover:bg-[var(--color-surface)]/40"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        {rowSubnet ? (
          <Network className="size-3 text-[var(--color-fg-muted)]" />
        ) : (
          <Hash className="size-3 text-[var(--color-fg-muted)]" />
        )}
        <Mono className="truncate text-xs text-[var(--color-fg)]">
          {rowSubnet
            ? rowSubnet.cidr
            : rowVlan
              ? `VLAN ${rowVlan.vlanId}`
              : t("No VLAN tag")}
        </Mono>
        {network.kind === "vlan-only" && (
          <Badge tone="warn">{t("Needs subnet")}</Badge>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
          {rowSubnet?.name ?? rowVlan?.name ?? t("No VLAN tag")}
        </span>
        {rowVlan ? (
          <span
            className="rounded-[1px] px-1 font-mono text-[10px]"
            style={{
              backgroundColor: `${rowVlan.color}20`,
              color: rowVlan.color,
            }}
          >
            VL{rowVlan.vlanId}
          </span>
        ) : (
          <span className="font-mono text-[10px] text-[var(--color-fg-subtle)]">
            {t("No VLAN tag")}
          </span>
        )}
      </div>
      {rowSubnet ? (
        <>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[var(--color-fg-subtle)]">
            <span>
              {t("{count} assigned", {
                count: network.assignments.length,
              })}
            </span>
            <span>|</span>
            <span>{t("{count} DHCP", { count: network.dhcpScopes.length })}</span>
            <span>|</span>
            <span>{t("{count} zones", { count: zoneCount })}</span>
          </div>
          <div className="mt-1.5 h-0.5 overflow-hidden bg-[var(--color-bg)]">
            <div
              className="h-full bg-[var(--color-accent)]"
              style={{ width: `${pct}%`, opacity: 0.7 }}
            />
          </div>
        </>
      ) : (
        <div className="mt-1.5 text-[10px] text-[var(--color-fg-subtle)]">
          {t("No subnet linked yet")}
        </div>
      )}
    </button>
  );
}

function NetworkSetupPanel({
  form,
  error,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  form: NetworkForm;
  error: string;
  saving: boolean;
  onChange: React.Dispatch<React.SetStateAction<NetworkForm>>;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("Network setup")}</CardLabel>
          <CardHeading>{t("Add VLAN, subnet, DHCP, and zones")}</CardHeading>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-[0.8fr_1fr]">
          <div className="space-y-4 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
            <div>
              <div className="rk-kicker">{t("Layer 2")}</div>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {(["tagged", "untagged"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onChange((prev) => ({ ...prev, mode }))}
                    className={`rounded-[var(--radius-xs)] border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                      form.mode === mode
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                        : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
                    }`}
                  >
                    {mode === "tagged" ? t("VLAN tagged") : t("No VLAN tag")}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {form.mode === "tagged" && (
                <Field label={t("VLAN ID")}>
                  <Input
                    type="number"
                    min={1}
                    max={4094}
                    value={form.vlanId}
                    onChange={(event) =>
                      onChange((prev) => ({
                        ...prev,
                        vlanId: event.target.value,
                      }))
                    }
                    placeholder="100"
                  />
                </Field>
              )}
              <Field label={t("Name")}>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      name: event.target.value,
                      subnetName: prev.subnetName || event.target.value,
                    }))
                  }
                  placeholder="Management"
                />
              </Field>
            </div>
            <div
              className={`grid gap-4 ${
                form.mode === "tagged" ? "md:grid-cols-2" : ""
              }`}
            >
              {form.mode === "tagged" && (
                <Field label={t("Color")}>
                  <ColorInput
                    value={form.color}
                    onChange={(value) =>
                      onChange((prev) => ({ ...prev, color: value }))
                    }
                    placeholder="#4f8cff or blue"
                  />
                </Field>
              )}
              <Field label={t("Description")}>
                <Input
                  value={form.description}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Core management network"
                />
              </Field>
            </div>
          </div>

          <div className="space-y-4 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
            <div className="rk-kicker">{t("Address plan")}</div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("Subnet CIDR")}>
                <Input
                  value={form.cidr}
                  onChange={(event) =>
                    onChange((prev) => ({ ...prev, cidr: event.target.value }))
                  }
                  placeholder="10.0.10.0/24"
                />
              </Field>
              <Field label={t("Subnet name")}>
                <Input
                  value={form.subnetName}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      subnetName: event.target.value,
                    }))
                  }
                  placeholder="Management subnet"
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("Gateway")}>
                <Input
                  value={form.gateway}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      gateway: event.target.value,
                    }))
                  }
                  placeholder="10.0.10.1"
                />
              </Field>
              <Field label={t("DNS servers")}>
                <Input
                  value={form.dnsServers}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      dnsServers: event.target.value,
                    }))
                  }
                  placeholder="10.0.10.1, 1.1.1.1"
                />
              </Field>
            </div>
            <Field label={t("Subnet notes")}>
              <Input
                value={form.subnetDescription}
                onChange={(event) =>
                  onChange((prev) => ({
                    ...prev,
                    subnetDescription: event.target.value,
                  }))
                }
                placeholder="Anything specific about this subnet"
              />
            </Field>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="rk-kicker">{t("DHCP")}</div>
                <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                  {t("Optional dynamic lease pool for this subnet.")}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
                <input
                  type="checkbox"
                  checked={form.enableDhcp}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      enableDhcp: event.target.checked,
                    }))
                  }
                />
                {t("Enabled")}
              </label>
            </div>
            {form.enableDhcp && (
              <>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label={t("Scope name")}>
                    <Input
                      value={form.dhcpName}
                      onChange={(event) =>
                        onChange((prev) => ({
                          ...prev,
                          dhcpName: event.target.value,
                        }))
                      }
                      placeholder="clients"
                    />
                  </Field>
                  <Field label={t("Start IP")}>
                    <Input
                      value={form.dhcpStartIp}
                      onChange={(event) =>
                        onChange((prev) => ({
                          ...prev,
                          dhcpStartIp: event.target.value,
                        }))
                      }
                      placeholder="10.0.10.100"
                    />
                  </Field>
                  <Field label={t("End IP")}>
                    <Input
                      value={form.dhcpEndIp}
                      onChange={(event) =>
                        onChange((prev) => ({
                          ...prev,
                          dhcpEndIp: event.target.value,
                        }))
                      }
                      placeholder="10.0.10.199"
                    />
                  </Field>
                </div>
                <Field label={t("DHCP notes")}>
                  <Input
                    value={form.dhcpDescription}
                    onChange={(event) =>
                      onChange((prev) => ({
                        ...prev,
                        dhcpDescription: event.target.value,
                      }))
                    }
                    placeholder="General client pool"
                  />
                </Field>
              </>
            )}
          </div>

          <div className="space-y-4 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
            <div>
              <div className="rk-kicker">{t("IP zones")}</div>
              <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                {t("Optional ranges for static and reserved addresses.")}
              </div>
            </div>
            {(
              [
                ["Static", "staticStartIp", "staticEndIp"],
                ["Reserved", "reservedStartIp", "reservedEndIp"],
              ] as const
            ).map(([label, startKey, endKey]) => (
              <div key={label} className="grid gap-3 md:grid-cols-3">
                <div className="pt-6 text-xs font-medium text-[var(--color-fg-muted)]">
                  {t(label)}
                </div>
                <Field label={t("Start IP")}>
                  <Input
                    value={form[startKey] as string}
                    onChange={(event) =>
                      onChange((prev) => ({
                        ...prev,
                        [startKey]: event.target.value,
                      }))
                    }
                    placeholder="10.0.10.10"
                  />
                </Field>
                <Field label={t("End IP")}>
                  <Input
                    value={form[endKey] as string}
                    onChange={(event) =>
                      onChange((prev) => ({
                        ...prev,
                        [endKey]: event.target.value,
                      }))
                    }
                    placeholder="10.0.10.99"
                  />
                </Field>
              </div>
            ))}
          </div>
        </div>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            <Save className="size-3.5" />
            {saving ? t("Creating...") : t("Create network")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function VlanEditor({
  form,
  error,
  saving,
  deleting,
  canEdit,
  canDelete,
  onChange,
  onSave,
  onDelete,
}: {
  form: VlanForm;
  error: string;
  saving: boolean;
  deleting: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onChange: React.Dispatch<React.SetStateAction<VlanForm>>;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("VLAN details")}</CardLabel>
          <CardHeading>{t("Update VLAN details")}</CardHeading>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("VLAN ID")}>
            <Input
              type="number"
              min={1}
              max={4094}
              value={form.vlanId}
              disabled={!canEdit}
              onChange={(event) =>
                onChange((prev) => ({ ...prev, vlanId: event.target.value }))
              }
            />
          </Field>
          <Field label={t("Name")}>
            <Input
              value={form.name}
              disabled={!canEdit}
              onChange={(event) =>
                onChange((prev) => ({ ...prev, name: event.target.value }))
              }
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("Color")}>
            <ColorInput
              value={form.color}
              onChange={(value) =>
                onChange((prev) => ({ ...prev, color: value }))
              }
              placeholder="#4f8cff or blue"
            />
          </Field>
          <Field label={t("Description")}>
            <Input
              value={form.description}
              disabled={!canEdit}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
            />
          </Field>
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {canEdit && (
          <div className="flex items-center justify-end gap-2">
            {canDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onDelete}
                disabled={deleting}
              >
                <Trash2 className="size-3.5" />
                {deleting ? t("Deleting...") : t("Delete VLAN")}
              </Button>
            )}
            <Button size="sm" onClick={onSave} disabled={saving}>
              <Save className="size-3.5" />
              {saving ? t("Saving...") : t("Save VLAN")}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function VlanPlanningSummary({
  ranges,
  vlans,
  canEdit,
  onShow,
  onNew,
}: {
  ranges: VlanRange[];
  vlans: Vlan[];
  canEdit: boolean;
  onShow: () => void;
  onNew: () => void;
}) {
  const { t } = useI18n();
  const totalReserved = ranges.reduce(
    (sum, range) => sum + (range.endVlan - range.startVlan + 1),
    0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("Advanced planning")}</CardLabel>
          <CardHeading>{t("VLAN planning ranges")}</CardHeading>
        </CardTitle>
        <div className="flex items-center gap-2">
          <Mono className="text-[11px] text-[var(--color-fg-subtle)]">
            {ranges.length} {t("VLAN ranges")} |{" "}
            {totalReserved > 0 ? (
              <>
                {vlans.length} / {totalReserved} {t("used")}
              </>
            ) : (
              t("{count} VLANs", { count: vlans.length })
            )}
          </Mono>
          <Button variant="outline" size="sm" onClick={onShow}>
            <ChevronDown className="size-3.5" />
            {t("Show ranges")}
          </Button>
          {canEdit && (
            <Button size="sm" onClick={onNew}>
              <Plus className="size-3.5" />
              {t("Add VLAN range")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody>
        <p className="max-w-3xl text-xs text-[var(--color-fg-subtle)]">
          {t(
            "Optional labels for blocks of VLAN IDs. They help allocate tags, but they do not create networks, subnets, or IP ranges.",
          )}
        </p>
      </CardBody>
    </Card>
  );
}

function VlanRangesPanel({
  ranges,
  vlans,
  selectedRangeId,
  selectedRange,
  creating,
  form,
  error,
  saving,
  deleting,
  canEdit,
  onSelectRange,
  onNew,
  onChange,
  onCancel,
  onSave,
  onDelete,
  onCollapse,
}: {
  ranges: VlanRange[];
  vlans: Vlan[];
  selectedRangeId?: string;
  selectedRange?: VlanRange;
  creating: boolean;
  form: RangeForm;
  error: string;
  saving: boolean;
  deleting: boolean;
  canEdit: boolean;
  onSelectRange: (id: string) => void;
  onNew: () => void;
  onChange: React.Dispatch<React.SetStateAction<RangeForm>>;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  onCollapse: () => void;
}) {
  const { t } = useI18n();
  const totalReserved = ranges.reduce(
    (sum, range) => sum + (range.endVlan - range.startVlan + 1),
    0,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("Advanced planning")}</CardLabel>
          <CardHeading>{t("VLAN planning ranges")}</CardHeading>
        </CardTitle>
        <div className="flex items-center gap-2">
          <Mono className="text-[11px] text-[var(--color-fg-subtle)]">
            {totalReserved > 0 ? (
              <>
                {vlans.length} / {totalReserved} {t("used")}
              </>
            ) : (
              t("{count} VLANs", { count: vlans.length })
            )}
          </Mono>
          <Button variant="ghost" size="sm" onClick={onCollapse}>
            <ChevronUp className="size-3.5" />
            {t("Hide ranges")}
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={onNew}>
              <Plus className="size-3.5" />
              {t("Add VLAN range")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="max-w-3xl text-xs text-[var(--color-fg-subtle)]">
          {t(
            "Optional labels for blocks of VLAN IDs. They help allocate tags, but they do not create networks, subnets, or IP ranges.",
          )}
        </p>
        {ranges.length > 0 ? (
          <>
            <VlanRangeBar
              ranges={ranges}
              vlans={vlans}
              selectedRangeId={selectedRangeId}
              onSelectRange={onSelectRange}
            />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ranges.map((range) => {
                const used = vlans.filter(
                  (vlan) =>
                    vlan.vlanId >= range.startVlan &&
                    vlan.vlanId <= range.endVlan,
                ).length;
                const active = range.id === selectedRangeId && !creating;
                return (
                  <button
                    key={range.id}
                    type="button"
                    onClick={() => onSelectRange(range.id)}
                    className={`rounded-[var(--radius-sm)] border p-3 text-left transition-colors ${
                      active
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                        : "border-[var(--color-line)] bg-[var(--color-bg)] hover:border-[var(--color-line-strong)]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-[1px]"
                        style={{ backgroundColor: range.color }}
                      />
                      <span className="text-sm font-medium text-[var(--color-fg)]">
                        {range.name}
                      </span>
                    </div>
                    <Mono className="mt-1 block text-[11px] text-[var(--color-fg-muted)]">
                      {range.startVlan}-{range.endVlan} | {used} {t("used")}
                    </Mono>
                    {range.purpose && (
                      <div className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
                        {range.purpose}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyState
            title={t("No VLAN planning ranges")}
            description={t(
              "Create ranges only when you want Rackpad to suggest or group VLAN IDs.",
            )}
          />
        )}

        {canEdit && (creating || selectedRange) && (
          <div className="space-y-4 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("Name")}>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    onChange((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="Servers"
                />
              </Field>
              <Field label={t("Color")}>
                <ColorInput
                  value={form.color}
                  onChange={(value) =>
                    onChange((prev) => ({ ...prev, color: value }))
                  }
                  placeholder="#4f8cff or blue"
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("Start VLAN")}>
                <Input
                  type="number"
                  min={1}
                  max={4094}
                  value={form.startVlan}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      startVlan: event.target.value,
                    }))
                  }
                  placeholder="100"
                />
              </Field>
              <Field label={t("End VLAN")}>
                <Input
                  type="number"
                  min={1}
                  max={4094}
                  value={form.endVlan}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      endVlan: event.target.value,
                    }))
                  }
                  placeholder="149"
                />
              </Field>
            </div>
            <Field label={t("Purpose")}>
              <Input
                value={form.purpose}
                onChange={(event) =>
                  onChange((prev) => ({
                    ...prev,
                    purpose: event.target.value,
                  }))
                }
                placeholder="Server LANs, storage, management"
              />
            </Field>
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <div className="flex items-center justify-between gap-3">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                {t("Cancel")}
              </Button>
              <div className="flex items-center gap-2">
                {!creating && selectedRange && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onDelete}
                    disabled={deleting}
                  >
                    <Trash2 className="size-3.5" />
                    {deleting ? t("Deleting...") : t("Delete range")}
                  </Button>
                )}
                <Button size="sm" onClick={onSave} disabled={saving}>
                  <Save className="size-3.5" />
                  {saving
                    ? t("Saving...")
                    : creating
                      ? t("Create range")
                      : t("Save range")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function AssignmentsSection({
  grouped,
  deviceById,
  releasingId,
  canEdit,
  onUnassign,
}: {
  grouped: Record<string, IpAssignment[]>;
  deviceById: Record<string, Device>;
  releasingId: string | null;
  canEdit: boolean;
  onUnassign: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {VISIBLE_ASSIGNMENT_TYPES.map((type) => {
        const items = grouped[type];
        if (!items || items.length === 0) return null;

        return (
          <Card key={type}>
            <CardHeader>
              <CardTitle>
                <CardLabel>{t(ASSIGNMENT_HEADING_KEYS[type])}</CardLabel>
                <CardHeading>
                  {t("{count} assigned", { count: items.length })}
                </CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <div className="divide-y divide-[var(--color-line)]">
                {[...items]
                  .sort((a, b) =>
                    a.ipAddress.localeCompare(b.ipAddress, undefined, {
                      numeric: true,
                    }),
                  )
                  .map((assignment) => {
                    const device = assignment.deviceId
                      ? deviceById[assignment.deviceId]
                      : undefined;
                    return (
                      <div
                        key={assignment.id}
                        className="grid grid-cols-12 items-center gap-3 px-4 py-2 transition-colors hover:bg-[var(--color-surface)]/40"
                      >
                        <div className="col-span-3">
                          {device ? (
                            <Link
                              to={`/devices/${device.id}`}
                              className="font-mono text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                            >
                              {assignment.ipAddress}
                            </Link>
                          ) : (
                            <Mono className="block text-[var(--color-fg)]">
                              {assignment.ipAddress}
                            </Mono>
                          )}
                          {device && formatDeviceMac(device) && (
                            <Mono className="block text-[10px] text-[var(--color-fg-muted)]">
                              {formatDeviceMac(device)}
                            </Mono>
                          )}
                        </div>
                        <div className="col-span-2 text-xs">
                          {device ? (
                            <Link
                              to={`/devices/${device.id}`}
                              className="hover:text-[var(--color-accent)]"
                            >
                              {assignment.hostname ?? device.hostname}
                            </Link>
                          ) : (
                            (assignment.hostname ?? "-")
                          )}
                        </div>
                        <div className="col-span-4 text-[11px] text-[var(--color-fg-subtle)]">
                          {device
                            ? `${device.hostname} (${device.deviceType})`
                            : (assignment.description ?? "-")}
                        </div>
                        <div className="col-span-3 flex items-center justify-end gap-2">
                          <Badge tone={badgeTone(type)}>
                            {t(ASSIGNMENT_BADGE_KEYS[type])}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={releasingId === assignment.id || !canEdit}
                            onClick={() => onUnassign(assignment.id)}
                          >
                            {releasingId === assignment.id
                              ? t("Releasing...")
                              : t("Unassign")}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CardBody>
          </Card>
        );
      })}
    </>
  );
}

function SubnetEditor({
  creating,
  form,
  vlans,
  error,
  saving,
  deleting,
  canDelete,
  onChange,
  onSave,
  onDelete,
  onNew,
}: {
  creating: boolean;
  form: SubnetForm;
  vlans: Vlan[];
  error: string;
  saving: boolean;
  deleting: boolean;
  canDelete: boolean;
  onChange: React.Dispatch<React.SetStateAction<SubnetForm>>;
  onSave: () => void;
  onDelete: () => void;
  onNew: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>
            {creating ? t("New subnet") : t("Subnet editor")}
          </CardLabel>
          <CardHeading>
            {creating ? t("Create subnet") : t("Update subnet details")}
          </CardHeading>
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onNew}>
            <Plus className="size-3.5" />
            {t("New subnet")}
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("CIDR")}>
            <Input
              value={form.cidr}
              onChange={(event) =>
                onChange((prev) => ({ ...prev, cidr: event.target.value }))
              }
              placeholder="10.0.10.0/24"
            />
          </Field>
          <Field label={t("Name")}>
            <Input
              value={form.name}
              onChange={(event) =>
                onChange((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Servers management"
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("Gateway")}>
            <Input
              value={form.gateway}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  gateway: event.target.value,
                }))
              }
              placeholder="10.0.10.1"
            />
          </Field>
          <Field label={t("DNS servers")}>
            <Input
              value={form.dnsServers}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  dnsServers: event.target.value,
                }))
              }
              placeholder="1.1.1.1, 8.8.8.8"
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("Linked VLAN")}>
            <Select
              value={form.vlanId}
              onChange={(value) =>
                onChange((prev) => ({ ...prev, vlanId: value }))
              }
            >
              <option value="">{t("Unassigned")}</option>
              {vlans.map((vlan) => (
                <option key={vlan.id} value={vlan.id}>
                  {vlan.vlanId} - {vlan.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Description")}>
            <Input
              value={form.description}
              onChange={(event) =>
                onChange((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              placeholder="Primary management network"
            />
          </Field>
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <div className="flex items-center justify-end gap-2">
          {canDelete && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={deleting}
            >
              <Trash2 className="size-3.5" />
              {deleting ? t("Deleting...") : t("Delete subnet")}
            </Button>
          )}
          <Button size="sm" onClick={onSave} disabled={saving}>
            <Save className="size-3.5" />
            {saving
              ? t("Saving...")
              : creating
                ? t("Create subnet")
                : t("Save subnet")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function ScopeEditor({
  subnet,
  scopes,
  selectedScopeId,
  setSelectedScopeId,
  creating,
  setCreating,
  form,
  onChange,
  error,
  saving,
  deleting,
  canEdit,
  onSave,
  onDelete,
}: {
  subnet: Subnet;
  scopes: DhcpScope[];
  selectedScopeId: string | null;
  setSelectedScopeId: (value: string | null) => void;
  creating: boolean;
  setCreating: (value: boolean) => void;
  form: ScopeForm;
  onChange: React.Dispatch<React.SetStateAction<ScopeForm>>;
  error: string;
  saving: boolean;
  deleting: boolean;
  canEdit: boolean;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("DHCP")}</CardLabel>
          <CardHeading>{t("Scopes")}</CardHeading>
        </CardTitle>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCreating(true);
              setSelectedScopeId(null);
            }}
          >
            <Plus className="size-3.5" />
            {t("Add scope")}
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        {scopes.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {scopes.map((scope) => (
              <button
                key={scope.id}
                type="button"
                onClick={() => {
                  setCreating(false);
                  setSelectedScopeId(scope.id);
                }}
                className={`rounded-[var(--radius-xs)] border px-2.5 py-1 text-xs transition-colors ${
                  !creating && selectedScopeId === scope.id
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                    : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
                }`}
              >
                <span className="font-mono">{scope.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title={t("No DHCP scopes documented")}
            description={t(
              "Add one or more DHCP pools for {cidr} if this subnet hands out leases dynamically.",
              { cidr: subnet.cidr },
            )}
          />
        )}

        {(creating || selectedScopeId) && canEdit && (
          <div className="space-y-4 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("Scope name")}>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    onChange((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder="Clients"
                />
              </Field>
              <Field label={t("Gateway")}>
                <Input
                  value={form.gateway}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      gateway: event.target.value,
                    }))
                  }
                  placeholder="10.0.10.1"
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("Start IP")}>
                <Input
                  value={form.startIp}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      startIp: event.target.value,
                    }))
                  }
                  placeholder="10.0.10.100"
                />
              </Field>
              <Field label={t("End IP")}>
                <Input
                  value={form.endIp}
                  onChange={(event) =>
                    onChange((prev) => ({ ...prev, endIp: event.target.value }))
                  }
                  placeholder="10.0.10.199"
                />
              </Field>
            </div>
            <Field label={t("DNS servers")}>
              <Input
                value={form.dnsServers}
                onChange={(event) =>
                  onChange((prev) => ({
                    ...prev,
                    dnsServers: event.target.value,
                  }))
                }
                placeholder="1.1.1.1, 8.8.8.8"
              />
            </Field>
            <Field label={t("Description")}>
              <Input
                value={form.description}
                onChange={(event) =>
                  onChange((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="General client pool"
              />
            </Field>
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <div className="flex items-center justify-end gap-2">
              {!creating && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  disabled={deleting}
                >
                  <Trash2 className="size-3.5" />
                  {deleting ? t("Deleting...") : t("Delete scope")}
                </Button>
              )}
              <Button size="sm" onClick={onSave} disabled={saving}>
                <Save className="size-3.5" />
                {saving
                  ? t("Saving...")
                  : creating
                    ? t("Create scope")
                    : t("Save scope")}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ZoneEditor({
  zones,
  selectedZoneId,
  setSelectedZoneId,
  creating,
  setCreating,
  form,
  onChange,
  error,
  saving,
  deleting,
  canEdit,
  onSave,
  onDelete,
}: {
  zones: IpZone[];
  selectedZoneId: string | null;
  setSelectedZoneId: (value: string | null) => void;
  creating: boolean;
  setCreating: (value: boolean) => void;
  form: ZoneForm;
  onChange: React.Dispatch<React.SetStateAction<ZoneForm>>;
  error: string;
  saving: boolean;
  deleting: boolean;
  canEdit: boolean;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("IP zones")}</CardLabel>
          <CardHeading>{t("Static, DHCP, reserved")}</CardHeading>
        </CardTitle>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCreating(true);
              setSelectedZoneId(null);
            }}
          >
            <Plus className="size-3.5" />
            {t("Add zone")}
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        {zones.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                onClick={() => {
                  setCreating(false);
                  setSelectedZoneId(zone.id);
                }}
                className={`rounded-[var(--radius-xs)] border px-2.5 py-1 text-xs transition-colors ${
                  !creating && selectedZoneId === zone.id
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                    : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
                }`}
              >
                <span className="font-mono">{t(ZONE_KIND_KEYS[zone.kind])}</span>
                <span className="mx-1 text-[var(--color-fg-faint)]">|</span>
                <span>
                  {zone.startIp}-{zone.endIp}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title={t("No IP zones documented yet")}
            description={t(
              "Define static, DHCP, or reserved zones to make address ownership easier to scan.",
            )}
          />
        )}

        {(creating || selectedZoneId) && canEdit && (
          <div className="space-y-4 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bg)] p-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t("Kind")}>
                <Select
                  value={form.kind}
                  onChange={(value) =>
                    onChange((prev) => ({
                      ...prev,
                      kind: value as ZoneForm["kind"],
                    }))
                  }
                >
                  {USER_ZONE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(ZONE_KIND_KEYS[kind])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("Start IP")}>
                <Input
                  value={form.startIp}
                  onChange={(event) =>
                    onChange((prev) => ({
                      ...prev,
                      startIp: event.target.value,
                    }))
                  }
                  placeholder="10.0.10.10"
                />
              </Field>
              <Field label={t("End IP")}>
                <Input
                  value={form.endIp}
                  onChange={(event) =>
                    onChange((prev) => ({ ...prev, endIp: event.target.value }))
                  }
                  placeholder="10.0.10.99"
                />
              </Field>
            </div>
            <Field label={t("Description")}>
              <Input
                value={form.description}
                onChange={(event) =>
                  onChange((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                placeholder="Static addresses"
              />
            </Field>
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <div className="flex items-center justify-end gap-2">
              {!creating && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  disabled={deleting}
                >
                  <Trash2 className="size-3.5" />
                  {deleting ? t("Deleting...") : t("Delete zone")}
                </Button>
              )}
              <Button size="sm" onClick={onSave} disabled={saving}>
                <Save className="size-3.5" />
                {saving
                  ? t("Saving...")
                  : creating
                    ? t("Create zone")
                    : t("Save zone")}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
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
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rk-control h-8 w-full px-2 text-sm text-[var(--text-primary)]"
    >
      {children}
    </select>
  );
}

function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
      {children}
    </div>
  );
}

function compareNetworkRows(a: NetworkRow, b: NetworkRow) {
  const aVlan =
    a.kind === "subnet" ? (a.vlan?.vlanId ?? Number.MAX_SAFE_INTEGER) : a.vlan.vlanId;
  const bVlan =
    b.kind === "subnet" ? (b.vlan?.vlanId ?? Number.MAX_SAFE_INTEGER) : b.vlan.vlanId;
  if (aVlan !== bVlan) return aVlan - bVlan;

  const aLabel = a.kind === "subnet" ? a.subnet.cidr : a.vlan.name;
  const bLabel = b.kind === "subnet" ? b.subnet.cidr : b.vlan.name;
  return aLabel.localeCompare(bLabel, undefined, { numeric: true });
}

function networkSearchText(network: NetworkRow) {
  const subnet = network.kind === "subnet" ? network.subnet : undefined;
  const vlan = network.kind === "subnet" ? network.vlan : network.vlan;
  return [
    network.kind,
    subnet?.cidr,
    subnet?.name,
    subnet?.description,
    subnet?.gateway,
    ...(subnet?.dnsServers ?? []),
    vlan?.vlanId,
    vlan?.name,
    vlan?.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isUserVisibleZone(zone: IpZone) {
  return USER_ZONE_KIND_SET.has(zone.kind);
}

function countUserVisibleZones(zones: IpZone[]) {
  return zones.filter(isUserVisibleZone).length;
}

function badgeTone(type: IpAssignment["assignmentType"]) {
  switch (type) {
    case "device":
      return "cyan" as const;
    case "vm":
      return "accent" as const;
    case "container":
      return "info" as const;
    case "reserved":
      return "warn" as const;
    case "infrastructure":
      return "neutral" as const;
    default:
      return "neutral" as const;
  }
}

function parseDnsServers(value: string) {
  const normalized = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}
