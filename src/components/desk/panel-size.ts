/**
 * Pure helpers for the resizable desk sidebars. Framework-free so they run
 * under `node:test`.
 */

export type PanelSide = "left" | "right";

export interface PanelLimits {
  min: number;
  default: number;
  max: number;
}

/** Widths in CSS pixels. Defaults match the previous fixed layout (w-60 / 22rem). */
export const PANEL_LIMITS: Record<PanelSide, PanelLimits> = {
  left: { min: 200, default: 240, max: 400 },
  right: { min: 280, default: 352, max: 1200 },
};

/** The chat column never gets narrower than this while both sidebars are docked. */
export const CHAT_MIN_WIDTH = 420;

export const PANEL_STEP = 16;
export const PANEL_STEP_LARGE = 64;

export const PANEL_STORAGE_KEYS: Record<PanelSide, string> = {
  left: "paddy:panelWidth:left",
  right: "paddy:panelWidth:right",
};

export function clampWidth(value: number, min: number, max: number): number {
  const hi = Math.max(min, max);
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.min(hi, Math.max(min, value)));
}

/**
 * Largest width a panel may take right now: its own max, reduced so the chat
 * column keeps CHAT_MIN_WIDTH next to the other panel. Never below the panel min.
 */
export function maxPanelWidth(side: PanelSide, viewport: number, otherWidth: number): number {
  const limits = PANEL_LIMITS[side];
  if (!Number.isFinite(viewport) || viewport <= 0) return limits.max;
  const room = Math.floor(viewport - otherWidth - CHAT_MIN_WIDTH);
  return Math.max(limits.min, Math.min(limits.max, room));
}

export function clampPanel(side: PanelSide, value: number, viewport: number, otherWidth: number): number {
  return clampWidth(value, PANEL_LIMITS[side].min, maxPanelWidth(side, viewport, otherWidth));
}

/**
 * Keyboard handling for a vertical separator. Arrow keys move the handle in
 * the direction pressed: for the left panel → grows it, for the right panel ←
 * grows it. Shift takes a larger step. Home/End jump to min/max. Returns null
 * for keys the separator does not handle.
 */
export function keyboardWidth(
  side: PanelSide,
  key: string,
  current: number,
  min: number,
  max: number,
  shift = false,
): number | null {
  const step = shift ? PANEL_STEP_LARGE : PANEL_STEP;
  const grow = side === "left" ? 1 : -1;
  switch (key) {
    case "ArrowRight":
      return clampWidth(current + step * grow, min, max);
    case "ArrowLeft":
      return clampWidth(current - step * grow, min, max);
    case "ArrowUp":
      return clampWidth(current + step, min, max);
    case "ArrowDown":
      return clampWidth(current - step, min, max);
    case "Home":
      return clampWidth(min, min, max);
    case "End":
      return clampWidth(max, min, max);
    default:
      return null;
  }
}

/** Width after dragging the handle `deltaX` pixels from where the drag started. */
export function dragWidth(side: PanelSide, startWidth: number, deltaX: number, min: number, max: number): number {
  return clampWidth(side === "left" ? startWidth + deltaX : startWidth - deltaX, min, max);
}

/** Parse a stored width. Anything missing, non-numeric or out of range falls back to the default. */
export function parseStoredWidth(side: PanelSide, raw: string | null | undefined): number {
  const limits = PANEL_LIMITS[side];
  if (raw == null || !/^\s*\d+(\.\d+)?\s*$/.test(raw)) return limits.default;
  return clampWidth(Number(raw), limits.min, limits.max);
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readPanelWidth(side: PanelSide, storage: StorageLike | null | undefined): number {
  try {
    return parseStoredWidth(side, storage?.getItem(PANEL_STORAGE_KEYS[side]));
  } catch {
    return PANEL_LIMITS[side].default;
  }
}

export function writePanelWidth(side: PanelSide, width: number, storage: StorageLike | null | undefined): void {
  const limits = PANEL_LIMITS[side];
  try {
    storage?.setItem(PANEL_STORAGE_KEYS[side], String(clampWidth(width, limits.min, limits.max)));
  } catch {
    // Storage full or blocked (private mode): the width just won't persist.
  }
}
