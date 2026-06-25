import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Network } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/shared/EmptyState";
import { useI18n } from "@/i18n";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Mono } from "@/components/shared/Mono";
import { SortableHeader } from "@/components/shared/SortableHeader";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { VlanRangeBar } from "@/components/vlan/VlanRangeBar";
import { IpZoneBar } from "@/components/vlan/IpZoneBar";
import { AllocatePanel } from "@/components/shared/AllocatePanel";
import { ColorInput } from "@/components/shared/ColorInput";
import {
  canEditInventory,
  createNetworkRecord,
  createSubnetRecord,
  createVlanRangeRecord,
  deleteVlan,
  deleteVlanRangeRecord,
  updateVlanRangeRecord,
  useStore,
} from "@/lib/store";
import { ChevronRight, Filter, Hash, Plus, Save, Trash2 } from "lucide-react";
import {
  applySortDirection,
  compareNumber,
  compareText,
  toggleSort,
  type SortState,
} from "@/lib/sort";
import type {
  IpAssignment,
  IpZoneKind,
  Subnet,
  Vlan,
  VlanRange,
} from "@/lib/types";

type RangeForm = {
  name: string;
  startVlan: string;
  endVlan: string;
  purpose: string;
  color: string;
};

type SubnetForm = {
  cidr: string;
  name: string;
  description: string;
  gateway: string;
  dnsServers: string;
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
  infrastructureStartIp: string;
  infrastructureEndIp: string;
};

type RangeSortKey = "name" | "ids" | "used" | "free" | "purpose";
type VlanSortKey = "vlanId" | "name" | "subnets";

const EMPTY_RANGE_FORM: RangeForm = {
  name: "",
  startVlan: "",
  endVlan: "",
  purpose: "",
  color: "",
};

const EMPTY_SUBNET_FORM: SubnetForm = {
  cidr: "",
  name: "",
  description: "",
  gateway: "",
  dnsServers: "",
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
  infrastructureStartIp: "",
  infrastructureEndIp: "",
};

export default function VlansView() {
  const { t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const activeLab = useStore((s) => s.lab);
  const ranges = useStore((s) => s.vlanRanges);
  const vlans = useStore((s) => s.vlans);
  const subnets = useStore((s) => s.subnets);
  const zones = useStore((s) => s.ipZones);
  const scopes = useStore((s) => s.scopes);
  const ipAssignments = useStore((s) => s.ipAssignments);
  const canEdit = canEditInventory(currentUser);

  const [selectedRangeId, setSelectedRangeId] = useState<string | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creatingNetwork, setCreatingNetwork] = useState(false);
  const [networkForm, setNetworkForm] =
    useState<NetworkForm>(EMPTY_NETWORK_FORM);
  const [networkSaving, setNetworkSaving] = useState(false);
  const [networkError, setNetworkError] = useState("");
  const [creatingRange, setCreatingRange] = useState(false);
  const [rangeForm, setRangeForm] = useState<RangeForm>(EMPTY_RANGE_FORM);
  const [rangeSaving, setRangeSaving] = useState(false);
  const [rangeDeleting, setRangeDeleting] = useState(false);
  const [rangeError, setRangeError] = useState("");
  const [subnetDraftVlanId, setSubnetDraftVlanId] = useState<string | null>(
    null,
  );
  const [subnetForm, setSubnetForm] = useState<SubnetForm>(EMPTY_SUBNET_FORM);
  const [subnetSaving, setSubnetSaving] = useState(false);
  const [subnetError, setSubnetError] = useState("");
  const [query, setQuery] = useState("");
  const [rangeSort, setRangeSort] = useState<SortState<RangeSortKey>>({
    key: "name",
    direction: "asc",
  });
  const [vlanSort, setVlanSort] = useState<SortState<VlanSortKey>>({
    key: "vlanId",
    direction: "asc",
  });

  useEffect(() => {
    if (!ranges.length) return;
    if (
      !selectedRangeId ||
      !ranges.some((range) => range.id === selectedRangeId)
    ) {
      setSelectedRangeId(ranges[0].id);
    }
  }, [ranges, selectedRangeId]);

  const selectedRange = selectedRangeId
    ? ranges.find((range) => range.id === selectedRangeId)
    : undefined;

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

  const totalUsed = vlans.length;
  const totalReserved = ranges.reduce(
    (sum, range) => sum + (range.endVlan - range.startVlan + 1),
    0,
  );

  const normalizedQuery = query.trim().toLowerCase();

  const filteredRanges = useMemo(() => {
    return ranges
      .filter((range) => {
        if (!normalizedQuery) return true;
        return [
          range.name,
          range.purpose,
          `${range.startVlan}-${range.endVlan}`,
          range.color,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => compareRanges(a, b, rangeSort, vlans));
  }, [normalizedQuery, rangeSort, ranges, vlans]);

  const filteredVlans = useMemo(() => {
    let next = vlans;
    if (!selectedRangeId) {
      next = vlans;
    } else {
      const range = ranges.find((entry) => entry.id === selectedRangeId);
      if (range) {
        next = vlans.filter(
          (vlan) =>
            vlan.vlanId >= range.startVlan && vlan.vlanId <= range.endVlan,
        );
      }
    }

    return next
      .filter((vlan) => {
        if (!normalizedQuery) return true;
        const linkedSubnets = subnets.filter((entry) => entry.vlanId === vlan.id);
        const haystack = [
          vlan.vlanId,
          vlan.name,
          vlan.description,
          vlan.color,
          ...linkedSubnets.flatMap((subnet) => [
            subnet.cidr,
            subnet.name,
            subnet.description,
          ]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((a, b) => compareVlans(a, b, vlanSort, subnets));
  }, [normalizedQuery, ranges, selectedRangeId, subnets, vlanSort, vlans]);

  const untaggedSubnets = useMemo(() => {
    return subnets
      .filter((subnet) => !subnet.vlanId)
      .filter((subnet) => {
        if (!normalizedQuery) return true;
        return [
          subnet.cidr,
          subnet.name,
          subnet.description,
          subnet.gateway,
          ...(subnet.dnsServers ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) =>
        a.cidr.localeCompare(b.cidr, undefined, { numeric: true }),
      );
  }, [normalizedQuery, subnets]);

  const assignmentsBySubnetId = useMemo(() => {
    return ipAssignments.reduce<Record<string, IpAssignment[]>>(
      (acc, assignment) => {
        (acc[assignment.subnetId] ??= []).push(assignment);
        return acc;
      },
      {},
    );
  }, [ipAssignments]);

  async function handleDeleteVlan(id: string, name: string, vlanId: number) {
    if (
      !window.confirm(
        `Delete VLAN ${vlanId} (${name})? Any linked subnet will become unassigned.`,
      )
    ) {
      return;
    }

    setDeletingId(id);
    try {
      await deleteVlan(id);
    } finally {
      setDeletingId(null);
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
        err instanceof Error ? err.message : "Failed to save VLAN range.",
      );
    } finally {
      setRangeSaving(false);
    }
  }

  async function handleDeleteRange() {
    if (!selectedRange) return;
    if (!window.confirm(`Delete VLAN range ${selectedRange.name}?`)) return;

    setRangeDeleting(true);
    setRangeError("");
    try {
      await deleteVlanRangeRecord(selectedRange.id);
      setSelectedRangeId(undefined);
      setCreatingRange(false);
    } catch (err) {
      setRangeError(
        err instanceof Error ? err.message : "Failed to delete VLAN range.",
      );
    } finally {
      setRangeDeleting(false);
    }
  }

  async function handleCreateSubnet(vlanId: string) {
    setSubnetSaving(true);
    setSubnetError("");
    try {
      await createSubnetRecord({
        labId: activeLab.id,
        cidr: subnetForm.cidr.trim(),
        name: subnetForm.name.trim(),
        description: subnetForm.description.trim() || undefined,
        gateway: subnetForm.gateway.trim() || undefined,
        dnsServers: parseDnsServers(subnetForm.dnsServers),
        vlanId,
      });
      setSubnetDraftVlanId(null);
      setSubnetForm(EMPTY_SUBNET_FORM);
    } catch (err) {
      setSubnetError(
        err instanceof Error
          ? err.message
          : "Failed to create linked IP range.",
      );
    } finally {
      setSubnetSaving(false);
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

      let vlan:
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
        vlan = {
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
      if (
        networkForm.enableDhcp &&
        dhcpStartIp &&
        dhcpEndIp
      ) {
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
        {
          kind: "infrastructure" as const,
          startIp: networkForm.infrastructureStartIp.trim(),
          endIp: networkForm.infrastructureEndIp.trim(),
          description: "Infrastructure addresses",
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

      await createNetworkRecord({
        labId: activeLab.id,
        vlan,
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

  function handleRangeSort(key: RangeSortKey) {
    setRangeSort((current) => toggleSort(current, key));
  }

  function handleVlanSort(key: VlanSortKey) {
    setVlanSort((current) => toggleSort(current, key));
  }

  return (
    <>
      <TopBar
        subtitle={t("Network")}
        title={t("VLANs")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {vlans.length} VLANs | {ranges.length} ranges | {totalReserved} IDs
            reserved
          </span>
        }
        actions={
          canEdit ? (
            <>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCreatingRange(true);
                  setRangeForm(EMPTY_RANGE_FORM);
                }}
              >
                <Plus className="size-3.5" />
                Add VLAN range
              </Button>
              <AllocatePanel
                defaultTab="vlan"
                defaultRangeId={selectedRangeId}
              />
            </>
          ) : undefined
        }
      />

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {canEdit && creatingNetwork && (
          <Card>
            <CardHeader>
              <CardTitle>
                <CardLabel>{t("Network setup")}</CardLabel>
                <CardHeading>
                  {t("Add VLAN, subnet, DHCP, and zones")}
                </CardHeading>
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
                          onClick={() =>
                            setNetworkForm((prev) => ({ ...prev, mode }))
                          }
                          className={`rounded-[var(--radius-xs)] border px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                            networkForm.mode === mode
                              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                              : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
                          }`}
                        >
                          {mode === "tagged"
                            ? t("VLAN tagged")
                            : t("No VLAN tag")}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {networkForm.mode === "tagged" && (
                      <Field label={t("VLAN ID")}>
                        <Input
                          type="number"
                          min={1}
                          max={4094}
                          value={networkForm.vlanId}
                          onChange={(event) =>
                            setNetworkForm((prev) => ({
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
                        value={networkForm.name}
                        onChange={(event) =>
                          setNetworkForm((prev) => ({
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
                      networkForm.mode === "tagged" ? "md:grid-cols-2" : ""
                    }`}
                  >
                    {networkForm.mode === "tagged" && (
                      <Field label={t("Color")}>
                        <ColorInput
                          value={networkForm.color}
                          onChange={(value) =>
                            setNetworkForm((prev) => ({
                              ...prev,
                              color: value,
                            }))
                          }
                          placeholder="#4f8cff or blue"
                        />
                      </Field>
                    )}
                    <Field label={t("Description")}>
                      <Input
                        value={networkForm.description}
                        onChange={(event) =>
                          setNetworkForm((prev) => ({
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
                        value={networkForm.cidr}
                        onChange={(event) =>
                          setNetworkForm((prev) => ({
                            ...prev,
                            cidr: event.target.value,
                          }))
                        }
                        placeholder="10.0.10.0/24"
                      />
                    </Field>
                    <Field label={t("Subnet name")}>
                      <Input
                        value={networkForm.subnetName}
                        onChange={(event) =>
                          setNetworkForm((prev) => ({
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
                        value={networkForm.gateway}
                        onChange={(event) =>
                          setNetworkForm((prev) => ({
                            ...prev,
                            gateway: event.target.value,
                          }))
                        }
                        placeholder="10.0.10.1"
                      />
                    </Field>
                    <Field label={t("DNS servers")}>
                      <Input
                        value={networkForm.dnsServers}
                        onChange={(event) =>
                          setNetworkForm((prev) => ({
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
                      value={networkForm.subnetDescription}
                      onChange={(event) =>
                        setNetworkForm((prev) => ({
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
                        checked={networkForm.enableDhcp}
                        onChange={(event) =>
                          setNetworkForm((prev) => ({
                            ...prev,
                            enableDhcp: event.target.checked,
                          }))
                        }
                      />
                      {t("Enabled")}
                    </label>
                  </div>
                  {networkForm.enableDhcp && (
                    <>
                      <div className="grid gap-4 md:grid-cols-3">
                        <Field label={t("Scope name")}>
                          <Input
                            value={networkForm.dhcpName}
                            onChange={(event) =>
                              setNetworkForm((prev) => ({
                                ...prev,
                                dhcpName: event.target.value,
                              }))
                            }
                            placeholder="clients"
                          />
                        </Field>
                        <Field label={t("Start IP")}>
                          <Input
                            value={networkForm.dhcpStartIp}
                            onChange={(event) =>
                              setNetworkForm((prev) => ({
                                ...prev,
                                dhcpStartIp: event.target.value,
                              }))
                            }
                            placeholder="10.0.10.100"
                          />
                        </Field>
                        <Field label={t("End IP")}>
                          <Input
                            value={networkForm.dhcpEndIp}
                            onChange={(event) =>
                              setNetworkForm((prev) => ({
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
                          value={networkForm.dhcpDescription}
                          onChange={(event) =>
                            setNetworkForm((prev) => ({
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
                      {t(
                        "Optional ranges for static, reserved, and infrastructure addresses.",
                      )}
                    </div>
                  </div>
                  {(
                    [
                      ["Static", "staticStartIp", "staticEndIp"],
                      ["Reserved", "reservedStartIp", "reservedEndIp"],
                      [
                        "Infrastructure",
                        "infrastructureStartIp",
                        "infrastructureEndIp",
                      ],
                    ] as const
                  ).map(([label, startKey, endKey]) => (
                    <div key={label} className="grid gap-3 md:grid-cols-3">
                      <div className="pt-6 text-xs font-medium text-[var(--color-fg-muted)]">
                        {t(label)}
                      </div>
                      <Field label={t("Start IP")}>
                        <Input
                          value={
                            networkForm[startKey as keyof NetworkForm] as string
                          }
                          onChange={(event) =>
                            setNetworkForm((prev) => ({
                              ...prev,
                              [startKey]: event.target.value,
                            }))
                          }
                          placeholder="10.0.10.10"
                        />
                      </Field>
                      <Field label={t("End IP")}>
                        <Input
                          value={
                            networkForm[endKey as keyof NetworkForm] as string
                          }
                          onChange={(event) =>
                            setNetworkForm((prev) => ({
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

              {networkError && (
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                  {networkError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCreatingNetwork(false);
                    setNetworkForm(EMPTY_NETWORK_FORM);
                  setNetworkError("");
                }}
              >
                  {t("Cancel")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleCreateNetwork()}
                  disabled={networkSaving}
                >
                  <Save className="size-3.5" />
                  {networkSaving ? t("Creating...") : t("Create network")}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              <CardLabel>VLAN ID ranges</CardLabel>
              <CardHeading>Reserved VLAN ID space | 1-4094</CardHeading>
            </CardTitle>
            <Mono className="text-[11px] text-[var(--color-fg-subtle)]">
              {totalUsed} / {totalReserved} used in reserved ranges
            </Mono>
          </CardHeader>
          <CardBody>
            <VlanRangeBar
              ranges={ranges}
              vlans={vlans}
              selectedRangeId={selectedRangeId}
              onSelectRange={(id) => {
                setSelectedRangeId(id === selectedRangeId ? undefined : id);
                setCreatingRange(false);
              }}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <CardLabel>Documented VLAN ID ranges</CardLabel>
              <CardHeading>{filteredRanges.length} ranges</CardHeading>
            </CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <table className="rk-table">
              <thead>
                <tr>
                  <SortableHeader
                    sortKey="name"
                    sort={rangeSort}
                    onSort={handleRangeSort}
                  >
                    Range
                  </SortableHeader>
                  <SortableHeader
                    sortKey="ids"
                    sort={rangeSort}
                    onSort={handleRangeSort}
                  >
                    IDs
                  </SortableHeader>
                  <SortableHeader
                    sortKey="used"
                    sort={rangeSort}
                    onSort={handleRangeSort}
                  >
                    Used
                  </SortableHeader>
                  <SortableHeader
                    sortKey="free"
                    sort={rangeSort}
                    onSort={handleRangeSort}
                  >
                    Free
                  </SortableHeader>
                  <SortableHeader
                    sortKey="purpose"
                    sort={rangeSort}
                    onSort={handleRangeSort}
                  >
                    Purpose
                  </SortableHeader>
                </tr>
              </thead>
              <tbody>
                {filteredRanges.map((range) => {
                  const used = vlans.filter(
                    (vlan) =>
                      vlan.vlanId >= range.startVlan &&
                      vlan.vlanId <= range.endVlan,
                  ).length;
                  const total = range.endVlan - range.startVlan + 1;
                  const free = total - used;
                  const isActive =
                    range.id === selectedRangeId && !creatingRange;
                  return (
                    <tr
                      key={range.id}
                      onClick={() => {
                        setSelectedRangeId(isActive ? undefined : range.id);
                        setCreatingRange(false);
                      }}
                      data-selected={isActive}
                      className="cursor-pointer"
                    >
                      <Td>
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2 rounded-[1px]"
                            style={{ backgroundColor: range.color }}
                          />
                          <span className="font-medium text-[var(--color-fg)]">
                            {range.name}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        <Mono className="text-[var(--color-fg-muted)]">
                          {range.startVlan}-{range.endVlan}
                        </Mono>
                      </Td>
                      <Td>
                        <Mono className="text-[var(--color-fg)]">{used}</Mono>
                      </Td>
                      <Td>
                        <Mono className="text-[var(--color-fg-subtle)]">
                          {free}
                        </Mono>
                      </Td>
                      <Td>
                        <span className="text-[11px] text-[var(--color-fg-subtle)]">
                          {range.purpose ?? "-"}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>

        {canEdit && (
          <Card>
            <CardHeader>
              <CardTitle>
                <CardLabel>
                  {creatingRange ? "New range" : "Range editor"}
                </CardLabel>
                <CardHeading>
                  {creatingRange
                    ? "Create VLAN ID range"
                    : selectedRange
                      ? `Edit ${selectedRange.name}`
                      : "Select a range"}
                </CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {creatingRange || selectedRange ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Name">
                      <Input
                        value={rangeForm.name}
                        onChange={(event) =>
                          setRangeForm((prev) => ({
                            ...prev,
                            name: event.target.value,
                          }))
                        }
                        placeholder="Servers"
                      />
                    </Field>
                    <Field label="Color">
                      <ColorInput
                        value={rangeForm.color}
                        onChange={(value) =>
                          setRangeForm((prev) => ({ ...prev, color: value }))
                        }
                        placeholder="#4f8cff or blue"
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Start VLAN">
                      <Input
                        type="number"
                        min={1}
                        max={4094}
                        value={rangeForm.startVlan}
                        onChange={(event) =>
                          setRangeForm((prev) => ({
                            ...prev,
                            startVlan: event.target.value,
                          }))
                        }
                        placeholder="100"
                      />
                    </Field>
                    <Field label="End VLAN">
                      <Input
                        type="number"
                        min={1}
                        max={4094}
                        value={rangeForm.endVlan}
                        onChange={(event) =>
                          setRangeForm((prev) => ({
                            ...prev,
                            endVlan: event.target.value,
                          }))
                        }
                        placeholder="149"
                      />
                    </Field>
                  </div>
                  <Field label="Purpose">
                    <Input
                      value={rangeForm.purpose}
                      onChange={(event) =>
                        setRangeForm((prev) => ({
                          ...prev,
                          purpose: event.target.value,
                        }))
                      }
                      placeholder="Server LANs, storage, management"
                    />
                  </Field>

                  {rangeError && (
                    <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                      {rangeError}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setCreatingRange(false);
                        setRangeError("");
                      }}
                    >
                      Cancel
                    </Button>
                    <div className="flex items-center gap-2">
                      {!creatingRange && selectedRange && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void handleDeleteRange()}
                          disabled={rangeDeleting}
                        >
                          <Trash2 className="size-3.5" />
                          {rangeDeleting ? "Deleting..." : "Delete range"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => void handleSaveRange()}
                        disabled={rangeSaving}
                      >
                        <Save className="size-3.5" />
                        {rangeSaving
                          ? "Saving..."
                          : creatingRange
                            ? "Create range"
                            : "Save range"}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={Network}
                  title={t("Select a VLAN range")}
                  description={t(
                    "Choose an existing range above or create a new one to manage reserved ID space.",
                  )}
                />
              )}
            </CardBody>
          </Card>
        )}

        {untaggedSubnets.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <CardLabel>{t("No VLAN tag")}</CardLabel>
                <CardHeading>
                  {t("{count} untagged networks", {
                    count: untaggedSubnets.length,
                  })}
                </CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {untaggedSubnets.map((subnet) => {
                const subnetZones = zones.filter(
                  (zone) => zone.subnetId === subnet.id,
                );
                const subnetScopes = scopes.filter(
                  (scope) => scope.subnetId === subnet.id,
                );
                const subnetAssignments = assignmentsBySubnetId[subnet.id] ?? [];
                return (
                  <div
                    key={subnet.id}
                    className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Mono className="text-[11px] text-[var(--color-fg)]">
                        {subnet.cidr}
                      </Mono>
                      <Badge tone="neutral">{subnet.name}</Badge>
                      {subnet.gateway && (
                        <span className="text-[11px] text-[var(--color-fg-subtle)]">
                          {t("gateway {gateway}", {
                            gateway: subnet.gateway,
                          })}
                        </span>
                      )}
                      {(subnet.dnsServers ?? []).length > 0 && (
                        <span className="text-[11px] text-[var(--color-fg-subtle)]">
                          {t("DNS {servers}", {
                            servers: (subnet.dnsServers ?? []).join(", "),
                          })}
                        </span>
                      )}
                      {subnetScopes.length > 0 && (
                        <Badge tone="cyan">
                          {t("{count} DHCP", { count: subnetScopes.length })}
                        </Badge>
                      )}
                      {subnetZones.length > 0 && (
                        <Badge tone="accent">
                          {t("{count} zones", { count: subnetZones.length })}
                        </Badge>
                      )}
                      <span className="text-[11px] text-[var(--color-fg-subtle)]">
                        {t("{count} assigned", {
                          count: subnetAssignments.length,
                        })}
                      </span>
                    </div>
                    {(subnetZones.length > 0 || subnetScopes.length > 0) && (
                      <IpZoneBar
                        subnet={subnet}
                        zones={subnetZones}
                        scopes={subnetScopes}
                        assignments={subnetAssignments}
                      />
                    )}
                    <div className="mt-2">
                      <Link
                        to={`/networks?subnetId=${subnet.id}`}
                        className="inline-flex items-center gap-1 text-[11px] text-[var(--color-accent)] hover:text-[var(--color-accent-strong)]"
                      >
                        {t("Open network")}
                        <ChevronRight className="size-3" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              <CardLabel>
                {selectedRangeId
                  ? `Filtered by ${ranges.find((range) => range.id === selectedRangeId)?.name}`
                  : "All VLANs"}
              </CardLabel>
              <CardHeading>{filteredVlans.length} configured</CardHeading>
            </CardTitle>
            {selectedRangeId && (
              <button
                onClick={() => setSelectedRangeId(undefined)}
                className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
              >
                Clear filter
              </button>
            )}
          </CardHeader>
          <CardBody className="border-b border-[var(--border-subtle)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative min-w-[16rem] max-w-xl flex-1">
                <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-faint)]" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search VLAN, range, CIDR, purpose..."
                  className="pl-8"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rk-kicker">Sort VLANs</span>
                <SortButton
                  active={vlanSort.key === "vlanId"}
                  direction={vlanSort.direction}
                  onClick={() => handleVlanSort("vlanId")}
                >
                  ID
                </SortButton>
                <SortButton
                  active={vlanSort.key === "name"}
                  direction={vlanSort.direction}
                  onClick={() => handleVlanSort("name")}
                >
                  Name
                </SortButton>
                <SortButton
                  active={vlanSort.key === "subnets"}
                  direction={vlanSort.direction}
                  onClick={() => handleVlanSort("subnets")}
                >
                  IP ranges
                </SortButton>
              </div>
            </div>
          </CardBody>
          <CardBody className="p-0">
            <div className="divide-y divide-[var(--color-line)]">
              {filteredVlans
                .map((vlan) => {
                  const linkedSubnets = subnets
                    .filter((entry) => entry.vlanId === vlan.id)
                    .sort((a, b) =>
                      a.cidr.localeCompare(b.cidr, undefined, {
                        numeric: true,
                      }),
                    );
                  const isAddingSubnet = subnetDraftVlanId === vlan.id;
                  return (
                    <div key={vlan.id} className="px-4 py-4">
                      <div className="mb-3 flex items-start gap-4">
                        <div
                          className="grid size-12 shrink-0 place-items-center rounded-[var(--radius-sm)] border"
                          style={{
                            backgroundColor: `${vlan.color}15`,
                            borderColor: `${vlan.color}40`,
                          }}
                        >
                          <Mono
                            className="text-sm font-semibold"
                            style={{ color: vlan.color }}
                          >
                            {vlan.vlanId}
                          </Mono>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-[var(--color-fg)]">
                              {vlan.name}
                            </h3>
                            <Hash className="size-3 text-[var(--color-fg-faint)]" />
                            <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                              VLAN {vlan.vlanId}
                            </Mono>
                          </div>
                          {vlan.description && (
                            <div className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                              {vlan.description}
                            </div>
                          )}
                          {linkedSubnets.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-3">
                              <Mono className="text-[11px] text-[var(--color-fg-muted)]">
                                {linkedSubnets
                                  .map((subnet) => subnet.cidr)
                                  .join(", ")}
                              </Mono>
                              <span className="text-[10px] text-[var(--color-fg-faint)]">
                                |
                              </span>
                              <span className="text-[11px] text-[var(--color-fg-subtle)]">
                                {linkedSubnets.length} linked IP range
                                {linkedSubnets.length === 1 ? "" : "s"}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSubnetDraftVlanId((current) =>
                                  current === vlan.id ? null : vlan.id,
                                );
                                setSubnetForm({
                                  cidr: "",
                                  name:
                                    linkedSubnets.length === 0
                                      ? `${vlan.name} subnet`
                                      : "",
                                  description: "",
                                  gateway: "",
                                  dnsServers: "",
                                });
                                setSubnetError("");
                              }}
                            >
                              <Plus className="size-3.5" />
                              Add IP range
                            </Button>
                          )}
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={deletingId === vlan.id}
                              onClick={() =>
                                void handleDeleteVlan(
                                  vlan.id,
                                  vlan.name,
                                  vlan.vlanId,
                                )
                              }
                            >
                              <Trash2 className="size-3.5" />
                              {deletingId === vlan.id
                                ? "Deleting..."
                                : "Delete"}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-3 pl-16">
                        <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-3">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div>
                              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                                Linked IP ranges
                              </div>
                              <div className="text-xs text-[var(--color-fg-subtle)]">
                                {linkedSubnets.length > 0
                                  ? `${linkedSubnets.length} subnet${linkedSubnets.length === 1 ? "" : "s"} linked to VLAN ${vlan.vlanId}`
                                  : `No subnet linked to VLAN ${vlan.vlanId} yet.`}
                              </div>
                            </div>
                            {linkedSubnets.length > 0 && (
                              <Link
                                to={`/networks?subnetId=${linkedSubnets[0].id}&vlanId=${vlan.id}`}
                                className="inline-flex items-center gap-1 text-[11px] text-[var(--color-accent)] hover:text-[var(--color-accent-strong)]"
                              >
                                {t("Open network")}
                                <ChevronRight className="size-3" />
                              </Link>
                            )}
                          </div>

                          {linkedSubnets.length > 0 ? (
                            <div className="space-y-3">
                              {linkedSubnets.map((subnet) => {
                                const subnetZones = zones.filter(
                                  (zone) => zone.subnetId === subnet.id,
                                );
                                const subnetScopes = scopes.filter(
                                  (scope) => scope.subnetId === subnet.id,
                                );
                                const subnetAssignments =
                                  assignmentsBySubnetId[subnet.id] ?? [];
                                const ipCount = subnetAssignments.length;
                                return (
                                  <div
                                    key={subnet.id}
                                    className="rounded-[var(--radius-xs)] border border-[var(--color-line)] bg-[var(--color-surface)]/50 p-3"
                                  >
                                    <div className="mb-2 flex flex-wrap items-center gap-2">
                                      <Mono className="text-[11px] text-[var(--color-fg)]">
                                        {subnet.cidr}
                                      </Mono>
                                      <Badge tone="neutral">
                                        {subnet.name}
                                      </Badge>
                                      {subnet.gateway && (
                                        <span className="text-[11px] text-[var(--color-fg-subtle)]">
                                          {t("gateway {gateway}", {
                                            gateway: subnet.gateway,
                                          })}
                                        </span>
                                      )}
                                      {(subnet.dnsServers ?? []).length > 0 && (
                                        <span className="text-[11px] text-[var(--color-fg-subtle)]">
                                          {t("DNS {servers}", {
                                            servers: (subnet.dnsServers ?? []).join(", "),
                                          })}
                                        </span>
                                      )}
                                      {subnetScopes.length > 0 && (
                                        <Badge tone="cyan">
                                          {t("{count} DHCP", {
                                            count: subnetScopes.length,
                                          })}
                                        </Badge>
                                      )}
                                      {subnetZones.length > 0 && (
                                        <Badge tone="accent">
                                          {t("{count} zones", {
                                            count: subnetZones.length,
                                          })}
                                        </Badge>
                                      )}
                                      <span className="text-[11px] text-[var(--color-fg-subtle)]">
                                        {t("{count} assigned", {
                                          count: ipCount,
                                        })}
                                      </span>
                                      {subnet.description && (
                                        <span className="text-[11px] text-[var(--color-fg-subtle)]">
                                          | {subnet.description}
                                        </span>
                                      )}
                                    </div>
                                    {(subnetZones.length > 0 ||
                                      subnetScopes.length > 0) && (
                                      <IpZoneBar
                                        subnet={subnet}
                                        zones={subnetZones}
                                        scopes={subnetScopes}
                                        assignments={subnetAssignments}
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}

                          {isAddingSubnet && canEdit && (
                            <div className="mt-3 space-y-4 rounded-[var(--radius-xs)] border border-[var(--color-line)] bg-[var(--color-surface)]/60 p-4">
                              <div className="grid gap-4 md:grid-cols-2">
                                <Field label="CIDR">
                                  <Input
                                    value={subnetForm.cidr}
                                    onChange={(event) =>
                                      setSubnetForm((prev) => ({
                                        ...prev,
                                        cidr: event.target.value,
                                      }))
                                    }
                                    placeholder="10.0.10.0/24"
                                  />
                                </Field>
                                <Field label="Name">
                                  <Input
                                    value={subnetForm.name}
                                    onChange={(event) =>
                                      setSubnetForm((prev) => ({
                                        ...prev,
                                        name: event.target.value,
                                      }))
                                    }
                                    placeholder="Servers management"
                                  />
                                </Field>
                              </div>
                              <Field label="Description">
                                <Input
                                  value={subnetForm.description}
                                  onChange={(event) =>
                                    setSubnetForm((prev) => ({
                                      ...prev,
                                      description: event.target.value,
                                    }))
                                  }
                                  placeholder="Primary subnet for this VLAN"
                                />
                              </Field>
                              <div className="grid gap-4 md:grid-cols-2">
                                <Field label={t("Gateway")}>
                                  <Input
                                    value={subnetForm.gateway}
                                    onChange={(event) =>
                                      setSubnetForm((prev) => ({
                                        ...prev,
                                        gateway: event.target.value,
                                      }))
                                    }
                                    placeholder="10.0.10.1"
                                  />
                                </Field>
                                <Field label={t("DNS servers")}>
                                  <Input
                                    value={subnetForm.dnsServers}
                                    onChange={(event) =>
                                      setSubnetForm((prev) => ({
                                        ...prev,
                                        dnsServers: event.target.value,
                                      }))
                                    }
                                    placeholder="10.0.10.1, 1.1.1.1"
                                  />
                                </Field>
                              </div>

                              {subnetError && (
                                <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                                  {subnetError}
                                </div>
                              )}

                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSubnetDraftVlanId(null);
                                    setSubnetForm(EMPTY_SUBNET_FORM);
                                    setSubnetError("");
                                  }}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    void handleCreateSubnet(vlan.id)
                                  }
                                  disabled={subnetSaving}
                                >
                                  <Save className="size-3.5" />
                                  {subnetSaving
                                    ? "Creating..."
                                    : "Create linked range"}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              {filteredVlans.length === 0 && (
                <div className="px-4 py-6">
                  <EmptyState
                    icon={Network}
                    title={t("No VLANs in this range yet")}
                    description={t(
                      "Use the allocate action to start reserving and documenting IDs in this range.",
                    )}
                  />
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
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

function Td({ children }: { children: ReactNode }) {
  return <td>{children}</td>;
}

function SortButton({
  active,
  direction,
  onClick,
  children,
}: {
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rk-filter-pill ${active ? "rk-filter-pill-active" : ""}`}
    >
      {children}
      {active && (
        <span className="font-mono text-[9px]">
          {direction === "asc" ? "↑" : "↓"}
        </span>
      )}
    </button>
  );
}

function parseDnsServers(value: string) {
  const normalized = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function compareRanges(
  a: VlanRange,
  b: VlanRange,
  sort: SortState<RangeSortKey>,
  vlans: Vlan[],
) {
  const aTotal = a.endVlan - a.startVlan + 1;
  const bTotal = b.endVlan - b.startVlan + 1;
  const aUsed = countVlansInRange(a, vlans);
  const bUsed = countVlansInRange(b, vlans);
  const result =
    sort.key === "ids"
      ? compareNumber(a.startVlan, b.startVlan) ||
        compareNumber(a.endVlan, b.endVlan)
      : sort.key === "used"
        ? compareNumber(aUsed, bUsed)
        : sort.key === "free"
          ? compareNumber(aTotal - aUsed, bTotal - bUsed)
          : sort.key === "purpose"
            ? compareText(a.purpose, b.purpose)
            : compareText(a.name, b.name);

  return applySortDirection(
    result || compareNumber(a.startVlan, b.startVlan),
    sort.direction,
  );
}

function compareVlans(
  a: Vlan,
  b: Vlan,
  sort: SortState<VlanSortKey>,
  subnets: Subnet[],
) {
  const result =
    sort.key === "name"
      ? compareText(a.name, b.name)
      : sort.key === "subnets"
        ? compareNumber(
            subnets.filter((subnet) => subnet.vlanId === a.id).length,
            subnets.filter((subnet) => subnet.vlanId === b.id).length,
          )
        : compareNumber(a.vlanId, b.vlanId);

  return applySortDirection(result || compareNumber(a.vlanId, b.vlanId), sort.direction);
}

function countVlansInRange(range: VlanRange, vlans: Vlan[]) {
  return vlans.filter(
    (vlan) => vlan.vlanId >= range.startVlan && vlan.vlanId <= range.endVlan,
  ).length;
}
