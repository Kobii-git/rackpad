import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { X, Save, Network, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Separator } from "@/components/ui/Separator";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { createDevice, updateDevice, useStore } from "@/lib/store";
import type { Device, DeviceStatus, DeviceType, RackFace } from "@/lib/types";

const DEVICE_TYPES: DeviceType[] = [
  "switch",
  "router",
  "firewall",
  "server",
  "rack_shelf",
  "ap",
  "endpoint",
  "vm",
  "storage",
  "patch_panel",
  "brush_panel",
  "blanking_panel",
  "pdu",
  "ups",
  "kvm",
  "other",
];

const STATUS_OPTIONS: DeviceStatus[] = [
  "online",
  "offline",
  "warning",
  "maintenance",
  "unknown",
];

interface FormState {
  hostname: string;
  displayName: string;
  deviceType: DeviceType;
  manufacturer: string;
  model: string;
  serial: string;
  managementIp: string;
  status: DeviceStatus;
  placement: NonNullable<Device["placement"]>;
  parentDeviceId: string;
  roomId: string;
  cpuCores: string;
  memoryGb: string;
  storageGb: string;
  specs: string;
  rackId: string;
  startU: string;
  heightU: string;
  face: RackFace;
  portTemplateId: string;
  tags: string;
  notes: string;
}

interface ShelfFormState {
  hostname: string;
  rackId: string;
  startU: string;
  heightU: string;
  face: RackFace;
}

function blankForm(defaults?: Partial<FormState>): FormState {
  return {
    hostname: "",
    displayName: "",
    deviceType: "server",
    manufacturer: "",
    model: "",
    serial: "",
    managementIp: "",
    status: "unknown",
    placement: defaults?.rackId ? "rack" : "room",
    parentDeviceId: "",
    roomId: "",
    cpuCores: "",
    memoryGb: "",
    storageGb: "",
    specs: "",
    rackId: "",
    startU: "",
    heightU: "1",
    face: "front",
    portTemplateId: "",
    tags: "",
    notes: "",
    ...defaults,
  };
}

function blankShelfForm(defaultRackId?: string): ShelfFormState {
  return {
    hostname: "",
    rackId: defaultRackId ?? "",
    startU: "",
    heightU: "1",
    face: "front",
  };
}

function deviceToForm(device: Device): FormState {
  return {
    hostname: device.hostname,
    displayName: device.displayName ?? "",
    deviceType: device.deviceType,
    manufacturer: device.manufacturer ?? "",
    model: device.model ?? "",
    serial: device.serial ?? "",
    managementIp: device.managementIp ?? "",
    status: device.status,
    placement: device.placement ?? (device.rackId ? "rack" : "room"),
    parentDeviceId: device.parentDeviceId ?? "",
    roomId: device.roomId ?? "",
    cpuCores: device.cpuCores != null ? String(device.cpuCores) : "",
    memoryGb: device.memoryGb != null ? String(device.memoryGb) : "",
    storageGb: device.storageGb != null ? String(device.storageGb) : "",
    specs: device.specs ?? "",
    rackId: device.rackId ?? "",
    startU: device.startU != null ? String(device.startU) : "",
    heightU: device.heightU != null ? String(device.heightU) : "1",
    face: device.face ?? "front",
    portTemplateId: "",
    tags: (device.tags ?? []).join(", "),
    notes: device.notes ?? "",
  };
}

interface DeviceDrawerProps {
  device?: Device;
  defaultRackId?: string;
  defaults?: Partial<FormState>;
  open: boolean;
  onClose: () => void;
  onSaved?: (device: Device) => void;
}

export function DeviceDrawer({
  device,
  defaultRackId,
  defaults,
  open,
  onClose,
  onSaved,
}: DeviceDrawerProps) {
  const racks = useStore((s) => s.racks);
  const rooms = useStore((s) => s.rooms);
  const devices = useStore((s) => s.devices);
  const ports = useStore((s) => s.ports);
  const portTemplates = useStore((s) => s.portTemplates);
  const isEdit = !!device;
  const [form, setForm] = useState<FormState>(() =>
    device
      ? deviceToForm(device)
      : blankForm({ rackId: defaultRackId ?? "", ...defaults }),
  );
  const [error, setError] = useState("");
  const [shelfError, setShelfError] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingShelf, setCreatingShelf] = useState(false);
  const [shelfForm, setShelfForm] = useState<ShelfFormState>(() =>
    blankShelfForm(defaultRackId),
  );

  useEffect(() => {
    if (open) {
      setForm(
        device
          ? deviceToForm(device)
          : blankForm({ rackId: defaultRackId ?? "", ...defaults }),
      );
      setError("");
      setShelfError("");
      setShelfForm(blankShelfForm(defaultRackId));
    }
  }, [defaultRackId, defaults, device, open]);

  const devicePortCount = useMemo(
    () =>
      device ? ports.filter((port) => port.deviceId === device.id).length : 0,
    [device, ports],
  );

  const canApplyTemplate = !device || devicePortCount === 0;
  const selectedTemplate = portTemplates.find(
    (template) => template.id === form.portTemplateId,
  );
  const compatibleTemplates = useMemo(
    () =>
      portTemplates.filter((template) =>
        template.deviceTypes.includes(form.deviceType),
      ),
    [form.deviceType, portTemplates],
  );
  const hasRackPlacement = form.placement === "rack";
  const parentCandidates = useMemo(() => {
    return devices
      .filter((entry) => !device || entry.id !== device.id)
      .filter((entry) => {
        if (form.placement === "wireless") return entry.deviceType === "ap";
        if (form.placement === "virtual") return entry.deviceType !== "vm";
        if (form.placement === "shelf") return entry.deviceType === "rack_shelf";
        return true;
      })
      .sort((a, b) => a.hostname.localeCompare(b.hostname));
  }, [device, devices, form.placement]);
  const showParentSelector =
    form.placement === "wireless" ||
    form.placement === "virtual" ||
    form.placement === "shelf";
  const parentLabel =
    form.placement === "wireless"
      ? "Connected AP"
      : form.placement === "shelf"
        ? "Rack shelf / tray"
        : "Host device";

  useEffect(() => {
    if (!form.portTemplateId) return;
    if (
      compatibleTemplates.some(
        (template) => template.id === form.portTemplateId,
      )
    )
      return;
    setForm((prev) => ({ ...prev, portTemplateId: "" }));
  }, [compatibleTemplates, form.portTemplateId]);

  useEffect(() => {
    if (form.placement === "rack") return;
    setForm((prev) => ({
      ...prev,
      rackId: "",
      startU: "",
      heightU: "1",
      face: "front",
    }));
  }, [form.placement]);

  useEffect(() => {
    if (form.deviceType !== "rack_shelf") return;
    if (form.placement === "rack") return;
    setForm((prev) => ({ ...prev, placement: "rack", parentDeviceId: "" }));
  }, [form.deviceType, form.placement]);

  useEffect(() => {
    if (showParentSelector) return;
    if (!form.parentDeviceId) return;
    setForm((prev) => ({ ...prev, parentDeviceId: "" }));
  }, [form.parentDeviceId, showParentSelector]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setShelf<K extends keyof ShelfFormState>(
    key: K,
    value: ShelfFormState[K],
  ) {
    setShelfForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreateShelf() {
    setShelfError("");

    const hostname = shelfForm.hostname.trim();
    const rackId = shelfForm.rackId.trim();
    const startU = Number.parseInt(shelfForm.startU, 10);
    const heightU = Number.parseInt(shelfForm.heightU, 10) || 1;

    if (!hostname) {
      setShelfError("Shelf hostname is required.");
      return;
    }
    if (!rackId) {
      setShelfError("Select the rack that contains this shelf / tray.");
      return;
    }
    if (!Number.isFinite(startU) || startU < 1) {
      setShelfError("Start U must be 1 or higher.");
      return;
    }

    setCreatingShelf(true);
    try {
      const created = await createDevice({
        hostname,
        deviceType: "rack_shelf",
        status: "unknown",
        placement: "rack",
        rackId,
        startU,
        heightU,
        face: shelfForm.face,
        tags: ["shelf"],
      });

      setForm((prev) => ({
        ...prev,
        placement: "shelf",
        parentDeviceId: created.id,
      }));
      setShelfForm(blankShelfForm(rackId));
    } catch (err) {
      setShelfError(
        err instanceof Error
          ? err.message
          : "Failed to create rack shelf / tray.",
      );
    } finally {
      setCreatingShelf(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (!form.hostname.trim()) {
      setError("Hostname is required.");
      return;
    }

    setSaving(true);
    try {
      const tags = form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

      const payload = {
        hostname: form.hostname.trim(),
        displayName: form.displayName.trim() || undefined,
        deviceType: form.deviceType,
        manufacturer: form.manufacturer.trim() || undefined,
        model: form.model.trim() || undefined,
        serial: form.serial.trim() || undefined,
        managementIp: form.managementIp.trim() || undefined,
        status: form.status,
        placement: form.placement,
        parentDeviceId:
          showParentSelector && form.parentDeviceId
            ? form.parentDeviceId
            : undefined,
        cpuCores: form.cpuCores.trim()
          ? Number.parseInt(form.cpuCores, 10)
          : undefined,
        memoryGb: form.memoryGb.trim()
          ? Number.parseFloat(form.memoryGb)
          : undefined,
        storageGb: form.storageGb.trim()
          ? Number.parseFloat(form.storageGb)
          : undefined,
        specs: form.specs.trim() || undefined,
        rackId: hasRackPlacement ? form.rackId : undefined,
        roomId: !hasRackPlacement && form.roomId ? form.roomId : undefined,
        startU:
          hasRackPlacement && form.startU
            ? Number.parseInt(form.startU, 10)
            : undefined,
        heightU: hasRackPlacement
          ? form.heightU
            ? Number.parseInt(form.heightU, 10)
            : 1
          : undefined,
        face: hasRackPlacement ? form.face : undefined,
        portTemplateId:
          canApplyTemplate && form.portTemplateId
            ? form.portTemplateId
            : undefined,
        tags: tags.length > 0 ? tags : undefined,
        notes: form.notes.trim() || undefined,
      };

      const saved =
        isEdit && device
          ? await updateDevice(device.id, payload)
          : await createDevice(payload);

      if (saved) {
        onSaved?.(saved);
        onClose();
      } else {
        setError("Failed to save device. Please try again.");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save device. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/40"
            onClick={onClose}
          />

          <motion.aside
            key="drawer-panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 z-40 flex h-full w-[460px] flex-col border-l border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--bg-shell)_94%,black_6%)]"
            style={{ boxShadow: "-16px 0 48px rgb(0 0 0 / 0.4)" }}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-5 py-3.5">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                  {isEdit ? "Edit" : "New"}
                </div>
                <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
                  {isEdit ? device.hostname : "Add device"}
                </h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close"
              >
                <X />
              </Button>
            </div>

            <form
              onSubmit={(event) => void handleSubmit(event)}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                <Section label="Identity">
                  <Field label="Hostname *">
                    <Input
                      value={form.hostname}
                      onChange={(event) => set("hostname", event.target.value)}
                      placeholder="e.g. core-sw-01"
                      autoFocus
                    />
                  </Field>
                  <Field label="Display name">
                    <Input
                      value={form.displayName}
                      onChange={(event) =>
                        set("displayName", event.target.value)
                      }
                      placeholder="e.g. Core Switch"
                    />
                  </Field>
                  <Field label="Device type">
                    <Select
                      value={form.deviceType}
                      onChange={(value) =>
                        set("deviceType", value as DeviceType)
                      }
                    >
                      {DEVICE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type.replace("_", " ")}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Status">
                    <div className="flex flex-wrap gap-1.5">
                      {STATUS_OPTIONS.map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => set("status", status)}
                          className={cn(
                            "rounded-[var(--radius-xs)] border px-2 py-1 font-mono text-[10px] uppercase tracking-wider capitalize transition-colors",
                            form.status === status
                              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                              : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]",
                          )}
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </Field>
                </Section>

                <Separator />

                <Section label="Hardware">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Manufacturer">
                      <Input
                        value={form.manufacturer}
                        onChange={(event) =>
                          set("manufacturer", event.target.value)
                        }
                        placeholder="e.g. Cisco"
                      />
                    </Field>
                    <Field label="Model">
                      <Input
                        value={form.model}
                        onChange={(event) => set("model", event.target.value)}
                        placeholder="e.g. C9300-48P"
                      />
                    </Field>
                  </div>
                  <Field label="Serial number">
                    <Input
                      value={form.serial}
                      onChange={(event) => set("serial", event.target.value)}
                      placeholder="e.g. FOC2134X0AB"
                    />
                  </Field>
                  <Field label="Management IP">
                    <Input
                      value={form.managementIp}
                      onChange={(event) =>
                        set("managementIp", event.target.value)
                      }
                      placeholder="e.g. 10.0.10.12"
                    />
                  </Field>
                </Section>

                <Separator />

                <Section label="Capacity & specs">
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="CPU cores">
                      <Input
                        type="number"
                        min={1}
                        value={form.cpuCores}
                        onChange={(event) =>
                          set("cpuCores", event.target.value)
                        }
                        placeholder="e.g. 8"
                      />
                    </Field>
                    <Field label="Memory (GB)">
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        value={form.memoryGb}
                        onChange={(event) =>
                          set("memoryGb", event.target.value)
                        }
                        placeholder="64"
                      />
                    </Field>
                    <Field label="Storage (GB)">
                      <Input
                        type="number"
                        min={0}
                        step="1"
                        value={form.storageGb}
                        onChange={(event) =>
                          set("storageGb", event.target.value)
                        }
                        placeholder="2000"
                      />
                    </Field>
                  </div>
                  <Field label="Specs">
                    <textarea
                      value={form.specs}
                      onChange={(event) => set("specs", event.target.value)}
                      placeholder="CPU generation, RAID layout, GPU, NIC details, or VM sizing notes..."
                      rows={3}
                      className="rk-control rk-textarea w-full text-sm font-sans"
                    />
                  </Field>
                </Section>

                <Separator />

                <Section label="Placement">
                  <Field label="Placement">
                    <Select
                      value={form.placement}
                      onChange={(value) =>
                        set("placement", value as FormState["placement"])
                      }
                    >
                      <option value="rack">Rack mounted</option>
                      <option value="room">Loose / room tech</option>
                      {form.deviceType !== "rack_shelf" && (
                        <option value="shelf">On rack shelf / tray</option>
                      )}
                      <option value="wireless">WiFi / AP linked</option>
                      <option value="virtual">Virtual / hosted</option>
                    </Select>
                  </Field>

                  {showParentSelector && (
                    <>
                      <Field label={parentLabel}>
                        <Select
                          value={form.parentDeviceId}
                          onChange={(value) => set("parentDeviceId", value)}
                        >
                          <option value="">
                            {form.placement === "wireless"
                              ? "-- no AP selected --"
                              : form.placement === "shelf"
                                ? "-- no rack shelf selected --"
                                : "-- no host selected --"}
                          </option>
                          {parentCandidates.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.hostname}
                            </option>
                          ))}
                        </Select>
                      </Field>

                      {form.placement === "shelf" && !form.parentDeviceId && (
                        <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--surface-1)] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold text-[var(--color-fg)]">
                                Need a shelf / tray first?
                              </div>
                              <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                                Create the rack shelf here, then this device can
                                be attached to it without closing the drawer.
                              </div>
                            </div>
                            <Badge tone="neutral">Rack device</Badge>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-3">
                            <Field label="Shelf hostname">
                              <Input
                                value={shelfForm.hostname}
                                onChange={(event) =>
                                  setShelf("hostname", event.target.value)
                                }
                                placeholder="e.g. cmp-shelf-u32"
                              />
                            </Field>
                            <Field label="Rack">
                              <Select
                                value={shelfForm.rackId}
                                onChange={(value) => setShelf("rackId", value)}
                              >
                                <option value="">Select rack</option>
                                {racks.map((rack) => (
                                  <option key={rack.id} value={rack.id}>
                                    {rack.name}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="Start U">
                              <Input
                                type="number"
                                min={1}
                                value={shelfForm.startU}
                                onChange={(event) =>
                                  setShelf("startU", event.target.value)
                                }
                                placeholder="e.g. 32"
                              />
                            </Field>
                            <Field label="Height (U)">
                              <Input
                                type="number"
                                min={1}
                                value={shelfForm.heightU}
                                onChange={(event) =>
                                  setShelf("heightU", event.target.value)
                                }
                              />
                            </Field>
                          </div>

                          <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
                            <Field label="Face">
                              <Select
                                value={shelfForm.face}
                                onChange={(value) =>
                                  setShelf("face", value as RackFace)
                                }
                              >
                                <option value="front">Front</option>
                                <option value="rear">Rear</option>
                              </Select>
                            </Field>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void handleCreateShelf()}
                              disabled={creatingShelf}
                            >
                              <Plus className="size-3.5" />
                              {creatingShelf ? "Creating..." : "Create shelf"}
                            </Button>
                          </div>

                          {shelfError && (
                            <div className="mt-3 rounded-[var(--radius-sm)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                              {shelfError}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {!hasRackPlacement && (
                    <Field label="Room">
                      <Select
                        value={form.roomId}
                        onChange={(value) => set("roomId", value)}
                      >
                        <option value="">-- no room selected --</option>
                        {rooms.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </Select>
                      {rooms.length === 0 && (
                        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                          Create rooms from the Racks workspace to group loose,
                          wireless, and shelf-adjacent gear.
                        </p>
                      )}
                    </Field>
                  )}
                </Section>

                <Separator />

                <Section label="Ports">
                  <Field label="Port template">
                    <Select
                      value={form.portTemplateId}
                      onChange={(value) => set("portTemplateId", value)}
                      disabled={!canApplyTemplate}
                    >
                      <option value="">No template</option>
                      {compatibleTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {!canApplyTemplate ? (
                    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-fg-subtle)]">
                      This device already has {devicePortCount} ports. Templates
                      can only be applied to empty devices.
                    </div>
                  ) : selectedTemplate ? (
                    <div className="rounded-[var(--radius-sm)] border border-[var(--color-accent-soft)]/30 bg-[var(--color-accent)]/5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                            Template preview
                          </div>
                          <div className="text-sm text-[var(--color-fg)]">
                            {selectedTemplate.description}
                          </div>
                        </div>
                        <Badge tone="accent">
                          <Network className="size-3" />
                          {selectedTemplate.ports.length} ports
                        </Badge>
                      </div>
                    </div>
                  ) : null}
                </Section>

                <Separator />

                <Section label="Rack placement">
                  <Field label="Rack">
                    <Select
                      value={form.rackId}
                      onChange={(value) => set("rackId", value)}
                    >
                      <option value="">-- unracked --</option>
                      {racks.map((rack) => (
                        <option key={rack.id} value={rack.id}>
                          {rack.name}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {hasRackPlacement && (
                    <div className="grid grid-cols-3 gap-3">
                      <Field label="Start U">
                        <Input
                          type="number"
                          min={1}
                          max={48}
                          value={form.startU}
                          onChange={(event) =>
                            set("startU", event.target.value)
                          }
                          placeholder="e.g. 12"
                        />
                      </Field>
                      <Field label="Height (U)">
                        <Input
                          type="number"
                          min={1}
                          max={12}
                          value={form.heightU}
                          onChange={(event) =>
                            set("heightU", event.target.value)
                          }
                          placeholder="1"
                        />
                      </Field>
                      <Field label="Face">
                        <Select
                          value={form.face}
                          onChange={(value) => set("face", value as RackFace)}
                        >
                          <option value="front">Front</option>
                          <option value="rear">Rear</option>
                        </Select>
                      </Field>
                    </div>
                  )}
                </Section>

                <Separator />

                <Section label="Metadata">
                  <Field label="Tags (comma-separated)">
                    <Input
                      value={form.tags}
                      onChange={(event) => set("tags", event.target.value)}
                      placeholder="e.g. core, managed, poe"
                    />
                  </Field>
                  <Field label="Notes">
                    <textarea
                      value={form.notes}
                      onChange={(event) => set("notes", event.target.value)}
                      placeholder="Any additional notes..."
                      rows={3}
                      className="rk-control rk-textarea w-full text-sm font-sans"
                    />
                  </Field>
                </Section>
              </div>

              <div className="border-t border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-1)_24%,transparent)] px-5 py-3">
                {error && (
                  <p className="mb-2 text-xs text-[var(--color-err)]">
                    {error}
                  </p>
                )}
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="default"
                    size="sm"
                    disabled={saving}
                  >
                    <Save className="size-3.5" />
                    {isEdit ? "Save changes" : "Add device"}
                  </Button>
                </div>
              </div>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="rk-kicker">{label}</div>
      {children}
    </div>
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
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={cn(
        "rk-control h-8 w-full px-2 text-sm font-sans",
        "text-[var(--text-primary)] capitalize",
      )}
    >
      {children}
    </select>
  );
}
