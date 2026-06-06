import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TopBar } from "@/components/layout/TopBar";
import {
  Card,
  CardHeader,
  CardTitle,
  CardLabel,
  CardHeading,
  CardBody,
} from "@/components/ui/Card";
import { Mono } from "@/components/shared/Mono";
import { ColorInput } from "@/components/shared/ColorInput";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SortableHeader } from "@/components/shared/SortableHeader";
import {
  canEditInventory,
  createCable,
  deleteCable,
  updateCable,
  useStore,
} from "@/lib/store";
import type { Device, Port, PortLink } from "@/lib/types";
import {
  formatPortEndpointLabel,
  formatPortLabel,
  normalizeColorToCss,
} from "@/lib/utils";
import {
  ArrowRight,
  Cable as CableIcon,
  Filter,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  applySortDirection,
  compareLength,
  compareText,
  toggleSort,
  type SortState,
} from "@/lib/sort";
import { useI18n } from "@/i18n";

interface CableFormState {
  fromPortId: string;
  toPortId: string;
  cableType: string;
  cableLength: string;
  color: string;
  notes: string;
}

type CableSortKey = "from" | "to" | "type" | "length" | "color";

const EMPTY_FORM: CableFormState = {
  fromPortId: "",
  toPortId: "",
  cableType: "",
  cableLength: "",
  color: "",
  notes: "",
};

export default function CableView() {
  const { t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const portLinks = useStore((s) => s.portLinks);
  const ports = useStore((s) => s.ports);
  const devices = useStore((s) => s.devices);
  const canEdit = canEditInventory(currentUser);
  const [query, setQuery] = useState("");
  const [cableType, setCableType] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<CableSortKey>>({
    key: "from",
    direction: "asc",
  });
  const [createForm, setCreateForm] = useState<CableFormState>(EMPTY_FORM);
  const [selectedLinkId, setSelectedLinkId] = useState<string>();
  const [editForm, setEditForm] = useState({
    fromPortId: "",
    toPortId: "",
    cableType: "",
    cableLength: "",
    color: "",
    notes: "",
  });
  const [createError, setCreateError] = useState("");
  const [editError, setEditError] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const portById = useMemo(() => {
    return ports.reduce<Record<string, Port>>((acc, port) => {
      acc[port.id] = port;
      return acc;
    }, {});
  }, [ports]);

  const deviceById = useMemo(() => {
    return devices.reduce<Record<string, Device>>((acc, device) => {
      acc[device.id] = device;
      return acc;
    }, {});
  }, [devices]);

  const filtered = useMemo(() => {
    return [...portLinks]
      .filter((link) => {
        if (cableType && link.cableType !== cableType) return false;
        if (!query) return true;
        const fromPort = portById[link.fromPortId];
        const toPort = portById[link.toPortId];
        const fromDev = fromPort ? deviceById[fromPort.deviceId] : undefined;
        const toDev = toPort ? deviceById[toPort.deviceId] : undefined;
        const haystack = [
          fromDev?.hostname,
          toDev?.hostname,
          fromPort?.name,
          toPort?.name,
          link.cableType,
          link.color,
          link.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
      .sort((a, b) => compareCables(a, b, sort, portById, deviceById));
  }, [cableType, deviceById, portById, portLinks, query, sort]);

  const byType = useMemo(() => {
    return portLinks.reduce<Record<string, number>>((acc, link) => {
      const key = link.cableType ?? "Unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  }, [portLinks]);

  const linkedPortIds = useMemo(() => {
    const ids = new Set<string>();
    for (const link of portLinks) {
      ids.add(link.fromPortId);
      ids.add(link.toPortId);
    }
    return ids;
  }, [portLinks]);

  const availablePorts = useMemo(() => {
    return [...ports]
      .filter((port) => !linkedPortIds.has(port.id))
      .sort((a, b) =>
        portOptionLabel(a, deviceById).localeCompare(
          portOptionLabel(b, deviceById),
        ),
      );
  }, [deviceById, linkedPortIds, ports]);

  const selectedLink = selectedLinkId
    ? portLinks.find((link) => link.id === selectedLinkId)
    : undefined;
  const selectedEndpointPortIds = useMemo(
    () =>
      new Set(
        selectedLink ? [selectedLink.fromPortId, selectedLink.toPortId] : [],
      ),
    [selectedLink],
  );
  const editAvailablePorts = useMemo(() => {
    return [...ports]
      .filter(
        (port) =>
          !linkedPortIds.has(port.id) || selectedEndpointPortIds.has(port.id),
      )
      .sort((a, b) =>
        portOptionLabel(a, deviceById).localeCompare(
          portOptionLabel(b, deviceById),
        ),
      );
  }, [deviceById, linkedPortIds, ports, selectedEndpointPortIds]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedLinkId(undefined);
      return;
    }
    if (selectedLinkId && filtered.some((link) => link.id === selectedLinkId)) {
      return;
    }
    setSelectedLinkId(filtered[0].id);
  }, [filtered, selectedLinkId]);

  useEffect(() => {
    if (!selectedLink) {
      setEditForm({
        fromPortId: "",
        toPortId: "",
        cableType: "",
        cableLength: "",
        color: "",
        notes: "",
      });
      setEditError("");
      return;
    }

    setEditForm({
      fromPortId: selectedLink.fromPortId,
      toPortId: selectedLink.toPortId,
      cableType: selectedLink.cableType ?? "",
      cableLength: selectedLink.cableLength ?? "",
      color: selectedLink.color ?? "",
      notes: selectedLink.notes ?? "",
    });
    setEditError("");
  }, [selectedLink]);

  async function handleCreateCable() {
    setCreating(true);
    setCreateError("");
    try {
      const created = await createCable({
        fromPortId: createForm.fromPortId,
        toPortId: createForm.toPortId,
        cableType: createForm.cableType.trim() || undefined,
        cableLength: createForm.cableLength.trim() || undefined,
        color: createForm.color.trim() || undefined,
        notes: createForm.notes.trim() || undefined,
      });
      setCreateForm(EMPTY_FORM);
      setSelectedLinkId(created.id);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create cable.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveCable() {
    if (!selectedLink) return;

    setSaving(true);
    setEditError("");
    try {
      await updateCable(selectedLink.id, {
        fromPortId: editForm.fromPortId,
        toPortId: editForm.toPortId,
        cableType: editForm.cableType.trim() || undefined,
        cableLength: editForm.cableLength.trim() || undefined,
        color: editForm.color.trim() || undefined,
        notes: editForm.notes.trim() || undefined,
      });
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Failed to update cable.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCable(id: string) {
    setDeletingId(id);
    setEditError("");
    try {
      await deleteCable(id);
      setSelectedLinkId((current) => (current === id ? undefined : current));
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Failed to delete cable.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  function handleSort(key: CableSortKey) {
    setSort((current) => toggleSort(current, key));
  }

  return (
    <>
      <TopBar
        subtitle="Connections"
        title={t("Cables")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {portLinks.length} cables | {Object.keys(byType).length} types
          </span>
        }
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-12 gap-4">
          <Card className="col-span-12 xl:col-span-5">
            <CardHeader>
              <CardTitle>
                <CardLabel>Create</CardLabel>
                <CardHeading>Patch a new cable</CardHeading>
              </CardTitle>
              <Badge tone="cyan">{availablePorts.length} free ports</Badge>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="From port">
                  <Select
                    value={createForm.fromPortId}
                    onChange={(value) =>
                      setCreateForm((prev) => ({ ...prev, fromPortId: value }))
                    }
                  >
                    <option value="">Select a port</option>
                    {availablePorts.map((port) => (
                      <option key={port.id} value={port.id}>
                        {portOptionLabel(port, deviceById)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="To port">
                  <Select
                    value={createForm.toPortId}
                    onChange={(value) =>
                      setCreateForm((prev) => ({ ...prev, toPortId: value }))
                    }
                  >
                    <option value="">Select a port</option>
                    {availablePorts
                      .filter((port) => port.id !== createForm.fromPortId)
                      .map((port) => (
                        <option key={port.id} value={port.id}>
                          {portOptionLabel(port, deviceById)}
                        </option>
                      ))}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Cable type">
                  <Input
                    value={createForm.cableType}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        cableType: e.target.value,
                      }))
                    }
                    placeholder="Cat6a, DAC, OM4..."
                  />
                </Field>
                <Field label="Length">
                  <Input
                    value={createForm.cableLength}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        cableLength: e.target.value,
                      }))
                    }
                    placeholder="0.5m, 3m..."
                  />
                </Field>
                <Field label="Color">
                  <ColorInput
                    value={createForm.color}
                    onChange={(value) =>
                      setCreateForm((prev) => ({ ...prev, color: value }))
                    }
                    placeholder="#4a78c4 or blue"
                  />
                </Field>
              </div>

              <Field label="Notes">
                <textarea
                  value={createForm.notes}
                  onChange={(e) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      notes: e.target.value,
                    }))
                  }
                  rows={3}
                  className="rk-control rk-textarea w-full text-sm"
                />
              </Field>

              {createError && (
                <div className="text-xs text-[var(--color-err)]">
                  {createError}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={
                    creating ||
                    !createForm.fromPortId ||
                    !createForm.toPortId ||
                    !canEdit
                  }
                  onClick={() => void handleCreateCable()}
                >
                  <Plus className="size-3.5" />
                  {creating ? "Creating..." : "Create cable"}
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card className="col-span-12 xl:col-span-7">
            <CardHeader>
              <CardTitle>
                <CardLabel>Inspector</CardLabel>
                <CardHeading>
                  {selectedLink ? "Selected cable" : "Select a cable"}
                </CardHeading>
              </CardTitle>
              {selectedLink && (
                <Badge>{selectedLink.cableType ?? "Cable"}</Badge>
              )}
            </CardHeader>
            <CardBody>
              {!selectedLink ? (
                <div className="rk-empty">
                  <div className="rk-empty-title">Select a cable</div>
                  <div className="rk-empty-copy">
                    Pick a cable from the inventory table to edit its metadata.
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rk-panel-inset rounded-[var(--radius-md)] p-3">
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                      Endpoints
                    </div>
                    <CableEndpoints
                      link={selectedLink}
                      portById={portById}
                      deviceById={deviceById}
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="From port">
                      <Select
                        value={editForm.fromPortId}
                        onChange={(value) =>
                          setEditForm((prev) => ({
                            ...prev,
                            fromPortId: value,
                          }))
                        }
                      >
                        {editAvailablePorts
                          .filter((port) => port.id !== editForm.toPortId)
                          .map((port) => (
                            <option key={port.id} value={port.id}>
                              {portOptionLabel(port, deviceById)}
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Field label="To port">
                      <Select
                        value={editForm.toPortId}
                        onChange={(value) =>
                          setEditForm((prev) => ({
                            ...prev,
                            toPortId: value,
                          }))
                        }
                      >
                        {editAvailablePorts
                          .filter((port) => port.id !== editForm.fromPortId)
                          .map((port) => (
                            <option key={port.id} value={port.id}>
                              {portOptionLabel(port, deviceById)}
                            </option>
                          ))}
                      </Select>
                    </Field>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Cable type">
                      <Input
                        value={editForm.cableType}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            cableType: e.target.value,
                          }))
                        }
                        placeholder="Cat6a, DAC, OM4..."
                      />
                    </Field>
                    <Field label="Length">
                      <Input
                        value={editForm.cableLength}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            cableLength: e.target.value,
                          }))
                        }
                        placeholder="0.5m, 3m..."
                      />
                    </Field>
                    <Field label="Color">
                      <ColorInput
                        value={editForm.color}
                        onChange={(value) =>
                          setEditForm((prev) => ({ ...prev, color: value }))
                        }
                        placeholder="#4a78c4 or blue"
                      />
                    </Field>
                  </div>

                  <Field label="Notes">
                    <textarea
                      value={editForm.notes}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          notes: e.target.value,
                        }))
                      }
                      rows={3}
                      className="rk-control rk-textarea w-full text-sm"
                    />
                  </Field>

                  {editError && (
                    <div className="text-xs text-[var(--color-err)]">
                      {editError}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    {canEdit && (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deletingId === selectedLink.id}
                        onClick={() => void handleDeleteCable(selectedLink.id)}
                      >
                        <Trash2 className="size-3.5" />
                        {deletingId === selectedLink.id
                          ? "Removing..."
                          : "Delete cable"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={
                        saving ||
                        !canEdit ||
                        !editForm.fromPortId ||
                        !editForm.toPortId
                      }
                      onClick={() => void handleSaveCable()}
                    >
                      <Save className="size-3.5" />
                      {saving ? "Saving..." : "Save changes"}
                    </Button>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCableType(null)}
            className={`rounded-[var(--radius-xs)] border px-2.5 py-1 transition-colors ${
              cableType === null
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
            }`}
          >
            <span className="font-mono text-[10px] uppercase tracking-wider">
              All
            </span>
            <Mono className="ml-2 text-[10px]">{portLinks.length}</Mono>
          </button>
          {Object.entries(byType).map(([type, count]) => (
            <button
              key={type}
              onClick={() => setCableType(type)}
              className={`rounded-[var(--radius-xs)] border px-2.5 py-1 transition-colors ${
                cableType === type
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                  : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
              }`}
            >
              <span className="font-mono text-[10px] uppercase tracking-wider">
                {type}
              </span>
              <Mono className="ml-2 text-[10px]">{count}</Mono>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative max-w-md flex-1">
            <Filter className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-faint)]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by device, port, type, color..."
              className="pl-7"
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <CardLabel>Inventory</CardLabel>
              <CardHeading>{filtered.length} cables</CardHeading>
            </CardTitle>
            <CableIcon className="size-4 text-[var(--color-fg-subtle)]" />
          </CardHeader>
          <CardBody className="p-0">
            <div className="rk-table-shell border-0 rounded-none">
              <table className="rk-table">
                <thead>
                  <tr>
                    <SortableHeader sortKey="from" sort={sort} onSort={handleSort}>
                      From
                    </SortableHeader>
                    <Th />
                    <SortableHeader sortKey="to" sort={sort} onSort={handleSort}>
                      To
                    </SortableHeader>
                    <SortableHeader sortKey="type" sort={sort} onSort={handleSort}>
                      Type
                    </SortableHeader>
                    <SortableHeader
                      sortKey="length"
                      sort={sort}
                      onSort={handleSort}
                    >
                      Length
                    </SortableHeader>
                    <SortableHeader
                      sortKey="color"
                      sort={sort}
                      onSort={handleSort}
                    >
                      Color
                    </SortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((link) => {
                    const fromPort = portById[link.fromPortId];
                    const toPort = portById[link.toPortId];
                    const fromDev = fromPort
                      ? deviceById[fromPort.deviceId]
                      : undefined;
                    const toDev = toPort
                      ? deviceById[toPort.deviceId]
                      : undefined;
                    const isSelected = link.id === selectedLinkId;
                    return (
                      <tr
                        key={link.id}
                        onClick={() => setSelectedLinkId(link.id)}
                        data-selected={isSelected}
                        className="cursor-pointer"
                      >
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs">{fromDev?.hostname}</span>
                            <span className="text-[var(--color-fg-faint)]">
                              :
                            </span>
                            <Mono className="text-[var(--color-cyan)]">
                              {fromPort?.name}
                            </Mono>
                          </div>
                        </Td>
                        <Td className="w-px">
                          <ArrowRight className="size-3 text-[var(--color-fg-subtle)]" />
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs">{toDev?.hostname}</span>
                            <span className="text-[var(--color-fg-faint)]">
                              :
                            </span>
                            <Mono className="text-[var(--color-cyan)]">
                              {toPort?.name}
                            </Mono>
                          </div>
                        </Td>
                        <Td>
                          <Badge>{link.cableType ?? "Unknown"}</Badge>
                        </Td>
                        <Td>
                          <Mono className="text-[var(--color-fg-muted)]">
                            {link.cableLength ?? "-"}
                          </Mono>
                        </Td>
                        <Td>
                          {link.color ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="size-2.5 rounded-[1px] border border-[var(--color-line-strong)]"
                                style={{
                                  backgroundColor:
                                    normalizeColorToCss(link.color) ??
                                    "#7a7a7a",
                                }}
                              />
                              <span className="font-mono text-[11px] capitalize text-[var(--text-secondary)]">
                                {link.color}
                              </span>
                            </span>
                          ) : (
                            <span className="text-[var(--color-fg-faint)]">
                              -
                            </span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-[var(--color-fg-subtle)]">
                  No cables match your filter.
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Th({ children }: { children?: ReactNode }) {
  return <th>{children}</th>;
}

function Td({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={className}>{children}</td>;
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
      onChange={(e) => onChange(e.target.value)}
      className="rk-control h-8 w-full px-2 text-sm text-[var(--text-primary)]"
    >
      {children}
    </select>
  );
}

function CableEndpoints({
  link,
  portById,
  deviceById,
}: {
  link: PortLink;
  portById: Record<string, Port>;
  deviceById: Record<string, Device>;
}) {
  const fromPort = portById[link.fromPortId];
  const toPort = portById[link.toPortId];
  const fromDevice = fromPort ? deviceById[fromPort.deviceId] : undefined;
  const toDevice = toPort ? deviceById[toPort.deviceId] : undefined;

  return (
    <div className="inline-flex items-center gap-1.5 text-xs">
      <span>{fromDevice?.hostname ?? "Unknown device"}</span>
      <span className="text-[var(--color-fg-faint)]">:</span>
      <Mono className="text-[var(--color-cyan)]">
        {formatPortLabel(fromPort, { includeFace: true })}
      </Mono>
      <ArrowRight className="size-3 text-[var(--color-fg-subtle)]" />
      <span>{toDevice?.hostname ?? "Unknown device"}</span>
      <span className="text-[var(--color-fg-faint)]">:</span>
      <Mono className="text-[var(--color-cyan)]">
        {formatPortLabel(toPort, { includeFace: true })}
      </Mono>
    </div>
  );
}

function portOptionLabel(port: Port, deviceById: Record<string, Device>) {
  const device = deviceById[port.deviceId];
  return formatPortEndpointLabel(port, device, {
    includeFace: true,
    includeSpeed: true,
  });
}

function compareCables(
  a: PortLink,
  b: PortLink,
  sort: SortState<CableSortKey>,
  portById: Record<string, Port>,
  deviceById: Record<string, Device>,
) {
  let result = 0;
  if (sort.key === "from") {
    result = compareText(
      cableEndpointLabel(a.fromPortId, portById, deviceById),
      cableEndpointLabel(b.fromPortId, portById, deviceById),
    );
  } else if (sort.key === "to") {
    result = compareText(
      cableEndpointLabel(a.toPortId, portById, deviceById),
      cableEndpointLabel(b.toPortId, portById, deviceById),
    );
  } else if (sort.key === "type") {
    result = compareText(a.cableType ?? "Unknown", b.cableType ?? "Unknown");
  } else if (sort.key === "length") {
    result = compareLength(a.cableLength, b.cableLength);
  } else {
    result = compareText(a.color, b.color);
  }

  if (result === 0) {
    result = compareText(
      cableEndpointLabel(a.fromPortId, portById, deviceById),
      cableEndpointLabel(b.fromPortId, portById, deviceById),
    );
  }
  return applySortDirection(result, sort.direction);
}

function cableEndpointLabel(
  portId: string,
  portById: Record<string, Port>,
  deviceById: Record<string, Device>,
) {
  const port = portById[portId];
  const device = port ? deviceById[port.deviceId] : undefined;
  return `${device?.hostname ?? ""}:${port?.name ?? ""}`;
}
