import { useRef, useState, type SetStateAction } from "react";
import type { HardwareTemplateV1 } from "./types";
import {
  changeTemplate,
  finishTemplateGesture,
  stepTemplateHistory,
  type TemplateHistory,
} from "./template-history";

export function useTemplateHistory<S>(
  initial: () => HardwareTemplateV1,
  selection: S,
  restoreSelection: (selection: S) => void,
) {
  const [history, render] = useState<TemplateHistory<S>>(() => ({
    draft: initial(),
    past: [],
    future: [],
  }));
  const current = useRef(history);
  function replace(next: TemplateHistory<S>) {
    current.current = next;
    render(next);
  }
  function setDraft(update: SetStateAction<HardwareTemplateV1>) {
    const before = current.current;
    const next = typeof update === "function" ? update(before.draft) : update;
    replace(changeTemplate(before, next, selection));
  }
  function beginGesture() {
    if (!current.current.gesture)
      replace({
        ...current.current,
        gesture: { draft: current.current.draft, selection },
      });
  }
  function finishGesture() {
    replace(finishTemplateGesture(current.current));
  }
  function cancelGesture() {
    const { gesture, ...next } = current.current;
    if (gesture) {
      replace({ ...next, draft: gesture.draft });
      restoreSelection(gesture.selection);
    }
  }
  function step(direction: "undo" | "redo") {
    const result = stepTemplateHistory(current.current, selection, direction);
    replace(result.history);
    restoreSelection(result.selection);
  }
  return {
    draft: history.draft,
    setDraft,
    beginGesture,
    finishGesture,
    cancelGesture,
    undo: () => step("undo"),
    redo: () => step("redo"),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    reset: (draft: HardwareTemplateV1) =>
      replace({ draft, past: [], future: [] }),
    saved: (draft: HardwareTemplateV1) =>
      replace({ ...current.current, draft }),
  };
}
