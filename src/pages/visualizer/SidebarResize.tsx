import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";

export function useSidebarWidth(mode: string, defaultWidth: number) {
  const key = `rackpad.visualizer.sidebar-width.${mode}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [requestedWidth, setRequestedWidth] = useState(() => {
    try {
      const value = Number(localStorage.getItem(key));
      return value >= 320 && value <= 640 ? value : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });
  const [maximum, setMaximum] = useState(640);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setMaximum(Math.max(320, Math.min(640, element.clientWidth - 384))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = Math.max(320, Math.min(maximum, requestedWidth));
  function setWidth(value: number) {
    const next = Math.round(Math.max(320, Math.min(maximum, value)));
    setRequestedWidth(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      /* Storage is optional. */
    }
  }
  return { containerRef, width, maximum, setWidth };
}

export function SidebarResize({
  sidebar,
}: {
  sidebar: ReturnType<typeof useSidebarWidth>;
}) {
  const { t } = useI18n();
  const drag = useRef<{ x: number; width: number; direction: number } | null>(
    null,
  );
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={t("Resize side panel")}
      aria-orientation="vertical"
      aria-valuemin={320}
      aria-valuemax={sidebar.maximum}
      aria-valuenow={sidebar.width}
      data-testid="visualizer-sidebar-resize"
      className="absolute -start-2 top-0 z-50 h-full w-2 cursor-col-resize touch-none rounded focus-visible:bg-[var(--accent-primary)]"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.clientX,
          width: sidebar.width,
          direction:
            getComputedStyle(event.currentTarget).direction === "rtl" ? 1 : -1,
        };
      }}
      onPointerMove={(event) => {
        if (drag.current)
          sidebar.setWidth(
            drag.current.width +
              (event.clientX - drag.current.x) * drag.current.direction,
          );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        if (drag.current) sidebar.setWidth(drag.current.width);
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 40 : 10;
        const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
        if (event.key === "Home") sidebar.setWidth(320);
        else if (event.key === "End") sidebar.setWidth(sidebar.maximum);
        else if (event.key === "ArrowLeft")
          sidebar.setWidth(sidebar.width + (rtl ? -step : step));
        else if (event.key === "ArrowRight")
          sidebar.setWidth(sidebar.width + (rtl ? step : -step));
        else return;
        event.preventDefault();
      }}
    />
  );
}
