import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_MIN_WIDTH,
  PANEL_LIMITS,
  PANEL_STEP,
  PANEL_STEP_LARGE,
  PANEL_STORAGE_KEYS,
  clampPanel,
  clampWidth,
  dragWidth,
  keyboardWidth,
  maxPanelWidth,
  parseStoredWidth,
  readPanelWidth,
  writePanelWidth,
} from "./panel-size.ts";

test("clampWidth bounds, rounds and rejects non-finite", () => {
  assert.equal(clampWidth(50, 100, 200), 100);
  assert.equal(clampWidth(500, 100, 200), 200);
  assert.equal(clampWidth(150.6, 100, 200), 151);
  assert.equal(clampWidth(Number.NaN, 100, 200), 100);
  assert.equal(clampWidth(Number.POSITIVE_INFINITY, 100, 200), 100);
  assert.equal(clampWidth(150, 100, 80), 100, "max below min collapses to min");
});

test("maxPanelWidth keeps the chat column usable", () => {
  const { right, left } = PANEL_LIMITS;
  assert.equal(maxPanelWidth("right", 3000, 240), right.max);
  assert.equal(maxPanelWidth("right", 1200, 240), 1200 - 240 - CHAT_MIN_WIDTH);
  assert.equal(maxPanelWidth("right", 900, 240), right.min, "never below min");
  assert.equal(maxPanelWidth("left", 1000, 352), Math.max(left.min, Math.min(left.max, 1000 - 352 - CHAT_MIN_WIDTH)));
  assert.equal(maxPanelWidth("left", 0, 352), left.max, "unknown viewport uses static max");
});

test("PANEL_LIMITS raised right cap keeps the left panel and chat guard", () => {
  assert.equal(PANEL_LIMITS.right.max, 1200, "inspector cap raised to 1200");
  assert.equal(PANEL_LIMITS.right.min, 280);
  assert.equal(PANEL_LIMITS.right.default, 352);
  assert.deepEqual(PANEL_LIMITS.left, { min: 200, default: 240, max: 400 }, "left panel untouched");
  assert.equal(CHAT_MIN_WIDTH, 420, "chat guard untouched");
});

test("maxPanelWidth lets the inspector reach 1200 only when the viewport has room", () => {
  assert.equal(maxPanelWidth("right", 1920, 240), 1200, "1920 - 240 - 420 = 1260 >= 1200");
  assert.equal(maxPanelWidth("right", 1280, 240), 620, "1280 - 240 - 420 = 620 still binds");
  assert.equal(
    keyboardWidth("right", "End", 352, PANEL_LIMITS.right.min, maxPanelWidth("right", 1920, 240)),
    1200,
    "End key reaches the new max",
  );
  assert.equal(parseStoredWidth("right", "1200"), 1200);
  assert.equal(parseStoredWidth("right", "800"), 800, "existing saved widths stay valid");
});

test("clampPanel combines limits and viewport room", () => {
  assert.equal(clampPanel("right", 9999, 1400, 240), 1400 - 240 - CHAT_MIN_WIDTH);
  assert.equal(clampPanel("right", 10, 1400, 240), PANEL_LIMITS.right.min);
  assert.equal(clampPanel("left", 300, 1600, 352), 300);
});

test("keyboardWidth arrow direction follows the handle", () => {
  assert.equal(keyboardWidth("left", "ArrowRight", 240, 200, 400), 240 + PANEL_STEP);
  assert.equal(keyboardWidth("left", "ArrowLeft", 240, 200, 400), 240 - PANEL_STEP);
  assert.equal(keyboardWidth("right", "ArrowLeft", 352, 280, 800), 352 + PANEL_STEP);
  assert.equal(keyboardWidth("right", "ArrowRight", 352, 280, 800), 352 - PANEL_STEP);
  assert.equal(keyboardWidth("right", "ArrowUp", 352, 280, 800), 352 + PANEL_STEP);
  assert.equal(keyboardWidth("right", "ArrowDown", 352, 280, 800), 352 - PANEL_STEP);
  assert.equal(keyboardWidth("right", "ArrowLeft", 352, 280, 800, true), 352 + PANEL_STEP_LARGE);
});

test("keyboardWidth clamps, handles Home/End and ignores other keys", () => {
  assert.equal(keyboardWidth("left", "ArrowLeft", 205, 200, 400), 200);
  assert.equal(keyboardWidth("right", "ArrowLeft", 795, 280, 800), 800);
  assert.equal(keyboardWidth("right", "Home", 500, 280, 800), 280);
  assert.equal(keyboardWidth("right", "End", 500, 280, 800), 800);
  assert.equal(keyboardWidth("right", "Enter", 500, 280, 800), null);
  assert.equal(keyboardWidth("right", "a", 500, 280, 800), null);
});

test("dragWidth grows the right panel when dragging left", () => {
  assert.equal(dragWidth("right", 352, -100, 280, 800), 452);
  assert.equal(dragWidth("left", 240, 60, 200, 400), 300);
  assert.equal(dragWidth("right", 352, 1000, 280, 800), 280);
});

test("parseStoredWidth validates and clamps", () => {
  assert.equal(parseStoredWidth("right", null), PANEL_LIMITS.right.default);
  assert.equal(parseStoredWidth("right", ""), PANEL_LIMITS.right.default);
  assert.equal(parseStoredWidth("right", "abc"), PANEL_LIMITS.right.default);
  assert.equal(parseStoredWidth("right", "-50"), PANEL_LIMITS.right.default);
  assert.equal(parseStoredWidth("right", "1e9"), PANEL_LIMITS.right.default);
  assert.equal(parseStoredWidth("right", "500"), 500);
  assert.equal(parseStoredWidth("right", "99999"), PANEL_LIMITS.right.max);
  assert.equal(parseStoredWidth("left", "10"), PANEL_LIMITS.left.min);
});

test("read/writePanelWidth use paddy: keys and survive throwing storage", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  writePanelWidth("right", 512.4, storage);
  assert.equal(map.get(PANEL_STORAGE_KEYS.right), "512");
  assert.ok(PANEL_STORAGE_KEYS.right.startsWith("paddy:"));
  assert.equal(readPanelWidth("right", storage), 512);
  writePanelWidth("left", 99999, storage);
  assert.equal(map.get(PANEL_STORAGE_KEYS.left), String(PANEL_LIMITS.left.max));

  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.equal(readPanelWidth("right", broken), PANEL_LIMITS.right.default);
  assert.doesNotThrow(() => writePanelWidth("right", 400, broken));
  assert.equal(readPanelWidth("left", null), PANEL_LIMITS.left.default);
});
