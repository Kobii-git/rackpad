import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SortState } from "@/lib/sort";

interface SortableHeaderProps<K extends string> {
  children: ReactNode;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  className?: string;
}

export function SortableHeader<K extends string>({
  children,
  sortKey,
  sort,
  onSort,
  className,
}: SortableHeaderProps<K>) {
  const active = sort.key === sortKey;
  return (
    <th
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
      className={cn(className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "rk-sort-button",
          active && "rk-sort-button-active",
        )}
      >
        <span>{children}</span>
        <span className="rk-sort-indicator" aria-hidden>
          {active ? (sort.direction === "asc" ? "^" : "v") : ""}
        </span>
      </button>
    </th>
  );
}
