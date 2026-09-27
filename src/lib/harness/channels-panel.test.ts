import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OPENCLAW_CHANNELS_PAUSED_MESSAGE } from "./channels-paused.ts";
import { channelsBridgeNotice, channelsProbeSummary } from "./channels-panel.ts";

test("paddy runtime: Channels panel shows no paused notice (unchanged)", () => {
  assert.deepEqual(channelsBridgeNotice("paddy"), { paused: false });
});

test("unknown / loading runtime: no paused notice", () => {
  assert.deepEqual(channelsBridgeNotice(null), { paused: false });
  assert.deepEqual(channelsBridgeNotice(undefined), { paused: false });
});

test("openclaw runtime: Channels panel shows the shared paused sentence verbatim", () => {
  const n = channelsBridgeNotice("openclaw");
  assert.equal(n.paused, true);
  assert.equal(n.paused && n.message, OPENCLAW_CHANNELS_PAUSED_MESSAGE);
  assert.match(OPENCLAW_CHANNELS_PAUSED_MESSAGE, /~\/\.openclaw\/openclaw\.json/);
});

test("probe summary covers every probe state", () => {
  assert.equal(channelsProbeSummary({ status: "idle" }).tone, "muted");
  assert.equal(channelsProbeSummary({ status: "loading" }).tone, "muted");
  assert.deepEqual(channelsProbeSummary({ status: "ok", detail: "3 models" }), { tone: "ok", text: "3 models" });
  assert.deepEqual(channelsProbeSummary({ status: "error", detail: "401" }), { tone: "danger", text: "401" });
  assert.deepEqual(channelsProbeSummary({ status: "empty", detail: "Paste a URL" }), { tone: "muted", text: "Paste a URL" });
});

test("client modules import only the pure paused module, never channels.ts", () => {
  for (const f of ["channels-panel.ts", "../../components/gateway-view.tsx", "../../components/openclaw-target-panel.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /from\s+["'][^"']*harness\/channels(\.ts)?["']/, `${f} must not import channels.ts`);
    assert.doesNotMatch(src, /from\s+["']\.\/channels(\.ts)?["']/, `${f} must not import channels.ts`);
  }
});
