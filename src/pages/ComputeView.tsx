import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Cpu, Network, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
import { TopBar } from "@/components/layout/TopBar";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { StatusDot } from "@/components/shared/StatusDot";
import {
  canEditInventory,
  createVirtualSwitchRecord,
  deleteVirtualSwitchRecord,
  updatePort,
  updateVirtualSwitchRecord,
  useStore,
} from "@/lib/store";
import type { Device, Port, VirtualSwitch } from "@/lib/types";
import { formatDeviceAddress } from "@/lib/network-labels";
import { statusLabel } from "@/lib/utils";

const HOST_DEVICE_TYPES = new Set<Device["deviceType"]>([
  "server",
  "storage",
  "kvm",
  "other",
]);

const VIRTUAL_SWITCH_KINDS: Array<VirtualSwitch["kind"]> = [
  "external",
  "internal",
  "private",
];

interface BridgeFormState {
  name: string;
  kind: VirtualSwitch["kind"];
  notes: string;
  uplinkPortIds: string[];
}

const EMPTY_BRIDGE_FORM: BridgeFormState = {
  name: "",
  kind: "external",
  notes: "",
  uplinkPortIds: [],
};

export default function ComputeView() {
  const { t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const devices = useStore((s) => s.devices);
  const ports = useStore((s) => s.ports);
  const virtualSwitches = useStore((s) => s.virtualSwitches);
  const canEdit = canEditInventory(currentUser);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDefaults, setDrawerDefaults] = useState<{
    deviceType?: Device["deviceType"];
    placement?: NonNullable<Device["placement"]>;
    parentDeviceId?: string;
    status?: Device["status"];
  }>();
  const [bridgeEditorHostId, setBridgeEditorHostId] = useState<string | null>(
    null,
  );
  const [bridgeEditingId, setBridgeEditingId] = useState<string | null>(null);
  const [bridgeForm, setBridgeForm] =
    useState<BridgeFormState>(EMPTY_BRIDGE_FORM);
  const [bridgeSaving, setBridgeSaving] = useState(false);
  const [bridgeDeletingId, setBridgeDeletingId] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState("");

  const devicesById = useMemo(() => {
    return devices.reduce<Record<string, Device>>((acc, device) => {
      acc[device.id] = device;
      return acc;
    }, {});
  }, [devices]);

  const vms = useMemo(
    () =>
      devices
        .filter(
          (device) =>
            device.deviceType === "vm" || device.placement === "virtual",
        )
        .sort((a, b) => a.hostname.localeCompare(b.hostname)),
    [devices],
  );

  const vmHostIds = useMemo(
    () =>
      new Set(
        vms
          .map((device) => device.parentDeviceId)
          .filter((value): value is string => Boolean(value)),
      ),
    [vms],
  );

  const hosts = useMemo(
    () =>
      devices
        .filter(
          (device) =>
            !["vm", "container"].includes(device.deviceType) &&
            (vmHostIds.has(device.id) ||
              HOST_DEVICE_TYPES.has(device.deviceType)),
        )
        .sort((a, b) => a.hostname.localeCompare(b.hostname)),
    [devices, vmHostIds],
  );

  const guestsByHostId = useMemo(() => {
    return vms.reduce<Record<string, Device[]>>((acc, device) => {
      if (device.parentDeviceId) {
        (acc[device.parentDeviceId] ??= []).push(device);
      }
      return acc;
    }, {});
  }, [vms]);

  const virtualSwitchesByHostId = useMemo(() => {
    return virtualSwitches.reduce<Record<string, VirtualSwitch[]>>(
      (acc, virtualSwitch) => {
        (acc[virtualSwitch.hostDeviceId] ??= []).push(virtualSwitch);
        return acc;
      },
      {},
    );
  }, [virtualSwitches]);

  const portsByDeviceId = useMemo(() => {
    return ports.reduce<Record<string, Port[]>>((acc, port) => {
      (acc[port.deviceId] ??= []).push(port);
      return acc;
    }, {});
  }, [ports]);

  const virtualSwitchById = useMemo(() => {
    return virtualSwitches.reduce<Record<string, VirtualSwitch>>(
      (acc, virtualSwitch) => {
        acc[virtualSwitch.id] = virtualSwitch;
        return acc;
      },
      {},
    );
  }, [virtualSwitches]);

  const portsByVirtualSwitchId = useMemo(() => {
    return ports.reduce<Record<string, typeof ports>>((acc, port) => {
      if (!port.virtualSwitchId) return acc;
      (acc[port.virtualSwitchId] ??= []).push(port);
      return acc;
    }, {});
  }, [ports]);

  const unassignedVms = useMemo(
    () =>
      vms.filter(
        (device) =>
          !device.parentDeviceId ||
          !hosts.some((host) => host.id === device.parentDeviceId),
      ),
    [hosts, vms],
  );

  const activeHosts = hosts.filter(
    (host) => (guestsByHostId[host.id] ?? []).length > 0,
  );
  const emptyHosts = hosts.filter(
    (host) => (guestsByHostId[host.id] ?? []).length === 0,
  );

  function openBridgeEditor(
    hostId: string,
    virtualSwitch?: VirtualSwitch,
    uplinkPortIds: string[] = [],
  ) {
    setBridgeEditorHostId(hostId);
    setBridgeEditingId(virtualSwitch?.id ?? null);
    setBridgeForm({
      name: virtualSwitch?.name ?? "",
      kind: virtualSwitch?.kind ?? "external",
      notes: virtualSwitch?.notes ?? "",
      uplinkPortIds,
    });
    setBridgeError("");
  }

  function closeBridgeEditor() {
    setBridgeEditorHostId(null);
    setBridgeEditingId(null);
    setBridgeForm(EMPTY_BRIDGE_FORM);
    setBridgeError("");
  }

  async function handleSaveBridge(hostId: string) {
    if (!bridgeForm.name.trim()) {
      setBridgeError("Bridge name is required.");
      return;
    }

    setBridgeSaving(true);
    setBridgeError("");
    try {
      const hostPorts = portsByDeviceId[hostId] ?? [];
      const saved = bridgeEditingId
        ? await updateVirtualSwitchRecord(bridgeEditingId, {
            name: bridgeForm.name.trim(),
            kind: bridgeForm.kind,
            notes: bridgeForm.notes.trim() || null,
          })
        : await createVirtualSwitchRecord({
            hostDeviceId: hostId,
            name: bridgeForm.name.trim(),
            kind: bridgeForm.kind,
            notes: bridgeForm.notes.trim() || null,
          });

      if (!saved) {
        throw new Error("Failed to save bridge.");
      }

      const desiredUplinkIds =
        saved.kind === "external"
          ? new Set(bridgeForm.uplinkPortIds)
          : new Set<string>();

      const hostMembershipUpdates = hostPorts.flatMap((port) => {
        if (desiredUplinkIds.has(port.id)) {
          return port.virtualSwitchId !== saved.id
            ? [updatePort(port.id, { virtualSwitchId: saved.id })]
            : [];
        }
        return port.virtualSwitchId === saved.id
          ? [updatePort(port.id, { virtualSwitchId: null })]
          : [];
      });

      if (hostMembershipUpdates.length > 0) {
        await Promise.all(hostMembershipUpdates);
      }

      closeBridgeEditor();
    } catch (error) {
      setBridgeError(
        error instanceof Error ? error.message : "Failed to save bridge.",
      );
    } finally {
      setBridgeSaving(false);
    }
  }

  async function handleDeleteBridge(virtualSwitch: VirtualSwitch) {
    if (
      !window.confirm(
        `Delete virtual switch "${virtualSwitch.name}"? Ports mapped to it will keep their VLAN settings but lose bridge membership.`,
      )
    ) {
      return;
    }

    setBridgeDeletingId(virtualSwitch.id);
    setBridgeError("");
    try {
      await deleteVirtualSwitchRecord(virtualSwitch.id);
      if (bridgeEditingId === virtualSwitch.id) {
        closeBridgeEditor();
      }
    } catch (error) {
      setBridgeError(
        error instanceof Error ? error.message : "Failed to delete bridge.",
      );
    } finally {
      setBridgeDeletingId(null);
    }
  }

  return (
    <>
      <TopBar
        subtitle="Virtualization inventory"
        title={t("Compute")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {hosts.length} hosts | {vms.length} VMs
          </span>
        }
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDrawerDefaults({
                    deviceType: "server",
                    placement: "room",
                    status: "unknown",
                  });
                  setDrawerOpen(true);
                }}
              >
                <Plus className="size-3.5" />
                Add host
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDrawerDefaults({
                    deviceType: "vm",
                    placement: "virtual",
                    status: "unknown",
                  });
                  setDrawerOpen(true);
                }}
              >
                <Plus className="size-3.5" />
                Add VM
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <ComputeStat
            label="Hosts"
            value={String(hosts.length)}
            hint="Potential virtualization hosts"
          />
          <ComputeStat
            label="Active hosts"
            value={String(activeHosts.length)}
            hint="Hosts with at least one guest"
          />
          <ComputeStat
            label="VMs"
            value={String(vms.length)}
            hint="Virtual devices documented in this lab"
          />
          <ComputeStat
            label="Unassigned VMs"
            value={String(unassignedVms.length)}
            hint="Guests not linked to a host yet"
          />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <CardLabel>Hosts</CardLabel>
                <CardHeading>Virtualization and compute nodes</CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {hosts.length === 0 ? (
                <div className="rk-empty text-center">
                  <div className="rk-empty-title">
                    No compute hosts documented yet
                  </div>
                  <div className="rk-empty-copy">
                    Add physical hosts, storage nodes, or hypervisors here to
                    start tracking guest placement and capacity.
                  </div>
                </div>
              ) : (
                <>
                  {activeHosts.length > 0 && (
                    <div className="grid gap-4 xl:grid-cols-2">
                      {activeHosts.map((host) => {
                        const guests = (guestsByHostId[host.id] ?? []).sort(
                          (a, b) => a.hostname.localeCompare(b.hostname),
                        );
                        const capacity = summarizeHostCapacity(host, guests);
                        return (
                          <Card key={host.id}>
                            <CardHeader>
                              <CardTitle>
                                <CardLabel>Host</CardLabel>
                                <CardHeading>{host.hostname}</CardHeading>
                              </CardTitle>
                              <Badge tone="accent">
                                <Cpu className="size-3" />
                                {guests.length} VMs
                              </Badge>
                            </CardHeader>
                            <CardBody className="space-y-3">
                              <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
                                <StatusDot status={host.status} />
                                <span>{statusLabel[host.status]}</span>
                                {formatDeviceAddress(host) && (
                                  <span className="font-mono text-[11px]">
                                    {formatDeviceAddress(host)}
                                  </span>
                                )}
                              </div>

                              {capacity.cpu.total ||
                              capacity.memory.total ||
                              capacity.storage.total ? (
                                <div className="grid gap-2 md:grid-cols-3">
                                  <CapacityMeter
                                    label="CPU"
                                    unit="cores"
                                    {...capacity.cpu}
                                  />
                                  <CapacityMeter
                                    label="Memory"
                                    unit="GB"
                                    {...capacity.memory}
                                  />
                                  <CapacityMeter
                                    label="Storage"
                                    unit="GB"
                                    {...capacity.storage}
                                  />
                                </div>
                              ) : null}

                              <div className="grid gap-2">
                                {guests.map((guest) => (
                                  <Link
                                    key={guest.id}
                                    to={`/devices/${guest.id}`}
                                    className="rk-panel-inset rounded-[var(--radius-md)] px-3 py-2 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
                                  >
                                    <div className="flex items-center gap-2">
                                      <DeviceTypeIcon
                                        type={guest.deviceType}
                                        className="size-4 text-[var(--color-accent)]"
                                      />
                                      <span className="text-sm font-medium text-[var(--text-primary)]">
                                        {guest.hostname}
                                      </span>
                                    </div>
                                    <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                                      {guest.displayName ||
                                        formatDeviceAddress(guest) ||
                                        statusLabel[guest.status]}
                                    </div>
                                  </Link>
                                ))}
                              </div>

                              <VirtualSwitchSection
                                host={host}
                                virtualSwitches={
                                  virtualSwitchesByHostId[host.id] ?? []
                                }
                                hostPorts={portsByDeviceId[host.id] ?? []}
                                portsByVirtualSwitchId={portsByVirtualSwitchId}
                                devicesById={devicesById}
                                virtualSwitchesById={virtualSwitchById}
                                canEdit={canEdit}
                                editingHostId={bridgeEditorHostId}
                                editingId={bridgeEditingId}
                                bridgeForm={bridgeForm}
                                bridgeSaving={bridgeSaving}
                                bridgeDeletingId={bridgeDeletingId}
                                bridgeError={bridgeError}
                                onFormChange={setBridgeForm}
                                onCreate={() => openBridgeEditor(host.id)}
                                onEdit={(virtualSwitch, uplinkPortIds) =>
                                  openBridgeEditor(
                                    host.id,
                                    virtualSwitch,
                                    uplinkPortIds,
                                  )
                                }
                                onCancel={closeBridgeEditor}
                                onSave={() => void handleSaveBridge(host.id)}
                                onDelete={(virtualSwitch) =>
                                  void handleDeleteBridge(virtualSwitch)
                                }
                              />

                              {canEdit && (
                                <div className="flex justify-end">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setDrawerDefaults({
                                        deviceType: "vm",
                                        placement: "virtual",
                                        parentDeviceId: host.id,
                                        status: "unknown",
                                      });
                                      setDrawerOpen(true);
                                    }}
                                  >
                                    <Plus className="size-3.5" />
                                    Add VM on host
                                  </Button>
                                </div>
                              )}
                            </CardBody>
                          </Card>
                        );
                      })}
                    </div>
                  )}

                  {emptyHosts.length > 0 && (
                    <div>
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                        Hosts without guests yet
                      </div>
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {emptyHosts.map((host) => (
                          <div
                            key={host.id}
                            className="rk-panel-inset rounded-[var(--radius-md)] px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <DeviceTypeIcon
                                type={host.deviceType}
                                className="size-4 text-[var(--color-accent)]"
                              />
                              <Link
                                to={`/devices/${host.id}`}
                                className="text-sm font-medium text-[var(--text-primary)] hover:underline"
                              >
                                {host.hostname}
                              </Link>
                            </div>
                            <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                              {host.displayName ||
                                formatDeviceAddress(host) ||
                                statusLabel[host.status]}
                            </div>
                            <VirtualSwitchSection
                              host={host}
                              virtualSwitches={
                                virtualSwitchesByHostId[host.id] ?? []
                              }
                              hostPorts={portsByDeviceId[host.id] ?? []}
                              portsByVirtualSwitchId={portsByVirtualSwitchId}
                              devicesById={devicesById}
                              virtualSwitchesById={virtualSwitchById}
                              canEdit={canEdit}
                              editingHostId={bridgeEditorHostId}
                              editingId={bridgeEditingId}
                              bridgeForm={bridgeForm}
                              bridgeSaving={bridgeSaving}
                              bridgeDeletingId={bridgeDeletingId}
                              bridgeError={bridgeError}
                              onFormChange={setBridgeForm}
                              onCreate={() => openBridgeEditor(host.id)}
                              onEdit={(virtualSwitch, uplinkPortIds) =>
                                openBridgeEditor(
                                  host.id,
                                  virtualSwitch,
                                  uplinkPortIds,
                                )
                              }
                              onCancel={closeBridgeEditor}
                              onSave={() => void handleSaveBridge(host.id)}
                              onDelete={(virtualSwitch) =>
                                void handleDeleteBridge(virtualSwitch)
                              }
                              compact
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <CardLabel>Unassigned</CardLabel>
                <CardHeading>VMs without a host link</CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody>
              {unassignedVms.length === 0 ? (
                <div className="rk-empty">
                  <div className="rk-empty-title">
                    Every VM is currently linked
                  </div>
                  <div className="rk-empty-copy">
                    All documented guests are already attached to a host record.
                  </div>
                </div>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {unassignedVms.map((device) => (
                    <Link
                      key={device.id}
                      to={`/devices/${device.id}`}
                      className="rk-panel-inset rounded-[var(--radius-md)] px-3 py-2 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
                    >
                      <div className="flex items-center gap-2">
                        <DeviceTypeIcon
                          type={device.deviceType}
                          className="size-4 text-[var(--color-accent)]"
                        />
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {device.hostname}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                        {device.displayName ||
                          formatDeviceAddress(device) ||
                          "No host selected yet"}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {canEdit && (
        <DeviceDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          defaults={drawerDefaults}
        />
      )}
    </>
  );
}

function ComputeStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-[var(--color-fg)]">
        {value}
      </div>
      <div className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
        {hint}
      </div>
    </div>
  );
}

function VirtualSwitchSection({
  host,
  virtualSwitches,
  hostPorts,
  portsByVirtualSwitchId,
  devicesById,
  virtualSwitchesById,
  canEdit,
  editingHostId,
  editingId,
  bridgeForm,
  bridgeSaving,
  bridgeDeletingId,
  bridgeError,
  onFormChange,
  onCreate,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  compact = false,
}: {
  host: Device;
  virtualSwitches: VirtualSwitch[];
  hostPorts: Port[];
  portsByVirtualSwitchId: Record<string, Port[]>;
  devicesById: Record<string, Device>;
  virtualSwitchesById: Record<string, VirtualSwitch>;
  canEdit: boolean;
  editingHostId: string | null;
  editingId: string | null;
  bridgeForm: BridgeFormState;
  bridgeSaving: boolean;
  bridgeDeletingId: string | null;
  bridgeError: string;
  onFormChange: (next: BridgeFormState) => void;
  onCreate: () => void;
  onEdit: (virtualSwitch: VirtualSwitch, uplinkPortIds: string[]) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: (virtualSwitch: VirtualSwitch) => void;
  compact?: boolean;
}) {
  const editorOpen = editingHostId === host.id;
  const sortedHostPorts = [...hostPorts].sort(sortPortsByPosition);

  return (
    <div className={compact ? "mt-3 space-y-2" : "space-y-3"}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
          Virtual switches
        </div>
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={onCreate}>
            <Plus className="size-3.5" />
            Add bridge
          </Button>
        ) : null}
      </div>

      {virtualSwitches.length === 0 && !editorOpen ? (
        <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-[11px] text-[var(--color-fg-subtle)]">
          No host bridges documented yet.
        </div>
      ) : null}

      {virtualSwitches.length > 0 ? (
        <div className="grid gap-2">
          {virtualSwitches.map((virtualSwitch) => {
            const members = [
              ...(portsByVirtualSwitchId[virtualSwitch.id] ?? []),
            ].sort(sortPortsByMembership(devicesById));
            const hostUplinkPorts = members.filter(
              (port) => port.deviceId === host.id,
            );
            const guestPorts = members.filter(
              (port) => port.deviceId !== host.id,
            );
            const isEditing = editingId === virtualSwitch.id && editorOpen;
            const tone =
              virtualSwitch.kind === "external"
                ? "accent"
                : virtualSwitch.kind === "internal"
                  ? "info"
                  : "neutral";

            return (
              <div
                key={virtualSwitch.id}
                className="rk-panel-inset rounded-[var(--radius-md)] px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Network className="size-3.5 text-[var(--accent-secondary)]" />
                      <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {virtualSwitch.name}
                      </span>
                      <Badge tone={tone}>{virtualSwitch.kind}</Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                      {members.length} member ports | {hostUplinkPorts.length}{" "}
                      host uplinks | {guestPorts.length} guest NICs
                    </div>
                    {virtualSwitch.notes ? (
                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                        {virtualSwitch.notes}
                      </div>
                    ) : null}
                    <div className="mt-3 space-y-2">
                      <div>
                        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                          Host uplinks
                        </div>
                        {hostUplinkPorts.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {hostUplinkPorts.map((port) => (
                              <div
                                key={port.id}
                                className="rounded-[var(--radius-xs)] border border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)] px-2 py-1 text-xs text-[var(--text-primary)]"
                              >
                                <strong className="font-medium">
                                  {port.name}
                                </strong>
                                <span className="ml-2 text-[var(--text-tertiary)]">
                                  {formatPortMeta(port)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-[var(--text-tertiary)]">
                            {virtualSwitch.kind === "external"
                              ? "No host uplinks assigned yet."
                              : "This bridge type does not require a physical host uplink."}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                          Guest members
                        </div>
                        {guestPorts.length > 0 ? (
                          <div className="grid gap-1.5">
                            {guestPorts.map((port) => {
                              const device = devicesById[port.deviceId];
                              return (
                                <div
                                  key={port.id}
                                  className="flex items-center justify-between gap-3 rounded-[var(--radius-xs)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-xs font-medium text-[var(--text-primary)]">
                                      {device ? (
                                        <Link
                                          to={`/devices/${device.id}`}
                                          className="hover:underline"
                                        >
                                          {device.hostname}
                                        </Link>
                                      ) : (
                                        port.deviceId
                                      )}{" "}
                                      · {port.name}
                                    </div>
                                    <div className="text-[11px] text-[var(--text-tertiary)]">
                                      {formatPortMeta(port)}
                                    </div>
                                  </div>
                                  <Badge tone="cyan">member</Badge>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-[11px] text-[var(--text-tertiary)]">
                            No VM or guest NICs are mapped to this bridge yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant={isEditing ? "default" : "ghost"}
                        size="icon"
                        onClick={() =>
                          onEdit(
                            virtualSwitch,
                            hostUplinkPorts.map((port) => port.id),
                          )
                        }
                        aria-label={`Edit ${virtualSwitch.name}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(virtualSwitch)}
                        aria-label={`Delete ${virtualSwitch.name}`}
                        disabled={bridgeDeletingId === virtualSwitch.id}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {editorOpen ? (
        <div className="rk-panel rounded-[var(--radius-md)] p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                {editingId ? "Edit bridge" : "New bridge"}
              </div>
              <div className="text-sm font-medium text-[var(--text-primary)]">
                {host.hostname}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onCancel}>
              <X className="size-3.5" />
            </Button>
          </div>

          <div className="space-y-3">
            <ComputeField label="Name">
              <Input
                value={bridgeForm.name}
                onChange={(event) =>
                  onFormChange({
                    ...bridgeForm,
                    name: event.target.value,
                  })
                }
                placeholder="vSwitch-Servers"
              />
            </ComputeField>

            <ComputeField label="Bridge type">
              <ComputeSelect
                value={bridgeForm.kind}
                onChange={(event) =>
                  onFormChange({
                    ...bridgeForm,
                    kind: event.target.value as VirtualSwitch["kind"],
                  })
                }
              >
                {VIRTUAL_SWITCH_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </ComputeSelect>
            </ComputeField>

            <ComputeField label="Notes">
              <textarea
                value={bridgeForm.notes}
                onChange={(event) =>
                  onFormChange({
                    ...bridgeForm,
                    notes: event.target.value,
                  })
                }
                rows={3}
                className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm text-[var(--color-fg)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]"
                placeholder="External uplink bridge for guest and management networks"
              />
            </ComputeField>

            {bridgeForm.kind === "external" ? (
              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                  Host uplink ports
                </div>
                {sortedHostPorts.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {sortedHostPorts.map((port) => {
                      const selected = bridgeForm.uplinkPortIds.includes(
                        port.id,
                      );
                      const assignedElsewhere =
                        port.virtualSwitchId &&
                        port.virtualSwitchId !== editingId
                          ? virtualSwitchesById[port.virtualSwitchId]
                          : null;
                      return (
                        <button
                          key={port.id}
                          type="button"
                          onClick={() =>
                            onFormChange({
                              ...bridgeForm,
                              uplinkPortIds: selected
                                ? bridgeForm.uplinkPortIds.filter(
                                    (entry) => entry !== port.id,
                                  )
                                : [...bridgeForm.uplinkPortIds, port.id],
                            })
                          }
                          className={`rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors ${
                            selected
                              ? "border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)]"
                              : "border-[var(--color-line)] bg-[var(--color-bg)] hover:border-[var(--color-line-strong)]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-[var(--text-primary)]">
                              {port.name}
                            </span>
                            {selected ? (
                              <Badge tone="accent">uplink</Badge>
                            ) : null}
                          </div>
                          <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                            {formatPortMeta(port)}
                          </div>
                          {assignedElsewhere ? (
                            <div className="mt-1 text-[11px] text-[var(--warning)]">
                              Currently on {assignedElsewhere.name}. Saving here
                              will move it.
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[11px] text-[var(--color-fg-subtle)]">
                    No host ports are documented on this device yet. Add them in
                    the Ports workspace first.
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-[var(--color-fg-subtle)]">
                Internal and private bridges do not use physical host uplinks.
                Guest NICs can still join this bridge from the Ports workspace.
              </div>
            )}

            <div className="text-[11px] text-[var(--color-fg-subtle)]">
              VM and guest NIC membership remains available from the Ports
              workspace, and member NICs are summarized above for quick review.
            </div>

            {bridgeError ? (
              <div className="text-xs text-[var(--color-err)]">
                {bridgeError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={onSave} disabled={bridgeSaving}>
                <Save className="size-3.5" />
                {bridgeSaving
                  ? "Saving..."
                  : editingId
                    ? "Save bridge"
                    : "Create bridge"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ComputeField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      {children}
    </label>
  );
}

function ComputeSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={onChange}
      className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm text-[var(--color-fg)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]"
    >
      {children}
    </select>
  );
}

function sortPortsByPosition(a: Port, b: Port) {
  return a.position - b.position || a.name.localeCompare(b.name);
}

function sortPortsByMembership(devicesById: Record<string, Device>) {
  return (a: Port, b: Port) => {
    const deviceA = devicesById[a.deviceId];
    const deviceB = devicesById[b.deviceId];
    const deviceCompare = (deviceA?.hostname ?? a.deviceId).localeCompare(
      deviceB?.hostname ?? b.deviceId,
    );
    if (deviceCompare !== 0) return deviceCompare;
    return sortPortsByPosition(a, b);
  };
}

function formatPortMeta(port: Port) {
  const parts = [port.kind.replace(/_/g, " ")];
  if (port.speed) parts.push(port.speed);
  if (port.mode) parts.push(port.mode);
  return parts.join(" · ");
}

function summarizeHostCapacity(host: Device, guests: Device[]) {
  return {
    cpu: summarizeCapacity(
      host.cpuCores,
      guests.map((guest) => guest.cpuCores),
    ),
    memory: summarizeCapacity(
      host.memoryGb,
      guests.map((guest) => guest.memoryGb),
    ),
    storage: summarizeCapacity(
      host.storageGb,
      guests.map((guest) => guest.storageGb),
    ),
  };
}

function summarizeCapacity(
  total: number | undefined,
  values: Array<number | undefined>,
) {
  const allocated = values.reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0,
  );
  const safeTotal = total ?? 0;
  const ratio =
    safeTotal > 0
      ? Math.min(100, Math.round((allocated / safeTotal) * 100))
      : 0;
  const overcommit = safeTotal > 0 && allocated > safeTotal;
  return {
    total: safeTotal,
    allocated,
    ratio,
    overcommit,
  };
}

function CapacityMeter({
  label,
  unit,
  total,
  allocated,
  ratio,
  overcommit,
}: {
  label: string;
  unit: string;
  total: number;
  allocated: number;
  ratio: number;
  overcommit: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
          {label}
        </div>
        <div
          className={`text-[11px] ${overcommit ? "text-[var(--color-err)]" : "text-[var(--color-fg-subtle)]"}`}
        >
          {formatCapacity(allocated)} /{" "}
          {total > 0 ? formatCapacity(total) : "—"} {unit}
        </div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-bg-3)]">
        <div
          className={`h-full rounded-full ${overcommit ? "bg-[var(--color-err)]" : "bg-[var(--color-accent)]"}`}
          style={{ width: `${Math.min(100, ratio)}%` }}
        />
      </div>
    </div>
  );
}

function formatCapacity(value: number) {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, "");
}
