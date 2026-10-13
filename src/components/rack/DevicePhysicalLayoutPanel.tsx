import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Pencil, RefreshCcw } from "lucide-react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { deviceTypeMatchesTemplate } from "@/lib/device-types";
import type {
  Device,
  DeviceTypeDefinition,
  DevicePhysicalLayout,
  HardwareTemplateV1,
  PhysicalLayoutPreview,
  Port,
  PortLink,
  ResolvedPhysicalLayoutV1,
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
import { PhysicalFaceplate } from "./PhysicalFaceplate";
import { PhysicalPortSlotEditor } from "./PhysicalPortSlotEditor";

interface DevicePhysicalLayoutPanelProps {
  device: Device;
  ports: Port[];
  allPorts: Port[];
  portLinks: PortLink[];
  devices: Device[];
  deviceTypes: DeviceTypeDefinition[];
  canEdit: boolean;
  initialLayout?: DevicePhysicalLayout;
  onLayoutChange?: (layout: DevicePhysicalLayout) => void;
  onInventoryReload?: () => Promise<void>;
}

export function DevicePhysicalLayoutPanel({
  device,
  ports,
  allPorts,
  portLinks,
  devices,
  deviceTypes,
  canEdit,
  initialLayout,
  onLayoutChange,
  onInventoryReload,
}: DevicePhysicalLayoutPanelProps) {
  const { t } = useI18n();
  const physicalPorts = useMemo(
    () =>
      ports.filter(
        (port) =>
          port.portRole !== "aggregate" &&
          port.kind !== "virtual" &&
          port.kind !== "wifi",
      ),
    [ports],
  );
  const [layout, setLayout] = useState(initialLayout);
  const [templates, setTemplates] = useState<HardwareTemplateV1[]>([]);
  const [templateId, setTemplateId] = useState(
    initialLayout?.sourceTemplateId ?? "generic-auto-v1",
  );
  const [preview, setPreview] = useState<PhysicalLayoutPreview>();
  const [moduleIds, setModuleIds] = useState<string[]>([]);
  const [customSnapshot, setCustomSnapshot] =
    useState<ResolvedPhysicalLayoutV1>();
  const [customFace, setCustomFace] = useState<"front" | "rear">("rear");
  const [selectedSlotId, setSelectedSlotId] = useState<string>();
  const [approvedPortSlotIds, setApprovedPortSlotIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(!initialLayout);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(!initialLayout);
    void Promise.all([
      api.getPhysicalLayout(device.id),
      api.getHardwareTemplates(),
    ])
      .then(([nextLayout, templateResponse]) => {
        if (cancelled) return;
        setLayout(nextLayout);
        setTemplateId(nextLayout.sourceTemplateId ?? "generic-auto-v1");
        setModuleIds(nextLayout.snapshot.moduleIds ?? []);
        setTemplates(templateResponse.templates);
        setError("");
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Failed to load physical layout.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [device.id, initialLayout]);

  const linkedPortIds = useMemo(() => {
    const ids = new Set<string>();
    for (const link of portLinks) {
      ids.add(link.fromPortId);
      ids.add(link.toPortId);
    }
    return ids;
  }, [portLinks]);
  const portById = useMemo(
    () => new Map(allPorts.map((port) => [port.id, port])),
    [allPorts],
  );
  const deviceById = useMemo(
    () => new Map(devices.map((entry) => [entry.id, entry])),
    [devices],
  );

  function connectionLabel(portId: string) {
    const link = portLinks.find(
      (entry) => entry.fromPortId === portId || entry.toPortId === portId,
    );
    if (!link) return undefined;
    const peerId = link.fromPortId === portId ? link.toPortId : link.fromPortId;
    const peer = portById.get(peerId);
    if (!peer) return undefined;
    const peerDevice = deviceById.get(peer.deviceId);
    return `${peerDevice?.hostname ?? peer.deviceId} · ${peer.name}`;
  }

  async function handlePreview() {
    setLoading(true);
    setError("");
    try {
      const activeCustomSnapshot =
        customSnapshot ??
        (templateId === "device-custom-v1" ? layout?.snapshot : undefined);
      setPreview(
        await api.previewPhysicalLayout(
          device.id,
          activeCustomSnapshot
            ? {
                customSnapshot: activeCustomSnapshot,
                preserveBindings: true,
              }
            : {
                templateId,
                moduleIds,
                preserveBindings: true,
              },
        ),
      );
      setApprovedPortSlotIds([]);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to preview physical layout.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setSaving(true);
    setError("");
    try {
      const activeCustomSnapshot =
        customSnapshot ??
        (preview.templateId === "device-custom-v1"
          ? preview.snapshot
          : undefined);
      const saved = await api.applyPhysicalLayout(device.id, {
        templateId:
          preview.templateId === "device-custom-v1"
            ? undefined
            : preview.templateId,
        portFingerprint: preview.portFingerprint,
        moduleIds: preview.moduleIds,
        bindings: preview.bindings,
        approvedPortSlotIds,
        preserveBindings: true,
        ...(preview.templateId === "device-custom-v1" && activeCustomSnapshot
          ? { customSnapshot: activeCustomSnapshot }
          : {}),
      });
      setLayout(saved);
      setTemplateId(saved.sourceTemplateId ?? "generic-auto-v1");
      setModuleIds(saved.snapshot.moduleIds ?? []);
      setPreview(undefined);
      setCustomSnapshot(undefined);
      onLayoutChange?.(saved);
      await onInventoryReload?.();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to apply physical layout.",
      );
    } finally {
      setSaving(false);
    }
  }

  const displayedLayout = preview
    ? ({
        snapshot: preview.snapshot,
        bindings: preview.bindings,
      } as DevicePhysicalLayout)
    : layout;
  const slotById = new Map(
    displayedLayout?.snapshot.portSlots.map((slot) => [slot.id, slot]) ?? [],
  );
  const bindingByPortId = new Map(
    displayedLayout?.bindings.map((binding) => [binding.portId, binding]) ?? [],
  );
  const status = layout?.effectiveStatus ?? layout?.status;
  const configured = status === "accurate";
  const compatibleTemplates = templates.filter(
    (template) =>
      deviceTypeMatchesTemplate(
        device.deviceType,
        template.deviceTypes,
        deviceTypes,
      ),
  );
  const selectedTemplate = compatibleTemplates.find(
    (template) => template.id === templateId,
  );

  function setPreviewBinding(portId: string, slotId: string) {
    setPreview((current) => {
      if (!current) return current;
      const bindings = current.bindings.filter(
        (binding) => binding.portId !== portId && binding.slotId !== slotId,
      );
      if (slotId) bindings.push({ portId, slotId });
      const unmappedPortIds = physicalPorts
        .filter(
          (port) => !bindings.some((binding) => binding.portId === port.id),
        )
        .map((port) => port.id);
      return {
        ...current,
        bindings,
        unmappedPortIds,
        linkedUnmappedPortIds: unmappedPortIds.filter((id) =>
          linkedPortIds.has(id),
        ),
      };
    });
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-12">
        <CardHeader>
          <CardTitle>
            <CardLabel>{t("Layout")}</CardLabel>
            <CardHeading>{t("Physical layout")}</CardHeading>
          </CardTitle>
          <Badge tone={configured ? "ok" : "warn"}>
            {configured ? (
              <Check className="size-3" />
            ) : (
              <AlertTriangle className="size-3" />
            )}
            {configured ? t("Configured") : t("Needs attention")}
          </Badge>
        </CardHeader>
        <CardBody className="space-y-4">
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
              <label className="min-w-64 flex-1 space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                  {t("Templates")}
                </span>
                <select
                  value={templateId}
                  onChange={(event) => {
                    setTemplateId(event.target.value);
                    setModuleIds([]);
                    setCustomSnapshot(undefined);
                    setPreview(undefined);
                    setApprovedPortSlotIds([]);
                  }}
                  className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-fg)]"
                >
                  {templateId === "device-custom-v1" && (
                    <option value="device-custom-v1">
                      {t("Custom template")}
                    </option>
                  )}
                  {compatibleTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handlePreview()}
                disabled={loading || !templateId}
              >
                <RefreshCcw className="size-3.5" />
                {t("Preview")}
              </Button>
              {layout && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCustomSnapshot(structuredClone(layout.snapshot));
                    setPreview(undefined);
                    setSelectedSlotId(undefined);
                  }}
                >
                  <Pencil className="size-3.5" />
                  {t("Edit")}
                </Button>
              )}
              {preview && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleApply()}
                  disabled={
                    saving ||
                    preview.conflicts.length > 0 ||
                    preview.linkedUnmappedPortIds.length > 0
                  }
                >
                  <Check className="size-3.5" />
                  {t("Apply")}
                </Button>
              )}
            </div>
          )}

          {canEdit && !customSnapshot && selectedTemplate?.modules.length ? (
            <div className="flex flex-wrap gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
              {selectedTemplate.modules.map((module) => (
                <label
                  key={module.id}
                  className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={moduleIds.includes(module.id)}
                    onChange={(event) => {
                      setModuleIds((current) =>
                        event.target.checked
                          ? [
                              ...current.filter(
                                (id) =>
                                  selectedTemplate.modules.find(
                                    (entry) => entry.id === id,
                                  )?.slotId !== module.slotId,
                              ),
                              module.id,
                            ]
                          : current.filter((id) => id !== module.id),
                      );
                      setPreview(undefined);
                    }}
                  />
                  <span>{module.name}</span>
                  <span className="font-mono text-[10px] text-[var(--color-fg-subtle)]">
                    {module.slotId}
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          {canEdit && customSnapshot && (
            <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  {(["front", "rear"] as const).map((entry) => (
                    <Button
                      key={entry}
                      type="button"
                      size="sm"
                      variant={customFace === entry ? "secondary" : "outline"}
                      onClick={() => setCustomFace(entry)}
                    >
                      {entry === "front" ? t("Front") : t("Rear")}
                    </Button>
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCustomSnapshot(undefined);
                    setSelectedSlotId(undefined);
                  }}
                >
                  {t("Cancel")}
                </Button>
              </div>
              <PhysicalPortSlotEditor
                layout={customSnapshot}
                face={customFace}
                selectedSlotId={selectedSlotId}
                onSelectSlot={setSelectedSlotId}
                onMoveSlot={(slotId, x, y) =>
                  setCustomSnapshot((current) =>
                    current
                      ? {
                          ...current,
                          portSlots: current.portSlots.map((slot) =>
                            slot.id === slotId
                              ? {
                                  ...slot,
                                  x: Math.max(
                                    0,
                                    Math.min(
                                      1000 - slot.width,
                                      Math.round(x * 100) / 100,
                                    ),
                                  ),
                                  y: Math.max(
                                    0,
                                    Math.min(
                                      current.faces[slot.face].height -
                                        slot.height,
                                      Math.round(y * 100) / 100,
                                    ),
                                  ),
                                }
                              : slot,
                          ),
                        }
                      : current,
                  )
                }
              />
            </div>
          )}

          {error && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          )}

          {preview && preview.unmappedPortIds.length > 0 && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--color-warning)]">
              {t("Needs attention")}: {preview.unmappedPortIds.length}{" "}
              {t("Ports")}
            </div>
          )}

          {preview && preview.linkedUnmappedPortIds.length > 0 && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
              {t("Ports linked")}: {preview.linkedUnmappedPortIds.length} ·{" "}
              {t("Needs attention")}
            </div>
          )}

          {preview && (
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">
                {preview.comparison.preservedBindingCount} · {t("Configured")}
              </Badge>
              {preview.comparison.addedSlotIds.length > 0 && (
                <Badge tone="accent">
                  +{preview.comparison.addedSlotIds.length} · {t("Ports")}
                </Badge>
              )}
              {preview.comparison.removedSlotIds.length > 0 && (
                <Badge tone="warn">
                  −{preview.comparison.removedSlotIds.length} · {t("Ports")}
                </Badge>
              )}
            </div>
          )}

          {preview && preview.portsToCreate.length > 0 && (
            <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                {t("Add")} · {t("Ports")}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {preview.portsToCreate.map((proposal) => (
                  <label
                    key={proposal.slotId}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-fg)]"
                  >
                    <input
                      type="checkbox"
                      checked={approvedPortSlotIds.includes(proposal.slotId)}
                      onChange={(event) => {
                        setApprovedPortSlotIds((current) =>
                          event.target.checked
                            ? [...current, proposal.slotId]
                            : current.filter((id) => id !== proposal.slotId),
                        );
                      }}
                    />
                    <span className="min-w-0 truncate">
                      {proposal.name} · {proposal.kind} · {proposal.face}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {displayedLayout && (
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                  {t("Front")}
                </div>
                <PhysicalFaceplate
                  layout={displayedLayout}
                  face="front"
                  ports={physicalPorts}
                  linkedPortIds={linkedPortIds}
                  connectionLabel={connectionLabel}
                />
              </div>
              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                  {t("Rear")}
                </div>
                <PhysicalFaceplate
                  layout={displayedLayout}
                  face="rear"
                  ports={physicalPorts}
                  linkedPortIds={linkedPortIds}
                  connectionLabel={connectionLabel}
                />
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="col-span-12">
        <CardHeader>
          <CardTitle>
            <CardLabel>{t("Ports")}</CardLabel>
            <CardHeading>{device.hostname}</CardHeading>
          </CardTitle>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--color-line)] font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
              <tr>
                <th className="px-4 py-2">{t("Port")}</th>
                <th className="px-4 py-2">{t("Face")}</th>
                <th className="px-4 py-2">{t("Status")}</th>
                <th className="px-4 py-2">{t("Connected")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {physicalPorts.map((port) => {
                const binding = bindingByPortId.get(port.id);
                const slot = binding ? slotById.get(binding.slotId) : undefined;
                return (
                  <tr key={port.id}>
                    <td className="px-4 py-2 font-mono text-[var(--color-fg)]">
                      {port.name}
                    </td>
                    <td className="px-4 py-2 text-[var(--color-fg-subtle)]">
                      {slot?.face ?? port.face ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      {preview ? (
                        <select
                          className="h-8 min-w-44 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-fg)]"
                          value={binding?.slotId ?? ""}
                          onChange={(event) =>
                            setPreviewBinding(port.id, event.target.value)
                          }
                        >
                          <option value="">{t("None")}</option>
                          {preview.snapshot.portSlots
                            .filter(
                              (candidate) =>
                                candidate.face ===
                                  (port.face === "rear" ? "rear" : "front") &&
                                candidate.acceptedPortKinds.includes(
                                  port.kind,
                                ) &&
                                (!preview.bindings.some(
                                  (entry) =>
                                    entry.slotId === candidate.id &&
                                    entry.portId !== port.id,
                                ) ||
                                  candidate.id === binding?.slotId),
                            )
                            .map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.label ?? candidate.id}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <Badge tone={binding ? "ok" : "warn"}>
                          {binding ? t("Configured") : t("Needs attention")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[var(--color-fg-subtle)]">
                      {connectionLabel(port.id) ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
