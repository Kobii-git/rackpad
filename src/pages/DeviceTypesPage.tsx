import { useCallback, useEffect, useMemo, useState } from "react";
import { LockKeyhole, Plus, Save, Trash2 } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
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
import { useI18n } from "@/i18n";
import {
  localizedDeviceTypeLabel,
  normalizeDeviceTypeId,
} from "@/lib/device-types";
import { api } from "@/lib/api";
import {
  createDeviceTypeRecord,
  deleteDeviceTypeRecord,
  isAdmin,
  updateDeviceTypeRecord,
  useStore,
} from "@/lib/store";
import type { DeviceTypeUsage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HardwareTemplateBuilder } from "@/components/rack/HardwareTemplateBuilder";

const NEW_TYPE_ID = "__new_device_type__";

type DeviceTypeForm = {
  id: string;
  label: string;
  parentType: string;
};

const EMPTY_FORM: DeviceTypeForm = {
  id: "",
  label: "",
  parentType: "other",
};

export default function DeviceTypesPage() {
  const { t } = useI18n();
  const currentUser = useStore((state) => state.currentUser);
  const deviceTypes = useStore((state) => state.deviceTypes);
  const builtInTypes = useMemo(
    () => deviceTypes.filter((type) => type.builtIn),
    [deviceTypes],
  );
  const customTypes = useMemo(
    () => deviceTypes.filter((type) => !type.builtIn),
    [deviceTypes],
  );
  const [selectedId, setSelectedId] = useState(NEW_TYPE_ID);
  const [form, setForm] = useState<DeviceTypeForm>(EMPTY_FORM);
  const [usage, setUsage] = useState<DeviceTypeUsage[]>([]);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const selectedType =
    selectedId === NEW_TYPE_ID
      ? undefined
      : deviceTypes.find((type) => type.id === selectedId);
  const selectedUsage = usage.find((entry) => entry.id === selectedType?.id);
  const inheritedParent = builtInTypes.find(
    (type) => type.id === form.parentType,
  );
  const deletionUsage = selectedUsage
    ? [
        [t("Devices"), selectedUsage.devices],
        [t("Discovery"), selectedUsage.discoveredDevices],
        [t("Port templates"), selectedUsage.portTemplates],
        [t("Drive-bay templates"), selectedUsage.driveBayTemplates],
      ].filter(([, count]) => Number(count) > 0)
    : [];

  const refreshUsage = useCallback(async () => {
    setLoadingUsage(true);
    try {
      setUsage(await api.getDeviceTypeUsage());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Failed to create device type."),
      );
    } finally {
      setLoadingUsage(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isAdmin(currentUser)) return;
    void refreshUsage();
  }, [currentUser, refreshUsage]);

  useEffect(() => {
    if (selectedId === NEW_TYPE_ID) {
      setForm(EMPTY_FORM);
      setError("");
      return;
    }
    if (!selectedType) {
      setSelectedId(NEW_TYPE_ID);
      return;
    }
    setForm({
      id: selectedType.id,
      label: selectedType.label,
      parentType: selectedType.parentType ?? "",
    });
    setError("");
  }, [selectedId, selectedType]);

  if (!isAdmin(currentUser)) {
    return (
      <>
        <TopBar subtitle={t("Administration")} title={t("Device types")} />
        <div className="flex flex-1 items-center justify-center px-6">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>
                <CardLabel>{t("Restricted")}</CardLabel>
                <CardHeading>{t("Administrator access required")}</CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody className="text-sm text-[var(--text-muted)]">
              {t("This page is only available to administrator accounts.")}
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  async function handleSave() {
    const label = form.label.trim();
    if (!label) {
      setError(t("Device type name is required."));
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (selectedId === NEW_TYPE_ID) {
        const created = await createDeviceTypeRecord({
          id: form.id.trim() || undefined,
          label,
          parentType: form.parentType || undefined,
        });
        setSelectedId(created.id);
      } else if (selectedType && !selectedType.builtIn) {
        await updateDeviceTypeRecord(selectedType.id, {
          label,
          parentType: form.parentType || null,
        });
      }
      await refreshUsage();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Failed to create device type."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedType || selectedType.builtIn) return;
    if (
      !window.confirm(
        t("Delete device type {label}?", { label: selectedType.label }),
      )
    ) {
      return;
    }

    setDeleting(true);
    setError("");
    try {
      await deleteDeviceTypeRecord(selectedType.id);
      setSelectedId(NEW_TYPE_ID);
      await refreshUsage();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Failed to create device type."),
      );
    } finally {
      setDeleting(false);
    }
  }

  const derivedId = normalizeDeviceTypeId(form.id || form.label);

  return (
    <>
      <TopBar
        subtitle={t("Administration")}
        title={t("Device types")}
        actions={
          <Button
            size="sm"
            onClick={() => setSelectedId(NEW_TYPE_ID)}
            disabled={selectedId === NEW_TYPE_ID}
          >
            <Plus />
            {t("New")}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.4fr)]">
          <Card>
            <CardHeader>
              <CardTitle>
                <CardLabel>{t("Inventory")}</CardLabel>
                <CardHeading>{t("Device types")}</CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-left",
                  selectedId === NEW_TYPE_ID
                    ? "border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)]"
                    : "border-[var(--border-default)] bg-[var(--surface-1)] hover:border-[var(--border-strong)]",
                )}
                onClick={() => setSelectedId(NEW_TYPE_ID)}
              >
                <span className="text-sm font-medium">{t("New")}</span>
                <Plus className="size-4" />
              </button>

              {[
                {
                  id: "built-in",
                  heading: t("Built-in template"),
                  types: builtInTypes,
                },
                {
                  id: "custom",
                  heading: t("Custom template"),
                  types: customTypes,
                },
              ].map((section) => (
                <section
                  key={section.id}
                  data-testid={`device-type-section-${section.id}`}
                  className="space-y-2 pt-2"
                >
                  <h3 className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    {section.heading}
                  </h3>
                  {section.types.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">—</p>
                  ) : (
                    section.types.map((type) => {
                      const parent = builtInTypes.find(
                        (entry) => entry.id === type.parentType,
                      );
                      return (
                        <button
                          key={type.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-left",
                            selectedId === type.id
                              ? "border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)]"
                              : "border-[var(--border-default)] bg-[var(--surface-1)] hover:border-[var(--border-strong)]",
                          )}
                          onClick={() => setSelectedId(type.id)}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {localizedDeviceTypeLabel(type, t)}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-[var(--text-muted)]">
                              {type.id}
                            </span>
                            {!type.builtIn && parent && (
                              <span className="block truncate text-[10px] text-[var(--text-muted)]">
                                {t("Parent")}:{" "}
                                {localizedDeviceTypeLabel(parent, t)}
                              </span>
                            )}
                          </span>
                          <Badge tone={type.builtIn ? "neutral" : "accent"}>
                            {type.builtIn
                              ? t("Built-in template")
                              : t("Custom template")}
                          </Badge>
                        </button>
                      );
                    })
                  )}
                </section>
              ))}
            </CardBody>
          </Card>

          <div className="space-y-4">
            <Card data-testid="device-type-editor">
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Device type")}</CardLabel>
                  <CardHeading>
                    {selectedType
                      ? localizedDeviceTypeLabel(selectedType, t)
                      : t("New")}
                  </CardHeading>
                </CardTitle>
                {selectedType?.builtIn && (
                  <Badge tone="neutral">
                    <LockKeyhole className="size-3" />
                    {t("Built-in template")}
                  </Badge>
                )}
              </CardHeader>
              <CardBody className="space-y-4">
                {error && (
                  <div
                    role="alert"
                    className="rounded-[var(--radius-sm)] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]"
                  >
                    {error}
                  </div>
                )}

                {selectedType?.builtIn && (
                  <p className="text-xs text-[var(--text-muted)]">
                    {t("Built-in templates cannot be modified.")}
                  </p>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("Name")}>
                    <Input
                      value={form.label}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          label: event.target.value,
                        }))
                      }
                      disabled={selectedType?.builtIn}
                    />
                  </Field>
                  <Field label={t("ID")}>
                    <Input
                      value={selectedType ? selectedType.id : form.id}
                      placeholder={derivedId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          id: event.target.value,
                        }))
                      }
                      disabled={Boolean(selectedType)}
                      className="font-mono"
                    />
                  </Field>
                  <Field label={t("Parent")}>
                    <select
                      className="rk-control h-8 w-full px-2.5 text-sm focus-visible:outline-none disabled:opacity-100"
                      value={form.parentType}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          parentType: event.target.value,
                        }))
                      }
                      disabled={selectedType?.builtIn}
                    >
                      <option value="">{t("Custom / none")}</option>
                      {builtInTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {localizedDeviceTypeLabel(type, t)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {!selectedType?.builtIn && inheritedParent && (
                  <div
                    data-testid="device-type-inheritance-summary"
                    className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-3"
                  >
                    <div className="text-xs font-medium text-[var(--text-primary)]">
                      {t("Parent")}:{" "}
                      {localizedDeviceTypeLabel(inheritedParent, t)}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                      {t(
                        "Inherits parent behavior for placement, ports and templates, Compute, WiFi, Storage, and imports.",
                      )}
                    </p>
                  </div>
                )}

                {!selectedType?.builtIn && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void handleSave()}
                      disabled={saving || deleting}
                    >
                      <Save />
                      {saving
                        ? t("Saving...")
                        : selectedType
                          ? t("Save changes")
                          : t("Create")}
                    </Button>
                    {selectedType && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void handleDelete()}
                        disabled={
                          deleting ||
                          saving ||
                          loadingUsage ||
                          Boolean(selectedUsage?.total)
                        }
                      >
                        <Trash2 />
                        {t("Delete")}
                      </Button>
                    )}
                  </div>
                )}
                {selectedType && deletionUsage.length > 0 && (
                  <p
                    data-testid="device-type-deletion-reason"
                    className="text-xs text-[var(--text-muted)]"
                  >
                    {t("Cannot delete while in use:")}{" "}
                    {deletionUsage
                      .map(([label, count]) => `${label} ${count}`)
                      .join(" · ")}
                  </p>
                )}
              </CardBody>
            </Card>

            {selectedType && (
              <Card data-testid="device-type-usage">
                <CardHeader>
                  <CardTitle>
                    <CardLabel>{t("Relationships")}</CardLabel>
                    <CardHeading>{t("Inventory")}</CardHeading>
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <UsageMetric
                      label={t("Devices")}
                      value={selectedUsage?.devices}
                      loading={loadingUsage}
                    />
                    <UsageMetric
                      label={t("Discovery")}
                      value={selectedUsage?.discoveredDevices}
                      loading={loadingUsage}
                    />
                    <UsageMetric
                      label={t("Port templates")}
                      value={selectedUsage?.portTemplates}
                      loading={loadingUsage}
                    />
                    <UsageMetric
                      label={t("Drive-bay templates")}
                      value={selectedUsage?.driveBayTemplates}
                      loading={loadingUsage}
                    />
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        </div>
        <div className="mt-4">
          <HardwareTemplateBuilder
            selectedDeviceType={selectedType?.id}
            deviceTypes={deviceTypes}
          />
        </div>
      </div>
    </>
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

function UsageMetric({
  label,
  value,
  loading,
}: {
  label: string;
  value?: number;
  loading: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">
        {loading ? "…" : (value ?? 0)}
      </div>
    </div>
  );
}
