import type { HardwareTemplateV1 } from "./types";
import { reconcileArtworkOrder } from "./template-artwork";

export interface TemplateHistoryEntry<S> {
  draft: HardwareTemplateV1;
  selection: S;
}
export interface TemplateHistory<S> {
  draft: HardwareTemplateV1;
  past: TemplateHistoryEntry<S>[];
  future: TemplateHistoryEntry<S>[];
  gesture?: TemplateHistoryEntry<S>;
}
const different = (a: HardwareTemplateV1, b: HardwareTemplateV1) =>
  JSON.stringify(a) !== JSON.stringify(b);
export function changeTemplate<S>(
  history: TemplateHistory<S>,
  draft: HardwareTemplateV1,
  selection: S,
): TemplateHistory<S> {
  draft = reconcileArtworkOrder(draft);
  if (!different(history.draft, draft)) return history;
  return {
    ...history,
    draft,
    past: history.gesture
      ? history.past
      : [...history.past, { draft: history.draft, selection }].slice(-100),
    future: history.gesture ? history.future : [],
  };
}
export function finishTemplateGesture<S>(
  history: TemplateHistory<S>,
): TemplateHistory<S> {
  const { gesture, ...rest } = history;
  if (!gesture || !different(gesture.draft, history.draft)) return rest;
  return { ...rest, past: [...history.past, gesture].slice(-100), future: [] };
}
export function stepTemplateHistory<S>(
  history: TemplateHistory<S>,
  selection: S,
  direction: "undo" | "redo",
) {
  history = finishTemplateGesture(history);
  const source = direction === "undo" ? history.past : history.future;
  const target = source.at(-1);
  if (!target) return { history, selection };
  const current = { draft: history.draft, selection };
  return {
    selection: target.selection,
    history: {
      draft: target.draft,
      past:
        direction === "undo"
          ? source.slice(0, -1)
          : [...history.past, current].slice(-100),
      future:
        direction === "redo"
          ? source.slice(0, -1)
          : [...history.future, current].slice(-100),
    } as TemplateHistory<S>,
  };
}
