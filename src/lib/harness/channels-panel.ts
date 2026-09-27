// Pure view-model for the Gateway UI Channels panel (Phase E).
// Imports only the pure paused-message module so the client bundle stays free of server code.
import { OPENCLAW_CHANNELS_PAUSED_MESSAGE } from "./channels-paused.ts";

export type ChannelsPanelRuntime = "paddy" | "openclaw";

export type ChannelsProbeUi =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; detail: string }
  | { status: "error"; detail: string }
  | { status: "empty"; detail: string };

export type ChannelsBridgeNotice =
  | { paused: false }
  | { paused: true; message: string };

/**
 * Channels panel notice from the server-resolved effective runtime.
 * Unknown / not-yet-loaded runtime renders as today (no notice) — the server
 * gate is the authority; this copy only explains it.
 */
export function channelsBridgeNotice(
  runtime: ChannelsPanelRuntime | null | undefined,
): ChannelsBridgeNotice {
  if (runtime === "openclaw") return { paused: true, message: OPENCLAW_CHANNELS_PAUSED_MESSAGE };
  return { paused: false };
}

/** One-line probe summary mirrored under the paused notice. */
export function channelsProbeSummary(probe: ChannelsProbeUi): { tone: "muted" | "ok" | "danger"; text: string } {
  switch (probe.status) {
    case "idle":
      return { tone: "muted", text: "OpenClaw gateway not probed yet." };
    case "loading":
      return { tone: "muted", text: "Probing OpenClaw gateway…" };
    case "ok":
      return { tone: "ok", text: probe.detail };
    case "empty":
      return { tone: "muted", text: probe.detail };
    case "error":
      return { tone: "danger", text: probe.detail };
  }
}
