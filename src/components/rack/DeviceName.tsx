import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { deviceNameMetrics } from "@/lib/device-name";

const CanvasZoom = createContext(1);

export function DeviceNameZoom({
  zoom,
  children,
}: {
  zoom: number;
  children: ReactNode;
}) {
  return <CanvasZoom.Provider value={zoom}>{children}</CanvasZoom.Provider>;
}

/** Names stay upright; only the faceplate artwork inherits device rotation. */
export function DeviceName({
  name,
  selected = false,
  tooltip = true,
  maxHeight,
  widthFraction = 1,
  reservedLeft = 0,
  reservedRight = 0,
  position = "upper-right",
}: {
  name: string;
  selected?: boolean;
  /** Disable when the host already provides a richer portaled tooltip. */
  tooltip?: boolean;
  maxHeight?: number;
  widthFraction?: number;
  reservedLeft?: number;
  reservedRight?: number;
  position?: "upper-left" | "upper-right";
}) {
  const zoom = useContext(CanvasZoom);
  const ref = useRef<HTMLSpanElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [point, setPoint] = useState({ x: 8, y: 8 });
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const metrics = deviceNameMetrics(
    bounds.width * widthFraction,
    Math.min(bounds.height, maxHeight ?? Infinity),
    zoom,
    reservedLeft,
    reservedRight,
    position,
  );
  const { visible, ...labelStyle } = metrics;
  const reveal =
    tooltip && !dismissed && (hovered || focused || (selected && !visible));

  // Selection props may change as a side effect of Escape (ReactFlow).
  // Only a renewed user interaction may cancel an explicit dismissal.
  useLayoutEffect(() => {
    if (!dismissed) return;
    const renew = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== "Escape")
        setDismissed(false);
    };
    window.addEventListener("pointerdown", renew, true);
    window.addEventListener("keydown", renew, true);
    return () => {
      window.removeEventListener("pointerdown", renew, true);
      window.removeEventListener("keydown", renew, true);
    };
  }, [dismissed]);
  useLayoutEffect(() => setDismissed(false), [name]);

  useLayoutEffect(() => {
    const host = ref.current?.closest<HTMLElement>("[data-device-name-host]");
    if (!host) return;
    const measure = () =>
      setBounds({ width: host.clientWidth, height: host.clientHeight });
    const enter = () => {
      setDismissed(false);
      setHovered(true);
    };
    const leave = () => setHovered(false);
    const focus = (event: FocusEvent) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !host.contains(event.relatedTarget)
      )
        setDismissed(false);
      setFocused(true);
    };
    const blur = (event: FocusEvent) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !host.contains(event.relatedTarget)
      )
        setFocused(false);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("focusin", focus);
    host.addEventListener("focusout", blur);
    host.addEventListener("keydown", dismiss);
    return () => {
      observer.disconnect();
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("focusin", focus);
      host.removeEventListener("focusout", blur);
      host.removeEventListener("keydown", dismiss);
    };
  }, []);

  useLayoutEffect(() => {
    if (!reveal) return;
    const host = ref.current?.closest<HTMLElement>("[data-device-name-host]");
    if (!host) return;
    let frame = 0;
    const follow = () => {
      const rect = host.getBoundingClientRect();
      const tooltip = tooltipRef.current?.getBoundingClientRect();
      const width = tooltip?.width ?? 0;
      const height = tooltip?.height ?? 0;
      const next = {
        x: Math.max(
          8,
          Math.min(window.innerWidth - width - 8, position === "upper-left" ? rect.left : rect.right - width),
        ),
        y: Math.max(
          8,
          Math.min(
            window.innerHeight - height - 8,
            rect.top - height - 4 >= 8
              ? rect.top - height - 4
              : rect.bottom + 4,
          ),
        ),
      };
      setPoint((previous) =>
        previous.x === next.x && previous.y === next.y ? previous : next,
      );
      frame = requestAnimationFrame(follow);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    window.addEventListener("keydown", dismiss);
    follow();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", dismiss);
    };
  }, [reveal, position]);

  return (
    <>
      <span
        ref={ref}
        data-testid="device-name"
        data-name-position={position}
        data-name-visible={visible}
        title={name}
        className="absolute z-10 box-border block truncate rounded bg-black/70 font-mono font-semibold text-white"
        style={{
          ...labelStyle,
          visibility: visible ? "visible" : "hidden",
          pointerEvents: "none",
          textAlign: position === "upper-left" ? "left" : "right",
        }}
      >
        {name}
      </span>
      {!visible && <span className="sr-only">{name}</span>}
      {reveal &&
        createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            data-testid="device-name-tooltip"
            className="pointer-events-none fixed z-[100] max-h-[calc(100vh-16px)] max-w-[min(320px,calc(100vw-16px))] overflow-hidden break-words rounded border border-[var(--border-strong)] bg-[var(--surface-1)] px-2 py-1 font-mono text-[12px] leading-4 text-[var(--text-primary)] shadow-lg"
            style={{ left: point.x, top: point.y }}
          >
            {name}
          </span>,
          document.body,
        )}
    </>
  );
}
