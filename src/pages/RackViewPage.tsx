import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Save,
  Server,
  Trash2,
} from "lucide-react";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { ReferenceImageGallery } from "@/components/shared/ReferenceImageGallery";
import { TopBar } from "@/components/layout/TopBar";
import { useI18n } from "@/i18n";
import { RackView } from "@/components/rack/RackView";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/shared/Mono";
import { StatusDot } from "@/components/shared/StatusDot";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import {
  canEditInventory,
  createRackRecord,
  createRoomRecord,
  deleteRackRecord,
  deleteRoomRecord,
  updateRackRecord,
  updateRoomRecord,
  useStore,
} from "@/lib/store";
import type {
  Device,
  DeviceImage,
  Port,
  RackFace,
  ReferenceImage,
  Room,
} from "@/lib/types";
import { cn, statusLabel } from "@/lib/utils";
import { formatDeviceAddress } from "@/lib/network-labels";

const UNRACKED_VIEW_ID = "__unracked__";
const ROOM_VIEW_PREFIX = "__room__:";

type RackForm = {
  name: string;
  totalU: string;
  description: string;
  location: string;
  notes: string;
  roomId: string;
};

type RackEditorMode = "closed" | "create" | "edit";
type RoomEditorMode = "closed" | "create" | "edit";
type RackDisplayFace = RackFace | "both";

type RoomForm = {
  name: string;
  description: string;
  location: string;
  notes: string;
};

const EMPTY_FORM: RackForm = {
  name: "",
  totalU: "42",
  description: "",
  location: "",
  notes: "",
  roomId: "",
};

const EMPTY_ROOM_FORM: RoomForm = {
  name: "",
  description: "",
  location: "",
  notes: "",
};

const RACK_SHELF_TYPE = "rack_shelf";

export default function RackViewPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useStore((s) => s.currentUser);
  const activeLab = useStore((s) => s.lab);
  const rooms = useStore((s) => s.rooms);
  const racks = useStore((s) => s.racks);
  const devices = useStore((s) => s.devices);
  const ports = useStore((s) => s.ports);
  const deviceImages = useStore((s) => s.deviceImages);
  const referenceImages = useStore((s) => s.referenceImages);
  const canEdit = canEditInventory(currentUser);
  const [selectedViewId, setSelectedViewId] = useState("");
  const [face, setFace] = useState<RackDisplayFace>("front");
  const [selectedDeviceId, setSelectedDeviceId] = useState<
    string | undefined
  >();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<RackEditorMode>("closed");
  const [roomEditorMode, setRoomEditorMode] =
    useState<RoomEditorMode>("closed");
  const [savingRack, setSavingRack] = useState(false);
  const [deletingRack, setDeletingRack] = useState(false);
  const [rackError, setRackError] = useState("");
  const [rackForm, setRackForm] = useState<RackForm>(EMPTY_FORM);
  const [savingRoom, setSavingRoom] = useState(false);
  const [deletingRoom, setDeletingRoom] = useState(false);
  const [roomError, setRoomError] = useState("");
  const [roomForm, setRoomForm] = useState<RoomForm>(EMPTY_ROOM_FORM);
  const rackParam = searchParams.get("rackId") ?? "";
  const roomParam = searchParams.get("roomId") ?? "";
  const viewParam = searchParams.get("view") ?? "";

  const roomById = useMemo(() => {
    return rooms.reduce<Record<string, Room>>((acc, room) => {
      acc[room.id] = room;
      return acc;
    }, {});
  }, [rooms]);

  const unrackedDevices = useMemo(
    () => devices.filter((device) => !device.rackId && !device.roomId),
    [devices],
  );
  const allLooseDevices = useMemo(
    () => devices.filter((device) => !device.rackId),
    [devices],
  );

  useEffect(() => {
    if (rackParam && racks.some((entry) => entry.id === rackParam)) {
      if (selectedViewId !== rackParam) setSelectedViewId(rackParam);
      return;
    }

    if (roomParam && rooms.some((room) => room.id === roomParam)) {
      const nextViewId = `${ROOM_VIEW_PREFIX}${roomParam}`;
      if (selectedViewId !== nextViewId) setSelectedViewId(nextViewId);
      return;
    }

    if (viewParam === "loose") {
      if (selectedViewId !== UNRACKED_VIEW_ID) {
        setSelectedViewId(UNRACKED_VIEW_ID);
      }
      return;
    }

    if (selectedViewId === UNRACKED_VIEW_ID) {
      return;
    }

    if (selectedViewId.startsWith(ROOM_VIEW_PREFIX)) {
      const roomId = selectedViewId.slice(ROOM_VIEW_PREFIX.length);
      if (rooms.some((room) => room.id === roomId)) return;
      setSelectedViewId(
        rooms[0]
          ? `${ROOM_VIEW_PREFIX}${rooms[0].id}`
          : unrackedDevices.length > 0
            ? UNRACKED_VIEW_ID
            : "",
      );
      return;
    }

    if (!racks.length) {
      if (rooms.length > 0) {
        setSelectedViewId(`${ROOM_VIEW_PREFIX}${rooms[0].id}`);
        return;
      }
      if (unrackedDevices.length > 0) {
        setSelectedViewId(UNRACKED_VIEW_ID);
      }
      return;
    }

    if (!selectedViewId || !racks.some((rack) => rack.id === selectedViewId)) {
      setSelectedViewId(racks[0].id);
    }
  }, [
    rackParam,
    racks,
    roomParam,
    rooms,
    selectedViewId,
    unrackedDevices.length,
    viewParam,
  ]);

  function selectLooseView() {
    setSelectedViewId(UNRACKED_VIEW_ID);
    setSelectedDeviceId(undefined);
    setSearchParams({ view: "loose" });
  }

  function selectRoomView(roomId: string) {
    setSelectedViewId(`${ROOM_VIEW_PREFIX}${roomId}`);
    setSelectedDeviceId(undefined);
    setSearchParams({ roomId });
  }

  function selectRackView(rackId: string) {
    setSelectedViewId(rackId);
    setSelectedDeviceId(undefined);
    setSearchParams({ rackId });
  }

  const viewingUnracked = selectedViewId === UNRACKED_VIEW_ID;
  const selectedRoomId = selectedViewId.startsWith(ROOM_VIEW_PREFIX)
    ? selectedViewId.slice(ROOM_VIEW_PREFIX.length)
    : "";
  const viewingRoom = selectedRoomId ? roomById[selectedRoomId] : undefined;
  const rack = viewingUnracked
    ? undefined
    : viewingRoom
      ? undefined
      : (racks.find((entry) => entry.id === selectedViewId) ?? racks[0]);

  useEffect(() => {
    if (editorMode !== "edit" || !rack) return;
    setRackForm({
      name: rack.name,
      totalU: String(rack.totalU),
      description: rack.description ?? "",
      location: rack.location ?? "",
      notes: rack.notes ?? "",
      roomId: rack.roomId ?? "",
    });
  }, [editorMode, rack]);

  useEffect(() => {
    if (roomEditorMode !== "edit" || !viewingRoom) return;
    setRoomForm({
      name: viewingRoom.name,
      description: viewingRoom.description ?? "",
      location: viewingRoom.location ?? "",
      notes: viewingRoom.notes ?? "",
    });
  }, [roomEditorMode, viewingRoom]);

  const portsByDeviceId = useMemo(() => {
    return ports.reduce<Record<string, Port[]>>((acc, port) => {
      (acc[port.deviceId] ??= []).push(port);
      return acc;
    }, {});
  }, [ports]);

  const deviceImagesByDeviceId = useMemo(() => {
    return deviceImages.reduce<Record<string, DeviceImage[]>>((acc, image) => {
      (acc[image.deviceId] ??= []).push(image);
      return acc;
    }, {});
  }, [deviceImages]);

  const rackDevices = rack
    ? devices.filter((device) => device.rackId === rack.id)
    : [];
  const rackImages = rack
    ? referenceImages.filter(
        (image) => image.entityType === "rack" && image.entityId === rack.id,
      )
    : [];
  const selectedDevice = selectedDeviceId
    ? devices.find((device) => device.id === selectedDeviceId)
    : undefined;
  const selectedRoomRacks = viewingRoom
    ? racks.filter((entry) => entry.roomId === viewingRoom.id)
    : [];
  const selectedRoomDevices = viewingRoom
    ? allLooseDevices.filter((device) => device.roomId === viewingRoom.id)
    : [];
  const selectedRoomImages = viewingRoom
    ? referenceImages.filter(
        (image) =>
          image.entityType === "room" && image.entityId === viewingRoom.id,
      )
    : [];

  async function handleSaveRack() {
    setSavingRack(true);
    setRackError("");
    try {
      if (editorMode === "create") {
        const created = await createRackRecord({
          labId: activeLab.id,
          name: rackForm.name.trim(),
          totalU: Number.parseInt(rackForm.totalU, 10) || 42,
          description: rackForm.description.trim() || undefined,
          location: rackForm.location.trim() || undefined,
          notes: rackForm.notes.trim() || undefined,
          roomId: rackForm.roomId || undefined,
        });
        selectRackView(created.id);
        setEditorMode("closed");
        return;
      }

      if (!rack) return;
      await updateRackRecord(rack.id, {
        name: rackForm.name.trim(),
        totalU: Number.parseInt(rackForm.totalU, 10) || 42,
        description: rackForm.description.trim() || null,
        location: rackForm.location.trim() || null,
        notes: rackForm.notes.trim() || null,
        roomId: rackForm.roomId || null,
      });
      setEditorMode("closed");
    } catch (err) {
      setRackError(err instanceof Error ? err.message : "Failed to save rack.");
    } finally {
      setSavingRack(false);
    }
  }

  async function handleSaveRoom() {
    setSavingRoom(true);
    setRoomError("");
    try {
      if (roomEditorMode === "create") {
        const created = await createRoomRecord({
          labId: activeLab.id,
          name: roomForm.name.trim(),
          description: roomForm.description.trim() || undefined,
          location: roomForm.location.trim() || undefined,
          notes: roomForm.notes.trim() || undefined,
        });
        selectRoomView(created.id);
        setRoomEditorMode("closed");
        return;
      }

      if (!viewingRoom) return;
      const updated = await updateRoomRecord(viewingRoom.id, {
        name: roomForm.name.trim(),
        description: roomForm.description.trim() || null,
        location: roomForm.location.trim() || null,
        notes: roomForm.notes.trim() || null,
      });
      selectRoomView(updated.id);
      setRoomEditorMode("closed");
    } catch (err) {
      setRoomError(err instanceof Error ? err.message : "Failed to save room.");
    } finally {
      setSavingRoom(false);
    }
  }

  async function handleDeleteRoom() {
    if (!viewingRoom) return;
    if (
      !window.confirm(
        `Delete room ${viewingRoom.name}? Racks and devices will become unassigned from this room.`,
      )
    )
      return;

    setDeletingRoom(true);
    setRoomError("");
    try {
      await deleteRoomRecord(viewingRoom.id);
      if (unrackedDevices.length > 0) {
        selectLooseView();
      } else {
        setSelectedViewId("");
        setSearchParams({});
      }
      setRoomEditorMode("closed");
    } catch (err) {
      setRoomError(
        err instanceof Error ? err.message : "Failed to delete room.",
      );
    } finally {
      setDeletingRoom(false);
    }
  }

  async function handleDeleteRack() {
    if (!rack) return;
    if (
      !window.confirm(`Delete rack ${rack.name}? Devices will become unracked.`)
    )
      return;

    setDeletingRack(true);
    setRackError("");
    try {
      await deleteRackRecord(rack.id);
      if (unrackedDevices.length > 0) {
        selectLooseView();
      } else {
        setSelectedViewId("");
        setSearchParams({});
      }
      setEditorMode("closed");
    } catch (err) {
      setRackError(
        err instanceof Error ? err.message : "Failed to delete rack.",
      );
    } finally {
      setDeletingRack(false);
    }
  }

  const showEmptyState =
    rooms.length === 0 && racks.length === 0 && allLooseDevices.length === 0;

  return (
    <>
      <TopBar
        subtitle={activeLab.name}
        title={t("Racks / Rooms")}
        actions={
          canEdit ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRoomForm(EMPTY_ROOM_FORM);
                  setRoomError("");
                  setRoomEditorMode("create");
                }}
              >
                <Plus className="size-3.5" />
                Add room
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRackForm({
                    ...EMPTY_FORM,
                    roomId: viewingRoom?.id ?? "",
                  });
                  setRackError("");
                  setEditorMode("create");
                }}
              >
                <Plus className="size-3.5" />
                Add rack
              </Button>
              {rack && !viewingUnracked && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRackError("");
                    setEditorMode("edit");
                  }}
                >
                  <Pencil className="size-3.5" />
                  Edit rack
                </Button>
              )}
              {viewingRoom && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRoomError("");
                    setRoomEditorMode("edit");
                  }}
                >
                  <Pencil className="size-3.5" />
                  Edit room
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDrawerOpen(true)}
              >
                <Plus className="size-3.5" />
                Add device
              </Button>
            </>
          ) : undefined
        }
      />

      {showEmptyState ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <Card className="w-full max-w-xl">
            <CardHeader>
              <CardTitle>
                <CardLabel>Inventory</CardLabel>
                <CardHeading>No racks documented yet</CardHeading>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <EmptyState
                icon={Server}
                title={t("No racks documented yet")}
                description={t(
                  "Create your first rack or start by adding loose room tech as unracked gear.",
                )}
                action={
                  canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => {
                          setRackForm(EMPTY_FORM);
                          setRackError("");
                          setEditorMode("create");
                        }}
                      >
                        <Plus className="size-3.5" />
                        Create first rack
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSelectedViewId(UNRACKED_VIEW_ID);
                          setDrawerOpen(true);
                        }}
                      >
                        <Plus className="size-3.5" />
                        Add loose gear
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            </CardBody>
          </Card>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-72 shrink-0 flex-col border-r border-[var(--border-default)] bg-[color-mix(in_srgb,var(--bg-shell)_70%,transparent)]">
            <div className="border-b border-[var(--border-default)] px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                {rooms.length} rooms | {racks.length} racks |{" "}
                {allLooseDevices.length} loose
              </span>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              <button
                onClick={selectLooseView}
                className={`w-full border-l-2 px-4 py-2.5 text-left transition-colors ${
                  viewingUnracked
                    ? "border-[var(--color-accent)] bg-[var(--accent-primary-soft)]"
                    : "border-transparent hover:bg-[var(--surface-hover)]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium text-[var(--color-fg)]">
                    Loose / room tech
                  </span>
                  <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                    {unrackedDevices.length}
                  </Mono>
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                  Devices not mounted in a physical rack
                </div>
              </button>

              {rooms.length > 0 && (
                <div className="my-2 border-y border-[var(--border-default)] py-2">
                  <div className="px-4 pb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
                    Rooms
                  </div>
                  {rooms.map((room) => {
                    const roomRackCount = racks.filter(
                      (entry) => entry.roomId === room.id,
                    ).length;
                    const roomDeviceCount = allLooseDevices.filter(
                      (device) => device.roomId === room.id,
                    ).length;
                    const isActive = viewingRoom?.id === room.id;
                    return (
                      <button
                        key={room.id}
                        onClick={() => selectRoomView(room.id)}
                        className={`w-full border-l-2 px-4 py-2.5 text-left transition-colors ${
                          isActive
                            ? "border-[var(--color-accent)] bg-[var(--accent-primary-soft)]"
                            : "border-transparent hover:bg-[var(--surface-hover)]"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-medium text-[var(--color-fg)]">
                            {room.name}
                          </span>
                          <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                            {roomRackCount}R / {roomDeviceCount}D
                          </Mono>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-[var(--color-fg-subtle)]">
                          {room.location || room.description || "Room context"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {racks.map((entry) => {
                const inRack = devices.filter(
                  (device) => device.rackId === entry.id,
                );
                const used = inRack.reduce(
                  (sum, device) => sum + (device.heightU ?? 0),
                  0,
                );
                const isActive = entry.id === rack?.id && !viewingUnracked;
                return (
                  <button
                    key={entry.id}
                    onClick={() => selectRackView(entry.id)}
                    className={`w-full border-l-2 px-4 py-2.5 text-left transition-colors ${
                      isActive
                        ? "border-[var(--color-accent)] bg-[var(--accent-primary-soft)]"
                        : "border-transparent hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-medium text-[var(--color-fg)]">
                        {entry.name}
                      </span>
                      <Mono className="text-[10px] text-[var(--color-fg-subtle)]">
                        {used}/{entry.totalU}U
                      </Mono>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[var(--color-fg-subtle)]">
                      {entry.description}
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-[1px] bg-[var(--color-bg)]">
                      <div
                        className="h-full bg-[var(--color-accent)]"
                        style={{
                          width: `${Math.round((used / entry.totalU) * 100)}%`,
                          opacity: 0.7,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto rk-page-pad">
            {viewingUnracked ? (
              <UnrackedPanel
                devices={unrackedDevices}
                portsByDeviceId={portsByDeviceId}
              />
            ) : viewingRoom ? (
              <RoomPanel
                room={viewingRoom}
                racks={selectedRoomRacks}
                devices={selectedRoomDevices}
                images={selectedRoomImages}
                canEdit={canEdit}
                portsByDeviceId={portsByDeviceId}
              />
            ) : rack ? (
              <>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                      Rack
                    </div>
                    <h2 className="text-lg font-semibold tracking-normal text-[var(--color-fg)]">
                      {rack.name}
                    </h2>
                    <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                      {rack.roomId && roomById[rack.roomId]
                        ? `${roomById[rack.roomId].name}${rack.location ? ` | ${rack.location}` : ""}`
                        : rack.location}
                    </div>
                  </div>

                  <Tabs
                    value={face}
                    onValueChange={(value) => setFace(value as RackDisplayFace)}
                  >
                    <TabsList>
                      <TabsTrigger value="front">Front</TabsTrigger>
                      <TabsTrigger value="rear">Rear</TabsTrigger>
                      <TabsTrigger value="both">Both</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <div
                  className={cn(
                    "flex items-start gap-6",
                    face === "both" && "flex-col",
                  )}
                >
                  <RackView
                    rack={rack}
                    devices={rackDevices}
                    deviceImages={deviceImagesByDeviceId}
                    face={face}
                    selectedDeviceId={selectedDeviceId}
                    onSelectDevice={(id) =>
                      setSelectedDeviceId(
                        id === selectedDeviceId ? undefined : id,
                      )
                    }
                  />

                  {face === "both" ? (
                    <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
                      <ReferenceImageGallery
                        entityType="rack"
                        entityId={rack.id}
                        images={rackImages}
                        face="front"
                        canEdit={canEdit}
                        compact
                        emptyText={t("No front rack picture yet.")}
                      />
                      <ReferenceImageGallery
                        entityType="rack"
                        entityId={rack.id}
                        images={rackImages}
                        face="rear"
                        canEdit={canEdit}
                        compact
                        emptyText={t("No rear rack picture yet.")}
                      />
                    </div>
                  ) : (
                    <div className="w-96 shrink-0">
                      <ReferenceImageGallery
                        entityType="rack"
                        entityId={rack.id}
                        images={rackImages}
                        face={face}
                        canEdit={canEdit}
                        compact
                        emptyText={t("No {face} rack picture yet.", { face })}
                      />
                    </div>
                  )}

                  <AnimatePresence>
                    {selectedDevice && (
                      <motion.div
                        key={selectedDevice.id}
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 8 }}
                        transition={{
                          duration: 0.25,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        className="w-80 shrink-0"
                      >
                        <DeviceSummaryCard
                          device={selectedDevice}
                          portCount={
                            portsByDeviceId[selectedDevice.id]?.length ?? 0
                          }
                          position={`${selectedDevice.face} | U${selectedDevice.startU}${
                            (selectedDevice.heightU ?? 1) > 1
                              ? `-${selectedDevice.startU! + selectedDevice.heightU! - 1}`
                              : ""
                          }`}
                          childDevices={devices.filter(
                            (entry) =>
                              entry.parentDeviceId === selectedDevice.id,
                          )}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      <RackEditorModal open={editorMode !== "closed"}>
        <RackEditorCard
          creatingRack={editorMode === "create"}
          rackForm={rackForm}
          rooms={rooms}
          setRackForm={setRackForm}
          rackError={rackError}
          savingRack={savingRack}
          deletingRack={deletingRack}
          canDelete={editorMode === "edit"}
          onSave={() => void handleSaveRack()}
          onDelete={() => void handleDeleteRack()}
          onCancel={() => {
            setEditorMode("closed");
            setRackError("");
          }}
        />
      </RackEditorModal>

      <RackEditorModal open={roomEditorMode !== "closed"}>
        <RoomEditorCard
          creatingRoom={roomEditorMode === "create"}
          roomForm={roomForm}
          setRoomForm={setRoomForm}
          roomError={roomError}
          savingRoom={savingRoom}
          deletingRoom={deletingRoom}
          canDelete={roomEditorMode === "edit"}
          onSave={() => void handleSaveRoom()}
          onDelete={() => void handleDeleteRoom()}
          onCancel={() => {
            setRoomEditorMode("closed");
            setRoomError("");
          }}
        />
      </RackEditorModal>

      <DeviceDrawer
        open={drawerOpen}
        defaultRackId={viewingUnracked ? undefined : rack?.id}
        defaults={
          selectedDevice?.deviceType === RACK_SHELF_TYPE
            ? {
                placement: "shelf",
                parentDeviceId: selectedDevice.id,
              }
            : viewingRoom
              ? {
                  placement: "room",
                  roomId: viewingRoom.id,
                }
              : undefined
        }
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}

function UnrackedPanel({
  devices,
  portsByDeviceId,
}: {
  devices: Device[];
  portsByDeviceId: Record<string, Port[]>;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
          Physical layout
        </div>
        <h2 className="text-lg font-semibold tracking-normal text-[var(--color-fg)]">
          Loose / room tech
        </h2>
        <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
          Devices that live on a shelf, desk, wall, or in a room instead of a
          rack.
        </div>
      </div>

      {devices.length === 0 ? (
        <Card>
          <CardBody className="py-8 text-center text-sm text-[var(--color-fg-subtle)]">
            No unracked devices yet.
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {devices.map((device) => (
            <Card key={device.id}>
              <CardHeader>
                <CardTitle>
                  <CardLabel>Loose gear</CardLabel>
                  <CardHeading>{device.hostname}</CardHeading>
                </CardTitle>
                <Button variant="ghost" size="icon" asChild>
                  <Link to={`/devices/${device.id}`}>
                    <ExternalLink />
                  </Link>
                </Button>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="flex items-center gap-2">
                  <DeviceTypeIcon
                    type={device.deviceType}
                    className="size-4 text-[var(--color-accent)]"
                  />
                  <span className="text-sm capitalize text-[var(--color-fg)]">
                    {device.deviceType.replace("_", " ")}
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1.5">
                    <StatusDot status={device.status} />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
                      {statusLabel[device.status]}
                    </span>
                  </span>
                </div>
                <dl className="space-y-2 text-xs">
                  <Row label="Manufacturer" value={device.manufacturer} />
                  <Row label="Model" value={device.model} mono />
                  <Row label="Serial" value={device.serial} mono />
                  <Row
                    label="Mgmt IP / MAC"
                    value={formatDeviceAddress(device)}
                    mono
                  />
                  <Row
                    label="Ports"
                    value={String(portsByDeviceId[device.id]?.length ?? 0)}
                  />
                </dl>
                {device.notes && (
                  <div
                    className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-fg-subtle)]"
                    data-no-i18n
                  >
                    {device.notes}
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RoomPanel({
  room,
  racks,
  devices,
  images,
  canEdit,
  portsByDeviceId,
}: {
  room: Room;
  racks: Array<{
    id: string;
    name: string;
    totalU: number;
    description?: string;
    location?: string;
  }>;
  devices: Device[];
  images: ReferenceImage[];
  canEdit: boolean;
  portsByDeviceId: Record<string, Port[]>;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
          Room
        </div>
        <h2 className="text-lg font-semibold tracking-normal text-[var(--color-fg)]">
          {room.name}
        </h2>
        <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
          {room.location || room.description || "Physical room grouping"}
        </div>
      </div>

      {(room.description || room.notes) && (
        <Card>
          <CardBody className="space-y-2 text-sm text-[var(--color-fg-subtle)]">
            {room.description && <p>{room.description}</p>}
            {room.notes && (
              <p className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-xs">
                {room.notes}
              </p>
            )}
          </CardBody>
        </Card>
      )}

      <ReferenceImageGallery
        entityType="room"
        entityId={room.id}
        images={images}
        canEdit={canEdit}
        emptyText={t("No room picture yet.")}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <CardLabel>Racks</CardLabel>
              <CardHeading>{racks.length} in this room</CardHeading>
            </CardTitle>
            <Badge tone="info">
              <Server className="size-3" />
              Mounted
            </Badge>
          </CardHeader>
          <CardBody className="space-y-2">
            {racks.length === 0 ? (
              <EmptyState
                icon={Server}
                title={t("No racks assigned")}
                description={t("Assign a rack to this room from the rack editor.")}
              />
            ) : (
              racks.map((rack) => (
                <Link
                  key={rack.id}
                  to={`/racks?rackId=${rack.id}`}
                  className="block rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 transition-colors hover:border-[var(--color-line-strong)] hover:bg-[var(--color-surface)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs font-medium text-[var(--color-fg)]">
                      {rack.name}
                    </span>
                    <Mono className="text-[10px] text-[var(--color-fg-muted)]">
                      {rack.totalU}U
                    </Mono>
                  </div>
                  {(rack.description || rack.location) && (
                    <div className="mt-1 truncate text-xs text-[var(--color-fg-subtle)]">
                      {rack.description || rack.location}
                    </div>
                  )}
                </Link>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <CardLabel>Loose gear</CardLabel>
              <CardHeading>{devices.length} devices</CardHeading>
            </CardTitle>
            <Badge tone="cyan">
              <MapPin className="size-3" />
              Room
            </Badge>
          </CardHeader>
          <CardBody className="space-y-2">
            {devices.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title={t("No loose devices assigned")}
                description={t(
                  "Add or edit a device and choose this room in Placement.",
                )}
              />
            ) : (
              devices.map((device) => (
                <DeviceRoomRow
                  key={device.id}
                  device={device}
                  portCount={portsByDeviceId[device.id]?.length ?? 0}
                />
              ))
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function DeviceRoomRow({
  device,
  portCount,
}: {
  device: Device;
  portCount: number;
}) {
  return (
    <Link
      to={`/devices/${device.id}`}
      className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 transition-colors hover:border-[var(--color-line-strong)] hover:bg-[var(--color-surface)]"
    >
      <DeviceTypeIcon
        type={device.deviceType}
        className="size-4 text-[var(--color-accent)]"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-[var(--color-fg)]">
          {device.hostname}
        </div>
        <div className="truncate text-[11px] text-[var(--color-fg-subtle)]">
          {formatDeviceAddress(device, device.deviceType.replace("_", " "))}
        </div>
      </div>
      <Mono className="text-[10px] text-[var(--color-fg-muted)]">
        {portCount} ports
      </Mono>
      <StatusDot status={device.status} />
    </Link>
  );
}

function RackEditorModal({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );
}

function DeviceSummaryCard({
  device,
  portCount,
  position,
  childDevices = [],
}: {
  device: Device;
  portCount: number;
  position?: string;
  childDevices?: Device[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>Device</CardLabel>
          <CardHeading>{device.hostname}</CardHeading>
        </CardTitle>
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/devices/${device.id}`}>
            <ExternalLink />
          </Link>
        </Button>
      </CardHeader>
      <CardBody>
        <div className="mb-3 flex items-center gap-2">
          <DeviceTypeIcon
            type={device.deviceType}
            className="size-4 text-[var(--color-accent)]"
          />
          <span className="text-sm capitalize text-[var(--color-fg)]">
            {device.deviceType.replace("_", " ")}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <StatusDot status={device.status} />
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
              {statusLabel[device.status]}
            </span>
          </span>
        </div>

        <dl className="space-y-2 text-xs">
          <Row label="Manufacturer" value={device.manufacturer} />
          <Row label="Model" value={device.model} mono />
          <Row label="Serial" value={device.serial} mono />
          <Row label="Mgmt IP / MAC" value={formatDeviceAddress(device)} mono />
          <Row label="Position" value={position} />
          <Row label="Ports" value={String(portCount)} />
          {device.deviceType === RACK_SHELF_TYPE && (
            <Row label="Shelf devices" value={String(childDevices.length)} />
          )}
        </dl>

        {device.tags && device.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1" data-no-i18n>
            {device.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        )}

        {device.deviceType === RACK_SHELF_TYPE && childDevices.length > 0 && (
          <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
              On this shelf / tray
            </div>
            <div className="space-y-2">
              {childDevices
                .sort((a, b) => a.hostname.localeCompare(b.hostname))
                .map((child) => (
                  <div
                    key={child.id}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2 text-[var(--color-fg)]">
                      <DeviceTypeIcon
                        type={child.deviceType}
                        className="size-3.5 shrink-0 text-[var(--color-fg-muted)]"
                      />
                      <span className="truncate">{child.hostname}</span>
                    </span>
                    <span className="text-[var(--color-fg-subtle)]">
                      {child.deviceType.replace("_", " ")}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RackEditorCard({
  creatingRack,
  rackForm,
  rooms,
  setRackForm,
  rackError,
  savingRack,
  deletingRack,
  canDelete,
  onSave,
  onDelete,
  onCancel,
}: {
  creatingRack: boolean;
  rackForm: RackForm;
  rooms: Room[];
  setRackForm: React.Dispatch<React.SetStateAction<RackForm>>;
  rackError: string;
  savingRack: boolean;
  deletingRack: boolean;
  canDelete: boolean;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{creatingRack ? "New rack" : "Rack editor"}</CardLabel>
          <CardHeading>
            {creatingRack ? "Create rack" : "Update rack metadata"}
          </CardHeading>
        </CardTitle>
        <Badge tone="info">
          <Server className="size-3" />
          Physical layout
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Rack name">
            <Input
              value={rackForm.name}
              onChange={(event) =>
                setRackForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Rack A"
            />
          </Field>
          <Field label="Total U">
            <Input
              type="number"
              min={1}
              max={100}
              value={rackForm.totalU}
              onChange={(event) =>
                setRackForm((prev) => ({ ...prev, totalU: event.target.value }))
              }
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Room">
            <select
              value={rackForm.roomId}
              onChange={(event) =>
                setRackForm((prev) => ({
                  ...prev,
                  roomId: event.target.value,
                }))
              }
              className="rk-control w-full text-sm"
            >
              <option value="">-- no room selected --</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <Input
              value={rackForm.location}
              onChange={(event) =>
                setRackForm((prev) => ({
                  ...prev,
                  location: event.target.value,
                }))
              }
              placeholder="Garage wall, office, DC row A"
            />
          </Field>
          <Field label="Description">
            <Input
              value={rackForm.description}
              onChange={(event) =>
                setRackForm((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              placeholder="Main homelab rack"
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea
            rows={3}
            value={rackForm.notes}
            onChange={(event) =>
              setRackForm((prev) => ({ ...prev, notes: event.target.value }))
            }
            className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm text-[var(--color-fg)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]"
            placeholder="Power feeds, cooling notes, ownership..."
          />
        </Field>

        {rackError && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
            {rackError}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            {canDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onDelete}
                disabled={deletingRack}
              >
                <Trash2 className="size-3.5" />
                {deletingRack ? "Deleting..." : "Delete rack"}
              </Button>
            )}
            <Button size="sm" onClick={onSave} disabled={savingRack}>
              <Save className="size-3.5" />
              {savingRack
                ? "Saving..."
                : creatingRack
                  ? "Create rack"
                  : "Save rack"}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function RoomEditorCard({
  creatingRoom,
  roomForm,
  setRoomForm,
  roomError,
  savingRoom,
  deletingRoom,
  canDelete,
  onSave,
  onDelete,
  onCancel,
}: {
  creatingRoom: boolean;
  roomForm: RoomForm;
  setRoomForm: React.Dispatch<React.SetStateAction<RoomForm>>;
  roomError: string;
  savingRoom: boolean;
  deletingRoom: boolean;
  canDelete: boolean;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <CardLabel>{creatingRoom ? "New room" : "Room editor"}</CardLabel>
          <CardHeading>
            {creatingRoom ? "Create room" : "Update room context"}
          </CardHeading>
        </CardTitle>
        <Badge tone="cyan">
          <MapPin className="size-3" />
          Physical zone
        </Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Room name">
            <Input
              value={roomForm.name}
              onChange={(event) =>
                setRoomForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Server room, garage, office"
            />
          </Field>
          <Field label="Location">
            <Input
              value={roomForm.location}
              onChange={(event) =>
                setRoomForm((prev) => ({
                  ...prev,
                  location: event.target.value,
                }))
              }
              placeholder="House, office, outbuilding"
            />
          </Field>
        </div>
        <Field label="Description">
          <Input
            value={roomForm.description}
            onChange={(event) =>
              setRoomForm((prev) => ({
                ...prev,
                description: event.target.value,
              }))
            }
            placeholder="What lives here?"
          />
        </Field>
        <Field label="Notes">
          <textarea
            rows={3}
            value={roomForm.notes}
            onChange={(event) =>
              setRoomForm((prev) => ({ ...prev, notes: event.target.value }))
            }
            className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-2 text-sm text-[var(--color-fg)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]"
            placeholder="Cooling, power, WiFi coverage, access notes..."
          />
        </Field>

        {roomError && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
            {roomError}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            {canDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onDelete}
                disabled={deletingRoom}
              >
                <Trash2 className="size-3.5" />
                {deletingRoom ? "Deleting..." : "Delete room"}
              </Button>
            )}
            <Button size="sm" onClick={onSave} disabled={savingRoom}>
              <Save className="size-3.5" />
              {savingRoom
                ? "Saving..."
                : creatingRoom
                  ? "Create room"
                  : "Save room"}
            </Button>
          </div>
        </div>
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
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
        {label}
      </dt>
      <dd
        className={`text-right text-[var(--color-fg)] ${mono ? "font-mono text-[11px]" : "text-xs"}`}
      >
        {value}
      </dd>
    </div>
  );
}
