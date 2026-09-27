// Pure constant shared by server (bridge / webhook / CLI) and the Gateway UI.
// Keep this module free of node: imports and server code so the client bundle can use it.
export const OPENCLAW_CHANNELS_PAUSED_MESSAGE =
  "Channels are configured in ~/.openclaw/openclaw.json, Paddy's bridge is paused.";
