/**
 * Channel bridge gate — plain Node ESM so bin/paddy*.mjs can use it without TS.
 *
 * paddy runtime (default, hosted demo): Paddy's bridge owns the bots, exactly as before.
 * openclaw runtime: OpenClaw owns channels (~/.openclaw/openclaw.json). Paddy's bridge
 * must not start a second poller against the same bots, and HTTP channel webhooks refuse.
 */
import { resolveOpenClawRuntime } from "./config.mjs";

/**
 * Mirror of OPENCLAW_CHANNELS_PAUSED_MESSAGE in channels-paused.ts (the pure module the
 * Gateway UI imports). Plain-node bins cannot import .ts on every Node 22, so the string
 * is duplicated here; channels.test.ts asserts both stay identical.
 */
export const OPENCLAW_CHANNELS_PAUSED_MESSAGE =
  "Channels are configured in ~/.openclaw/openclaw.json, Paddy's bridge is paused.";

/** HTTP status every /api/hooks/* route returns while the bridge is paused. */
export const CHANNELS_PAUSED_HTTP_STATUS = 409;

/**
 * @param {{ home?: string }} [opts]
 * @returns {{ runtime: "paddy" | "openclaw", start: boolean, bridge: "on" | "paused", message: string }}
 */
export function channelBridgeState({ home } = {}) {
  const oc = resolveOpenClawRuntime({ home });
  const start = oc.active === false;
  return {
    runtime: oc.runtime,
    start,
    bridge: start ? "on" : "paused",
    message: start ? "" : OPENCLAW_CHANNELS_PAUSED_MESSAGE,
  };
}

/** JSON body for a refused webhook (status CHANNELS_PAUSED_HTTP_STATUS). */
export function channelsPausedBody() {
  return {
    ok: false,
    error: OPENCLAW_CHANNELS_PAUSED_MESSAGE,
    code: "openclaw_channels_paused",
    runtime: "openclaw",
  };
}
