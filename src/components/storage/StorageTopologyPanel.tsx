import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  Database,
  HardDrive,
  Plus,
  Save,
  Trash2,
  Unplug,
} from "lucide-react";
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
import { deviceTypeMatchesTemplate } from "@/lib/device-types";
import {
  applyDriveBayTemplateRecord,
  canEditInventory,
  createDriveSlotRecord,
  createStorageDriveRecord,
  createStoragePoolRecord,
  deleteDriveSlotRecord,
  deleteStorageDriveRecord,
  deleteStoragePoolRecord,
  updateDriveSlotRecord,
  updateStorageDriveRecord,
  updateStoragePoolRecord,
  useStore,
} from "@/lib/store";
import {
  DRIVE_FORM_FACTOR_OPTIONS,
  DRIVE_INTERFACE_OPTIONS,
  DRIVE_SLOT_TYPE_OPTIONS,
  driveBayTemplateDisplayCopy,
  driveFormFactorLabel,
  driveInterfaceLabel,
  driveLabel,
  driveSecondaryLabel,
  formatStorageCapacity,
  poolColor,
  poolTypeLabel,
  STORAGE_POOL_STATUS_OPTIONS,
  STORAGE_POOL_TYPE_OPTIONS,
  summarizeStorage,
  storagePoolStatusLabel,
} from "@/lib/storage";
import type {
  DriveFormFactor,
  DriveInterface,
  DriveSlot,
  DriveSlotFace,
  DriveSlotLayout,
  DriveSlotType,
  StorageDrive,
  StoragePool,
  StoragePoolStatus,
  StoragePoolType,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface StorageTopologyPanelProps {
  deviceId: string;
}

type DriveForm = {
  manufacturer: string;
  model: string;
  serial: string;
  capacity: string;
  capacityUnit: "gb" | "tb";
  interface: DriveInterface;
  formFactor: DriveFormFactor;
  notes: string;
};

type SlotForm = {
  name: string;
  sectionName: string;
  sectionOrder: string;
  position: string;
  slotType: DriveSlotType;
  face: DriveSlotFace;
  layout: DriveSlotLayout;
  columns: string;
};

type PoolForm = {
  name: string;
  poolType: StoragePoolType;
  usableCapacity: string;
  capacityUnit: "gb" | "tb";
  status: StoragePoolStatus;
  notes: string;
  driveIds: string[];
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
};

const EMPTY_SLOT_FORM: SlotForm = {
  name: "",
  sectionName: "Drive bays",
  sectionOrder: "0",
  position: "1",
  slotType: "generic",
  face: "front",
  layout: "grid",
  columns: "4",
};

const EMPTY_POOL_FORM: PoolForm = {
  name: "",
  poolType: "raidz1",
  usableCapacity: "",
  capacityUnit: "tb",
  status: "unknown",
  notes: "",
  driveIds: [],
};

export function StorageTopologyPanel({ deviceId }: StorageTopologyPanelProps) {
  const { t } = useI18n();
  const currentUser = useStore((state) => state.currentUser);
  const lab = useStore((state) => state.lab);
  const devices = useStore((state) => state.devices);
  const deviceTypes = useStore((state) => state.deviceTypes);
  const templates = useStore((state) => state.driveBayTemplates);
  const allSlots = useStore((state) => state.driveSlots);
  const drives = useStore((state) => state.storageDrives);
  const allPools = useStore((state) => state.storagePools);
  const device = devices.find((entry) => entry.id === deviceId);
  const slots = useMemo(
    () => allSlots.filter((slot) => slot.deviceId === deviceId),
    [allSlots, deviceId],
  );
  const pools = useMemo(
    () => allPools.filter((pool) => pool.deviceId === deviceId),
    [allPools, deviceId],
  );
  const canEdit = canEditInventory(currentUser, lab.id);
  const compatibleTemplates = useMemo(
    () =>
      device
        ? templates.filter((template) =>
            deviceTypeMatchesTemplate(
              device.deviceType,
              template.deviceTypes,
              deviceTypes,
            ),
          )
        : [],
    [device, deviceTypes, templates],
  );
  const deviceDrives = useMemo(
    () => drives.filter((drive) => drive.deviceId === deviceId),
    [deviceId, drives],
  );
  const summary = useMemo(
    () => summarizeStorage(deviceDrives, slots, pools, drives),
    [deviceDrives, drives, pools, slots],
  );
  const attachedPools = useMemo(() => {
    const installedDriveIds = new Set(
      drives
        .filter((drive) => drive.deviceId === deviceId && drive.slotId)
        .map((drive) => drive.id),
    );
    return allPools.filter(
      (pool) =>
        pool.deviceId !== deviceId &&
        pool.driveIds.some((driveId) => installedDriveIds.has(driveId)),
    );
  }, [allPools, deviceId, drives]);

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [creatingSlot, setCreatingSlot] = useState(false);
  const [slotForm, setSlotForm] = useState<SlotForm>(EMPTY_SLOT_FORM);
  const [driveForm, setDriveForm] = useState<DriveForm>(EMPTY_DRIVE_FORM);
  const [installDriveId, setInstallDriveId] = useState("");
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [creatingPool, setCreatingPool] = useState(false);
  const [poolForm, setPoolForm] = useState<PoolForm>(EMPTY_POOL_FORM);
  const [hoveredPoolId, setHoveredPoolId] = useState<string | null>(null);
  const [focusedPoolId, setFocusedPoolId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const selectedDrive = selectedSlot?.driveId
    ? (drives.find((drive) => drive.id === selectedSlot.driveId) ?? null)
    : null;
  const selectedPool = pools.find((pool) => pool.id === selectedPoolId) ?? null;
  const highlightedPoolId = focusedPoolId ?? hoveredPoolId;
  const inconsistentSections = useMemo(
    () => [
      ...new Set(
        slots
          .filter((slot) => slot.sectionInconsistent)
          .map((slot) => slot.sectionName),
      ),
    ],
    [slots],
  );

  function repairSection(sectionName: string) {
    const firstSlot = [...slots]
      .filter((slot) => slot.sectionName === sectionName)
      .sort((left, right) => left.position - right.position)[0];
    if (!firstSlot) return;
    setCreatingSlot(false);
    setSelectedSlotId(firstSlot.id);
    setSlotForm(slotToForm(firstSlot));
  }

  useEffect(() => {
    if (compatibleTemplates.length === 0) {
      setSelectedTemplateId("");
      return;
    }
    if (
      !compatibleTemplates.some(
        (template) => template.id === selectedTemplateId,
      )
    ) {
      setSelectedTemplateId(compatibleTemplates[0].id);
    }
  }, [compatibleTemplates, selectedTemplateId]);

  useEffect(() => {
    if (creatingSlot) return;
    if (selectedSlotId && slots.some((slot) => slot.id === selectedSlotId))
      return;
    setSelectedSlotId(slots[0]?.id ?? null);
  }, [creatingSlot, selectedSlotId, slots]);

  useEffect(() => {
    if (creatingSlot) {
      const sample = [...slots].sort(
        (left, right) =>
          left.sectionOrder - right.sectionOrder ||
          left.position - right.position,
      )[0];
      const sectionSlots = sample
        ? slots.filter((slot) => slot.sectionName === sample.sectionName)
        : [];
      const maxPosition = Math.max(
        0,
        ...sectionSlots.map((slot) => slot.position),
      );
      setSlotForm(
        sample
          ? {
              ...slotToForm(sample),
              name: "",
              position: String(maxPosition + 1),
              slotType: "generic",
            }
          : { ...EMPTY_SLOT_FORM },
      );
      setDriveForm(EMPTY_DRIVE_FORM);
      return;
    }
    if (!selectedSlot) return;
    setSlotForm(slotToForm(selectedSlot));
    setDriveForm(
      selectedDrive
        ? driveToForm(selectedDrive)
        : driveFormForSlot(selectedSlot),
    );
    setInstallDriveId("");
  }, [creatingSlot, selectedDrive, selectedSlot, slots]);

  useEffect(() => {
    if (creatingPool) {
      setPoolForm(EMPTY_POOL_FORM);
      return;
    }
    if (selectedPool) setPoolForm(poolToForm(selectedPool));
  }, [creatingPool, selectedPool]);

  useEffect(() => {
    if (creatingPool) return;
    if (selectedPoolId && pools.some((pool) => pool.id === selectedPoolId))
      return;
    setSelectedPoolId(pools[0]?.id ?? null);
  }, [creatingPool, pools, selectedPoolId]);

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError("");
    try {
      await action();
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

  async function handleApplyTemplate() {
    if (!selectedTemplateId) return;
    setApplyingTemplate(true);
    setError("");
    try {
      const created = await applyDriveBayTemplateRecord(
        deviceId,
        selectedTemplateId,
      );
      setSelectedSlotId(created[0]?.id ?? null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Storage changes could not be saved."),
      );
    } finally {
      setApplyingTemplate(false);
    }
  }

  async function handleSaveSlot() {
    const payload = {
      deviceId,
      name: slotForm.name.trim(),
      sectionName: slotForm.sectionName.trim(),
      sectionOrder: Number.parseInt(slotForm.sectionOrder, 10) || 0,
      position: Number.parseInt(slotForm.position, 10) || 1,
      slotType: slotForm.slotType,
      face: slotForm.face,
      layout: slotForm.layout,
      columns:
        slotForm.layout === "grid"
          ? Number.parseInt(slotForm.columns, 10) || 4
          : null,
    };
    if (!payload.name) {
      setError(t("Name"));
      return;
    }
    await run(async () => {
      if (creatingSlot) {
        const created = await createDriveSlotRecord(payload);
        setCreatingSlot(false);
        setSelectedSlotId(created.id);
      } else if (selectedSlot) {
        await updateDriveSlotRecord(selectedSlot.id, payload);
      }
    });
  }

  async function handleDeleteSlot() {
    if (!selectedSlot || !window.confirm(t("Delete this empty slot?"))) return;
    await run(async () => {
      await deleteDriveSlotRecord(selectedSlot.id);
      setSelectedSlotId(null);
    });
  }

  async function handleSaveDrive() {
    if (!selectedSlot) return;
    const capacity = Number.parseFloat(driveForm.capacity);
    if (!Number.isFinite(capacity) || capacity < 0) {
      setError(t("Capacity"));
      return;
    }
    const payload = {
      manufacturer: driveForm.manufacturer.trim() || null,
      model: driveForm.model.trim() || null,
      serial: driveForm.serial.trim() || null,
      capacityGb: driveForm.capacityUnit === "tb" ? capacity * 1000 : capacity,
      interface: driveForm.interface,
      formFactor: driveForm.formFactor,
      notes: driveForm.notes.trim() || null,
      slotId: selectedSlot.id,
    };
    await run(async () => {
      if (selectedDrive) {
        await updateStorageDriveRecord(selectedDrive.id, payload);
      } else {
        await createStorageDriveRecord(payload);
      }
    });
  }

  async function handleInstallExistingDrive() {
    if (!selectedSlot || !installDriveId) return;
    await run(async () => {
      await updateStorageDriveRecord(installDriveId, {
        slotId: selectedSlot.id,
      });
      setInstallDriveId("");
    });
  }

  async function handlePullDrive() {
    if (!selectedDrive) return;
    await run(() =>
      updateStorageDriveRecord(selectedDrive.id, { slotId: null }),
    );
  }

  async function handleDeleteDrive() {
    if (!selectedDrive || !window.confirm(t("Delete this drive?"))) return;
    await run(() => deleteStorageDriveRecord(selectedDrive.id));
  }

  async function handleSavePool() {
    const capacity = Number.parseFloat(poolForm.usableCapacity);
    if (!poolForm.name.trim() || !Number.isFinite(capacity) || capacity < 0) {
      setError(t("Pool name"));
      return;
    }
    const payload = {
      name: poolForm.name.trim(),
      poolType: poolForm.poolType,
      usableCapacityGb:
        poolForm.capacityUnit === "tb" ? capacity * 1000 : capacity,
      status: poolForm.status,
      notes: poolForm.notes.trim() || null,
      driveIds: poolForm.driveIds,
    };
    await run(async () => {
      if (creatingPool) {
        const created = await createStoragePoolRecord({ deviceId, ...payload });
        setCreatingPool(false);
        setSelectedPoolId(created.id);
      } else if (selectedPool) {
        await updateStoragePoolRecord(selectedPool.id, payload);
      }
    });
  }

  async function handleDeletePool() {
    if (!selectedPool || !window.confirm(t("Delete this storage pool?")))
      return;
    await run(async () => {
      await deleteStoragePoolRecord(selectedPool.id);
      setSelectedPoolId(null);
    });
  }

  if (!device) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StorageMetric
          icon={<Boxes />}
          label={t("Occupied slots")}
          testId="device-storage-occupied"
          value={`${summary.occupiedSlots}/${summary.totalSlots}`}
        />
        <StorageMetric
          icon={<HardDrive />}
          label={t("Raw capacity")}
          testId="device-storage-raw-capacity"
          value={formatStorageCapacity(summary.rawCapacityGb)}
        />
        <StorageMetric
          icon={<Database />}
          label={t("Usable capacity")}
          testId="device-storage-usable-capacity"
          value={formatStorageCapacity(summary.usableCapacityGb)}
        />
        <StorageMetric
          icon={<AlertTriangle />}
          label={t("Storage attention")}
          testId="device-storage-attention"
          value={String(
            summary.unhealthyPools + summary.missingPoolMemberIds.length,
          )}
          warning={
            summary.unhealthyPools + summary.missingPoolMemberIds.length > 0
          }
        />
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        {t("Storage (GB) remains an independent imported or manual value.")}
      </p>

      {attachedPools.length > 0 && (
        <Card data-testid="attached-storage-pools">
          <CardHeader>
            <CardTitle>
              <CardLabel>{t("Relationships")}</CardLabel>
              <CardHeading>{t("Logical pools")}</CardHeading>
            </CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-2">
              {attachedPools.map((pool) => {
                const owner = devices.find(
                  (entry) => entry.id === pool.deviceId,
                );
                const memberCount = pool.driveIds.filter((driveId) =>
                  drives.some(
                    (drive) =>
                      drive.id === driveId &&
                      drive.deviceId === deviceId &&
                      drive.slotId,
                  ),
                ).length;
                return (
                  <div
                    key={pool.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="break-words text-sm font-semibold">
                        {pool.name}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {memberCount} {t("Drives")}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="info">{t("External / attached")}</Badge>
                      <span className="text-xs text-[var(--text-muted)]">
                        {t("Pool owner")}:
                      </span>
                      {owner ? (
                        <Button variant="link" size="sm" asChild>
                          <Link to={`/devices/${owner.id}?tab=storage`}>
                            {owner.hostname}
                          </Link>
                        </Button>
                      ) : (
                        <span className="text-xs text-[var(--color-warning)]">
                          {t("Unassigned")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {error && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <CardLabel>{t("Physical layout")}</CardLabel>
            <CardHeading>{t("Drive bays")}</CardHeading>
          </CardTitle>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCreatingSlot(true);
                setSelectedSlotId(null);
              }}
            >
              <Plus />
              {t("Add slot")}
            </Button>
          )}
        </CardHeader>
        <CardBody>
          {slots.length === 0 && (
            <div className="mb-4 grid gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-1)] p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <Field label={t("Drive-bay template")}>
                <Select
                  value={selectedTemplateId}
                  onChange={(event) =>
                    setSelectedTemplateId(event.target.value)
                  }
                  disabled={!canEdit || compatibleTemplates.length === 0}
                >
                  {compatibleTemplates.length === 0 ? (
                    <option value="">{t("No drive-bay template")}</option>
                  ) : (
                    compatibleTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {driveBayTemplateDisplayCopy(template, t).name}
                      </option>
                    ))
                  )}
                </Select>
              </Field>
              {canEdit && (
                <Button
                  size="sm"
                  onClick={() => void handleApplyTemplate()}
                  disabled={!selectedTemplateId || applyingTemplate}
                >
                  {applyingTemplate ? t("Applying...") : t("Apply template")}
                </Button>
              )}
              <p className="text-xs text-[var(--text-muted)] lg:col-span-2">
                {t("Templates can only be applied before slots are added.")}
              </p>
            </div>
          )}

          {inconsistentSections.length > 0 && (
            <div
              className="mb-4 flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]"
              role="status"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{t("Storage attention")}</div>
                <div>{t("Shared section settings do not match.")}</div>
                {canEdit && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {inconsistentSections.map((sectionName) => (
                      <Button
                        key={sectionName}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => repairSection(sectionName)}
                      >
                        {t("Repair section")}: {sectionName}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {slots.length === 0 && !creatingSlot ? (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] px-4 py-10 text-center">
              <HardDrive className="mx-auto size-7 text-[var(--text-muted)]" />
              <div className="mt-3 text-sm font-medium">
                {t("No drive slots configured.")}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {t("Apply a template or add a slot manually.")}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <DriveSlotGrid
                slots={slots}
                drives={drives}
                pools={allPools}
                selectedSlotId={selectedSlotId}
                highlightedPoolId={highlightedPoolId}
                onSelect={(slotId) => {
                  setCreatingSlot(false);
                  setSelectedSlotId(slotId);
                }}
                onHoverPool={setHoveredPoolId}
                onFocusPool={setFocusedPoolId}
              />

              {(selectedSlot || creatingSlot) && (
                <div className="space-y-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-1)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="rk-kicker">{t("Slot details")}</div>
                      <div className="mt-1 text-sm font-semibold">
                        {creatingSlot ? t("New slot") : selectedSlot?.name}
                      </div>
                    </div>
                    {!creatingSlot && selectedSlot?.driveId && (
                      <Badge tone="info">{t("Installed")}</Badge>
                    )}
                  </div>

                  <SlotEditor
                    form={slotForm}
                    onChange={setSlotForm}
                    disabled={!canEdit}
                    slots={slots}
                    creating={creatingSlot}
                  />
                  {canEdit && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => void handleSaveSlot()}
                        disabled={saving}
                      >
                        <Save />
                        {creatingSlot ? t("Add slot") : t("Save slot")}
                      </Button>
                      {!creatingSlot &&
                        selectedSlot &&
                        !selectedSlot.driveId && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void handleDeleteSlot()}
                            disabled={saving}
                          >
                            <Trash2 />
                            {t("Delete slot")}
                          </Button>
                        )}
                    </div>
                  )}

                  {!creatingSlot && selectedSlot && (
                    <div className="border-t border-[var(--border-subtle)] pt-4">
                      <div className="rk-kicker">{t("Drive details")}</div>
                      {!selectedDrive && canEdit && drives.length > 0 && (
                        <div className="mt-3 flex items-end gap-2">
                          <Field label={t("Installed drive")}>
                            <Select
                              value={installDriveId}
                              onChange={(event) =>
                                setInstallDriveId(event.target.value)
                              }
                            >
                              <option value="">
                                {t("Select a drive or create a new one.")}
                              </option>
                              {drives.map((drive) => (
                                <option key={drive.id} value={drive.id}>
                                  {driveLabel(drive)}{" "}
                                  {t("· {value1}", {
                                    value1: driveSecondaryLabel(drive, t),
                                  })}
                                  {drive.deviceHostname
                                    ? t("· {value1}", {
                                        value1: `${drive.deviceHostname}/${drive.slotName}`,
                                      })
                                    : ""}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!installDriveId || saving}
                            onClick={() => void handleInstallExistingDrive()}
                          >
                            {t("Install")}
                          </Button>
                        </div>
                      )}
                      <div className="mt-3">
                        <DriveEditor
                          form={driveForm}
                          onChange={setDriveForm}
                          disabled={!canEdit}
                        />
                      </div>
                      {canEdit && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => void handleSaveDrive()}
                            disabled={saving}
                          >
                            <Save />
                            {selectedDrive
                              ? t("Save drive")
                              : t("Create drive")}
                          </Button>
                          {selectedDrive && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handlePullDrive()}
                              disabled={saving}
                            >
                              <Unplug />
                              {t("Pull drive")}
                            </Button>
                          )}
                          {selectedDrive && !selectedDrive.poolId && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => void handleDeleteDrive()}
                              disabled={saving}
                            >
                              <Trash2 />
                              {t("Delete drive")}
                            </Button>
                          )}
                        </div>
                      )}
                      {selectedDrive?.poolId && (
                        <div className="mt-3 text-xs text-[var(--text-muted)]">
                          {t("Assigned to {name}", {
                            name: selectedDrive.poolName ?? t("Pool"),
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <CardLabel>{t("Logical storage")}</CardLabel>
            <CardHeading>{t("Logical pools")}</CardHeading>
          </CardTitle>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCreatingPool(true);
                setSelectedPoolId(null);
              }}
            >
              <Plus />
              {t("New pool")}
            </Button>
          )}
        </CardHeader>
        <CardBody>
          {pools.length === 0 && !creatingPool ? (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
              {t("No storage pools documented yet.")}
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
              <div className="space-y-2">
                {pools.map((pool) => {
                  const missing = pool.driveIds.filter(
                    (driveId) =>
                      !drives.find((drive) => drive.id === driveId)?.slotId,
                  ).length;
                  return (
                    <button
                      key={pool.id}
                      type="button"
                      className={cn(
                        "w-full rounded-[var(--radius-md)] border p-3 text-left transition-colors",
                        selectedPoolId === pool.id && !creatingPool
                          ? "border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)]"
                          : "border-[var(--border-default)] bg-[var(--surface-1)] hover:border-[var(--border-strong)]",
                      )}
                      onClick={() => {
                        setCreatingPool(false);
                        setSelectedPoolId(pool.id);
                      }}
                      onMouseEnter={() => setHoveredPoolId(pool.id)}
                      onMouseLeave={() => setHoveredPoolId(null)}
                      onFocus={() => setFocusedPoolId(pool.id)}
                      onBlur={() => setFocusedPoolId(null)}
                      aria-label={t("Open pool {name}", { name: pool.name })}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 break-words text-sm font-semibold">
                          {pool.name}
                        </span>
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: poolColor(pool.id) }}
                        />
                      </div>
                      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        {poolTypeLabel(pool.poolType, t)} ·{" "}
                        {formatStorageCapacity(pool.usableCapacityGb)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone={poolStatusTone(pool.status)}>
                          {storagePoolStatusLabel(pool.status, t)}
                        </Badge>
                        <Badge tone="neutral">
                          {pool.driveIds.length} {t("Drives")}
                        </Badge>
                        {missing > 0 && (
                          <Badge tone="err">
                            {missing} {t("Missing")}
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {(selectedPool || creatingPool) && (
                <PoolEditor
                  form={poolForm}
                  onChange={setPoolForm}
                  pool={selectedPool}
                  drives={drives}
                  devices={devices}
                  ownerDeviceId={deviceId}
                  disabled={!canEdit}
                  onSave={() => void handleSavePool()}
                  onDelete={() => void handleDeletePool()}
                  saving={saving}
                  creating={creatingPool}
                  highlightedPoolId={highlightedPoolId}
                  onHoverPool={setHoveredPoolId}
                  onFocusPool={setFocusedPoolId}
                />
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button variant="link" size="sm" asChild>
          <Link to="/storage">{t("Manage storage")}</Link>
        </Button>
      </div>
    </div>
  );
}

function StorageMetric({
  icon,
  label,
  value,
  warning,
  testId,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  warning?: boolean;
  testId?: string;
}) {
  return (
    <div
      className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-1)] p-3"
      data-testid={testId}
    >
      <div className="flex items-center gap-2 text-[var(--text-muted)] [&_svg]:size-4">
        {icon}
        <span className="font-mono text-[10px] uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "mt-2 text-xl font-semibold",
          warning && "text-[var(--danger)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function DriveSlotGrid({
  slots,
  drives,
  pools,
  selectedSlotId,
  highlightedPoolId,
  onSelect,
  onHoverPool,
  onFocusPool,
}: {
  slots: DriveSlot[];
  drives: StorageDrive[];
  pools: StoragePool[];
  selectedSlotId: string | null;
  highlightedPoolId: string | null;
  onSelect: (slotId: string) => void;
  onHoverPool: (poolId: string | null) => void;
  onFocusPool: (poolId: string | null) => void;
}) {
  const { t } = useI18n();
  const driveById = new Map(drives.map((drive) => [drive.id, drive]));
  const poolById = new Map(pools.map((pool) => [pool.id, pool]));
  const sections = [...new Set(slots.map((slot) => slot.sectionName))];
  return (
    <div className="space-y-4">
      {sections.map((sectionName) => {
        const sectionSlots = slots.filter(
          (slot) => slot.sectionName === sectionName,
        );
        const sample = sectionSlots[0];
        return (
          <section key={sectionName}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0 break-words text-xs font-semibold">
                {sectionName}
              </div>
              <div className="font-mono text-[10px] uppercase text-[var(--text-muted)]">
                {driveSlotFaceLabel(sample.face, t)} · {sectionSlots.length}
              </div>
            </div>
            <div
              className={cn(
                sample.layout === "grid"
                  ? "grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(4.25rem,1fr))] xl:[grid-template-columns:repeat(var(--slot-columns),minmax(0,1fr))]"
                  : "space-y-2",
              )}
              style={
                sample.layout === "grid"
                  ? ({
                      "--slot-columns": Math.min(sample.columns ?? 4, 12),
                    } as React.CSSProperties)
                  : undefined
              }
            >
              {sectionSlots.map((slot) => {
                const drive = slot.driveId
                  ? driveById.get(slot.driveId)
                  : undefined;
                const pool = drive?.poolId
                  ? poolById.get(drive.poolId)
                  : undefined;
                const highlighted = Boolean(
                  pool && pool.id === highlightedPoolId,
                );
                return (
                  <button
                    key={slot.id}
                    type="button"
                    className={cn(
                      "min-w-0 rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-2 text-left transition-[border-color,background-color,box-shadow,transform]",
                      selectedSlotId === slot.id
                        ? "border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)]"
                        : "border-[var(--border-default)] hover:border-[var(--border-strong)]",
                      highlighted &&
                        "-translate-y-0.5 shadow-[0_0_0_2px_var(--pool-color)]",
                    )}
                    style={
                      {
                        "--pool-color": pool
                          ? poolColor(pool.id)
                          : "transparent",
                        borderColor:
                          highlighted && pool ? poolColor(pool.id) : undefined,
                      } as React.CSSProperties
                    }
                    onClick={() => onSelect(slot.id)}
                    onMouseEnter={() => onHoverPool(pool?.id ?? null)}
                    onMouseLeave={() => onHoverPool(null)}
                    onFocus={() => onFocusPool(pool?.id ?? null)}
                    onBlur={() => onFocusPool(null)}
                    data-pool-highlighted={highlighted ? "true" : undefined}
                    title={
                      drive
                        ? t("{value1}{value2}", {
                            value1: driveLabel(drive),
                            value2: t("· {value1}", {
                              value1: driveSecondaryLabel(drive, t),
                            }),
                          })
                        : t("Empty slot")
                    }
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="min-w-0 break-words font-mono text-[10px] font-semibold">
                        {slot.name}
                      </span>
                      {pool && (
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: poolColor(pool.id) }}
                        />
                      )}
                    </div>
                    <div className="mt-1 min-w-0 break-words text-[11px] text-[var(--text-muted)]">
                      {drive ? driveLabel(drive) : t("Empty slot")}
                    </div>
                    {drive && (
                      <div className="mt-1 font-mono text-[9px] uppercase text-[var(--text-muted)]">
                        {formatStorageCapacity(drive.capacityGb)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SlotEditor({
  form,
  onChange,
  disabled,
  slots,
  creating,
}: {
  form: SlotForm;
  onChange: (next: SlotForm) => void;
  disabled: boolean;
  slots: DriveSlot[];
  creating: boolean;
}) {
  const { t } = useI18n();
  const sectionNames = [...new Set(slots.map((slot) => slot.sectionName))];
  const selectedExistingSection = creating
    ? (sectionNames.find((sectionName) => sectionName === form.sectionName) ??
      "")
    : "";
  const sharedSettingsLocked = disabled || Boolean(selectedExistingSection);
  const set = <K extends keyof SlotForm>(key: K, value: SlotForm[K]) =>
    onChange({ ...form, [key]: value });
  const setSectionName = (sectionName: string) => {
    const sample = slots.find((slot) => slot.sectionName === sectionName);
    if (!sample) {
      set("sectionName", sectionName);
      return;
    }
    const sectionSlots = slots.filter(
      (slot) => slot.sectionName === sectionName,
    );
    onChange({
      ...form,
      sectionName,
      sectionOrder: String(sample.sectionOrder),
      position: creating
        ? String(Math.max(0, ...sectionSlots.map((slot) => slot.position)) + 1)
        : form.position,
      face: sample.face,
      layout: sample.layout,
      columns: String(sample.columns ?? 4),
    });
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
      <Field label={t("Name")}>
        <Input
          value={form.name}
          onChange={(event) => set("name", event.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label={t("Section")}>
        {creating ? (
          <div className="space-y-2">
            <Select
              value={selectedExistingSection || "__new__"}
              onChange={(event) => {
                if (event.target.value === "__new__") {
                  set("sectionName", "");
                } else {
                  setSectionName(event.target.value);
                }
              }}
              disabled={disabled}
            >
              {sectionNames.map((sectionName) => (
                <option key={sectionName} value={sectionName}>
                  {sectionName}
                </option>
              ))}
              <option value="__new__">{t("Add section")}</option>
            </Select>
            {!selectedExistingSection && (
              <Input
                value={form.sectionName}
                onChange={(event) => setSectionName(event.target.value)}
                disabled={disabled}
                placeholder={t("Add section")}
              />
            )}
          </div>
        ) : (
          <Input
            value={form.sectionName}
            onChange={(event) => setSectionName(event.target.value)}
            disabled={disabled}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Section order")}>
          <Input
            type="number"
            min={0}
            value={form.sectionOrder}
            onChange={(event) => set("sectionOrder", event.target.value)}
            disabled={sharedSettingsLocked}
          />
        </Field>
        <Field label={t("Position")}>
          <Input
            type="number"
            min={1}
            value={form.position}
            onChange={(event) => set("position", event.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Slot type")}>
          <Select
            value={form.slotType}
            onChange={(event) =>
              set("slotType", event.target.value as DriveSlotType)
            }
            disabled={disabled}
          >
            {DRIVE_SLOT_TYPE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {driveFormFactorLabel(value, t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("Face")}>
          <Select
            value={form.face}
            onChange={(event) =>
              set("face", event.target.value as DriveSlotFace)
            }
            disabled={sharedSettingsLocked}
          >
            <option value="front">{t("Front")}</option>
            <option value="rear">{t("Rear")}</option>
            <option value="internal">{t("Internal")}</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Layout")}>
          <Select
            value={form.layout}
            onChange={(event) =>
              set("layout", event.target.value as DriveSlotLayout)
            }
            disabled={sharedSettingsLocked}
          >
            <option value="grid">{t("Grid")}</option>
            <option value="list">{t("List")}</option>
          </Select>
        </Field>
        {form.layout === "grid" && (
          <Field label={t("Columns")}>
            <Input
              type="number"
              min={1}
              max={24}
              value={form.columns}
              onChange={(event) => set("columns", event.target.value)}
              disabled={sharedSettingsLocked}
            />
          </Field>
        )}
      </div>
    </div>
  );
}

function DriveEditor({
  form,
  onChange,
  disabled,
}: {
  form: DriveForm;
  onChange: (next: DriveForm) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const set = <K extends keyof DriveForm>(key: K, value: DriveForm[K]) =>
    onChange({ ...form, [key]: value });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Manufacturer")}>
          <Input
            value={form.manufacturer}
            onChange={(event) => set("manufacturer", event.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label={t("Model")}>
          <Input
            value={form.model}
            onChange={(event) => set("model", event.target.value)}
            disabled={disabled}
          />
        </Field>
      </div>
      <Field label={t("Serial")}>
        <Input
          value={form.serial}
          onChange={(event) => set("serial", event.target.value)}
          disabled={disabled}
        />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
        <Field label={t("Capacity")}>
          <Input
            type="number"
            min={0}
            step="any"
            value={form.capacity}
            onChange={(event) => set("capacity", event.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label={t("Capacity unit")}>
          <Select
            value={form.capacityUnit}
            onChange={(event) =>
              set("capacityUnit", event.target.value as "gb" | "tb")
            }
            disabled={disabled}
          >
            <option value="gb">{t("{value1}", { value1: "GB" })}</option>
            <option value="tb">{t("{value1}", { value1: "TB" })}</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Interface")}>
          <Select
            value={form.interface}
            onChange={(event) =>
              set("interface", event.target.value as DriveInterface)
            }
            disabled={disabled}
          >
            {DRIVE_INTERFACE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {driveInterfaceLabel(value, t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("Form factor")}>
          <Select
            value={form.formFactor}
            onChange={(event) =>
              set("formFactor", event.target.value as DriveFormFactor)
            }
            disabled={disabled}
          >
            {DRIVE_FORM_FACTOR_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {driveFormFactorLabel(value, t)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("Notes")}>
        <Textarea
          value={form.notes}
          onChange={(event) => set("notes", event.target.value)}
          disabled={disabled}
          rows={3}
        />
      </Field>
    </div>
  );
}

function PoolEditor({
  form,
  onChange,
  pool,
  drives,
  devices,
  ownerDeviceId,
  disabled,
  onSave,
  onDelete,
  saving,
  creating,
  highlightedPoolId,
  onHoverPool,
  onFocusPool,
}: {
  form: PoolForm;
  onChange: (next: PoolForm) => void;
  pool: StoragePool | null;
  drives: StorageDrive[];
  devices: Array<{ id: string; hostname: string }>;
  ownerDeviceId: string;
  disabled: boolean;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  creating: boolean;
  highlightedPoolId: string | null;
  onHoverPool: (poolId: string | null) => void;
  onFocusPool: (poolId: string | null) => void;
}) {
  const { t } = useI18n();
  const set = <K extends keyof PoolForm>(key: K, value: PoolForm[K]) =>
    onChange({ ...form, [key]: value });
  const hostnameById = new Map(
    devices.map((device) => [device.id, device.hostname]),
  );
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-1)] p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t("Pool name")}>
          <Input
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            disabled={disabled}
          />
        </Field>
        <Field label={t("RAID / pool type")}>
          <Select
            value={form.poolType}
            onChange={(event) =>
              set("poolType", event.target.value as StoragePoolType)
            }
            disabled={disabled}
          >
            {STORAGE_POOL_TYPE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {poolTypeLabel(value, t)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
          <Field label={t("Usable capacity")}>
            <Input
              type="number"
              min={0}
              step="any"
              value={form.usableCapacity}
              onChange={(event) => set("usableCapacity", event.target.value)}
              disabled={disabled}
            />
          </Field>
          <Field label={t("Capacity unit")}>
            <Select
              value={form.capacityUnit}
              onChange={(event) =>
                set("capacityUnit", event.target.value as "gb" | "tb")
              }
              disabled={disabled}
            >
              <option value="gb">{t("{value1}", { value1: "GB" })}</option>
              <option value="tb">{t("{value1}", { value1: "TB" })}</option>
            </Select>
          </Field>
        </div>
        <Field label={t("Pool status")}>
          <Select
            value={form.status}
            onChange={(event) =>
              set("status", event.target.value as StoragePoolStatus)
            }
            disabled={disabled}
          >
            {STORAGE_POOL_STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {storagePoolStatusLabel(value, t)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label={t("Notes")}>
          <Textarea
            value={form.notes}
            onChange={(event) => set("notes", event.target.value)}
            disabled={disabled}
            rows={3}
          />
        </Field>
      </div>

      <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
        <div className="rk-kicker">{t("Pool members")}</div>
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
          {drives.map((drive) => {
            const belongsHere = pool ? drive.poolId === pool.id : false;
            const assignedElsewhere = Boolean(drive.poolId && !belongsHere);
            const physicallyMissing = !drive.slotId && belongsHere;
            const selectable =
              Boolean(drive.slotId || belongsHere) && !assignedElsewhere;
            const checked = form.driveIds.includes(drive.id);
            const hoverPoolId =
              drive.poolId ?? (pool && checked ? pool.id : null);
            const highlighted = Boolean(
              hoverPoolId && hoverPoolId === highlightedPoolId,
            );
            const inputId = `storage-pool-drive-${pool?.id ?? "new"}-${drive.id}`;
            const installation = !drive.slotId
              ? "unassigned"
              : drive.deviceId === ownerDeviceId
                ? "internal"
                : "external";
            return (
              <div
                key={drive.id}
                data-pool-member-row
                className={cn(
                  "flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2 transition-[border-color,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]",
                  !selectable && "opacity-55",
                  highlighted && "shadow-[0_0_0_2px_var(--pool-color)]",
                )}
                tabIndex={assignedElsewhere ? 0 : undefined}
                aria-disabled={disabled || assignedElsewhere || undefined}
                style={
                  {
                    "--pool-color": hoverPoolId
                      ? poolColor(hoverPoolId)
                      : "transparent",
                    borderColor:
                      highlighted && hoverPoolId
                        ? poolColor(hoverPoolId)
                        : undefined,
                  } as React.CSSProperties
                }
                onMouseEnter={() => onHoverPool(hoverPoolId)}
                onMouseLeave={() => onHoverPool(null)}
                onFocusCapture={() => onFocusPool(hoverPoolId)}
                onBlurCapture={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  ) {
                    onFocusPool(null);
                  }
                }}
                data-pool-highlighted={highlighted ? "true" : undefined}
              >
                <input
                  id={inputId}
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--accent-primary)]"
                  checked={checked}
                  disabled={disabled || !selectable}
                  onChange={(event) =>
                    set(
                      "driveIds",
                      event.target.checked
                        ? [...form.driveIds, drive.id]
                        : form.driveIds.filter((id) => id !== drive.id),
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={inputId}
                    className="block break-words text-xs font-medium"
                  >
                    {driveLabel(drive)}
                  </label>
                  <span className="mt-0.5 block break-words font-mono text-[10px] text-[var(--text-muted)]">
                    {installation === "external" && drive.deviceId ? (
                      <Link
                        className="text-[var(--color-accent)] hover:underline"
                        to={`/devices/${drive.deviceId}?tab=storage`}
                      >
                        {hostnameById.get(drive.deviceId) ?? t("Unassigned")}
                      </Link>
                    ) : installation === "internal" ? (
                      hostnameById.get(drive.deviceId ?? "")
                    ) : (
                      t("Unassigned")
                    )}
                    {drive.slotName
                      ? t("· {value1}", { value1: drive.slotName })
                      : ""}
                    {drive.serial
                      ? t("· {value1}", { value1: drive.serial })
                      : ""}
                  </span>
                </div>
                <Badge tone={installation === "external" ? "info" : "neutral"}>
                  {installation === "internal"
                    ? t("Internal")
                    : installation === "external"
                      ? t("External / attached")
                      : t("Unassigned")}
                </Badge>
                {assignedElsewhere && (
                  <Badge tone="neutral">{drive.poolName}</Badge>
                )}
                {physicallyMissing && <Badge tone="err">{t("Missing")}</Badge>}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          {t("A new pool member must be installed in a slot.")}
        </p>
      </div>

      {!disabled && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={onSave} disabled={saving}>
            <Save />
            {creating ? t("Create pool") : t("Save pool")}
          </Button>
          {!creating && pool && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={saving}
            >
              <Trash2 />
              {t("Delete pool")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "rk-control h-8 w-full px-2.5 text-sm text-[var(--text-primary)] focus-visible:outline-none disabled:opacity-100",
        props.className,
      )}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "rk-control w-full resize-y px-2.5 py-2 text-sm text-[var(--text-primary)] focus-visible:outline-none disabled:opacity-100",
        props.className,
      )}
    />
  );
}

function slotToForm(slot: DriveSlot): SlotForm {
  return {
    name: slot.name,
    sectionName: slot.sectionName,
    sectionOrder: String(slot.sectionOrder),
    position: String(slot.position),
    slotType: slot.slotType,
    face: slot.face,
    layout: slot.layout,
    columns: String(slot.columns ?? 4),
  };
}

function driveFormForSlot(slot: DriveSlot): DriveForm {
  const formFactor = slot.slotType === "generic" ? "other" : slot.slotType;
  return { ...EMPTY_DRIVE_FORM, formFactor };
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
  };
}

function poolToForm(pool: StoragePool): PoolForm {
  const useTb = pool.usableCapacityGb >= 1000;
  return {
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

function driveSlotFaceLabel(
  face: DriveSlotFace,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (face) {
    case "front":
      return t("Front");
    case "rear":
      return t("Rear");
    case "internal":
      return t("Internal");
  }
}

function poolStatusTone(status: StoragePoolStatus) {
  switch (status) {
    case "healthy":
      return "ok" as const;
    case "degraded":
    case "rebuilding":
      return "warn" as const;
    case "offline":
      return "err" as const;
    default:
      return "neutral" as const;
  }
}
