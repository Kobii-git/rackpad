import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Cable, Plus, Route, Save, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { nextManualWaypoint } from "@/lib/rack-studio-cables";
import type {
  CableRouteWaypoint,
  Device,
  Port,
  PortLink,
  RackFace,
  Room,
} from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const SELECT_CLASS =
  "h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] px-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]";

interface RackStudioCableInspectorProps {
  link?: PortLink;
  ports: Port[];
  devices: Device[];
  room?: Room;
  face: RackFace | "both";
  canEdit: boolean;
  saving: boolean;
  onUpdate: (
    id: string,
    changes: Partial<Omit<PortLink, "id">>,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function endpointLabel(port: Port | undefined, devices: Device[]) {
  if (!port) return "—";
  const device = devices.find((candidate) => candidate.id === port.deviceId);
  return `${device?.hostname ?? port.deviceId}:${port.name}`;
}

export function RackStudioCableInspector({
  link,
  ports,
  devices,
  room,
  face,
  canEdit,
  saving,
  onUpdate,
  onDelete,
}: RackStudioCableInspectorProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<PortLink>();
  const [deleteArmed, setDeleteArmed] = useState(false);

  useEffect(() => {
    setDraft(link ? { ...link, routeWaypoints: [...(link.routeWaypoints ?? [])] } : undefined);
    setDeleteArmed(false);
  }, [link]);

  const fromPort = useMemo(
    () => ports.find((port) => port.id === link?.fromPortId),
    [link?.fromPortId, ports],
  );
  const toPort = useMemo(
    () => ports.find((port) => port.id === link?.toPortId),
    [link?.toPortId, ports],
  );

  if (!link || !draft) {
    return (
      <div className="p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
          {t("Cables")}
        </div>
        <div className="mt-8 text-center text-xs text-[var(--text-tertiary)]">
          {t("Select a cable")}
        </div>
      </div>
    );
  }

  const currentRoomWaypoints = (draft.routeWaypoints ?? []).filter(
    (point) => point.roomId === room?.id,
  );

  function updateWaypoint(
    waypointId: string,
    changes: Partial<CableRouteWaypoint>,
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            routeWaypoints: (current.routeWaypoints ?? []).map((point) =>
              point.id === waypointId ? { ...point, ...changes } : point,
            ),
          }
        : current,
    );
  }

  function removeWaypoint(waypointId: string) {
    setDraft((current) =>
      current
        ? {
            ...current,
            routeWaypoints: (current.routeWaypoints ?? []).filter(
              (point) => point.id !== waypointId,
            ),
          }
        : current,
    );
  }

  return (
    <div data-testid="rack-studio-cable-inspector" className="space-y-4 p-4">
      <div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
          <Cable className="size-3.5" />
          {t("Selected cable")}
        </div>
        <div className="mt-2 space-y-1 text-[11px] text-[var(--text-secondary)]">
          <div>
            {t("From port")}: {endpointLabel(fromPort, devices)}
          </div>
          <div>
            {t("To port")}: {endpointLabel(toPort, devices)}
          </div>
        </div>
      </div>

      <InspectorField label={t("Label")}>
        <Input
          value={draft.label ?? ""}
          disabled={!canEdit}
          onChange={(event) =>
            setDraft((current) =>
              current ? { ...current, label: event.target.value } : current,
            )
          }
          className="h-8 text-xs"
        />
      </InspectorField>

      <div className="grid grid-cols-2 gap-2">
        <InspectorField label={t("Type")}>
          <Input
            value={draft.cableType ?? ""}
            disabled={!canEdit}
            onChange={(event) =>
              setDraft((current) =>
                current
                  ? { ...current, cableType: event.target.value }
                  : current,
              )
            }
            className="h-8 text-xs"
          />
        </InspectorField>
        <InspectorField label={t("Length")}>
          <Input
            value={draft.cableLength ?? ""}
            disabled={!canEdit}
            onChange={(event) =>
              setDraft((current) =>
                current
                  ? { ...current, cableLength: event.target.value }
                  : current,
              )
            }
            className="h-8 text-xs"
          />
        </InspectorField>
      </div>

      <InspectorField label={t("Color")}>
        <Input
          value={draft.color ?? ""}
          disabled={!canEdit}
          onChange={(event) =>
            setDraft((current) =>
              current ? { ...current, color: event.target.value } : current,
            )
          }
          className="h-8 font-mono text-xs"
        />
      </InspectorField>

      <InspectorField label={t("Notes")}>
        <textarea
          value={draft.notes ?? ""}
          disabled={!canEdit}
          onChange={(event) =>
            setDraft((current) =>
              current ? { ...current, notes: event.target.value } : current,
            )
          }
          className="min-h-20 w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] p-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] disabled:opacity-60"
        />
      </InspectorField>

      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={draft.visible === false}
          disabled={!canEdit}
          onChange={(event) =>
            setDraft((current) =>
              current ? { ...current, visible: !event.target.checked } : current,
            )
          }
        />
        {t("Hidden")}
      </label>

      {room && (
        <div className="space-y-2 border-t border-[var(--border-default)] pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              <Route className="size-3.5" />
              {t("Cable route layout")}
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={!canEdit}
              aria-label={t("Add")}
              onClick={() =>
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        routeWaypoints: [
                          ...(current.routeWaypoints ?? []),
                          nextManualWaypoint({
                            link: current,
                            roomId: room.id,
                            face: face === "both" ? "front" : face,
                          }),
                        ],
                      }
                    : current,
                )
              }
            >
              <Plus />
            </Button>
          </div>
          {currentRoomWaypoints.map((point) => (
            <div
              key={point.id}
              className="grid grid-cols-[1fr_1fr_1.2fr_auto] gap-1.5"
            >
              <Input
                aria-label={t("{value1}: {name}", {
                  value1: t("Position"),
                  name: "X",
                })}
                type="number"
                min={0}
                max={1000}
                value={point.x}
                disabled={!canEdit}
                onChange={(event) =>
                  updateWaypoint(point.id, { x: Number(event.target.value) })
                }
                className="h-8 text-xs"
              />
              <Input
                aria-label={t("{value1}: {name}", {
                  value1: t("Position"),
                  name: "Y",
                })}
                type="number"
                min={0}
                max={620}
                value={point.y}
                disabled={!canEdit}
                onChange={(event) =>
                  updateWaypoint(point.id, { y: Number(event.target.value) })
                }
                className="h-8 text-xs"
              />
              <select
                aria-label={t("Position")}
                className={SELECT_CLASS}
                value={point.face}
                disabled={!canEdit}
                onChange={(event) =>
                  updateWaypoint(point.id, {
                    face: event.target.value as RackFace,
                  })
                }
              >
                <option value="front">{t("Front")}</option>
                <option value="rear">{t("Rear")}</option>
              </select>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={!canEdit}
                aria-label={t("Delete")}
                onClick={() => removeWaypoint(point.id)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button
          disabled={!canEdit || saving}
          onClick={() =>
            void onUpdate(link.id, {
              label: draft.label,
              cableType: draft.cableType,
              cableLength: draft.cableLength,
              color: draft.color,
              notes: draft.notes,
              visible: draft.visible !== false,
              routeWaypoints: draft.routeWaypoints ?? [],
            })
          }
        >
          <Save className="size-3.5" />
          {t("Save")}
        </Button>
        <Button variant="outline" asChild>
          <Link to={`/visualizer?tracePortId=${link.fromPortId}`}>
            <Route className="size-3.5" />
            {t("Trace")}
          </Link>
        </Button>
      </div>

      <Button
        className="w-full"
        variant={deleteArmed ? "destructive" : "outline"}
        disabled={!canEdit || saving}
        onClick={() => {
          if (!deleteArmed) {
            setDeleteArmed(true);
            return;
          }
          void onDelete(link.id);
        }}
      >
        <Trash2 className="size-3.5" />
        {deleteArmed ? t("Delete cable") : t("Delete")}
      </Button>
    </div>
  );
}

function InspectorField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}
