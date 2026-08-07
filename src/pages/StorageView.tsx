import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Database,
  HardDrive,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/shared/EmptyState";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { useI18n } from "@/i18n";
import { localizedDeviceTypeLabel } from "@/lib/device-types";
import {
  canEditInventory,
  createDriveBayTemplateRecord,
  createStorageDriveRecord,
  createStoragePoolRecord,
  deleteDriveBayTemplateRecord,
  deleteStorageDriveRecord,
  deleteStoragePoolRecord,
  updateDriveBayTemplateRecord,
  updateStorageDriveRecord,
  updateStoragePoolRecord,
  useStore,
} from "@/lib/store";
import {
  DRIVE_FORM_FACTOR_OPTIONS,
  DRIVE_INTERFACE_OPTIONS,
  DRIVE_SLOT_TYPE_OPTIONS,
  STORAGE_POOL_STATUS_OPTIONS,
  STORAGE_POOL_TYPE_OPTIONS,
  commitDriveBaySlotCount,
  driveLabel,
  driveBayTemplateDisplayCopy,
  driveFormFactorLabel,
  driveInterfaceLabel,
  driveSlotTypeLabel,
  formatStorageCapacity,
  generateDriveBaySection,
  inferDriveBaySlotPrefix,
  isPoolDriveEligible,
  poolColor,
  poolTypeLabel,
  renameDriveBaySlots,
  serializeDriveBayTemplateSection,
  setDriveBaySlotType,
  summarizeStorage,
  storagePoolStatusLabel,
  uniformDriveBaySlotType,
} from "@/lib/storage";
import type {
  DeviceType,
  DriveBayTemplate,
  DriveBayTemplateSlot,
  DriveFormFactor,
  DriveInterface,
  DriveSlotFace,
  DriveSlotLayout,
  DriveSlotType,
  StorageDrive,
  StoragePool,
  StoragePoolStatus,
  StoragePoolType,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type WorkspaceTab = "overview" | "drives" | "pools" | "templates";

type DriveForm = {
  manufacturer: string;
  model: string;
  serial: string;
  capacity: string;
  capacityUnit: "gb" | "tb";
  interface: DriveInterface;
  formFactor: DriveFormFactor;
  notes: string;
  slotId: string;
};

type PoolForm = {
  deviceId: string;
  name: string;
  poolType: StoragePoolType;
  usableCapacity: string;
  capacityUnit: "gb" | "tb";
  status: StoragePoolStatus;
  notes: string;
  driveIds: string[];
};

type TemplateSectionDraft = {
  id: string;
  name: string;
  face: DriveSlotFace;
  layout: DriveSlotLayout;
  count: string;
  columns: string;
  slotType: DriveSlotType | "mixed";
  prefix: string;
  slots: DriveBayTemplateSlot[];
};

type TemplateForm = {
  name: string;
  description: string;
  deviceTypes: DeviceType[];
  sections: TemplateSectionDraft[];
};

const EMPTY_DRIVE_FORM: DriveForm = {
  manufacturer: "",
  model: "",
  serial: "",
  capacity: "",
  capacityUnit: "tb",
  interface: "sata",
  formFactor: "3.5",
  notes: "",
  slotId: "",
};

const EMPTY_POOL_FORM: PoolForm = {
  deviceId: "",
  name: "",
  poolType: "raidz1",
  usableCapacity: "",
  capacityUnit: "tb",
  status: "unknown",
  notes: "",
  driveIds: [],
};

function newSection(index = 0): TemplateSectionDraft {
  const name = index === 0 ? "Drive bays" : `Section ${index + 1}`;
  const count = index === 0 ? 4 : 2;
  const columns = index === 0 ? 4 : 2;
  const slotType = index === 0 ? "3.5" : "generic";
  const prefix = index === 0 ? "Bay " : "Slot ";
  return {
    id: crypto.randomUUID(),
    name,
    face: index === 0 ? "front" : "internal",
    layout: "grid",
    count: String(count),
    columns: String(columns),
    slotType,
    prefix,
    slots: generateDriveBaySection({
      name,
      count,
      columns,
      slotType,
      prefix,
    }).slots,
  };
}

const EMPTY_TEMPLATE_FORM: TemplateForm = {
  name: "",
  description: "",
  deviceTypes: ["server", "storage"],
  sections: [newSection()],
};

export default function StorageView() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useStore((state) => state.currentUser);
  const lab = useStore((state) => state.lab);
  const devices = useStore((state) => state.devices);
  const deviceTypes = useStore((state) => state.deviceTypes);
  const slots = useStore((state) => state.driveSlots);
  const drives = useStore((state) => state.storageDrives);
  const pools = useStore((state) => state.storagePools);
  const templates = useStore((state) => state.driveBayTemplates);
  const canEdit = canEditInventory(currentUser, lab.id);
  const isAdmin = currentUser?.role === "admin";
  const requestedTab = searchParams.get("tab") as WorkspaceTab | null;
  const tab: WorkspaceTab = [
    "overview",
    "drives",
    "pools",
    "templates",
  ].includes(requestedTab ?? "")
    ? requestedTab!
    : "overview";
  const summary = useMemo(
    () => summarizeStorage(drives, slots, pools),
    [drives, pools, slots],
  );
  const driveById = useMemo(
    () => new Map(drives.map((drive) => [drive.id, drive])),
    [drives],
  );
  const deviceById = useMemo(
    () => new Map(devices.map((device) => [device.id, device])),
    [devices],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        title={t("Storage")}
        subtitle={t("Storage inventory")}
        meta={t("Physical drives, device bays, and logical pools")}
      />
      <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 xl:p-6">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", value);
            setSearchParams(next, { replace: true });
          }}
        >
          <TabsList className="mb-4 w-fit max-w-full overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap">
            <TabsTrigger value="overview">{t("Overview")}</TabsTrigger>
            <TabsTrigger value="drives">
              {t("Drives")} · {drives.length}
            </TabsTrigger>
            <TabsTrigger value="pools">
              {t("Logical pools")} · {pools.length}
            </TabsTrigger>
            <TabsTrigger value="templates">
              {t("Drive-bay templates")} · {templates.length}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <StorageOverview
              summary={summary}
              pools={pools}
              drives={drives}
              driveById={driveById}
              deviceById={deviceById}
            />
          </TabsContent>
          <TabsContent value="drives">
            <DriveInventory
              canEdit={canEdit}
              requestedDriveId={searchParams.get("driveId")}
            />
          </TabsContent>
          <TabsContent value="pools">
            <PoolInventory canEdit={canEdit} />
          </TabsContent>
          <TabsContent value="templates">
            <TemplateLibrary isAdmin={isAdmin} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StorageOverview({
  summary,
  pools,
  drives,
  driveById,
  deviceById,
}: {
  summary: ReturnType<typeof summarizeStorage>;
  pools: StoragePool[];
  drives: StorageDrive[];
  driveById: Map<string, StorageDrive>;
  deviceById: Map<string, { hostname: string }>;
}) {
  const { t } = useI18n();
  const unhealthy = pools.filter(
    (pool) => pool.status === "degraded" || pool.status === "offline",
  );
  const poolsWithMissing = pools.filter((pool) =>
    pool.driveIds.some((driveId) => !driveById.get(driveId)?.slotId),
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={t("Raw capacity")}
          value={formatStorageCapacity(summary.rawCapacityGb)}
        />
        <Metric
          label={t("Usable capacity")}
          value={formatStorageCapacity(summary.usableCapacityGb)}
        />
        <Metric
          label={t("Occupied slots")}
          value={`${summary.occupiedSlots} / ${summary.totalSlots}`}
        />
        <Metric
          label={t("Unassigned drives")}
          value={String(summary.unassignedDrives)}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <CardLabel>{t("Storage attention")}</CardLabel>
            <CardHeading>{t("Degraded or offline pools")}</CardHeading>
          </CardTitle>
          <Badge
            tone={unhealthy.length || poolsWithMissing.length ? "warn" : "ok"}
          >
            {unhealthy.length + poolsWithMissing.length}
          </Badge>
        </CardHeader>
        <CardBody className="space-y-2">
          {unhealthy.length === 0 && poolsWithMissing.length === 0 ? (
            <div className="text-sm text-[var(--text-secondary)]">
              {t("All storage looks healthy.")}
            </div>
          ) : (
            <>
              {unhealthy.map((pool) => (
                <PoolAttentionRow
                  key={`status-${pool.id}`}
                  pool={pool}
                  deviceById={deviceById}
                  detail={storagePoolStatusLabel(pool.status, t)}
                />
              ))}
              {poolsWithMissing.map((pool) => {
                const missing = pool.driveIds.filter(
                  (id) => !driveById.get(id)?.slotId,
                );
                return (
                  <PoolAttentionRow
                    key={`missing-${pool.id}`}
                    pool={pool}
                    deviceById={deviceById}
                    detail={`${missing.length} ${t("Missing pool members")}`}
                  />
                );
              })}
            </>
          )}
        </CardBody>
      </Card>
      {drives.length === 0 && pools.length === 0 && (
        <EmptyState
          icon={HardDrive}
          title={t("No drives documented yet.")}
          description={t("Select a drive or create a new one.")}
        />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody>
        <div className="rk-kicker">{label}</div>
        <div className="mt-2 font-mono text-2xl font-semibold text-[var(--text-primary)]">
          {value}
        </div>
      </CardBody>
    </Card>
  );
}

function PoolAttentionRow({
  pool,
  deviceById,
  detail,
}: {
  pool: StoragePool;
  deviceById: Map<string, { hostname: string }>;
  detail: string;
}) {
  return (
    <Link
      to={`/devices/${pool.deviceId}?tab=storage`}
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-2 text-sm sm:flex"
    >
      <AlertTriangle className="row-span-3 size-4 shrink-0 text-[var(--warning)]" />
      <span className="min-w-0 flex-1 break-words font-medium text-[var(--text-primary)]">
        {pool.name}
      </span>
      <span className="min-w-0 break-words text-xs text-[var(--text-secondary)] sm:text-sm">
        {deviceById.get(pool.deviceId)?.hostname}
      </span>
      <Badge
        tone="warn"
        className="w-fit max-w-full whitespace-normal break-words sm:ml-auto sm:whitespace-nowrap"
      >
        {detail}
      </Badge>
    </Link>
  );
}

function DriveInventory({
  canEdit,
  requestedDriveId,
}: {
  canEdit: boolean;
  requestedDriveId: string | null;
}) {
  const { t } = useI18n();
  const devices = useStore((state) => state.devices);
  const slots = useStore((state) => state.driveSlots);
  const drives = useStore((state) => state.storageDrives);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<DriveForm>(EMPTY_DRIVE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return drives;
    return drives.filter((drive) =>
      [
        drive.manufacturer,
        drive.model,
        drive.serial,
        drive.deviceHostname,
        drive.slotName,
        drive.poolName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [drives, query]);
  const selected = drives.find((drive) => drive.id === editingId) ?? null;
  const availableSlots = slots.filter(
    (slot) => !slot.driveId || slot.driveId === selected?.id,
  );

  useEffect(() => {
    if (
      requestedDriveId &&
      drives.some((drive) => drive.id === requestedDriveId)
    ) {
      setCreating(false);
      setEditingId(requestedDriveId);
      const requestedDrive = drives.find(
        (drive) => drive.id === requestedDriveId,
      );
      if (requestedDrive) setForm(driveToForm(requestedDrive));
    }
  }, [drives, requestedDriveId]);

  function openDrive(drive?: StorageDrive) {
    setCreating(!drive);
    setEditingId(drive?.id ?? null);
    setForm(drive ? driveToForm(drive) : EMPTY_DRIVE_FORM);
    setError("");
  }

  async function saveDrive() {
    const capacity = Number(form.capacity);
    if (!Number.isFinite(capacity) || capacity < 0) {
      setError(t("Capacity"));
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      manufacturer: form.manufacturer.trim() || null,
      model: form.model.trim() || null,
      serial: form.serial.trim() || null,
      capacityGb: form.capacityUnit === "tb" ? capacity * 1000 : capacity,
      interface: form.interface,
      formFactor: form.formFactor,
      notes: form.notes.trim() || null,
      slotId: form.slotId || null,
    };
    try {
      if (selected) await updateStorageDriveRecord(selected.id, payload);
      else await createStorageDriveRecord(payload);
      setCreating(false);
      setEditingId(null);
      setForm(EMPTY_DRIVE_FORM);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Storage changes could not be saved."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeDrive() {
    if (!selected || !window.confirm(t("Delete this drive?"))) return;
    setSaving(true);
    setError("");
    try {
      await deleteStorageDriveRecord(selected.id);
      setEditingId(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Storage changes could not be saved."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <CardTitle>
            <CardLabel>{t("Drive inventory")}</CardLabel>
            <CardHeading>
              {drives.length} {t("Drives")}
            </CardHeading>
          </CardTitle>
          {canEdit && (
            <Button size="sm" onClick={() => openDrive()}>
              <Plus className="size-3.5" />
              {t("New drive")}
            </Button>
          )}
        </CardHeader>
        <CardBody className="p-0">
          <div className="border-b border-[var(--border-subtle)] p-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search drives...")}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-[var(--surface-1)] font-mono uppercase tracking-[0.1em] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2">{t("Drive details")}</th>
                  <th className="px-3 py-2">{t("Capacity")}</th>
                  <th className="px-3 py-2">{t("Installed")}</th>
                  <th className="px-3 py-2">{t("Pool")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filtered.map((drive) => (
                  <tr
                    key={drive.id}
                    className="hover:bg-[var(--surface-hover)]"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-[var(--text-primary)]">
                        {driveLabel(drive)}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--text-muted)]">
                        {drive.serial || "—"} ·{" "}
                        {driveInterfaceLabel(drive.interface, t)} ·{" "}
                        {driveFormFactorLabel(drive.formFactor, t)}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[var(--text-primary)]">
                      {formatStorageCapacity(drive.capacityGb)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-[var(--text-primary)]">
                        {drive.deviceHostname || t("Unassigned drives")}
                      </div>
                      {drive.slotName && (
                        <div className="text-[var(--text-muted)]">
                          {drive.slotSectionName} · {drive.slotName}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {drive.poolName ? (
                        <Badge tone="info">{drive.poolName}</Badge>
                      ) : (
                        <span className="text-[var(--text-muted)]">
                          {t("No pool")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openDrive(drive)}
                          aria-label={t("Edit {name}", {
                            name: driveLabel(drive),
                          })}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">
              {query
                ? t("No drives match this search.")
                : t("No drives documented yet.")}
            </div>
          )}
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>
            <CardLabel>{t("Drive details")}</CardLabel>
            <CardHeading>
              {selected
                ? driveLabel(selected)
                : creating
                  ? t("New drive")
                  : t("Select a drive or create a new one.")}
            </CardHeading>
          </CardTitle>
          {(selected || creating) && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("Close")}
              onClick={() => {
                setEditingId(null);
                setCreating(false);
              }}
            >
              <X className="size-4" />
            </Button>
          )}
        </CardHeader>
        <CardBody>
          {!selected && !creating ? (
            <EmptyState
              icon={HardDrive}
              title={t("Select a drive or create a new one.")}
            />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Manufacturer")}>
                  <Input
                    disabled={!canEdit}
                    value={form.manufacturer}
                    onChange={(e) =>
                      setForm({ ...form, manufacturer: e.target.value })
                    }
                  />
                </Field>
                <Field label={t("Model")}>
                  <Input
                    disabled={!canEdit}
                    value={form.model}
                    onChange={(e) =>
                      setForm({ ...form, model: e.target.value })
                    }
                  />
                </Field>
              </div>
              <Field label={t("Serial")}>
                <Input
                  disabled={!canEdit}
                  value={form.serial}
                  onChange={(e) => setForm({ ...form, serial: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-[1fr_90px] gap-3">
                <Field label={t("Capacity")}>
                  <Input
                    disabled={!canEdit}
                    type="number"
                    min="0"
                    value={form.capacity}
                    onChange={(e) =>
                      setForm({ ...form, capacity: e.target.value })
                    }
                  />
                </Field>
                <Field label={t("Capacity unit")}>
                  <select
                    disabled={!canEdit}
                    className={selectClass}
                    value={form.capacityUnit}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        capacityUnit: e.target.value as "gb" | "tb",
                      })
                    }
                  >
                    <option value="gb">
                      {t("{value1}", { value1: "GB" })}
                    </option>
                    <option value="tb">
                      {t("{value1}", { value1: "TB" })}
                    </option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Interface")}>
                  <select
                    disabled={!canEdit}
                    className={selectClass}
                    value={form.interface}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        interface: e.target.value as DriveInterface,
                      })
                    }
                  >
                    {DRIVE_INTERFACE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {driveInterfaceLabel(value, t)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("Form factor")}>
                  <select
                    disabled={!canEdit}
                    className={selectClass}
                    value={form.formFactor}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        formFactor: e.target.value as DriveFormFactor,
                      })
                    }
                  >
                    {DRIVE_FORM_FACTOR_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {driveFormFactorLabel(value, t)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label={t("Select a slot")}>
                <select
                  disabled={!canEdit}
                  className={selectClass}
                  value={form.slotId}
                  onChange={(e) => setForm({ ...form, slotId: e.target.value })}
                >
                  <option value="">{t("Unassigned drives")}</option>
                  {availableSlots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {
                        devices.find((device) => device.id === slot.deviceId)
                          ?.hostname
                      }{" "}
                      · {slot.sectionName} · {slot.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Notes")}>
                <textarea
                  disabled={!canEdit}
                  className={textareaClass}
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
              {error && (
                <div className="text-xs text-[var(--danger)]">{error}</div>
              )}
              {canEdit && (
                <div className="flex justify-between gap-2">
                  {selected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving}
                      onClick={() => void removeDrive()}
                    >
                      <Trash2 className="size-3.5" />
                      {t("Delete drive")}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={() => void saveDrive()}
                  >
                    <Save className="size-3.5" />
                    {selected ? t("Save drive") : t("Create drive")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function PoolInventory({ canEdit }: { canEdit: boolean }) {
  const { t } = useI18n();
  const devices = useStore((state) => state.devices);
  const drives = useStore((state) => state.storageDrives);
  const pools = useStore((state) => state.storagePools);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<PoolForm>(EMPTY_POOL_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = pools.find((pool) => pool.id === editingId) ?? null;

  function openPool(pool?: StoragePool) {
    setCreating(!pool);
    setEditingId(pool?.id ?? null);
    setForm(
      pool
        ? poolToForm(pool)
        : { ...EMPTY_POOL_FORM, deviceId: devices[0]?.id ?? "" },
    );
    setError("");
  }

  async function savePool() {
    const capacity = Number(form.usableCapacity);
    if (
      !form.deviceId ||
      !form.name.trim() ||
      !Number.isFinite(capacity) ||
      capacity < 0
    ) {
      setError(t("Storage changes could not be saved."));
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      deviceId: form.deviceId,
      name: form.name.trim(),
      poolType: form.poolType,
      usableCapacityGb: form.capacityUnit === "tb" ? capacity * 1000 : capacity,
      status: form.status,
      notes: form.notes.trim() || null,
      driveIds: form.driveIds,
    };
    try {
      if (selected) await updateStoragePoolRecord(selected.id, payload);
      else await createStoragePoolRecord(payload);
      setEditingId(null);
      setCreating(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Storage changes could not be saved."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function removePool() {
    if (!selected || !window.confirm(t("Delete this storage pool?"))) return;
    setSaving(true);
    try {
      await deleteStoragePoolRecord(selected.id);
      setEditingId(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Storage changes could not be saved."),
      );
    } finally {
      setSaving(false);
    }
  }

  const groupedDrives = useMemo(() => {
    const groups = new Map<string, StorageDrive[]>();
    for (const drive of drives) {
      if (!canEdit && !form.driveIds.includes(drive.id)) continue;
      const key = drive.deviceId ?? "unassigned";
      groups.set(key, [...(groups.get(key) ?? []), drive]);
    }
    return [...groups.entries()];
  }, [canEdit, drives, form.driveIds]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Card>
        <CardHeader>
          <CardTitle>
            <CardLabel>{t("Logical storage")}</CardLabel>
            <CardHeading>
              {pools.length} {t("Logical pools")}
            </CardHeading>
          </CardTitle>
          {canEdit && (
            <Button size="sm" onClick={() => openPool()}>
              <Plus className="size-3.5" />
              {t("New pool")}
            </Button>
          )}
        </CardHeader>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-[var(--surface-1)] font-mono uppercase tracking-[0.1em] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2">{t("Pool")}</th>
                  <th className="px-3 py-2">{t("Pool owner")}</th>
                  <th className="px-3 py-2">{t("RAID / pool type")}</th>
                  <th className="px-3 py-2">{t("Usable capacity")}</th>
                  <th className="px-3 py-2">{t("Pool members")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {pools.map((pool) => (
                  <tr key={pool.id} className="hover:bg-[var(--surface-hover)]">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ background: poolColor(pool.id) }}
                        />
                        <div>
                          <button
                            type="button"
                            className="rounded-sm text-left font-medium text-[var(--text-primary)] hover:text-[var(--accent-primary-hover)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                            onClick={() => openPool(pool)}
                            aria-label={t("Open pool {name}", {
                              name: pool.name,
                            })}
                          >
                            {pool.name}
                          </button>
                          <Badge
                            tone={
                              pool.status === "healthy"
                                ? "ok"
                                : pool.status === "degraded" ||
                                    pool.status === "offline"
                                  ? "warn"
                                  : "neutral"
                            }
                          >
                            {storagePoolStatusLabel(pool.status, t)}
                          </Badge>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        className="text-[var(--accent-primary-hover)] hover:underline"
                        to={`/devices/${pool.deviceId}?tab=storage`}
                      >
                        {
                          devices.find((device) => device.id === pool.deviceId)
                            ?.hostname
                        }
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {poolTypeLabel(pool.poolType, t)}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatStorageCapacity(pool.usableCapacityGb)}
                    </td>
                    <td className="px-3 py-2">{pool.driveIds.length}</td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openPool(pool)}
                          aria-label={t("Edit pool {name}", {
                            name: pool.name,
                          })}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pools.length === 0 && (
            <EmptyState
              icon={Database}
              title={t("No storage pools documented yet.")}
            />
          )}
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>
            <CardLabel>{t("Pool")}</CardLabel>
            <CardHeading>
              {selected?.name ?? (creating ? t("New pool") : t("No pool"))}
            </CardHeading>
          </CardTitle>
          {(selected || creating) && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("Close")}
              onClick={() => {
                setEditingId(null);
                setCreating(false);
              }}
            >
              <X className="size-4" />
            </Button>
          )}
        </CardHeader>
        <CardBody>
          {!selected && !creating ? (
            <EmptyState icon={Database} title={t("No pool")} />
          ) : (
            <div className="space-y-3">
              <Field label={t("Pool owner")}>
                <select
                  className={selectClass}
                  value={form.deviceId}
                  disabled={Boolean(selected)}
                  onChange={(e) =>
                    setForm({ ...form, deviceId: e.target.value })
                  }
                >
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.hostname}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("Pool name")}>
                <Input
                  disabled={!canEdit}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("RAID / pool type")}>
                  <select
                    disabled={!canEdit}
                    className={selectClass}
                    value={form.poolType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        poolType: e.target.value as StoragePoolType,
                      })
                    }
                  >
                    {STORAGE_POOL_TYPE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {poolTypeLabel(value, t)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("Pool status")}>
                  <select
                    disabled={!canEdit}
                    className={selectClass}
                    value={form.status}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        status: e.target.value as StoragePoolStatus,
                      })
                    }
                  >
                    {STORAGE_POOL_STATUS_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {storagePoolStatusLabel(value, t)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-[1fr_90px] gap-3">
                <Field label={t("Usable capacity")}>
                  <Input
                    disabled={!canEdit}
                    type="number"
                    min="0"
                    value={form.usableCapacity}
                    onChange={(e) =>
                      setForm({ ...form, usableCapacity: e.target.value })
                    }
                  />
                </Field>
                <Field label={t("Capacity unit")}>
                  <select
                    disabled={!canEdit}
                    className={selectClass}
                    value={form.capacityUnit}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        capacityUnit: e.target.value as "gb" | "tb",
                      })
                    }
                  >
                    <option value="gb">
                      {t("{value1}", { value1: "GB" })}
                    </option>
                    <option value="tb">
                      {t("{value1}", { value1: "TB" })}
                    </option>
                  </select>
                </Field>
              </div>
              <FieldGroup label={t("Pool members")}>
                <div className="max-h-72 space-y-3 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-default)] p-2">
                  {groupedDrives.map(([deviceId, entries]) => (
                    <div key={deviceId}>
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        {devices.find((device) => device.id === deviceId)
                          ?.hostname ?? t("Unassigned drives")}
                      </div>
                      <div className="space-y-1">
                        {entries.map((drive) => {
                          const eligible = isPoolDriveEligible(
                            drive,
                            selected?.id,
                          );
                          const checked = form.driveIds.includes(drive.id);
                          return (
                            <label
                              key={drive.id}
                              className={cn(
                                "flex items-start gap-2 rounded px-2 py-1.5 text-xs",
                                eligible || checked
                                  ? "hover:bg-[var(--surface-hover)]"
                                  : "opacity-50",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={checked}
                                disabled={!canEdit || (!eligible && !checked)}
                                onChange={(e) =>
                                  setForm({
                                    ...form,
                                    driveIds: e.target.checked
                                      ? [...form.driveIds, drive.id]
                                      : form.driveIds.filter(
                                          (id) => id !== drive.id,
                                        ),
                                  })
                                }
                              />
                              <span className="min-w-0">
                                <span className="block text-[var(--text-primary)]">
                                  {driveLabel(drive)}
                                </span>
                                <span className="block font-mono text-[10px] text-[var(--text-muted)]">
                                  {drive.serial || "—"}
                                </span>
                                <span className="block text-[var(--text-muted)]">
                                  {drive.slotName
                                    ? t("{value1}{value2}", {
                                        value1: drive.slotSectionName,
                                        value2: t("· {value1}", {
                                          value1: drive.slotName,
                                        }),
                                      })
                                    : t("Member missing from a physical slot")}
                                  {drive.poolName &&
                                  drive.poolId !== selected?.id
                                    ? t("· {value1}", {
                                        value1: t("Assigned to {name}", {
                                          name: drive.poolName,
                                        }),
                                      })
                                    : ""}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </FieldGroup>
              <Field label={t("Notes")}>
                <textarea
                  className={textareaClass}
                  rows={3}
                  disabled={!canEdit}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
              {error && (
                <div className="text-xs text-[var(--danger)]">{error}</div>
              )}
              {canEdit && (
                <div className="flex justify-between gap-2">
                  {selected ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void removePool()}
                    >
                      <Trash2 className="size-3.5" />
                      {t("Delete pool")}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={() => void savePool()}
                  >
                    <Save className="size-3.5" />
                    {selected ? t("Save pool") : t("Create pool")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function TemplateLibrary({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useI18n();
  const templates = useStore((state) => state.driveBayTemplates);
  const deviceTypes = useStore((state) => state.deviceTypes);
  const [selectedId, setSelectedId] = useState<string | null>(
    templates[0]?.id ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TemplateForm>(EMPTY_TEMPLATE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected =
    templates.find((template) => template.id === selectedId) ?? null;
  const editing = creating || Boolean(selected && !selected.builtIn && isAdmin);
  const previewSections = useMemo(
    () => form.sections.map(sectionDraftToTemplate),
    [form.sections],
  );

  useEffect(() => {
    if (creating) return;
    const current = templates.find((template) => template.id === selectedId);
    if (current) {
      setForm(templateToForm(current, t));
      return;
    }
    if (templates[0]) {
      setSelectedId(templates[0].id);
      setForm(templateToForm(templates[0], t));
    }
  }, [creating, selectedId, t, templates]);

  function openTemplate(template: DriveBayTemplate) {
    setSelectedId(template.id);
    setCreating(false);
    setForm(templateToForm(template, t));
    setError("");
  }

  function startTemplate() {
    setSelectedId(null);
    setCreating(true);
    setForm({ ...EMPTY_TEMPLATE_FORM, sections: [newSection()] });
    setError("");
  }

  async function saveTemplate() {
    const committedSections = form.sections.map(commitTemplateSectionCount);
    if (
      !form.name.trim() ||
      form.deviceTypes.length === 0 ||
      committedSections.some((section) => section == null)
    ) {
      setError(t("Storage changes could not be saved."));
      return;
    }
    const normalizedSections = committedSections.filter(
      (section): section is TemplateSectionDraft => section != null,
    );
    const normalizedPreview = normalizedSections.map(sectionDraftToTemplate);
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        deviceTypes: form.deviceTypes,
        sections: normalizedPreview,
      };
      const saved =
        selected && !selected.builtIn
          ? await updateDriveBayTemplateRecord(selected.id, payload)
          : await createDriveBayTemplateRecord(payload);
      setSelectedId(saved.id);
      setCreating(false);
      setForm({ ...form, sections: normalizedSections });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Storage changes could not be saved."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate() {
    if (
      !selected ||
      selected.builtIn ||
      !window.confirm(t("Delete this drive-bay template?"))
    )
      return;
    setSaving(true);
    try {
      await deleteDriveBayTemplateRecord(selected.id);
      setSelectedId(
        templates.find((entry) => entry.id !== selected.id)?.id ?? null,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Storage changes could not be saved."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>
            <CardLabel>{t("Template library")}</CardLabel>
            <CardHeading>{t("Drive-bay templates")}</CardHeading>
          </CardTitle>
          {isAdmin && (
            <Button
              size="icon"
              onClick={startTemplate}
              aria-label={t("Custom template")}
            >
              <Plus className="size-4" />
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-2">
          {templates.map((template) => {
            const display = driveBayTemplateDisplayCopy(template, t);
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => openTemplate(template)}
                className={cn(
                  "w-full rounded-[var(--radius-md)] border p-3 text-left transition-colors",
                  selected?.id === template.id
                    ? "border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)]"
                    : "border-[var(--border-default)] hover:bg-[var(--surface-hover)]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--text-primary)]">
                    {display.name}
                  </span>
                  <Badge tone={template.builtIn ? "neutral" : "info"}>
                    {template.builtIn
                      ? t("Built-in template")
                      : t("Custom template")}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-[var(--text-muted)]">
                  {template.sections.reduce(
                    (sum, section) => sum + section.slots.length,
                    0,
                  )}{" "}
                  {t("Slot count")}
                </div>
              </button>
            );
          })}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <CardLabel>{t("Template details")}</CardLabel>
            <CardHeading>
              {creating
                ? t("Custom template")
                : selected
                  ? driveBayTemplateDisplayCopy(selected, t).name
                  : t("Drive-bay templates")}
            </CardHeading>
          </CardTitle>
          {selected && (
            <Badge tone={selected.builtIn ? "neutral" : "info"}>
              {selected.builtIn ? t("Built-in template") : t("Custom template")}
            </Badge>
          )}
        </CardHeader>
        <CardBody>
          {!selected && !creating ? (
            <EmptyState icon={HardDrive} title={t("Drive-bay templates")} />
          ) : (
            <div className="space-y-4">
              <div className="rounded-[var(--radius-md)] border border-[var(--info-border)] bg-[var(--info-soft)] p-3 text-xs text-[var(--text-secondary)]">
                {t(
                  "Templates are copied to devices; later edits do not change existing slots.",
                )}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <Field label={t("Name")}>
                  <Input
                    disabled={!editing}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </Field>
                <Field label={t("Description")}>
                  <Input
                    disabled={!editing}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </Field>
              </div>
              <FieldGroup label={t("Compatible device types")}>
                <div className="flex flex-wrap gap-2">
                  {deviceTypes.map((type) => {
                    const checked = form.deviceTypes.includes(type.id);
                    return (
                      <label
                        key={type.id}
                        className={cn(
                          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                          checked
                            ? "border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)]"
                            : "border-[var(--border-default)]",
                        )}
                      >
                        <input
                          type="checkbox"
                          aria-label={localizedDeviceTypeLabel(type, t)}
                          disabled={!editing}
                          checked={checked}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              deviceTypes: e.target.checked
                                ? [...form.deviceTypes, type.id]
                                : form.deviceTypes.filter(
                                    (id) => id !== type.id,
                                  ),
                            })
                          }
                        />
                        {localizedDeviceTypeLabel(type, t)}
                      </label>
                    );
                  })}
                </div>
              </FieldGroup>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="rk-kicker">{t("Drive bays")}</div>
                  {editing && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setForm({
                          ...form,
                          sections: [
                            ...form.sections,
                            newSection(form.sections.length),
                          ],
                        })
                      }
                    >
                      <Plus className="size-3.5" />
                      {t("Add section")}
                    </Button>
                  )}
                </div>
                {form.sections.map((section, index) => (
                  <div
                    key={section.id}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  >
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label={t("Name")}>
                        <Input
                          disabled={!editing}
                          value={section.name}
                          onChange={(e) =>
                            changeSection(setForm, form, section.id, {
                              name: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label={t("Slot count")}>
                        <Input
                          disabled={!editing}
                          type="number"
                          min="1"
                          max="500"
                          value={section.count}
                          onChange={(e) =>
                            changeSection(setForm, form, section.id, {
                              count: e.target.value,
                            })
                          }
                          onBlur={() =>
                            setForm((current) => ({
                              ...current,
                              sections: current.sections.map((entry) =>
                                entry.id === section.id
                                  ? (commitTemplateSectionCount(entry) ?? entry)
                                  : entry,
                              ),
                            }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </Field>
                      <Field label={t("Columns")}>
                        <Input
                          disabled={!editing}
                          type="number"
                          min="1"
                          max="24"
                          value={section.columns}
                          onChange={(e) =>
                            changeSection(setForm, form, section.id, {
                              columns: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label={t("Slot prefix")}>
                        <Input
                          disabled={!editing}
                          value={section.prefix}
                          placeholder={t("Custom template")}
                          onChange={(e) => {
                            const prefix = e.target.value;
                            changeSection(setForm, form, section.id, {
                              prefix,
                              slots: renameDriveBaySlots(section.slots, prefix),
                            });
                          }}
                        />
                      </Field>
                      <Field label={t("Slot type")}>
                        <select
                          disabled={!editing}
                          className={selectClass}
                          value={section.slotType}
                          onChange={(e) => {
                            const slotType = e.target.value as DriveSlotType;
                            changeSection(setForm, form, section.id, {
                              slotType,
                              slots: setDriveBaySlotType(
                                section.slots,
                                slotType,
                              ),
                            });
                          }}
                        >
                          {section.slotType === "mixed" && (
                            <option value="mixed" disabled>
                              {t("Custom template")}
                            </option>
                          )}
                          {DRIVE_SLOT_TYPE_OPTIONS.map((value) => (
                            <option key={value} value={value}>
                              {driveSlotTypeLabel(value, t)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={t("Layout")}>
                        <select
                          disabled={!editing}
                          className={selectClass}
                          value={section.layout}
                          onChange={(e) =>
                            changeSection(setForm, form, section.id, {
                              layout: e.target.value as DriveSlotLayout,
                            })
                          }
                        >
                          <option value="grid">{t("Grid")}</option>
                          <option value="list">{t("List")}</option>
                        </select>
                      </Field>
                      <Field label={t("Face")}>
                        <select
                          disabled={!editing}
                          className={selectClass}
                          value={section.face}
                          onChange={(e) =>
                            changeSection(setForm, form, section.id, {
                              face: e.target.value as DriveSlotFace,
                            })
                          }
                        >
                          <option value="front">{t("Front")}</option>
                          <option value="rear">{t("Rear")}</option>
                          <option value="internal">{t("Internal")}</option>
                        </select>
                      </Field>
                      {editing && form.sections.length > 1 && (
                        <div className="flex items-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setForm({
                                ...form,
                                sections: form.sections.filter(
                                  (entry) => entry.id !== section.id,
                                ),
                              })
                            }
                          >
                            <Trash2 className="size-3.5" />
                            {t("Delete section")}
                          </Button>
                        </div>
                      )}
                    </div>
                    {(section.slotType === "mixed" || !section.prefix) && (
                      <Badge className="mt-2" tone="neutral">
                        {t("Custom template")}
                      </Badge>
                    )}
                    <TemplatePreview section={previewSections[index]} />
                  </div>
                ))}
              </div>
              {error && (
                <div className="text-xs text-[var(--danger)]">{error}</div>
              )}
              {editing && (
                <div className="flex justify-between gap-2">
                  {selected && !selected.builtIn ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving}
                      onClick={() => void removeTemplate()}
                    >
                      <Trash2 className="size-3.5" />
                      {t("Delete template")}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={() => void saveTemplate()}
                  >
                    <Save className="size-3.5" />
                    {t("Save")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function TemplatePreview({
  section,
}: {
  section: ReturnType<typeof sectionDraftToTemplate>;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-3">
      <div className="mb-2 rk-kicker">{t("Layout preview")}</div>
      <div
        className={cn(
          section.layout === "grid" ? "grid gap-1.5" : "space-y-1.5",
        )}
        style={
          section.layout === "grid"
            ? {
                gridTemplateColumns: `repeat(${section.columns ?? 1}, minmax(0, 1fr))`,
              }
            : undefined
        }
      >
        {section.slots.map((slot) => (
          <div
            key={slot.position}
            className="min-w-0 rounded border border-[var(--border-default)] bg-[var(--surface-2)] px-2 py-2 text-center font-mono text-[10px] text-[var(--text-secondary)]"
            title={slot.name}
          >
            <span className="block break-words">{slot.name}</span>
            <span className="text-[var(--text-muted)]">
              {driveSlotTypeLabel(slot.slotType, t)}
            </span>
          </div>
        ))}
      </div>
    </div>
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
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.11em] text-[var(--text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="mb-1 block font-mono text-[10px] uppercase tracking-[0.11em] text-[var(--text-muted)]">
        {label}
      </legend>
      {children}
    </fieldset>
  );
}

function driveToForm(drive: StorageDrive): DriveForm {
  const useTb = drive.capacityGb >= 1000;
  return {
    manufacturer: drive.manufacturer ?? "",
    model: drive.model ?? "",
    serial: drive.serial ?? "",
    capacity: String(useTb ? drive.capacityGb / 1000 : drive.capacityGb),
    capacityUnit: useTb ? "tb" : "gb",
    interface: drive.interface,
    formFactor: drive.formFactor,
    notes: drive.notes ?? "",
    slotId: drive.slotId ?? "",
  };
}

function poolToForm(pool: StoragePool): PoolForm {
  const useTb = pool.usableCapacityGb >= 1000;
  return {
    deviceId: pool.deviceId,
    name: pool.name,
    poolType: pool.poolType,
    usableCapacity: String(
      useTb ? pool.usableCapacityGb / 1000 : pool.usableCapacityGb,
    ),
    capacityUnit: useTb ? "tb" : "gb",
    status: pool.status,
    notes: pool.notes ?? "",
    driveIds: pool.driveIds,
  };
}

function templateToForm(
  template: DriveBayTemplate,
  t: ReturnType<typeof useI18n>["t"],
): TemplateForm {
  const display = driveBayTemplateDisplayCopy(template, t);
  return {
    name: display.name,
    description: display.description,
    deviceTypes: template.deviceTypes,
    sections: template.sections.map((section, index) => ({
      id: `${template.id}-${index}`,
      name: section.name,
      face: section.face,
      layout: section.layout,
      count: String(section.slots.length),
      columns: String(section.columns ?? 1),
      slotType: uniformDriveBaySlotType(section.slots) ?? "mixed",
      prefix: inferDriveBaySlotPrefix(section.slots) ?? "",
      slots: section.slots.map((slot) => ({ ...slot })),
    })),
  };
}

function sectionDraftToTemplate(section: TemplateSectionDraft) {
  return serializeDriveBayTemplateSection({
    name: section.name,
    face: section.face,
    layout: section.layout,
    columns: section.layout === "grid" ? Number(section.columns) || 1 : null,
    slots: section.slots.map((slot) => ({ ...slot })),
  });
}

function commitTemplateSectionCount(section: TemplateSectionDraft) {
  const fallbackType =
    section.slotType === "mixed"
      ? (section.slots.at(-1)?.slotType ?? "generic")
      : section.slotType;
  const slots = commitDriveBaySlotCount(section.slots, section.count, {
    prefix: section.prefix || "Slot ",
    slotType: fallbackType,
  });
  if (!slots) return null;
  return { ...section, count: String(slots.length), slots };
}

function changeSection(
  setForm: React.Dispatch<React.SetStateAction<TemplateForm>>,
  form: TemplateForm,
  id: string,
  changes: Partial<TemplateSectionDraft>,
) {
  setForm({
    ...form,
    sections: form.sections.map((section) =>
      section.id === id ? { ...section, ...changes } : section,
    ),
  });
}

const selectClass =
  "h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-2)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary-border)] disabled:opacity-60";
const textareaClass =
  "w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary-border)] disabled:opacity-60";
