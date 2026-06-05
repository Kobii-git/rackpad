import { useMemo } from "react";
import { motion } from "motion/react";
import type { Vlan, VlanRange } from "@/lib/types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { Mono } from "@/components/shared/Mono";

interface VlanRangeBarProps {
  ranges: VlanRange[];
  vlans: Vlan[];
  onSelectRange?: (rangeId: string) => void;
  selectedRangeId?: string;
}

const TOTAL_VLANS = 4094;

export function VlanRangeBar({
  ranges,
  vlans,
  onSelectRange,
  selectedRangeId,
}: VlanRangeBarProps) {
  const sorted = useMemo(
    () => [...ranges].sort((a, b) => a.startVlan - b.startVlan),
    [ranges],
  );

  const segments = useMemo(() => {
    const segs: Array<{ start: number; end: number; range?: VlanRange }> = [];
    let cursor = 1;
    for (const range of sorted) {
      if (range.startVlan > cursor) {
        segs.push({ start: cursor, end: range.startVlan - 1 });
      }
      segs.push({ start: range.startVlan, end: range.endVlan, range });
      cursor = range.endVlan + 1;
    }
    if (cursor <= TOTAL_VLANS) {
      segs.push({ start: cursor, end: TOTAL_VLANS });
    }
    return segs;
  }, [sorted]);

  const usedIds = useMemo(
    () => new Set(vlans.map((vlan) => vlan.vlanId)),
    [vlans],
  );

  // Linear 1-4094 scaling makes small low-numbered ranges invisible, so give
  // every defined range a minimum width floor and renormalize. Unallocated
  // gaps keep their proportional share of whatever space is left.
  const widths = useMemo(() => {
    const MIN_RANGE_PCT = 6;
    const raw = segments.map(
      (segment) => ((segment.end - segment.start + 1) / TOTAL_VLANS) * 100,
    );
    const adjusted = segments.map((segment, index) =>
      segment.range ? Math.max(raw[index], MIN_RANGE_PCT) : raw[index],
    );
    const sum = adjusted.reduce((total, value) => total + value, 0) || 1;
    return adjusted.map((value) => (value / sum) * 100);
  }, [segments]);

  return (
    <div className="space-y-3">
      <div className="flex h-10 w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[linear-gradient(180deg,rgb(255_255_255_/_0.025),transparent_34%),var(--surface-1)] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]">
        {segments.map((segment, index) => {
          const width = widths[index];
          const inRangeUsed = vlans.filter(
            (vlan) =>
              vlan.vlanId >= segment.start && vlan.vlanId <= segment.end,
          ).length;
          const total = segment.end - segment.start + 1;
          const isSelected =
            segment.range && segment.range.id === selectedRangeId;

          if (!segment.range) {
            return (
              <Tooltip key={index}>
                <TooltipTrigger asChild>
                  <div
                    className="border-r border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] last:border-r-0"
                    style={{ width: `${width}%` }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-[11px]">
                    <div className="font-mono text-[var(--text-tertiary)]">
                      unallocated
                    </div>
                    <div>
                      VLAN {segment.start}-{segment.end} | {total} IDs free
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          }

          return (
            <Tooltip key={index}>
              <TooltipTrigger asChild>
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: index * 0.04 }}
                  onClick={() => onSelectRange?.(segment.range!.id)}
                  className="relative border-r border-[var(--border-subtle)] last:border-r-0 transition-all hover:brightness-110"
                  style={{
                    width: `${width}%`,
                    background: `linear-gradient(180deg, rgb(255 255 255 / 0.06), transparent 48%), ${segment.range.color}35`,
                    boxShadow: isSelected
                      ? `inset 0 0 0 1px ${segment.range.color}`
                      : "none",
                  }}
                >
                  {width > 5 && (
                    <span
                      className="absolute inset-0 flex items-center justify-center px-1 font-mono text-[9px] uppercase tracking-[0.16em] truncate"
                      style={{ color: segment.range.color }}
                    >
                      {segment.range.name}
                    </span>
                  )}

                  <div className="absolute inset-x-0 bottom-0 h-1">
                    {Array.from({ length: total }).map((_, idx) => {
                      const id = segment.start + idx;
                      if (!usedIds.has(id)) return null;
                      const left = (idx / total) * 100;
                      return (
                        <span
                          key={idx}
                          className="absolute size-1 rounded-full"
                          style={{
                            left: `${left}%`,
                            top: -2,
                            backgroundColor: segment.range!.color,
                            boxShadow: `0 0 6px ${segment.range!.color}55`,
                          }}
                        />
                      );
                    })}
                  </div>
                </motion.button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-0.5 text-[11px]">
                  <div
                    className="font-medium"
                    style={{ color: segment.range.color }}
                  >
                    {segment.range.name}
                  </div>
                  <div className="text-[var(--text-tertiary)]">
                    VLAN {segment.range.startVlan}-{segment.range.endVlan}
                  </div>
                  <div className="text-[var(--text-tertiary)]">
                    {inRangeUsed} used | {total - inRangeUsed} free
                  </div>
                  {segment.range.purpose && (
                    <div className="text-[var(--text-muted)]">
                      {segment.range.purpose}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex items-center justify-between px-1 font-mono text-[9px] text-[var(--text-muted)]">
        <span>VLAN 1</span>
        <span className="normal-case tracking-normal">
          defined ranges sized for visibility
        </span>
        <span>4094</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {sorted.map((range) => (
          <button
            key={range.id}
            onClick={() => onSelectRange?.(range.id)}
            className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 transition-colors ${
              range.id === selectedRangeId
                ? "border-[var(--accent-primary-border)] bg-[var(--surface-selected)] text-[var(--text-primary)]"
                : "border-[var(--border-default)] bg-[rgb(255_255_255_/_0.02)] hover:border-[var(--border-strong)]"
            }`}
          >
            <span
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: range.color }}
            />
            <span className="text-[11px] text-[var(--text-primary)]">
              {range.name}
            </span>
            <Mono className="text-[10px] text-[var(--text-tertiary)]">
              {range.startVlan}-{range.endVlan}
            </Mono>
          </button>
        ))}
      </div>
    </div>
  );
}
