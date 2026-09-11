import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import type {
  CableRouteGuide,
  Device,
  DevicePhysicalLayout,
  Port,
  Rack,
  RackFace,
  Room,
} from "@/lib/types";
import { PhysicalFaceplate } from "./PhysicalFaceplate";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const selectClass =
  "h-8 w-full rounded border border-[var(--border-default)] bg-[var(--surface-1)] px-2 text-xs";

export function CableGuideEditor({
  guides,
  devices,
  racks,
  layouts,
  ports,
  room,
  disabled,
  onChange,
}: {
  guides: CableRouteGuide[];
  devices: Device[];
  racks: Rack[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  room: Room;
  disabled: boolean;
  onChange: (guides: CableRouteGuide[]) => void;
}) {
  const { t } = useI18n();
  const available = devices.filter(
    (device) =>
      (racks.find((rack) => rack.id === device.rackId)?.roomId ??
        device.roomId) === room.id &&
      layouts.some((layout) => layout.deviceId === device.id),
  );
  const update = (id: string, changes: Partial<CableRouteGuide>) =>
    onChange(
      guides.map((guide) =>
        guide.id === id ? { ...guide, ...changes } : guide,
      ),
    );
  const move = (index: number, direction: number) => {
    const next = [...guides];
    [next[index], next[index + direction]] = [
      next[index + direction]!,
      next[index]!,
    ];
    onChange(next);
  };
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="mb-2 text-xs font-medium">{t("Route guides")}</legend>
      <p className="text-[11px] text-[var(--text-tertiary)]">
        {t(
          "Select an installed brush panel or cable manager, then place a guide on its face.",
        )}
      </p>
      {guides.map((guide, index) => {
        const device = devices.find((device) => device.id === guide.deviceId);
        const layout = layouts.find(
          (layout) => layout.deviceId === guide.deviceId,
        );
        return (
          <div
            key={guide.id}
            className="space-y-2 rounded border border-[var(--border-default)] p-2"
          >
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-xs">
                {index + 1}. {device?.hostname ?? guide.deviceId}
              </span>
              <Button
                size="icon"
                variant="ghost"
                disabled={disabled || index === 0}
                aria-label={t("Move up")}
                onClick={() => move(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={disabled || index === guides.length - 1}
                aria-label={t("Move down")}
                onClick={() => move(index, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={disabled}
                aria-label={t("Delete")}
                onClick={() =>
                  onChange(guides.filter((item) => item.id !== guide.id))
                }
              >
                <Trash2 />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["entryFace", "exitFace"] as const).map((key) => (
                <label key={key} className="text-[11px]">
                  {key === "entryFace" ? t("Entry face") : t("Exit face")}
                  <select
                    className={selectClass}
                    value={guide[key]}
                    onChange={(event) =>
                      update(guide.id, {
                        [key]: event.target.value as RackFace,
                      })
                    }
                  >
                    <option value="front">{t("Front")}</option>
                    <option value="rear">{t("Rear")}</option>
                  </select>
                </label>
              ))}
            </div>
            {layout ? (
              <div
                className="relative h-24"
                onPointerDown={(event) => {
                  if (disabled) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  update(guide.id, {
                    x: Math.round(
                      Math.max(
                        0,
                        Math.min(
                          1000,
                          ((event.clientX - rect.left) / rect.width) * 1000,
                        ),
                      ),
                    ),
                    y: Math.round(
                      Math.max(
                        0,
                        Math.min(
                          1000,
                          ((event.clientY - rect.top) / rect.height) * 1000,
                        ),
                      ),
                    ),
                  });
                }}
              >
                <PhysicalFaceplate
                  layout={layout}
                  face={guide.entryFace}
                  ports={ports.filter(
                    (port) => port.deviceId === guide.deviceId,
                  )}
                  compact
                  fit="stretch"
                  className="h-full w-full"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--accent-primary)]"
                  style={{ left: `${guide.x / 10}%`, top: `${guide.y / 10}%` }}
                />
              </div>
            ) : (
              <p className="text-xs text-[var(--color-warning)]">
                {t("Incomplete route")}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {(["x", "y"] as const).map((key) => (
                <Input
                  key={key}
                  aria-label={t("{value1}: {name}", {
                    value1: t("Position"),
                    name: key.toUpperCase(),
                  })}
                  type="number"
                  min={0}
                  max={1000}
                  value={guide[key]}
                  onChange={(event) =>
                    update(guide.id, {
                      [key]: Math.max(
                        0,
                        Math.min(1000, Number(event.target.value)),
                      ),
                    })
                  }
                  className="h-8 text-xs"
                />
              ))}
            </div>
          </div>
        );
      })}
      <label className="flex items-center gap-2 text-xs">
        <Plus className="size-4" />
        <select
          aria-label={t("Add guide")}
          className={selectClass}
          value=""
          disabled={disabled || guides.length >= 32}
          onChange={(event) => {
            let sequence = 1;
            while (guides.some((guide) => guide.id === `guide-${sequence}`))
              sequence += 1;
            if (event.target.value)
              onChange([
                ...guides,
                {
                  id: `guide-${sequence}`,
                  deviceId: event.target.value,
                  roomId: room.id,
                  entryFace: "front",
                  exitFace: "front",
                  x: 500,
                  y: 500,
                },
              ]);
          }}
        >
          <option value="">{t("Add guide")}</option>
          {available.map((device) => (
            <option key={device.id} value={device.id}>
              {device.hostname}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
