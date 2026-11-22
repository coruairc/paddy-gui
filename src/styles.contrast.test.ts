import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Locks in the WCAG AA claim for the user bubble (PR #17): text and timestamp
// tokens on --color-bubble must stay >= 4.5:1 in both themes.
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function block(selector: RegExp): Record<string, string> {
  const match = selector.exec(css);
  assert.ok(match, `missing block ${selector}`);
  const body = css.slice(match.index + match[0].length, css.indexOf("}", match.index));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)) tokens[name] = value.trim();
  return tokens;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  assert.ok(match, `expected a hex colour, got ${hex}`);
  const full = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("contrast() matches known WCAG values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");
});

/** Source-over composite of black at `alpha` onto an opaque hex colour (sRGB, as browsers blend). */
function overBlack(hex: string, alpha: number): string {
  const full = hex.replace("#", "");
  return (
    "#" +
    [0, 2, 4]
      .map((i) => Math.round(parseInt(full.slice(i, i + 2), 16) * (1 - alpha)))
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")
  );
}

test("overBlack() composites like a browser", () => {
  assert.equal(overBlack("#ffffff", 0.3), "#b3b3b3");
  assert.equal(overBlack("#256a35", 0), "#256a35");
});

// The bubble's own selection classes live in app.tsx; read them so the test
// follows the real markup instead of a copied number.
const app = readFileSync(new URL("./components/desk/app.tsx", import.meta.url), "utf8");
const bubbleClass = /className="[^"]*\bbg-bubble\b[^"]*"/.exec(app)?.[0] ?? "";

test("the user bubble declares its own selection colours", () => {
  assert.match(bubbleClass, /\bselection:bg-black\/\d+\b/);
  assert.match(bubbleClass, /\bselection:text-bubble-fg\b/);
});

const selectionAlpha = Number(/\bselection:bg-black\/(\d+)\b/.exec(bubbleClass)?.[1] ?? NaN) / 100;

const themes = {
  dark: block(/@theme\s*\{/),
  light: block(/\[data-theme="light"\]\s*\{/),
};

for (const [theme, tokens] of Object.entries(themes)) {
  for (const fg of ["--color-bubble-fg", "--color-bubble-muted"]) {
    test(`${theme}: ${fg} on --color-bubble is at least 4.5:1`, () => {
      assert.ok(tokens["--color-bubble"], `${theme} defines --color-bubble`);
      assert.ok(tokens[fg], `${theme} defines ${fg}`);
      const ratio = contrast(tokens[fg], tokens["--color-bubble"]);
      assert.ok(ratio >= 4.5, `${theme} ${fg} ${tokens[fg]} on ${tokens["--color-bubble"]} = ${ratio.toFixed(2)}:1`);
    });
  }
}

for (const [theme, tokens] of Object.entries(themes)) {
  test(`${theme}: selected bubble text (bubble-fg on black/${Math.round(selectionAlpha * 100)} over bubble) is at least 4.5:1`, () => {
    assert.ok(Number.isFinite(selectionAlpha), "selection alpha parsed from app.tsx");
    const background = overBlack(tokens["--color-bubble"], selectionAlpha);
    const ratio = contrast(tokens["--color-bubble-fg"], background);
    assert.ok(ratio >= 4.5, `${theme} ${tokens["--color-bubble-fg"]} on ${background} = ${ratio.toFixed(2)}:1`);
  });
}
