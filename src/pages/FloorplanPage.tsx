import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api, ApiError } from "@/lib/api";
import { canEditInventory, useStore } from "@/lib/store";
import type { ReferenceImage, RoomFloorplan } from "@/lib/types";
import { useI18n } from "@/i18n";

type Drag = { id: string; x: number; y: number; pointerId: number };
const clamp = (value: number) => Math.min(1, Math.max(0, value));
export default function FloorplanPage() {
  const { t } = useI18n();
  const rooms = useStore((s) => s.rooms),
    racks = useStore((s) => s.racks),
    devices = useStore((s) => s.devices),
    user = useStore((s) => s.currentUser);
  const [params, setParams] = useSearchParams();
  const requestedRoomId = params.get("roomId");
  const roomId = rooms.some((row) => row.id === requestedRoomId)
    ? requestedRoomId!
    : rooms[0]?.id || "";
  useEffect(() => {
    if (requestedRoomId && roomId && requestedRoomId !== roomId)
      setParams({ roomId }, { replace: true });
  }, [requestedRoomId, roomId, setParams]);
  const room = rooms.find((row) => row.id === roomId);
  const canEdit = Boolean(room && canEditInventory(user, room.labId));
  const [plan, setPlan] = useState<RoomFloorplan>();
  const [images, setImages] = useState<ReferenceImage[]>([]);
  const [background, setBackground] = useState("");
  const [inventory, setInventory] = useState("");
  const [selected, setSelected] = useState("");
  const [label, setLabel] = useState("");
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState<Drag>();
  const dragRef = useRef<Drag | undefined>(undefined);
  const canvasRef = useRef<HTMLDivElement>(null);
  const epoch = useRef(0);
  useEffect(() => {
    const generation = ++epoch.current;
    setBusy(false);
    setPlan(undefined);
    setImages([]);
    setSelected("");
    setError("");
    setDrag(undefined);
    dragRef.current = undefined;
    if (!roomId) return;
    Promise.all([
      api.getFloorplan(roomId),
      api.getReferenceImages({ entityType: "room", entityId: roomId }),
    ]).then(
      ([value, references]) => {
        if (epoch.current !== generation) return;
        setPlan(value);
        setImages(references);
        setBackground(value.backgroundImageId || "");
      },
      () => {
        if (epoch.current === generation) setError(t("Failed"));
      },
    );
    return () => {
      epoch.current = generation + 1;
    };
  }, [roomId, t]);
  async function change(action: () => Promise<RoomFloorplan>) {
    const generation = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await action();
      if (epoch.current === generation) {
        setPlan(value);
        setBackground(value.backgroundImageId || "");
      }
    } catch (failure) {
      if (epoch.current === generation) {
        setError(
          failure instanceof ApiError && failure.code === "FLOORPLAN_CONFLICT"
            ? t("Floorplan changed. Reload before applying this edit.")
            : t("Failed"),
        );
        try {
          const value = await api.getFloorplan(roomId);
          if (epoch.current === generation) {
            setPlan(value);
            setBackground(value.backgroundImageId || "");
          }
        } catch {
          /* Keep the safe error visible. */
        }
      }
    } finally {
      if (epoch.current === generation) setBusy(false);
    }
  }
  const candidates = [
    ...racks
      .filter((row) => row.roomId === roomId)
      .map((row) => ({
        key: `rack:${row.id}`,
        id: row.id,
        kind: "rack" as const,
        name: row.name,
      })),
    ...devices
      .filter(
        (row) =>
          (row.rackId
            ? racks.find((rack) => rack.id === row.rackId)?.roomId
            : row.roomId) === roomId,
      )
      .map((row) => ({
        key: `device:${row.id}`,
        id: row.id,
        kind: "device" as const,
        name: row.displayName || row.hostname,
      })),
  ].filter(
    (row) =>
      !plan?.markers.some(
        (marker) =>
          (row.kind === "device" ? marker.deviceId : marker.rackId) === row.id,
      ),
  );
  const marker = plan?.markers.find((row) => row.id === selected);
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current,
      bounds = canvasRef.current?.getBoundingClientRect();
    if (!current || !bounds || current.pointerId !== event.pointerId) return;
    const value = {
      ...current,
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
    dragRef.current = value;
    setDrag(value);
  }
  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId || !plan) return;
    dragRef.current = undefined;
    setDrag(undefined);
    const original = plan.markers.find((row) => row.id === current.id);
    if (original?.x === current.x && original?.y === current.y) return;
    void change(() =>
      api.updateFloorplanMarker(roomId, current.id, {
        revision: plan.revision,
        x: current.x,
        y: current.y,
      }),
    );
  }
  return (
    <div className="flex h-full flex-col">
      <TopBar title={t("Floorplan")} />
      <main className="space-y-4 overflow-auto p-6">
        <div className="flex flex-wrap items-end gap-3">
          <label>
            {t("Room")}
            <select
              className="rk-control block"
              value={roomId}
              disabled={busy}
              onChange={(e) => setParams({ roomId: e.target.value })}
            >
              <option value="">{t("Select")}</option>
              {rooms.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Zoom")}
            <input
              aria-label={t("Zoom")}
              className="block"
              type="range"
              min="50"
              max="200"
              step="10"
              value={zoom * 100}
              onChange={(e) => setZoom(Number(e.target.value) / 100)}
            />
          </label>
          <span>{Math.round(zoom * 100)}%</span>
          {room && (
            <Link to={`/racks?roomId=${encodeURIComponent(room.id)}`}>
              {t("Reference images")}
            </Link>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {plan && (
          <>
            {canEdit && (
              <div className="flex flex-wrap items-end gap-3">
                <label>
                  {t("Reference images")}
                  <select
                    className="rk-control block"
                    value={background}
                    disabled={busy}
                    onChange={(e) => setBackground(e.target.value)}
                  >
                    <option value="">{t("None")}</option>
                    {images.map((image) => (
                      <option key={image.id} value={image.id}>
                        {image.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={
                    busy || background === (plan.backgroundImageId || "")
                  }
                  onClick={() => {
                    const replace = Boolean(
                      plan.backgroundImageId &&
                      background &&
                      background !== plan.backgroundImageId,
                    );
                    if (
                      replace &&
                      !window.confirm(
                        t("Replace the background and keep marker positions?"),
                      )
                    )
                      return;
                    void change(() =>
                      api.setFloorplanBackground(roomId, {
                        revision: plan.revision,
                        backgroundImageId: background || null,
                        confirmBackgroundChange: replace,
                      }),
                    );
                  }}
                >
                  {t("Save")}
                </Button>
                <label>
                  {t("Inventory")}
                  <select
                    className="rk-control block"
                    value={inventory}
                    disabled={busy}
                    onChange={(e) => setInventory(e.target.value)}
                  >
                    <option value="">{t("Select")}</option>
                    {candidates.map((row) => (
                      <option value={row.key} key={row.key}>
                        {t(row.kind === "rack" ? "Rack" : "Device")}: {row.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={
                    busy || !candidates.some((row) => row.key === inventory)
                  }
                  onClick={() => {
                    const candidate = candidates.find(
                      (row) => row.key === inventory,
                    )!;
                    void change(() =>
                      api.addFloorplanMarker(roomId, {
                        revision: plan.revision,
                        ...(candidate.kind === "device"
                          ? { deviceId: candidate.id }
                          : { rackId: candidate.id }),
                      }),
                    );
                  }}
                >
                  {t("Add marker")}
                </Button>
              </div>
            )}
            {canEdit && (
              <p id="floorplan-keyboard-help" className="text-sm">
                {t(
                  "Use arrow keys to move the selected marker. Hold Shift for larger steps.",
                )}
              </p>
            )}
            {plan.background ? (
              <div className="max-h-[65vh] overflow-auto rounded border border-[var(--border-default)]">
                <div
                  ref={canvasRef}
                  data-testid="room-floorplan-canvas"
                  className="relative"
                  style={{ width: `${zoom * 100}%`, minWidth: "50%" }}
                >
                  <img
                    className="block h-auto w-full max-w-none select-none"
                    src={plan.background.dataUrl}
                    alt={plan.background.label}
                    draggable={false}
                  />
                  {plan.markers.map((row) => {
                    const position = drag?.id === row.id ? drag : row;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        className={`absolute max-w-48 -translate-x-1/2 -translate-y-1/2 touch-none rounded border px-2 py-1 text-xs shadow bg-[var(--surface-1)] text-[var(--text-primary)] ${selected === row.id ? "border-[var(--accent-primary)]" : "border-[var(--border-strong)]"}`}
                        style={{
                          left: `${position.x * 100}%`,
                          top: `${position.y * 100}%`,
                        }}
                        aria-describedby={
                          canEdit ? "floorplan-keyboard-help" : undefined
                        }
                        onClick={() => {
                          setSelected(row.id);
                          setLabel(row.label || "");
                        }}
                        onPointerDown={(e) => {
                          setSelected(row.id);
                          setLabel(row.label || "");
                          if (!canEdit || busy || e.button !== 0) return;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          const current = {
                            id: row.id,
                            x: row.x,
                            y: row.y,
                            pointerId: e.pointerId,
                          };
                          dragRef.current = current;
                          setDrag(current);
                        }}
                        onPointerMove={pointerMove}
                        onPointerUp={pointerUp}
                        onPointerCancel={() => {
                          dragRef.current = undefined;
                          setDrag(undefined);
                        }}
                        onKeyDown={(e) => {
                          if (
                            !canEdit ||
                            busy ||
                            ![
                              "ArrowLeft",
                              "ArrowRight",
                              "ArrowUp",
                              "ArrowDown",
                            ].includes(e.key)
                          )
                            return;
                          e.preventDefault();
                          const step = e.shiftKey ? 0.05 : 0.01;
                          void change(() =>
                            api.updateFloorplanMarker(roomId, row.id, {
                              revision: plan.revision,
                              x: clamp(
                                row.x +
                                  (e.key === "ArrowRight"
                                    ? step
                                    : e.key === "ArrowLeft"
                                      ? -step
                                      : 0),
                              ),
                              y: clamp(
                                row.y +
                                  (e.key === "ArrowDown"
                                    ? step
                                    : e.key === "ArrowUp"
                                      ? -step
                                      : 0),
                              ),
                            }),
                          );
                        }}
                      >
                        {row.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p>{t("No floorplan background selected.")}</p>
            )}
            <ul className="flex flex-wrap gap-2">
              {plan.markers.map((row) => (
                <li key={row.id}>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelected(row.id);
                      setLabel(row.label || "");
                    }}
                  >
                    {row.name}
                  </Button>
                </li>
              ))}
            </ul>
            {marker && (
              <div className="flex flex-wrap items-end gap-3">
                <Link
                  to={
                    marker.deviceId
                      ? `/devices/${encodeURIComponent(marker.deviceId)}`
                      : `/racks?rackId=${encodeURIComponent(marker.rackId!)}`
                  }
                >
                  {t(marker.deviceId ? "Device" : "Rack")}: {marker.name}
                </Link>
                {canEdit && (
                  <>
                    <label>
                      {t("Label")}
                      <Input
                        value={label}
                        maxLength={120}
                        onChange={(e) => setLabel(e.target.value)}
                      />
                    </label>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void change(() =>
                          api.updateFloorplanMarker(roomId, marker.id, {
                            revision: plan.revision,
                            label: label || null,
                          }),
                        )
                      }
                    >
                      {t("Save")}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() =>
                        void change(() =>
                          api.deleteFloorplanMarker(
                            roomId,
                            marker.id,
                            plan.revision,
                          ),
                        )
                      }
                    >
                      {t("Delete")}
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
