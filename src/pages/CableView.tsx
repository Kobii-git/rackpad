import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Cable } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/shared/EmptyState";
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
  bulkUpdateCables,
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
  X,
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

interface BulkCableForm {
  cableType: string;
  cableLength: string;
  color: string;
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

const EMPTY_BULK_FORM: BulkCableForm = {
  cableType: "",
  cableLength: "",
  color: "",
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
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkFields, setBulkFields] = useState<Set<keyof BulkCableForm>>(
    new Set(),
  );
  const [bulkForm, setBulkForm] = useState<BulkCableForm>(EMPTY_BULK_FORM);
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
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState("");

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
  const allFilteredSelected =
    filtered.length > 0 &&
    filtered.every((link) => selectedLinkIds.has(link.id));
  const selectedLinkCount = selectedLinkIds.size;

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
  const selectedLinkIsLogical = selectedLink
    ? isLogicalAggregateLink(selectedLink, portById)
    : false;
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
    const linkIds = new Set(portLinks.map((link) => link.id));
    setSelectedLinkIds((current) => {
      const next = new Set(
        [...current].filter((linkId) => linkIds.has(linkId)),
      );
      return next.size === current.size &&
        [...next].every((linkId) => current.has(linkId))
        ? current
        : next;
    });
  }, [portLinks]);

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

  function toggleLinkSelection(linkId: string) {
    setSelectedLinkIds((current) => {
      const next = new Set(current);
      if (next.has(linkId)) next.delete(linkId);
      else next.add(linkId);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelectedLinkIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        for (const link of filtered) next.delete(link.id);
      } else {
        for (const link of filtered) next.add(link.id);
      }
      return next;
    });
  }

  function toggleBulkField(field: keyof BulkCableForm) {
    setBulkFields((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function handleBulkSave() {
    if (selectedLinkIds.size === 0 || bulkFields.size === 0) return;
    const changes: {
      cableType?: string | null;
      cableLength?: string | null;
      color?: string | null;
    } = {};
    if (bulkFields.has("cableType")) {
      changes.cableType = bulkForm.cableType.trim() || null;
    }
    if (bulkFields.has("cableLength")) {
      changes.cableLength = bulkForm.cableLength.trim() || null;
    }
    if (bulkFields.has("color")) {
      changes.color = bulkForm.color.trim() || null;
    }

    setBulkSaving(true);
    setBulkError("");
    try {
      await bulkUpdateCables({
        linkIds: [...selectedLinkIds],
        changes,
      });
      setSelectedLinkIds(new Set());
      setBulkFields(new Set());
      setBulkForm(EMPTY_BULK_FORM);
    } catch (error) {
      setBulkError(
        error instanceof Error
          ? error.message
          : t("Something went wrong. Try again."),
      );
    } finally {
      setBulkSaving(false);
    }
  }

  function handleSort(key: CableSortKey) {
    setSort((current) => toggleSort(current, key));
  }

  return (
    <>
      <TopBar
        subtitle={t("Connections")}
        title={t("Cables")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {portLinks.length} {t("cables |")}
            {Object.keys(byType).length} {t("types")}
          </span>
        }
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-12 gap-4">
          <Card className="col-span-12 xl:col-span-5">
            <CardHeader>
              <CardTitle>
                <CardLabel>{t("Create")}</CardLabel>
                <CardHeading>{t("Patch a new cable")}</CardHeading>
              </CardTitle>
              <Badge tone="cyan">
                {availablePorts.length} {t("free ports")}
              </Badge>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t("From port")}>
                  <Select
                    value={createForm.fromPortId}
                    onChange={(value) =>
                      setCreateForm((prev) => ({ ...prev, fromPortId: value }))
                    }
                  >
                    <option value="">{t("Select a port")}</option>
                    {availablePorts.map((port) => (
                      <option key={port.id} value={port.id}>
                        {portOptionLabel(port, deviceById)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("To port")}>
                  <Select
                    value={createForm.toPortId}
                    onChange={(value) =>
                      setCreateForm((prev) => ({ ...prev, toPortId: value }))
                    }
                  >
                    <option value="">{t("Select a port")}</option>
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
                <Field label={t("Cable type")}>
                  <Input
                    value={createForm.cableType}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        cableType: e.target.value,
                      }))
                    }
                    placeholder={t("Cat6a, DAC, OM4...")}
                  />
                </Field>
                <Field label={t("Length")}>
                  <Input
                    value={createForm.cableLength}
                    onChange={(e) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        cableLength: e.target.value,
                      }))
                    }
                    placeholder={t("0.5m, 3m...")}
                  />
                </Field>
                <Field label={t("Color")}>
                  <ColorInput
                    value={createForm.color}
                    onChange={(value) =>
                      setCreateForm((prev) => ({ ...prev, color: value }))
                    }
                    placeholder={t("#4a78c4 or blue")}
                  />
                </Field>
              </div>

              <Field label={t("Notes")}>
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
                  {creating ? t("Creating...") : t("Create cable")}
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card className="col-span-12 xl:col-span-7">
            <CardHeader>
              <CardTitle>
                <CardLabel>{t("Inspector")}</CardLabel>
                <CardHeading>
                  {selectedLink ? t("Selected cable") : t("Select a cable")}
                </CardHeading>
              </CardTitle>
              {selectedLink && (
                <div className="flex items-center gap-1.5">
                  {selectedLinkIsLogical && (
                    <Badge>{t("Aggregate port")}</Badge>
                  )}
                  <Badge>{selectedLink.cableType ?? t("Cable")}</Badge>
                </div>
              )}
            </CardHeader>
            <CardBody>
              {!selectedLink ? (
                <EmptyState
                  icon={Cable}
                  title={t("Select a cable")}
                  description={t(
                    "Pick a cable from the inventory table to edit its metadata.",
                  )}
                />
              ) : (
                <div className="space-y-4">
                  <div className="rk-panel-inset rounded-[var(--radius-md)] p-3">
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                      {t("Endpoints")}
                    </div>
                    <CableEndpoints
                      link={selectedLink}
                      portById={portById}
                      deviceById={deviceById}
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label={t("From port")}>
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
                    <Field label={t("To port")}>
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
                    <Field label={t("Cable type")}>
                      <Input
                        value={editForm.cableType}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            cableType: e.target.value,
                          }))
                        }
                        placeholder={t("Cat6a, DAC, OM4...")}
                      />
                    </Field>
                    <Field label={t("Length")}>
                      <Input
                        value={editForm.cableLength}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            cableLength: e.target.value,
                          }))
                        }
                        placeholder={t("0.5m, 3m...")}
                      />
                    </Field>
                    <Field label={t("Color")}>
                      <ColorInput
                        value={editForm.color}
                        onChange={(value) =>
                          setEditForm((prev) => ({ ...prev, color: value }))
                        }
                        placeholder={t("#4a78c4 or blue")}
                      />
                    </Field>
                  </div>

                  <Field label={t("Notes")}>
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
                          ? t("Removing...")
                          : t("Delete cable")}
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
                      {saving ? t("Saving...") : t("Save changes")}
                    </Button>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {canEdit && selectedLinkCount > 0 && (
          <Card data-testid="cable-bulk-editor">
            <CardHeader>
              <CardTitle>
                <CardLabel>{t("Bulk edit")}</CardLabel>
                <CardHeading>
                  {selectedLinkCount} {t("selected")}
                </CardHeading>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                disabled={bulkSaving}
                onClick={() => setSelectedLinkIds(new Set())}
              >
                <X className="size-3.5" />
                {t("Clear")}
              </Button>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <BulkCableField
                  label={t("Cable type")}
                  checked={bulkFields.has("cableType")}
                  disabled={bulkSaving}
                  checkboxTestId="bulk-cable-type-enabled"
                  onChecked={() => toggleBulkField("cableType")}
                >
                  <Input
                    value={bulkForm.cableType}
                    disabled={!bulkFields.has("cableType") || bulkSaving}
                    onChange={(event) =>
                      setBulkForm((current) => ({
                        ...current,
                        cableType: event.target.value,
                      }))
                    }
                    placeholder={t("Cat6a, DAC, OM4...")}
                    data-testid="bulk-cable-type"
                  />
                </BulkCableField>
                <BulkCableField
                  label={t("Length")}
                  checked={bulkFields.has("cableLength")}
                  disabled={bulkSaving}
                  checkboxTestId="bulk-cable-length-enabled"
                  onChecked={() => toggleBulkField("cableLength")}
                >
                  <Input
                    value={bulkForm.cableLength}
                    disabled={!bulkFields.has("cableLength") || bulkSaving}
                    onChange={(event) =>
                      setBulkForm((current) => ({
                        ...current,
                        cableLength: event.target.value,
                      }))
                    }
                    placeholder={t("0.5m, 3m...")}
                    data-testid="bulk-cable-length"
                  />
                </BulkCableField>
                <BulkCableField
                  label={t("Color")}
                  checked={bulkFields.has("color")}
                  disabled={bulkSaving}
                  checkboxTestId="bulk-cable-color-enabled"
                  onChecked={() => toggleBulkField("color")}
                >
                  <div data-testid="bulk-cable-color">
                    <ColorInput
                      value={bulkForm.color}
                      disabled={!bulkFields.has("color") || bulkSaving}
                      onChange={(color) =>
                        setBulkForm((current) => ({ ...current, color }))
                      }
                      placeholder={t("#4a78c4 or blue")}
                    />
                  </div>
                </BulkCableField>
              </div>

              {bulkError && (
                <div className="text-xs text-[var(--color-err)]" role="alert">
                  {bulkError}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={bulkSaving || bulkFields.size === 0}
                  onClick={() => void handleBulkSave()}
                  data-testid="bulk-cable-apply"
                >
                  <Save className="size-3.5" />
                  {bulkSaving ? t("Saving...") : t("Apply changes")}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

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
              {t("All")}
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
              placeholder={t("Search by device, port, type, color...")}
              className="pl-7"
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <CardLabel>{t("Inventory")}</CardLabel>
              <CardHeading>
                {filtered.length} {t("cables")}
              </CardHeading>
            </CardTitle>
            <CableIcon className="size-4 text-[var(--color-fg-subtle)]" />
          </CardHeader>
          <CardBody className="p-0">
            <div className="rk-table-shell border-0 rounded-none">
              <table className="rk-table">
                <thead>
                  <tr>
                    {canEdit && (
                      <Th>
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleAllFiltered}
                          aria-label={t("All")}
                          data-testid="cable-select-all"
                        />
                      </Th>
                    )}
                    <SortableHeader
                      sortKey="from"
                      sort={sort}
                      onSort={handleSort}
                    >
                      {t("From")}
                    </SortableHeader>
                    <Th />
                    <SortableHeader
                      sortKey="to"
                      sort={sort}
                      onSort={handleSort}
                    >
                      {t("To")}
                    </SortableHeader>
                    <SortableHeader
                      sortKey="type"
                      sort={sort}
                      onSort={handleSort}
                    >
                      {t("Type")}
                    </SortableHeader>
                    <SortableHeader
                      sortKey="length"
                      sort={sort}
                      onSort={handleSort}
                    >
                      {t("Length")}
                    </SortableHeader>
                    <SortableHeader
                      sortKey="color"
                      sort={sort}
                      onSort={handleSort}
                    >
                      {t("Color")}
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
                    const isBulkSelected = selectedLinkIds.has(link.id);
                    return (
                      <tr
                        key={link.id}
                        onClick={() => setSelectedLinkId(link.id)}
                        data-selected={isSelected}
                        data-bulk-selected={isBulkSelected || undefined}
                        className="cursor-pointer"
                      >
                        {canEdit && (
                          <Td className="w-px">
                            <input
                              type="checkbox"
                              checked={isBulkSelected}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleLinkSelection(link.id)}
                              aria-label={t("{from} to {to}", {
                                from: `${fromDev?.hostname ?? link.fromPortId}:${fromPort?.name ?? link.fromPortId}`,
                                to: `${toDev?.hostname ?? link.toPortId}:${toPort?.name ?? link.toPortId}`,
                              })}
                              data-testid={`cable-select-${link.id}`}
                            />
                          </Td>
                        )}
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
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isLogicalAggregateLink(link, portById) && (
                              <Badge>{t("Aggregate port")}</Badge>
                            )}
                            <Badge>{link.cableType ?? t("Unknown")}</Badge>
                          </div>
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
                  {t("No cables match your filter.")}
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

function BulkCableField({
  label,
  checked,
  disabled,
  checkboxTestId,
  onChecked,
  children,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  checkboxTestId: string;
  onChecked: () => void;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onChecked}
          data-testid={checkboxTestId}
        />
        <span className="rk-field-label mb-0">{label}</span>
      </span>
      {children}
    </label>
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
  const { t } = useI18n();
  const fromPort = portById[link.fromPortId];
  const toPort = portById[link.toPortId];
  const fromDevice = fromPort ? deviceById[fromPort.deviceId] : undefined;
  const toDevice = toPort ? deviceById[toPort.deviceId] : undefined;

  return (
    <div className="inline-flex items-center gap-1.5 text-xs">
      <span>{fromDevice?.hostname ?? t("Unknown device")}</span>
      <span className="text-[var(--color-fg-faint)]">:</span>
      <Mono className="text-[var(--color-cyan)]">
        {formatPortLabel(fromPort, { includeFace: true })}
      </Mono>
      <ArrowRight className="size-3 text-[var(--color-fg-subtle)]" />
      <span>{toDevice?.hostname ?? t("Unknown device")}</span>
      <span className="text-[var(--color-fg-faint)]">:</span>
      <Mono className="text-[var(--color-cyan)]">
        {formatPortLabel(toPort, { includeFace: true })}
      </Mono>
    </div>
  );
}

function portOptionLabel(port: Port, deviceById: Record<string, Device>) {
  const device = deviceById[port.deviceId];
  const label = formatPortEndpointLabel(port, device, {
    includeFace: true,
    includeSpeed: true,
  });
  return port.portRole === "aggregate" ? `${label} (bond)` : label;
}

function isLogicalAggregateLink(
  link: PortLink,
  portById: Record<string, Port>,
) {
  return (
    portById[link.fromPortId]?.portRole === "aggregate" ||
    portById[link.toPortId]?.portRole === "aggregate"
  );
}

function compareCables(
  a: PortLink,
  b: PortLink,
  sort: SortState<CableSortKey>,
  portById: Record<string, Port>,
  deviceById: Record<string, Device>,
) {
  let result: number;
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
