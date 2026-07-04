import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { EmptyState } from "@/components/shared/EmptyState";
import {
  createPortRecord,
  deletePortRecord,
  updatePort,
} from "@/lib/store";
import type { Device, Port, PortLink, VirtualSwitch, Vlan } from "@/lib/types";
import { Save, Trash2 } from "lucide-react";
import { formatPortLabel } from "@/lib/utils";

function formatVlanReference(vlanId: string, vlansById: Record<string, Vlan>) {
  const vlan = vlansById[vlanId];
  return vlan ? `${vlan.vlanId} - ${vlan.name}` : vlanId;
}

const LINK_STATES: Port["linkState"][] = ["up", "down", "disabled", "unknown"];
const LINK_STATE_KEYS: Record<Port["linkState"], TranslationKey> = {
  up: "Up",
  down: "Down",
  disabled: "disabled",
  unknown: "Unknown",
};
const PORT_KINDS: Port["kind"][] = [
  "rj45",
  "sfp",
  "sfp_plus",
  "qsfp",
  "fiber",
  "power",
  "console",
  "usb",
  "virtual",
  "wifi",
];
const PORT_MODES: NonNullable<Port["mode"]>[] = ["access", "trunk"];
const PORT_MODE_KEYS: Record<NonNullable<Port["mode"]>, TranslationKey> = {
  access: "access",
  trunk: "trunk",
};

interface PortFormState {
  name: string;
  kind: Port["kind"];
  speed: string;
  linkState: Port["linkState"];
  mode: NonNullable<Port["mode"]>;
  vlanId: string;
  allowedVlanIds: string[];
  virtualSwitchId: string;
  description: string;
  face: NonNullable<Port["face"]>;
  macAddress: string;
}

function portToForm(port: Port): PortFormState {
  return {
    name: port.name,
    kind: port.kind,
    speed: port.speed ?? "",
    linkState: port.linkState,
    mode: port.mode ?? "access",
    vlanId: port.vlanId ?? "",
    allowedVlanIds: port.allowedVlanIds ?? [],
    virtualSwitchId: port.virtualSwitchId ?? "",
    description: port.description ?? "",
    face: port.face ?? "front",
    macAddress: port.macAddress ?? "",
  };
}

function blankPortForm(device: Device): PortFormState {
  const isVirtualDevice =
    device.deviceType === "vm" || device.deviceType === "container";
  return {
    name: "",
    kind: isVirtualDevice ? "virtual" : "rj45",
    speed: isVirtualDevice ? "virtio" : "",
    linkState: "down",
    mode: "access",
    vlanId: "",
    allowedVlanIds: [],
    virtualSwitchId: "",
    description: "",
    face: "front",
    macAddress: "",
  };
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
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
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 text-sm text-[var(--color-fg)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)] disabled:opacity-50"
    >
      {children}
    </select>
  );
}

export function DevicePortEditor({
  device,
  port,
  creating,
  canEdit,
  devicePorts,
  vlans,
  virtualSwitches,
  peerPort,
  peerDevice,
  link,
  showFaceInHeading = false,
  onCancelCreate,
  onSaved,
  onDeleted,
}: {
  device: Device;
  port?: Port;
  creating: boolean;
  canEdit: boolean;
  devicePorts: Port[];
  vlans: Vlan[];
  virtualSwitches: VirtualSwitch[];
  peerPort?: Port;
  peerDevice?: Device;
  link?: PortLink;
  showFaceInHeading?: boolean;
  onCancelCreate: () => void;
  onSaved: (port: Port) => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<PortFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const vlansById = useMemo(
    () =>
      vlans.reduce<Record<string, Vlan>>((acc, vlan) => {
        acc[vlan.id] = vlan;
        return acc;
      }, {}),
    [vlans],
  );
  const virtualSwitchesById = useMemo(
    () =>
      virtualSwitches.reduce<Record<string, VirtualSwitch>>((acc, entry) => {
        acc[entry.id] = entry;
        return acc;
      }, {}),
    [virtualSwitches],
  );
  const candidateVirtualSwitches = virtualSwitches.filter(
    (entry) => entry.hostDeviceId === device.id,
  );

  useEffect(() => {
    if (creating) {
      setForm(blankPortForm(device));
      setError("");
      return;
    }
    setForm(port ? portToForm(port) : null);
    setError("");
  }, [creating, device, port]);

  async function handleSave() {
    if (!form) return;
    if (!form.name.trim()) {
      setError("Port name is required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        kind: form.kind,
        speed: form.speed.trim() || undefined,
        linkState: form.linkState,
        mode: form.mode,
        vlanId: form.vlanId || undefined,
        allowedVlanIds: form.mode === "trunk" ? form.allowedVlanIds : undefined,
        description: form.description.trim() || undefined,
        virtualSwitchId: form.virtualSwitchId || undefined,
        face: form.face,
        macAddress: form.macAddress.trim() || undefined,
      };

      if (creating) {
        const created = await createPortRecord({
          deviceId: device.id,
          ...payload,
          position: (devicePorts.at(-1)?.position ?? 0) + 1,
        });
        onSaved(created);
      } else if (port) {
        const updated = await updatePort(port.id, payload);
        if (updated) onSaved(updated);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : creating
            ? "Failed to create port."
            : t("Failed to update port."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!port) return;
    if (!window.confirm(t("Delete port {name}?", { name: port.name }))) return;

    setDeleting(true);
    setError("");
    try {
      await deletePortRecord(port.id);
      onDeleted();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Failed to delete port."),
      );
    } finally {
      setDeleting(false);
    }
  }

  const heading = creating
    ? t("New port")
    : port
      ? formatPortLabel(port, {
          includeFace: showFaceInHeading || port.face === "rear",
        })
      : t("Select a port");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("Inspector")}</CardLabel>
          <CardHeading>{heading}</CardHeading>
        </CardTitle>
        {(port || creating) && form ? (
          <Badge tone="cyan">{form.kind.replace("_", " ")}</Badge>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-4">
        {!canEdit ? (
          !port ? (
            <div className="text-sm text-[var(--color-fg-subtle)]">
              {t("Select a port to edit its details.")}
            </div>
          ) : (
            <ReadOnlyPortDetails
              port={port}
              peerPort={peerPort}
              peerDevice={peerDevice}
              link={link}
              vlansById={vlansById}
              virtualSwitchesById={virtualSwitchesById}
              device={device}
              t={t}
            />
          )
        ) : !form ? (
          <EmptyState title={t("Select a port to edit its details.")} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Port name")}>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) =>
                      prev ? { ...prev, name: event.target.value } : prev,
                    )
                  }
                />
              </Field>
              <Field label={t("Kind")}>
                <Select
                  value={form.kind}
                  onChange={(value) =>
                    setForm((prev) =>
                      prev ? { ...prev, kind: value as Port["kind"] } : prev,
                    )
                  }
                >
                  {PORT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Speed")}>
                <Input
                  value={form.speed}
                  onChange={(event) =>
                    setForm((prev) =>
                      prev ? { ...prev, speed: event.target.value } : prev,
                    )
                  }
                  placeholder="e.g. 10G"
                />
              </Field>
              <Field label={t("MAC address")}>
                <Input
                  value={form.macAddress}
                  onChange={(event) =>
                    setForm((prev) =>
                      prev ? { ...prev, macAddress: event.target.value } : prev,
                    )
                  }
                  placeholder="aa:bb:cc:dd:ee:ff"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Link state")}>
                <Select
                  value={form.linkState}
                  onChange={(value) =>
                    setForm((prev) =>
                      prev
                        ? { ...prev, linkState: value as Port["linkState"] }
                        : prev,
                    )
                  }
                >
                  {LINK_STATES.map((state) => (
                    <option key={state} value={state}>
                      {t(LINK_STATE_KEYS[state])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("Mode")}>
                <Select
                  value={form.mode}
                  onChange={(value) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            mode: value as PortFormState["mode"],
                            allowedVlanIds:
                              value === "trunk" ? prev.allowedVlanIds : [],
                          }
                        : prev,
                    )
                  }
                >
                  {PORT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(PORT_MODE_KEYS[mode])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Face")}>
                <Select
                  value={form.face}
                  onChange={(value) =>
                    setForm((prev) =>
                      prev
                        ? { ...prev, face: value as PortFormState["face"] }
                        : prev,
                    )
                  }
                >
                  <option value="front">{t("Front")}</option>
                  <option value="rear">{t("Rear")}</option>
                </Select>
              </Field>
              <Field
                label={
                  form.mode === "trunk" ? t("Native VLAN") : t("Access VLAN")
                }
              >
                <Select
                  value={form.vlanId}
                  onChange={(value) =>
                    setForm((prev) => (prev ? { ...prev, vlanId: value } : prev))
                  }
                >
                  <option value="">
                    {form.mode === "trunk"
                      ? t("No native VLAN")
                      : t("Unassigned")}
                  </option>
                  {vlans.map((vlan) => (
                    <option key={vlan.id} value={vlan.id}>
                      {vlan.vlanId} - {vlan.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {form.mode === "trunk" && (
              <>
                <Field label={t("Add tagged VLAN")}>
                  <Select
                    value=""
                    onChange={(value) => {
                      if (!value) return;
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              allowedVlanIds: prev.allowedVlanIds.includes(value)
                                ? prev.allowedVlanIds
                                : [...prev.allowedVlanIds, value],
                            }
                          : prev,
                      );
                    }}
                  >
                    <option value="">{t("Add tagged VLAN...")}</option>
                    {vlans
                      .filter(
                        (vlan) => !form.allowedVlanIds.includes(vlan.id),
                      )
                      .map((vlan) => (
                        <option key={vlan.id} value={vlan.id}>
                          {vlan.vlanId} - {vlan.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label={t("Tagged VLANs")}>
                  <div className="flex flex-wrap gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-2">
                    {form.allowedVlanIds.length === 0 ? (
                      <div className="px-1 py-1 text-xs text-[var(--color-fg-subtle)]">
                        {t("No tagged VLANs documented yet.")}
                      </div>
                    ) : (
                      form.allowedVlanIds.map((vlanId) => {
                        const vlan = vlans.find((entry) => entry.id === vlanId);
                        return (
                          <button
                            key={vlanId}
                            type="button"
                            onClick={() =>
                              setForm((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      allowedVlanIds: prev.allowedVlanIds.filter(
                                        (entry) => entry !== vlanId,
                                      ),
                                    }
                                  : prev,
                              )
                            }
                            className="rounded-[var(--radius-xs)] border border-[var(--color-accent-soft)]/40 bg-[var(--color-accent)]/10 px-2 py-1 text-xs text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/15"
                          >
                            {vlan ? `${vlan.vlanId} - ${vlan.name}` : vlanId} ×
                          </button>
                        );
                      })
                    )}
                  </div>
                </Field>
              </>
            )}

            <Field label={t("Virtual switch / bridge")}>
              <Select
                value={form.virtualSwitchId}
                onChange={(value) =>
                  setForm((prev) =>
                    prev ? { ...prev, virtualSwitchId: value } : prev,
                  )
                }
              >
                <option value="">
                  {candidateVirtualSwitches.length > 0
                    ? t("No bridge membership")
                    : t("No host bridges documented")}
                </option>
                {candidateVirtualSwitches.map((virtualSwitch) => (
                  <option key={virtualSwitch.id} value={virtualSwitch.id}>
                    {virtualSwitch.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t("Description")}>
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, description: event.target.value } : prev,
                  )
                }
                rows={3}
                className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm text-[var(--color-fg)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]"
              />
            </Field>

            <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                {t("Link")}
              </div>
              {link && peerDevice && peerPort ? (
                <div className="space-y-1 text-xs">
                  <div className="text-[var(--color-fg)]">
                    {peerDevice.hostname}
                    <span className="mx-1 text-[var(--color-fg-faint)]">|</span>
                    <Mono className="text-[var(--color-cyan)]">
                      {formatPortLabel(peerPort, { includeFace: true })}
                    </Mono>
                  </div>
                  <div className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
                    {link.cableType ?? t("Cable")} |{" "}
                    {link.cableLength ?? t("length n/a")}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[var(--color-fg-subtle)]">
                  {creating
                    ? t("Save the port first before cabling it.")
                    : t("No linked cable.")}
                </div>
              )}
            </div>

            {error ? (
              <div className="text-xs text-[var(--color-err)]">{error}</div>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              {!creating && port ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleDelete()}
                  disabled={deleting || saving}
                >
                  <Trash2 className="size-3.5" />
                  {deleting ? t("Deleting...") : t("Delete port")}
                </Button>
              ) : creating ? (
                <Button variant="outline" size="sm" onClick={onCancelCreate}>
                  {t("Cancel")}
                </Button>
              ) : (
                <span />
              )}
              <Button size="sm" onClick={() => void handleSave()} disabled={saving || deleting}>
                <Save className="size-3.5" />
                {saving ? t("Saving...") : creating ? t("Create port") : t("Save port")}
              </Button>
            </div>

            {!creating && port ? (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/ports?deviceId=${device.id}&portId=${port.id}`}>
                    {t("Open in ports workspace")}
                  </Link>
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ReadOnlyPortDetails({
  port,
  peerPort,
  peerDevice,
  link,
  vlansById,
  virtualSwitchesById,
  device,
  t,
}: {
  port: Port;
  peerPort?: Port;
  peerDevice?: Device;
  link?: PortLink;
  vlansById: Record<string, Vlan>;
  virtualSwitchesById: Record<string, VirtualSwitch>;
  device: Device;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const primaryVlan = port.vlanId ? vlansById[port.vlanId] : undefined;
  const allowedVlanLabels =
    port.allowedVlanIds?.map((vlanId) =>
      formatVlanReference(vlanId, vlansById),
    ) ?? [];
  const virtualSwitch = port.virtualSwitchId
    ? virtualSwitchesById[port.virtualSwitchId]
    : undefined;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
        <InspectorRow label={t("State")} value={port.linkState} />
        <InspectorRow label={t("Speed")} value={port.speed ?? t("n/a")} mono />
        <InspectorRow label={t("Mode")} value={port.mode ?? "access"} />
        <InspectorRow label={t("Face")} value={port.face ?? "front"} />
        <InspectorRow label={t("MAC address")} value={port.macAddress ?? t("n/a")} mono />
        <InspectorRow
          label={port.mode === "trunk" ? t("Native VLAN") : t("Access VLAN")}
          value={
            primaryVlan
              ? formatVlanReference(primaryVlan.id, vlansById)
              : port.mode === "trunk"
                ? "None (tagged only)"
                : t("Unassigned")
          }
        />
        {port.mode === "trunk" ? (
          <InspectorRow
            label={t("Tagged VLANs")}
            value={
              allowedVlanLabels.length > 0
                ? allowedVlanLabels.join(", ")
                : t("No tagged VLANs documented yet.")
            }
          />
        ) : null}
        <InspectorRow
          label={t("Virtual switch")}
          value={
            virtualSwitch?.name ??
            (port.virtualSwitchId ? port.virtualSwitchId : "None")
          }
        />
      </div>
      <InspectorRow
        label={t("Description")}
        value={port.description?.trim() || "No description documented."}
      />
      <div className="space-y-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
          Link peer
        </div>
        <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2">
          {peerDevice && peerPort ? (
            <div className="space-y-1 text-sm">
              <div className="text-[var(--color-fg)]">
                {peerDevice.hostname}
                <span className="mx-1 text-[var(--color-fg-faint)]">|</span>
                <Mono className="text-[var(--color-cyan)]">
                  {formatPortLabel(peerPort, { includeFace: true })}
                </Mono>
              </div>
              <div className="text-[11px] text-[var(--color-fg-subtle)]">
                {link?.cableType ?? t("Cable")} |{" "}
                {link?.cableLength ?? t("length n/a")}
              </div>
            </div>
          ) : (
            <div className="text-sm text-[var(--color-fg-subtle)]">
              {t("No linked cable.")}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link to={`/ports?deviceId=${device.id}&portId=${port.id}`}>
            {t("Open in ports workspace")}
          </Link>
        </Button>
      </div>
    </>
  );
}

function InspectorRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div
        className={`mt-1 text-sm text-[var(--color-fg)] ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
