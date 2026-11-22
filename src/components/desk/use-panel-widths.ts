import { useCallback, useEffect, useState } from "react";
import {
  PANEL_LIMITS,
  clampPanel,
  clampWidth,
  maxPanelWidth,
  readPanelWidth,
  writePanelWidth,
  type PanelSide,
} from "./panel-size";

/** Tailwind `lg` — below this the inspector is hidden and nothing resizes. */
const WIDE_QUERY = "(min-width: 1024px)";

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export interface PanelState {
  width: number;
  min: number;
  max: number;
  resize: (width: number) => void;
  commit: (width: number) => void;
  reset: () => void;
}

/**
 * Sidebar widths for the desk. Stored preferences are clamped against the
 * viewport so the chat column keeps its minimum; resizing is only enabled on
 * wide viewports (`wide`).
 */
export function usePanelWidths(rightVisible: boolean): { wide: boolean; left: PanelState; right: PanelState } {
  const [prefs, setPrefs] = useState<Record<PanelSide, number>>({
    left: PANEL_LIMITS.left.default,
    right: PANEL_LIMITS.right.default,
  });
  const [viewport, setViewport] = useState(0);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const storage = browserStorage();
    setPrefs({ left: readPanelWidth("left", storage), right: readPanelWidth("right", storage) });
    const media = window.matchMedia(WIDE_QUERY);
    const update = () => {
      setViewport(window.innerWidth);
      setWide(media.matches);
    };
    update();
    window.addEventListener("resize", update);
    media.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      media.removeEventListener("change", update);
    };
  }, []);

  const leftWidth = clampWidth(prefs.left, PANEL_LIMITS.left.min, PANEL_LIMITS.left.max);
  const rightWidth = clampPanel("right", prefs.right, viewport, leftWidth);
  const leftMax = maxPanelWidth("left", viewport, rightVisible ? rightWidth : 0);
  const rightMax = maxPanelWidth("right", viewport, leftWidth);

  const resize = useCallback((side: PanelSide, width: number) => {
    setPrefs((current) => (current[side] === width ? current : { ...current, [side]: width }));
  }, []);
  const commit = useCallback((side: PanelSide, width: number) => {
    writePanelWidth(side, width, browserStorage());
  }, []);
  const reset = useCallback(
    (side: PanelSide) => {
      resize(side, PANEL_LIMITS[side].default);
      commit(side, PANEL_LIMITS[side].default);
    },
    [commit, resize],
  );

  const panel = (side: PanelSide, width: number, max: number): PanelState => ({
    width: Math.min(width, max),
    min: PANEL_LIMITS[side].min,
    max,
    resize: (next) => resize(side, next),
    commit: (next) => commit(side, next),
    reset: () => reset(side),
  });

  return { wide, left: panel("left", leftWidth, leftMax), right: panel("right", rightWidth, rightMax) };
}
