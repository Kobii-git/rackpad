import { useI18n } from "@/i18n";
import {
  cableContinuationLabel,
  type CableContinuationMarker,
} from "@/lib/rack-studio-cables";
import type { Device, Port } from "@/lib/types";

/** Presentation only: every marker still selects/traces its single real cable. */
export function CableContinuationMarkers({
  markers,
  linkId,
  cableLabel,
  color,
  ports,
  devices,
  showLabels,
  opacity = 1,
  onRevealEndpoint,
}: {
  markers: CableContinuationMarker[];
  linkId: string;
  cableLabel: string;
  color: string;
  ports: Port[];
  devices: Device[];
  showLabels: boolean;
  opacity?: number;
  onRevealEndpoint?: (portId: string, linkId: string) => void;
}) {
  const { t } = useI18n();
  return markers.map((marker) => {
    const label = cableContinuationLabel(marker, ports, devices, {
      front: t("Front"),
      rear: t("Rear"),
    });
    const directionalLabel = `${cableLabel} [${linkId}] · ↔ ${label}${marker.incomplete ? ` · ${t("Incomplete route")}` : ""}`;
    return (
      <g
        key={marker.portId}
        data-testid="cable-continuation"
        data-link-id={linkId}
        data-port-id={marker.portId}
        data-destination-port-id={marker.destinationPortId}
        data-face={marker.face}
        data-destination-face={marker.destinationFace}
        className={onRevealEndpoint ? "pointer-events-auto cursor-pointer" : "pointer-events-none"}
        role={onRevealEndpoint ? "button" : undefined}
        tabIndex={onRevealEndpoint ? 0 : undefined}
        aria-label={directionalLabel}
        onClick={event => { event.stopPropagation(); onRevealEndpoint?.(marker.destinationPortId, linkId); }}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onRevealEndpoint?.(marker.destinationPortId, linkId); } }}
        opacity={opacity}
      >
        <title>{directionalLabel}</title>
        {onRevealEndpoint && <circle cx={marker.x} cy={marker.y} r={12} fill="transparent" />}
        <circle
          cx={marker.x}
          cy={marker.y}
          r={marker.radius}
          fill="var(--surface-1)"
          stroke={color}
          strokeWidth={Math.min(2, marker.radius * 0.65)}
        />
        {(showLabels || marker.incomplete) && (
          <text
            x={marker.x + (marker.textAnchor === "start" ? 8 : -8)}
            y={marker.y - 6}
            textAnchor={marker.textAnchor}
            fill="var(--text-primary)"
            stroke="var(--surface-1)"
            strokeWidth={3}
            paintOrder="stroke"
            fontSize={9}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {directionalLabel}
          </text>
        )}
      </g>
    );
  });
}
