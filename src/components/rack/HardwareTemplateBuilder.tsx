import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Check,
  Copy,
  MousePointer2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import {
  deviceTypeChainIncludes,
  deviceTypeLineage,
  localizedDeviceTypeIdLabel,
} from "@/lib/device-types";
import {
  createHardwareModule,
  createStarterTemplate,
  HARDWARE_TEMPLATE_STARTERS,
  MODULE_PRIMITIVES,
  movePhysicalPortSlot,
  replacePortBlock,
  safeId,
  type HardwareModulePrimitive,
  type PortBlockDefinition,
  type PortBlockDirection,
} from "@/lib/hardware-template-builder";
import { upsertPhysicalLayoutRecord, useStore } from "@/lib/store";
import type {
  DeviceTypeDefinition,
  HardwareTemplateDefault,
  HardwareTemplateV1,
  PhysicalLayoutPreview,
  PortKind,
  RackFace,
} from "@/lib/types";
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
import { PhysicalPortSlotEditor } from "./PhysicalPortSlotEditor";

const NEW_TEMPLATE = "__new_hardware_template__";

const EMPTY_BLOCK: PortBlockDefinition = {
  id: "ports",
  face: "rear",
  connector: "rj45",
  count: 4,
  rows: 1,
  columns: 4,
  start: 1,
  direction: "left-to-right",
  x: 110,
  y: 100,
  width: 500,
  height: 80,
};

interface HardwareTemplateBuilderProps {
  selectedDeviceType?: string;
  deviceTypes: DeviceTypeDefinition[];
}

export function HardwareTemplateBuilder({
  selectedDeviceType,
  deviceTypes,
}: HardwareTemplateBuilderProps) {
  const { t } = useI18n();
  const devices = useStore((state) => state.devices);
  const [templates, setTemplates] = useState<HardwareTemplateV1[]>([]);
  const [defaults, setDefaults] = useState<HardwareTemplateDefault[]>([]);
  const [selectedId, setSelectedId] = useState(NEW_TEMPLATE);
  const [starterId, setStarterId] = useState("server-2u");
  const [draft, setDraft] = useState(() => createStarterTemplate("server-2u"));
  const [face, setFace] = useState<RackFace>("rear");
  const [selectedSlotId, setSelectedSlotId] = useState<string>();
  const [block, setBlock] = useState<PortBlockDefinition>(EMPTY_BLOCK);
  const [modulePrimitive, setModulePrimitive] =
    useState<HardwareModulePrimitive>("nic");
  const [moduleSlotId, setModuleSlotId] = useState("rear-module-a");
  const [moduleIds, setModuleIds] = useState<string[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [bulkPreviews, setBulkPreviews] = useState<PhysicalLayoutPreview[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const selectedTemplate = templates.find(
    (template) => template.id === selectedId,
  );
  const editable = !selectedTemplate?.builtIn;
  const compatibleDevices = useMemo(
    () =>
      selectedDeviceType
        ? devices.filter((device) =>
            deviceTypeChainIncludes(
              device.deviceType,
              selectedDeviceType,
              deviceTypes,
            ),
          )
        : [],
    [deviceTypes, devices, selectedDeviceType],
  );
  const exactDefault = defaults.find(
    (entry) => entry.deviceType === selectedDeviceType,
  );
  const defaultLineage = selectedDeviceType
    ? deviceTypeLineage(selectedDeviceType, deviceTypes)
    : [];
  const currentDefault = defaultLineage
    .map((deviceType) =>
      defaults.find((entry) => entry.deviceType === deviceType),
    )
    .find((entry): entry is HardwareTemplateDefault => Boolean(entry));
  const inheritedDefaultSource =
    currentDefault && currentDefault.deviceType !== selectedDeviceType
      ? currentDefault.deviceType
      : undefined;

  async function refreshTemplates(preferredId?: string) {
    const response = await api.getHardwareTemplates();
    setTemplates(response.templates);
    setDefaults(response.defaults);
    if (preferredId) {
      const preferred = response.templates.find(
        (template) => template.id === preferredId,
      );
      if (preferred) {
        setSelectedId(preferred.id);
        setDraft(structuredClone(preferred));
        setModuleSlotId(preferred.moduleSlots[0]?.id ?? "");
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    void api
      .getHardwareTemplates()
      .then((response) => {
        if (cancelled) return;
        setTemplates(response.templates);
        setDefaults(response.defaults);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : t("Failed to create device type."),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    setSelectedDeviceIds([]);
    setBulkPreviews([]);
  }, [selectedDeviceType, selectedId]);

  function selectTemplate(id: string) {
    setSelectedId(id);
    setBulkPreviews([]);
    if (id === NEW_TEMPLATE) {
      const next = createStarterTemplate(starterId);
      if (selectedDeviceType) next.deviceTypes = [selectedDeviceType];
      setDraft(next);
      setModuleSlotId(next.moduleSlots[0]?.id ?? "");
      return;
    }
    const template = templates.find((entry) => entry.id === id);
    if (template) {
      setDraft(structuredClone(template));
      setModuleSlotId(template.moduleSlots[0]?.id ?? "");
      setModuleIds([]);
    }
  }

  function selectStarter(id: string) {
    setStarterId(id);
    setSelectedId(NEW_TEMPLATE);
    const next = createStarterTemplate(id);
    if (selectedDeviceType) next.deviceTypes = [selectedDeviceType];
    setDraft(next);
    setModuleSlotId(next.moduleSlots[0]?.id ?? "");
    setSelectedSlotId(undefined);
    setBulkPreviews([]);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const normalized = {
        ...draft,
        id: safeId(draft.id),
        name: draft.name.trim(),
        builtIn: undefined,
      };
      const saved =
        selectedTemplate && !selectedTemplate.builtIn
          ? await api.updateHardwareTemplate(selectedTemplate.id, normalized)
          : await api.createHardwareTemplate(normalized);
      await refreshTemplates(saved.id);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t("Failed to save port template."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate() {
    if (!selectedTemplate) return;
    setSaving(true);
    setError("");
    try {
      const id = safeId(`${selectedTemplate.id}-copy`);
      const copy = await api.duplicateHardwareTemplate(selectedTemplate.id, {
        id,
        name: `${selectedTemplate.name} copy`,
      });
      await refreshTemplates(copy.id);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t("Failed to save port template."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedTemplate || selectedTemplate.builtIn) return;
    if (!window.confirm(t("Delete template"))) return;
    setSaving(true);
    setError("");
    try {
      await api.deleteHardwareTemplate(selectedTemplate.id);
      selectTemplate(NEW_TEMPLATE);
      await refreshTemplates();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t("Failed to delete port template."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDefault() {
    if (!selectedDeviceType || selectedId === NEW_TEMPLATE) return;
    setSaving(true);
    setError("");
    try {
      const assigned = await api.setHardwareTemplateDefault(
        selectedDeviceType,
        selectedId,
      );
      setDefaults((current) => [
        ...current.filter((entry) => entry.deviceType !== selectedDeviceType),
        assigned,
      ]);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t("Failed to save port template."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDefaultReset() {
    if (!selectedDeviceType || !exactDefault) return;
    setSaving(true);
    setError("");
    try {
      await api.clearHardwareTemplateDefault(selectedDeviceType);
      setDefaults((current) =>
        current.filter((entry) => entry.deviceType !== selectedDeviceType),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t("Failed to save port template."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkPreview() {
    if (selectedId === NEW_TEMPLATE || selectedDeviceIds.length === 0) return;
    setLoading(true);
    setError("");
    try {
      const response = await api.bulkPreviewPhysicalLayouts({
        deviceIds: selectedDeviceIds,
        templateId: selectedId,
        moduleIds,
      });
      setBulkPreviews(response.previews);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t("Applying the preview failed."),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkApply() {
    if (bulkPreviews.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const response = await api.bulkApplyPhysicalLayouts(bulkPreviews);
      for (const layout of response.layouts) upsertPhysicalLayoutRecord(layout);
      setBulkPreviews([]);
      setSelectedDeviceIds([]);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : t("Applying the preview failed."),
      );
    } finally {
      setSaving(false);
    }
  }

  const selectedSlot = draft.portSlots.find(
    (slot) => slot.id === selectedSlotId,
  );
  const bulkBlocked = bulkPreviews.some(
    (preview) =>
      preview.conflicts.length > 0 || preview.linkedUnmappedPortIds.length > 0,
  );

  return (
    <Card data-testid="hardware-template-builder">
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("Hardware")}</CardLabel>
          <CardHeading>{t("Template library")}</CardHeading>
        </CardTitle>
        <Badge tone="accent">
          <Boxes className="size-3" />
          {t("Studio Beta")}
        </Badge>
      </CardHeader>
      <CardBody className="space-y-5">
        {error && (
          <div
            role="alert"
            className="rounded-[var(--radius-sm)] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]"
          >
            {error}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <Field label={t("Templates")}>
              <select
                className="rk-control h-8 w-full px-2.5 text-sm"
                value={selectedId}
                onChange={(event) => selectTemplate(event.target.value)}
              >
                <option value={NEW_TEMPLATE}>{t("New template")}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Type")}>
              <select
                className="rk-control h-8 w-full px-2.5 text-sm"
                value={starterId}
                onChange={(event) => selectStarter(event.target.value)}
              >
                {HARDWARE_TEMPLATE_STARTERS.map((starter) => (
                  <option key={starter.id} value={starter.id}>
                    {starter.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("Name")}>
              <Input
                disabled={!editable}
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label={t("ID")}>
              <Input
                disabled={Boolean(selectedTemplate)}
                className="font-mono"
                value={draft.id}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    id: event.target.value,
                  }))
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("Device type")}>
                <select
                  disabled={!editable}
                  className="rk-control h-8 w-full px-2 text-sm"
                  value={draft.deviceTypes[0] ?? "other"}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      deviceTypes: [event.target.value],
                    }))
                  }
                >
                  {deviceTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Height (U)")}>
                <Input
                  disabled={!editable}
                  type="number"
                  min={1}
                  max={100}
                  value={draft.mountDefaults.heightU}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      mountDefaults: {
                        ...current.mountDefaults,
                        heightU: Number(event.target.value),
                      },
                    }))
                  }
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              {editable && (
                <Button
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={saving}
                >
                  <Save />
                  {saving ? t("Saving...") : t("Save template")}
                </Button>
              )}
              {selectedTemplate && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDuplicate()}
                  disabled={saving}
                >
                  <Copy />
                  {t("Duplicate")}
                </Button>
              )}
              {selectedTemplate && !selectedTemplate.builtIn && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void handleDelete()}
                  disabled={saving}
                >
                  <Trash2 />
                  {t("Delete")}
                </Button>
              )}
            </div>
            {selectedDeviceType && selectedId !== NEW_TEMPLATE && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={
                    currentDefault?.templateId === selectedId
                      ? "secondary"
                      : "outline"
                  }
                  onClick={() => void handleDefault()}
                  disabled={saving}
                >
                  <Check />
                  {t("Apply template")}
                </Button>
                {exactDefault ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleDefaultReset()}
                    disabled={saving}
                  >
                    {t("Reset")}
                  </Button>
                ) : null}
                {inheritedDefaultSource ? (
                  <Badge tone="neutral">
                    {t("Parent")}: {localizedDeviceTypeIdLabel(
                      inheritedDefaultSource,
                      deviceTypes,
                      t,
                    )}
                  </Badge>
                ) : null}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {(["front", "rear"] as const).map((entry) => (
                  <Button
                    key={entry}
                    size="sm"
                    variant={face === entry ? "secondary" : "outline"}
                    onClick={() => setFace(entry)}
                  >
                    {entry === "front" ? t("Front") : t("Rear")}
                  </Button>
                ))}
              </div>
              <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                <MousePointer2 className="size-3.5" />
                {t("Position")}
              </span>
            </div>
            <PhysicalPortSlotEditor
              layout={draft}
              face={face}
              selectedSlotId={selectedSlotId}
              onSelectSlot={setSelectedSlotId}
              onMoveSlot={(slotId, x, y) =>
                editable &&
                setDraft((current) =>
                  movePhysicalPortSlot(current, slotId, x, y),
                )
              }
            />
            {selectedSlot && (
              <div className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] p-3 sm:grid-cols-4">
                <Field label={t("Port")}>
                  <Input
                    value={selectedSlot.label ?? selectedSlot.id}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        portSlots: current.portSlots.map((slot) =>
                          slot.id === selectedSlot.id
                            ? { ...slot, label: event.target.value }
                            : slot,
                        ),
                      }))
                    }
                  />
                </Field>
                <Field label={t("Position")}>
                  <Input
                    type="number"
                    value={selectedSlot.x}
                    onChange={(event) =>
                      setDraft((current) =>
                        movePhysicalPortSlot(
                          current,
                          selectedSlot.id,
                          Number(event.target.value),
                          selectedSlot.y,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={t("Position")}>
                  <Input
                    type="number"
                    value={selectedSlot.y}
                    onChange={(event) =>
                      setDraft((current) =>
                        movePhysicalPortSlot(
                          current,
                          selectedSlot.id,
                          selectedSlot.x,
                          Number(event.target.value),
                        ),
                      )
                    }
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        portSlots: current.portSlots.filter(
                          (slot) => slot.id !== selectedSlot.id,
                        ),
                      }))
                    }
                  >
                    <Trash2 />
                    {t("Delete port")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {editable && (
          <div className="grid gap-4 border-t border-[var(--border-default)] pt-5 xl:grid-cols-2">
            <section className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] p-3">
              <div className="rk-kicker">{t("Port layout")}</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t("ID")}>
                  <Input
                    value={block.id}
                    onChange={(event) =>
                      setBlock((current) => ({
                        ...current,
                        id: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label={t("Face")}>
                  <select
                    className="rk-control h-8 w-full px-2 text-sm"
                    value={block.face}
                    onChange={(event) =>
                      setBlock((current) => ({
                        ...current,
                        face: event.target.value as RackFace,
                      }))
                    }
                  >
                    <option value="front">{t("Front")}</option>
                    <option value="rear">{t("Rear")}</option>
                  </select>
                </Field>
                <Field label={t("Type")}>
                  <select
                    className="rk-control h-8 w-full px-2 text-sm"
                    value={block.connector}
                    onChange={(event) =>
                      setBlock((current) => ({
                        ...current,
                        connector: event.target.value as PortKind,
                      }))
                    }
                  >
                    {[
                      "rj45",
                      "sfp",
                      "sfp_plus",
                      "qsfp",
                      "fiber",
                      "power",
                      "console",
                      "usb",
                      "sff",
                      "other",
                    ].map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("Ports")}>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={block.count}
                    onChange={(event) =>
                      setBlock((current) => ({
                        ...current,
                        count: Number(event.target.value),
                      }))
                    }
                  />
                </Field>
                <Field label={t("Columns")}>
                  <Input
                    type="number"
                    min={1}
                    max={64}
                    value={block.columns}
                    onChange={(event) =>
                      setBlock((current) => ({
                        ...current,
                        columns: Number(event.target.value),
                      }))
                    }
                  />
                </Field>
                <Field label={t("Height (U)")}>
                  <Input
                    type="number"
                    min={1}
                    max={64}
                    value={block.rows}
                    onChange={(event) =>
                      setBlock((current) => ({
                        ...current,
                        rows: Number(event.target.value),
                      }))
                    }
                  />
                </Field>
                <Field label={t("Start port")}>
                  <Input
                    type="number"
                    min={0}
                    value={block.start}
                    onChange={(event) =>
                      setBlock((current) => ({
                        ...current,
                        start: Number(event.target.value),
                      }))
                    }
                  />
                </Field>
                <Field label={t("Position")}>
                  <select
                    className="rk-control h-8 w-full px-2 text-sm"
                    value={block.direction}
                    onChange={(event) =>
                      setBlock((current) => ({
                        ...current,
                        direction: event.target.value as PortBlockDirection,
                      }))
                    }
                  >
                    {[
                      "left-to-right",
                      "right-to-left",
                      "vertical",
                      "serpentine",
                    ].map((direction) => (
                      <option key={direction} value={direction}>
                        {direction}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setDraft((current) => replacePortBlock(current, block));
                  setFace(block.face);
                }}
              >
                <Plus />
                {t("Add port")}
              </Button>
            </section>

            <section className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] p-3">
              <div className="rk-kicker">{t("Hardware")}</div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label={t("Type")}>
                  <select
                    className="rk-control h-8 w-full px-2 text-sm"
                    value={modulePrimitive}
                    onChange={(event) =>
                      setModulePrimitive(
                        event.target.value as HardwareModulePrimitive,
                      )
                    }
                  >
                    {MODULE_PRIMITIVES.map((primitive) => (
                      <option key={primitive} value={primitive}>
                        {primitive}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("Position")}>
                  <select
                    className="rk-control h-8 w-full px-2 text-sm"
                    value={moduleSlotId}
                    onChange={(event) => setModuleSlotId(event.target.value)}
                  >
                    {draft.moduleSlots.map((slot) => (
                      <option key={slot.id} value={slot.id}>
                        {slot.id}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    size="sm"
                    disabled={!moduleSlotId}
                    onClick={() => {
                      const id = safeId(
                        `${modulePrimitive}-${draft.modules.length + 1}`,
                      );
                      setDraft((current) => ({
                        ...current,
                        modules: [
                          ...current.modules,
                          createHardwareModule(
                            id,
                            modulePrimitive,
                            moduleSlotId,
                            modulePrimitive,
                            modulePrimitive === "nic" ? 2 : 1,
                          ),
                        ],
                      }));
                    }}
                  >
                    <Plus />
                    {t("Add")}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {draft.modules.map((module) => (
                  <Badge key={module.id} tone="neutral">
                    {module.name} · {module.slotId}
                  </Badge>
                ))}
                {draft.modules.length === 0 && (
                  <span className="text-xs text-[var(--text-muted)]">
                    {t("None")}
                  </span>
                )}
              </div>
            </section>
          </div>
        )}

        {selectedDeviceType &&
          selectedId !== NEW_TEMPLATE &&
          compatibleDevices.length > 0 && (
            <section
              className="space-y-3 border-t border-[var(--border-default)] pt-5"
              data-testid="hardware-template-bulk-assignment"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="rk-kicker">{t("Bulk edit devices")}</div>
                  <div className="text-sm font-medium">{t("Assignments")}</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelectedDeviceIds(
                      selectedDeviceIds.length === compatibleDevices.length
                        ? []
                        : compatibleDevices.map((device) => device.id),
                    )
                  }
                >
                  {selectedDeviceIds.length === compatibleDevices.length
                    ? t("Clear")
                    : t("Select all")}
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {compatibleDevices.map((device) => (
                  <label
                    key={device.id}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDeviceIds.includes(device.id)}
                      onChange={(event) =>
                        setSelectedDeviceIds((current) =>
                          event.target.checked
                            ? [...current, device.id]
                            : current.filter((id) => id !== device.id),
                        )
                      }
                    />
                    <span className="truncate">{device.hostname}</span>
                  </label>
                ))}
              </div>
              {draft.modules.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {draft.modules.map((module) => (
                    <label
                      key={module.id}
                      className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={moduleIds.includes(module.id)}
                        onChange={(event) =>
                          setModuleIds((current) =>
                            event.target.checked
                              ? [
                                  ...current.filter(
                                    (id) =>
                                      draft.modules.find(
                                        (entry) => entry.id === id,
                                      )?.slotId !== module.slotId,
                                  ),
                                  module.id,
                                ]
                              : current.filter((id) => id !== module.id),
                          )
                        }
                      />
                      {module.name}
                    </label>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading || selectedDeviceIds.length === 0}
                  onClick={() => void handleBulkPreview()}
                >
                  {t("Preview")}
                </Button>
                {bulkPreviews.length > 0 && (
                  <Button
                    size="sm"
                    disabled={saving || bulkBlocked}
                    onClick={() => void handleBulkApply()}
                  >
                    {t("Apply")} · {bulkPreviews.length}
                  </Button>
                )}
                {bulkPreviews.length > 0 && (
                  <Badge tone={bulkBlocked ? "warn" : "ok"}>
                    {bulkPreviews.reduce(
                      (count, preview) =>
                        count + preview.comparison.preservedBindingCount,
                      0,
                    )}{" "}
                    · {t("Ports linked")}
                  </Badge>
                )}
              </div>
            </section>
          )}
      </CardBody>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}
