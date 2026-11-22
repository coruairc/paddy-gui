import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { dragWidth, keyboardWidth, type PanelSide } from "./panel-size";

interface ResizeHandleProps {
  side: PanelSide;
  label: string;
  controls: string;
  width: number;
  min: number;
  max: number;
  /** Live width while dragging or on each key press. */
  onResize: (width: number) => void;
  /** Final width to persist (drag end, key press). */
  onCommit: (width: number) => void;
  /** Double-click: back to the default width. */
  onReset: () => void;
  className?: string;
}

/**
 * Vertical splitter on a sidebar's inner edge. Pointer capture keeps the drag
 * alive when the pointer leaves the 12px hit area; works for mouse, pen and
 * touch. Keyboard: arrows step, Shift+arrows step larger, Home/End jump.
 */
export function ResizeHandle({ side, label, controls, width, min, max, onResize, onCommit, onReset, className }: ResizeHandleProps) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; last: number } | null>(null);

  // If the handle unmounts mid-drag (e.g. viewport drops below lg), restore the body styles.
  useEffect(
    () => () => {
      if (drag.current) {
        drag.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    },
    [],
  );

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, last: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const next = dragWidth(side, state.startWidth, event.clientX - state.startX, min, max);
    if (next !== state.last) {
      state.last = next;
      onResize(next);
    }
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onCommit(state.last);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = keyboardWidth(side, event.key, width, min, max, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onResize(next);
    onCommit(next);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
      className={cn(
        "group absolute inset-y-0 z-20 w-3 cursor-col-resize touch-none select-none outline-none",
        side === "left" ? "-right-1.5" : "-left-1.5",
        className,
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-accent/50 group-focus-visible:w-0.5 group-focus-visible:bg-accent group-active:bg-accent"
      />
    </div>
  );
}
