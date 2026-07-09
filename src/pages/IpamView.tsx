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
import { AllocatePanel } from "@/components/shared/AllocatePanel";
import {
  canEditInventory,
  createDhcpScopeRecord,
  createIpZoneRecord,
  createSubnetRecord,
  deleteDhcpScopeRecord,
  deleteIpZoneRecord,
  deleteSubnetRecord,
  unassignIp,
  updateDhcpScopeRecord,
  updateIpZoneRecord,
  updateSubnetRecord,
  useStore,
} from "@/lib/store";
import type {
  Device,
  DhcpScope,
  IpAssignment,
  IpZone,
  Subnet,
  Vlan,
} from "@/lib/types";
import { Hash, Network, Plus, Save, Trash2 } from "lucide-react";
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

export default function IpamView() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useStore((s) => s.currentUser);
  const activeLab = useStore((s) => s.lab);
  const subnets = useStore((s) => s.subnets);
  const vlans = useStore((s) => s.vlans);
  const devices = useStore((s) => s.devices);
  const allAssignments = useStore((s) => s.ipAssignments);
  const allScopes = useStore((s) => s.scopes);
  const allZones = useStore((s) => s.ipZones);
  const canEdit = canEditInventory(currentUser);

  const [subnetId, setSubnetId] = useState("");
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const [creatingSubnet, setCreatingSubnet] = useState(false);
  const [subnetForm, setSubnetForm] = useState<SubnetForm>(EMPTY_SUBNET_FORM);
  const [subnetSaving, setSubnetSaving] = useState(false);
  const [subnetDeleting, setSubnetDeleting] = useState(false);
  const [subnetError, setSubnetError] = useState("");

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
  const requestedSubnetId = searchParams.get("subnetId");
  const requestedVlanId = searchParams.get("vlanId") ?? "";

  useEffect(() => {
    if (!subnets.length) return;
    if (
      requestedSubnetId &&
      subnets.some((entry) => entry.id === requestedSubnetId)
    ) {
      setSubnetId((current) =>
        current === requestedSubnetId ? current : requestedSubnetId,
      );
      return;
    }

    setSubnetId((current) =>
      current && subnets.some((subnet) => subnet.id === current)
        ? current
        : subnets[0].id,
    );
  }, [requestedSubnetId, subnets]);

  useEffect(() => {
    const currentSubnetId = searchParams.get("subnetId") ?? "";
    const nextSubnetId = subnetId ?? "";
    if (currentSubnetId === nextSubnetId) return;

    const next = new URLSearchParams(searchParams);
    if (nextSubnetId) {
      next.set("subnetId", nextSubnetId);
    } else {
      next.delete("subnetId");
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, subnetId]);

  useEffect(() => {
    if (!creatingSubnet || !requestedVlanId || subnetForm.vlanId) return;
    setSubnetForm((prev) => ({ ...prev, vlanId: requestedVlanId }));
  }, [creatingSubnet, requestedVlanId, subnetForm.vlanId]);

  const vlanById = useMemo(() => {
    return vlans.reduce<Record<string, Vlan>>((acc, vlan) => {
      acc[vlan.id] = vlan;
      return acc;
    }, {});
  }, [vlans]);

  const deviceById = useMemo(() => {
    return devices.reduce<Record<string, Device>>((acc, device) => {
      acc[device.id] = device;
      return acc;
    }, {});
  }, [devices]);

  const subnet = subnets.find((entry) => entry.id === subnetId) ?? subnets[0];

  const assignments = useMemo(
    () =>
      allAssignments.filter((assignment) => assignment.subnetId === subnet?.id),
    [allAssignments, subnet?.id],
  );
  const subnetScopes = useMemo(
    () => allScopes.filter((scope) => scope.subnetId === subnet?.id),
    [allScopes, subnet?.id],
  );
  const subnetZones = useMemo(
    () => allZones.filter((zone) => zone.subnetId === subnet?.id),
    [allZones, subnet?.id],
  );

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
    if (!subnetZones.length) {
      setSelectedZoneId(null);
      return;
    }
    if (
      !selectedZoneId ||
      !subnetZones.some((zone) => zone.id === selectedZoneId)
    ) {
      setSelectedZoneId(subnetZones[0].id);
    }
  }, [selectedZoneId, subnetZones]);

  const selectedZone = selectedZoneId
    ? subnetZones.find((zone) => zone.id === selectedZoneId)
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

  const ipsBySubnetId = useMemo(() => {
    return allAssignments.reduce<Record<string, IpAssignment[]>>(
      (acc, assignment) => {
        (acc[assignment.subnetId] ??= []).push(assignment);
        return acc;
      },
      {},
    );
  }, [allAssignments]);

  const grouped = useMemo(() => {
    return assignments.reduce<Record<string, IpAssignment[]>>(
      (acc, assignment) => {
        (acc[assignment.assignmentType] ??= []).push(assignment);
        return acc;
      },
      {},
    );
  }, [assignments]);

  if (!subnet) {
    return (
      <>
        <TopBar
          subtitle={t("Address management")}
          title={t("IPAM")}
          actions={
            canEdit ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCreatingSubnet(true);
                  setSubnetForm(EMPTY_SUBNET_FORM);
                }}
              >
                <Plus className="size-3.5" />
                {t("Add subnet")}
              </Button>
            ) : undefined
          }
        />
        <div className="flex flex-1 items-center justify-center px-6">
          <Card className="w-full max-w-xl">
            <CardHeader>
              <CardTitle>
                <CardLabel>{t("IPAM")}</CardLabel>
                <CardHeading>{t("No subnets documented yet")}</CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <EmptyState
                title={t("No subnets documented yet")}
                description={t(
                  "Create a subnet to start documenting IP allocations, DHCP scopes, and static zones.",
                )}
                action={
                  canEdit ? (
                    <SubnetEditor
                      creating={creatingSubnet}
                      form={subnetForm}
                      vlans={vlans}
                      error={subnetError}
                      saving={subnetSaving}
                      deleting={false}
                      canDelete={false}
                      onChange={setSubnetForm}
                      onSave={async () => {
                        setSubnetSaving(true);
                        setSubnetError("");
                        try {
                          const created = await createSubnetRecord({
                            labId: activeLab.id,
                        cidr: subnetForm.cidr.trim(),
                        name: subnetForm.name.trim(),
                        description: subnetForm.description.trim() || undefined,
                        gateway: subnetForm.gateway.trim() || undefined,
                        dnsServers: parseDnsServers(subnetForm.dnsServers),
                        vlanId: subnetForm.vlanId || undefined,
                      });
                      setSubnetId(created.id);
                      setCreatingSubnet(false);
                    } catch (err) {
                      setSubnetError(
                        err instanceof Error
                          ? err.message
                          : t("Failed to create subnet."),
                      );
                    } finally {
                      setSubnetSaving(false);
                    }
                  }}
                  onDelete={async () => {}}
                  onNew={() => {
                    setCreatingSubnet(true);
                    setSubnetForm(EMPTY_SUBNET_FORM);
                  }}
                    />
                  ) : undefined
                }
              />
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  const vlan = subnet?.vlanId ? vlanById[subnet.vlanId] : undefined;

  async function handleUnassign(assignmentId: string) {
    setReleasingId(assignmentId);
    try {
      await unassignIp(assignmentId);
    } finally {
      setReleasingId(null);
    }
  }

  async function handleSaveSubnet() {
    if (!subnet) return;
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
        setSubnetId(created.id);
        setCreatingSubnet(false);
        return;
      }

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
      setSubnetId("");
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
      if (creatingZone) {
        const created = await createIpZoneRecord({
          subnetId: subnet.id,
          kind: zoneForm.kind,
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
        kind: zoneForm.kind,
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
        title={t("IPAM")}
        meta={
          <>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              {t("{count} subnets", { count: subnets.length })}
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
                variant="outline"
                size="sm"
                onClick={() => {
                  setCreatingSubnet(true);
                  setSubnetForm(EMPTY_SUBNET_FORM);
                }}
              >
                <Plus className="size-3.5" />
                {t("Add subnet")}
              </Button>
            )}
            <AllocatePanel defaultTab="ip" defaultSubnetId={subnet?.id} />
          </>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-72 shrink-0 flex-col border-r border-[var(--color-line)] bg-[var(--color-bg-2)]/40">
          <div className="border-b border-[var(--color-line)] px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
              {t("Subnets")}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {subnets.map((entry) => {
              const isActive = entry.id === subnet?.id;
              const entryVlan = entry.vlanId
                ? vlanById[entry.vlanId]
                : undefined;
              const ipCount = (ipsBySubnetId[entry.id] ?? []).length;
              const total = cidrSize(entry.cidr) - 2;
              const pct = Math.round((ipCount / Math.max(1, total)) * 100);
              return (
                <button
                  key={entry.id}
                  onClick={() => {
                    setSubnetId(entry.id);
                    setCreatingSubnet(false);
                    setCreatingScope(false);
                    setCreatingZone(false);
                  }}
                  className={`w-full border-l-2 px-4 py-2.5 text-left transition-colors ${
                    isActive
                      ? "border-[var(--color-accent)] bg-[var(--color-surface)]"
                      : "border-transparent hover:bg-[var(--color-surface)]/40"
                  }`}
                >
                  <div className="mb-0.5 flex items-center gap-2">
                    <Network className="size-3 text-[var(--color-fg-muted)]" />
                    <Mono className="text-xs text-[var(--color-fg)]">
                      {entry.cidr}
                    </Mono>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="truncate text-[11px] text-[var(--color-fg-subtle)]">
                      {entry.name}
                    </span>
                    {entryVlan && (
                      <span
                        className="rounded-[1px] px-1 font-mono text-[10px]"
                        style={{
                          backgroundColor: `${entryVlan.color}20`,
                          color: entryVlan.color,
                        }}
                      >
                        VL{entryVlan.vlanId}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 h-0.5 overflow-hidden bg-[var(--color-bg)]">
                    <div
                      className="h-full bg-[var(--color-accent)]"
                      style={{ width: `${pct}%`, opacity: 0.7 }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {subnet && (
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                  {t("Subnet")}
                </div>
                <h2 className="flex items-center gap-3 text-lg font-semibold tracking-tight">
                  <span className="font-mono">{subnet.cidr}</span>
                  <span className="font-sans text-[var(--color-fg-muted)]">
                    /
                  </span>
                  <span className="font-sans">{subnet.name}</span>
                </h2>
                {vlan && (
                  <div className="mt-1 flex items-center gap-2">
                    <Hash className="size-3 text-[var(--color-fg-subtle)]" />
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
                    {vlan.description && (
                      <span className="text-[11px] text-[var(--color-fg-subtle)]">
                        {vlan.description}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {canEdit && subnet && (
            <SubnetEditor
              creating={creatingSubnet}
              form={subnetForm}
              vlans={vlans}
              error={subnetError}
              saving={subnetSaving}
              deleting={subnetDeleting}
              canDelete={!creatingSubnet}
              onChange={setSubnetForm}
              onSave={() => void handleSaveSubnet()}
              onDelete={() => void handleDeleteSubnet()}
              onNew={() => {
                setCreatingSubnet(true);
                setSubnetForm(EMPTY_SUBNET_FORM);
              }}
            />
          )}

          {subnetZones.length > 0 && (
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
                  zones={subnetZones}
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
            zones={subnetZones}
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
                    {items
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
                                disabled={
                                  releasingId === assignment.id || !canEdit
                                }
                                onClick={() =>
                                  void handleUnassign(assignment.id)
                                }
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
        </div>
      </div>
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
              placeholder={t("Servers management")}
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
              placeholder={t("Primary management network")}
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
                  placeholder={t("Clients")}
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
                placeholder={t("General client pool")}
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
          <CardHeading>
            {t("Static, DHCP, reserved, infrastructure")}
          </CardHeading>
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
              "Define infrastructure, reserved, static, or DHCP zones to make address ownership easier to scan.",
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
                  <option value="static">{t("static")}</option>
                  <option value="dhcp">{t("dhcp")}</option>
                  <option value="reserved">{t("reserved")}</option>
                  <option value="infrastructure">
                    {t("infrastructure")}
                  </option>
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
                placeholder={t("Static addresses for infrastructure")}
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
