import { useMemo, useSyncExternalStore } from "react";
import { parseSummaryFields, type SummaryField } from "./device-summary";

const eventName = "rackpad:summary-preferences";
const memory = new Map<string, string>();
export const summaryPreferenceKey = (userId: string) =>
  `rackpad.device-summary.${encodeURIComponent(userId)}`;
function subscribe(callback: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key) memory.delete(event.key);
    else memory.clear();
    callback();
  };
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener("storage", storage);
  };
}
export function useSummaryPreferences(userId: string) {
  const key = summaryPreferenceKey(userId);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      if (!userId) return null;
      if (memory.has(key)) return memory.get(key)!;
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const fields = useMemo(() => parseSummaryFields(snapshot), [snapshot]);
  const save = (next: readonly SummaryField[]) => {
    if (!userId) return;
    const serialized = JSON.stringify(next);
    memory.set(key, serialized);
    try {
      window.localStorage.setItem(key, serialized);
      memory.delete(key);
    } catch {
      /* Keep a working in-memory preference. */
    }
    window.dispatchEvent(new Event(eventName));
  };
  return { fields, save };
}
