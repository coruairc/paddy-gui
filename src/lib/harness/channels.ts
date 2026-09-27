import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  loadPendingPairs,
  loadResolvedAccounts,
  removeCanonicalChannel,
  savePendingPairs,
  upsertCanonicalChannel,
} from "./config.mjs";
import { channelBridgeState, channelsPausedBody, CHANNELS_PAUSED_HTTP_STATUS } from "./bridge-gate.mjs";
import { envAccountsFromProcess } from "./lineage.mjs";
import { enqueueOutboundDurable } from "./outbound.mjs";

export { OPENCLAW_CHANNELS_PAUSED_MESSAGE } from "./channels-paused.ts";
export { CHANNELS_PAUSED_HTTP_STATUS } from "./bridge-gate.mjs";

/**
 * Webhook guard for every /api/hooks/* route. Returns null when Paddy's bridge owns
 * channels (runtime=paddy). When openclaw.runtime=openclaw, returns a 409 JSON response
 * `{ ok: false, error: OPENCLAW_CHANNELS_PAUSED_MESSAGE, code: "openclaw_channels_paused", runtime: "openclaw" }`
 * so providers never get processed twice.
 */
export function channelsPausedWebhookResponse(opts?: { home?: string }): Response | null {
  if (channelBridgeState({ home: opts?.home }).start) return null;
  return new Response(JSON.stringify(channelsPausedBody()), {
    status: CHANNELS_PAUSED_HTTP_STATUS,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const BRIDGE_CHANNELS = [
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "signal",
  "email",
] as const;

export type BridgeChannelId = (typeof BRIDGE_CHANNELS)[number];
export type DmPolicy = "pairing" | "open" | "allowlist";

export interface ChannelAccount {
  token?: string;
  appToken?: string;
  phoneId?: string;
  verifyToken?: string;
  number?: string;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from?: string;
  secure?: boolean;
  dmPolicy: DmPolicy;
  allowFrom: string[];
  requireMention: boolean;
}

export interface PendingPair {
  id: string;
  channelId: BridgeChannelId;
  from: string;
  fromId: string;
  chatId: string;
  text: string;
  code: string;
  at: number;
}

export interface ChannelLiveStatus {
  id: BridgeChannelId;
  configured: boolean;
  status: "connected" | "idle" | "pairing" | "offline" | "error";
  label?: string;
  error?: string;
  lastAt?: number;
  lastMessage?: { from: string; text: string };
  pending?: number;
  lastChatId?: string;
}

export type ChannelConfigFile = {
  accounts: Partial<Record<BridgeChannelId, ChannelAccount>>;
  pending: PendingPair[];
};

const EMPTY_ACCOUNT: ChannelAccount = {
  dmPolicy: "pairing",
  allowFrom: [],
  requireMention: true,
};

export function paddyHome(): string {
  return process.env.PADDY_HOME?.trim() || join(homedir(), ".paddy");
}

/** Legacy path. Runtime uses config.json. Kept for migration/back-compat helpers. */
export function channelsPath(): string {
  return join(paddyHome(), "channels.json");
}

export function channelsStatusPath(): string {
  return join(paddyHome(), "channels-status.json");
}

export function outboundPath(): string {
  return join(paddyHome(), "outbound.json");
}

export function outboundDeadPath(): string {
  return join(paddyHome(), "outbound-dead.json");
}

function ensureHome(): void {
  mkdirSync(paddyHome(), { recursive: true, mode: 0o700 });
  try {
    chmodSync(paddyHome(), 0o700);
  } catch {
    /* already owned */
  }
}

export function pairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => alphabet[n % alphabet.length]!).join("");
}

export function senderAllowed(
  account: ChannelAccount | undefined,
  fromId: string,
): "allow" | "pair" | "deny" {
  const acc = account ?? EMPTY_ACCOUNT;
  const id = fromId.trim();
  if (!id) return "deny";
  if (acc.allowFrom.some((x) => x === id || x === "*")) return "allow";
  if (acc.dmPolicy === "open") return "allow";
  if (acc.dmPolicy === "allowlist") return "deny";
  return "pair";
}

export function isBridgeChannel(id: string): id is BridgeChannelId {
  return (BRIDGE_CHANNELS as readonly string[]).includes(id);
}

export function maskSecret(value?: string): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 4)}…${v.slice(-3)}`;
}

export function defaultAccount(): ChannelAccount {
  return { ...EMPTY_ACCOUNT, allowFrom: [] };
}

export function emptyConfig(): ChannelConfigFile {
  return { accounts: {}, pending: [] };
}

export function loadChannelConfig(): ChannelConfigFile {
  try {
    return {
      accounts: loadResolvedAccounts() as ChannelConfigFile["accounts"],
      pending: loadPendingPairs() as PendingPair[],
    };
  } catch {
    return emptyConfig();
  }
}

export function saveChannelConfig(cfg: ChannelConfigFile): void {
  savePendingPairs(cfg.pending ?? []);
}

export function upsertAccount(
  id: BridgeChannelId,
  patch: Partial<ChannelAccount>,
): ChannelConfigFile {
  upsertCanonicalChannel(id, { ...defaultAccount(), ...patch });
  return loadChannelConfig();
}

export function removeAccount(id: BridgeChannelId): ChannelConfigFile {
  removeCanonicalChannel(id);
  return loadChannelConfig();
}

export function enqueuePair(pair: Omit<PendingPair, "id" | "code" | "at">): PendingPair {
  const pending = loadPendingPairs() as PendingPair[];
  const existing = pending.find((p) => p.channelId === pair.channelId && p.fromId === pair.fromId);
  if (existing) {
    existing.text = pair.text;
    existing.chatId = pair.chatId;
    existing.from = pair.from;
    existing.at = Date.now();
    savePendingPairs(pending);
    return existing;
  }
  const row: PendingPair = {
    ...pair,
    id: `pair_${Date.now().toString(36)}`,
    code: pairingCode(),
    at: Date.now(),
  };
  pending.unshift(row);
  savePendingPairs(pending.slice(0, 40));
  return row;
}

export function resolvePair(
  code: string,
  allow: boolean,
): { ok: true; pair: PendingPair } | { ok: false; error: string } {
  const pending = loadPendingPairs() as PendingPair[];
  const needle = code.trim().toUpperCase();
  const pair = pending.find((p) => p.code.toUpperCase() === needle);
  if (!pair) return { ok: false, error: "Unknown pairing code." };
  const next = pending.filter((p) => p.id !== pair.id);
  savePendingPairs(next);
  if (allow) {
    const cfg = loadChannelConfig();
    const acc = cfg.accounts[pair.channelId] ?? defaultAccount();
    if (!acc.allowFrom.includes(pair.fromId)) acc.allowFrom.push(pair.fromId);
    upsertCanonicalChannel(pair.channelId, acc);
  }
  return { ok: true, pair };
}

export function mentionedIn(text: string, names: (string | undefined)[]): boolean {
  const lower = text.toLowerCase();
  return names.some((n) => n && lower.includes(n.toLowerCase()));
}

export type InboundDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "pair"; pair: PendingPair; reply: string };

export function decideInbound(opts: {
  channelId: BridgeChannelId;
  from: string;
  fromId: string;
  chatId: string;
  text: string;
  isGroup: boolean;
  botNames?: string[];
}): InboundDecision {
  const cfg = loadChannelConfig();
  const acc = cfg.accounts[opts.channelId];
  if (!acc || !accountConfigured(opts.channelId, acc)) {
    return { action: "deny", reason: `${opts.channelId} is not connected.` };
  }
  if (opts.isGroup && acc.requireMention && !mentionedIn(opts.text, opts.botNames ?? [])) {
    return { action: "deny", reason: "Group message ignored (mention required)." };
  }
  const gate = senderAllowed(acc, opts.fromId);
  if (gate === "allow") return { action: "allow" };
  if (gate === "deny") {
    return { action: "deny", reason: "Sender is not on the allow list." };
  }
  const pair = enqueuePair({
    channelId: opts.channelId,
    from: opts.from,
    fromId: opts.fromId,
    chatId: opts.chatId,
    text: opts.text.slice(0, 500),
  });
  return {
    action: "pair",
    pair,
    reply: `Paddy pairing code ${pair.code}. Approve in Gateway or: paddy pairing approve ${pair.code}`,
  };
}

export function accountConfigured(id: BridgeChannelId, acc: ChannelAccount): boolean {
  if (id === "telegram" || id === "discord") return Boolean(acc.token?.trim());
  if (id === "slack") return Boolean(acc.token?.trim() && acc.appToken?.trim());
  if (id === "whatsapp") return Boolean(acc.token?.trim() && acc.phoneId?.trim());
  if (id === "signal") return Boolean(acc.host?.trim() && acc.number?.trim());
  if (id === "email") return Boolean(acc.host?.trim() && acc.user?.trim() && acc.pass?.trim());
  return false;
}

export function readLiveStatus(): Partial<Record<BridgeChannelId, ChannelLiveStatus>> {
  try {
    return JSON.parse(readFileSync(channelsStatusPath(), "utf8")) as Partial<
      Record<BridgeChannelId, ChannelLiveStatus>
    >;
  } catch {
    return {};
  }
}

export function writeLiveStatus(status: Partial<Record<BridgeChannelId, ChannelLiveStatus>>): void {
  ensureHome();
  writeFileSync(channelsStatusPath(), `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
}

export function enqueueOutbound(row: {
  channelId: BridgeChannelId;
  chatId?: string;
  message: string;
}): void {
  enqueueOutboundDurable({
    channelId: row.channelId,
    chatId: row.chatId,
    message: row.message.slice(0, 4000),
  });
}

export function applyEnvAccounts(cfg: ChannelConfigFile): ChannelConfigFile {
  const fromEnv = envAccountsFromProcess(process.env) as Partial<
    Record<BridgeChannelId, ChannelAccount>
  >;
  for (const id of BRIDGE_CHANNELS) {
    const patch = fromEnv[id];
    if (!patch) continue;
    const prev = cfg.accounts[id] ?? defaultAccount();
    const next: ChannelAccount = { ...prev };
    for (const key of ["token", "appToken", "phoneId", "verifyToken", "number", "host", "user", "pass", "from"] as const) {
      const v = patch[key];
      if (typeof v === "string" && v.trim()) next[key] = v.trim();
    }
    if (patch.allowFrom?.length) {
      next.allowFrom = Array.from(new Set([...(next.allowFrom ?? []), ...patch.allowFrom]));
    }
    if (patch.dmPolicy === "open") next.dmPolicy = "open";
    cfg.accounts[id] = next;
  }
  return cfg;
}

export function summarizeChannels(): ChannelLiveStatus[] {
  const cfg = applyEnvAccounts(loadChannelConfig());
  const live = existsSync(channelsStatusPath()) ? readLiveStatus() : {};
  return BRIDGE_CHANNELS.map((id) => {
    const acc = cfg.accounts[id];
    const configured = Boolean(acc && accountConfigured(id, acc));
    const row = live[id];
    const pending = cfg.pending.filter((p) => p.channelId === id).length;
    return {
      id,
      configured,
      status: row?.status ?? "idle",
      label: row?.label,
      error: row?.error,
      lastAt: row?.lastAt,
      lastMessage: row?.lastMessage,
      pending: pending || row?.pending,
      lastChatId: row?.lastChatId,
    };
  });
}

export const CHANNEL_SETUP: Record<
  BridgeChannelId,
  {
    title: string;
    how: string;
    href: string;
    fields: { key: keyof ChannelAccount; label: string; placeholder: string }[];
  }
> = {
  telegram: {
    title: "Telegram",
    how: "Message @BotFather, /newbot, paste the token. Same as openclaw channels add telegram and hermes gateway setup. Long-polls — no public URL.",
    href: "https://t.me/BotFather",
    fields: [{ key: "token", label: "Bot token", placeholder: "123456:ABC…" }],
  },
  discord: {
    title: "Discord",
    how: "Developer Portal → Bot → Reset token. Enable Message Content Intent. Invite with bot scope.",
    href: "https://discord.com/developers/applications",
    fields: [{ key: "token", label: "Bot token", placeholder: "MTI…" }],
  },
  slack: {
    title: "Slack",
    how: "Create an app, Socket Mode on, bot scopes chat:write im:history im:write. Bot token + app token.",
    href: "https://api.slack.com/apps",
    fields: [
      { key: "token", label: "Bot token", placeholder: "xoxb-…" },
      { key: "appToken", label: "App token", placeholder: "xapp-…" },
    ],
  },
  whatsapp: {
    title: "WhatsApp",
    how: "Meta Cloud API — phone number id + access token. Webhook: /api/hooks/whatsapp on this gateway (tunnel if local).",
    href: "https://developers.facebook.com/apps/",
    fields: [
      { key: "token", label: "Access token", placeholder: "EAA…" },
      { key: "phoneId", label: "Phone number id", placeholder: "123…" },
      { key: "verifyToken", label: "Verify token", placeholder: "choose a secret" },
    ],
  },
  signal: {
    title: "Signal",
    how: "Run signal-cli REST (bbernhard/signal-cli-rest-api). Paste the base URL and the linked number.",
    href: "https://github.com/bbernhard/signal-cli-rest-api",
    fields: [
      { key: "host", label: "REST URL", placeholder: "http://127.0.0.1:8080" },
      { key: "number", label: "Number", placeholder: "+1555…" },
    ],
  },
  email: {
    title: "Email",
    how: "IMAP poll + SMTP send. Gmail needs an app password.",
    href: "https://support.google.com/accounts/answer/185833",
    fields: [
      { key: "host", label: "IMAP host", placeholder: "imap.gmail.com" },
      { key: "user", label: "User", placeholder: "you@example.com" },
      { key: "pass", label: "Password", placeholder: "app password" },
      { key: "from", label: "From", placeholder: "paddy@example.com" },
    ],
  },
};
