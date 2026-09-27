import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Copy, Radio, Send, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  exportLineageChannels,
  importLineageChannels,
  listGatewayChannels,
  resolveGatewayPair,
  saveGatewayChannel,
} from "@/lib/harness/channel-api";
import { INSTALL_PS1_CMD, INSTALL_SH } from "@/lib/harness/install";
import {
  isCliAuthFailure,
  markCliAuthNeeded,
  messageForCliAuthFailure,
} from "@/lib/harness/cli-token";
import { sendTurn } from "@/lib/harness/send";
import { useHelix } from "@/lib/harness/store";
import type { ChannelStatus } from "@/lib/harness/types";
import { formatRelative } from "@/lib/utils";
import {
  OpenClawTargetPanel,
  type OpenClawTargetControl,
  type OpenClawTargetStatus,
} from "@/components/openclaw-target-panel";
import { channelsBridgeNotice, channelsProbeSummary } from "@/lib/harness/channels-panel";

const STATUS: Record<ChannelStatus, { label: string; variant: "ok" | "warn" | "danger" | "default" }> = {
  connected: { label: "connected", variant: "ok" },
  idle: { label: "idle", variant: "default" },
  pairing: { label: "pairing", variant: "warn" },
  offline: { label: "offline", variant: "danger" },
};

const CLI_COMMANDS = [
  { cmd: INSTALL_SH, blurb: "macOS / Linux / WSL — clone, npm install, put paddy on PATH." },
  { cmd: INSTALL_PS1_CMD, blurb: "Windows PowerShell — same install." },
  { cmd: "paddy gateway", blurb: "Control plane + channel bridge in the foreground." },
  { cmd: "paddy channels add telegram --token <bot>", blurb: "Writes Paddy config. The live bridge picks it up." },
  { cmd: "paddy gateway setup", blurb: "Wizard. Telegram, Discord, Slack, … same config as the CLI." },
  { cmd: "paddy config import", blurb: "Pull OpenClaw / Hermes into Paddy. Conflicts ask before replace." },
  { cmd: "paddy channels export --to both", blurb: "Compatibility files only. Paddy config stays the source of truth." },
  { cmd: "paddy pairing approve ABCD", blurb: "Allow a stranger who DMed the bot." },
];

type BridgeChannelId = "telegram" | "discord" | "slack" | "whatsapp" | "signal" | "email";
type DmPolicy = "pairing" | "open" | "allowlist";

type AccountRow = {
  id: BridgeChannelId;
  title: string;
  how: string;
  href: string;
  fields: { key: string; label: string; placeholder: string; set: boolean; preview: string }[];
  dmPolicy: DmPolicy;
  allowFrom: string[];
  requireMention: boolean;
  configured: boolean;
};

const FALLBACK: Record<
  string,
  { how: string; fields: { key: string; label: string; placeholder: string }[] }
> = {
  telegram: {
    how: "Message @BotFather, /newbot, paste the token.",
    fields: [{ key: "token", label: "Bot token", placeholder: "123456:ABC…" }],
  },
  discord: {
    how: "Developer Portal → Bot → Reset token. Enable Message Content Intent.",
    fields: [{ key: "token", label: "Bot token", placeholder: "MTI…" }],
  },
  slack: {
    how: "Socket Mode on. Bot token + app token.",
    fields: [
      { key: "token", label: "Bot token", placeholder: "xoxb-…" },
      { key: "appToken", label: "App token", placeholder: "xapp-…" },
    ],
  },
  whatsapp: {
    how: "Meta Cloud API. Webhook /api/hooks/whatsapp on this gateway.",
    fields: [
      { key: "token", label: "Access token", placeholder: "EAA…" },
      { key: "phoneId", label: "Phone number id", placeholder: "123…" },
      { key: "verifyToken", label: "Verify token", placeholder: "choose a secret" },
    ],
  },
  signal: {
    how: "signal-cli REST URL and the linked number.",
    fields: [
      { key: "host", label: "REST URL", placeholder: "http://127.0.0.1:8080" },
      { key: "number", label: "Number", placeholder: "+1555…" },
    ],
  },
  email: {
    how: "IMAP poll + SMTP send. Gmail needs an app password.",
    fields: [
      { key: "host", label: "IMAP host", placeholder: "imap.gmail.com" },
      { key: "user", label: "User", placeholder: "you@example.com" },
      { key: "pass", label: "Password", placeholder: "app password" },
      { key: "from", label: "From", placeholder: "paddy@example.com" },
    ],
  },
};

type LineageInfo = {
  openclaw: boolean;
  hermes: boolean;
  openclawChannels: { id: string; hasToken: boolean }[];
  hermesChannels: { id: string; hasToken: boolean }[];
};

type ImportConflict = {
  id: string;
  reason: string;
  currentMode?: string;
  incomingMode?: string;
  currentUsers?: string[];
  incomingUsers?: string[];
};

export function GatewayView() {
  const channels = useHelix((s) => s.channels);
  const lastPulseAt = useHelix((s) => s.lastPulseAt);
  const wakes = useHelix((s) => s.workspaces[s.activeProfileId]!.wakes);
  const firePulse = useHelix((s) => s.firePulse);
  const admitChannel = useHelix((s) => s.admitChannel);
  const admitWake = useHelix((s) => s.admitWake);
  const approvePair = useHelix((s) => s.approvePair);
  const denyPair = useHelix((s) => s.denyPair);
  const mergeLiveChannels = useHelix((s) => s.mergeLiveChannels);
  const busy = useHelix((s) => s.busy);
  const [ready, setReady] = useState(false);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [lineage, setLineage] = useState<LineageInfo | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ImportConflict[]>([]);
  const [importSource, setImportSource] = useState<"openclaw" | "hermes" | "both">("both");
  const [openclawStatus, setOpenclawStatus] = useState<OpenClawTargetStatus>({
    savedRuntime: null,
    probe: { status: "idle" },
  });
  const openclawControl = useRef<OpenClawTargetControl | null>(null);
  const onOpenclawStatus = useCallback((s: OpenClawTargetStatus) => setOpenclawStatus(s), []);

  async function refresh() {
    try {
      const data = await listGatewayChannels();
      setReady(Boolean(data.ready));
      setAccounts((data.accounts ?? []) as AccountRow[]);
      setLineage((data.lineage as LineageInfo) ?? null);
      mergeLiveChannels(
        (data.channels ?? []).map((row) => ({
          ...row,
          status: row.status === "error" ? "offline" : row.status,
        })),
        data.pending ?? [],
      );
    } catch {
      /* preview without the fn is fine */
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, []);

  async function admit(id: string) {
    const text = admitChannel(id);
    if (!text) return;
    await sendTurn(text, id);
  }

  function pulse() {
    const result = firePulse();
    toast(result.woke ? "Wake gate opened" : "Heartbeat · gate closed", {
      description: result.detail,
    });
  }

  async function wake(id: string) {
    const text = admitWake(id);
    if (!text) return;
    await sendTurn(text);
  }

  async function pair(channelId: string, allow: boolean, code?: string) {
    if (ready && code) {
      const r = await resolveGatewayPair({ data: { code, allow } });
      if (!r.ok) {
        toast(r.error);
        return;
      }
      toast(r.detail);
      if (allow) approvePair(channelId);
      else denyPair(channelId);
      void refresh();
      return;
    }
    if (allow) approvePair(channelId);
    else denyPair(channelId);
  }

  async function save(id: BridgeChannelId, remove = false) {
    setSaving(id);
    const acc = accounts.find((a) => a.id === id);
    const prefix = `${id}:`;
    const payload: Parameters<typeof saveGatewayChannel>[0]["data"] = {
      id,
      remove,
      dmPolicy: (drafts[`${prefix}dmPolicy`] as DmPolicy) || acc?.dmPolicy || "pairing",
      allowFrom: drafts[`${prefix}allowFrom`] ?? (acc?.allowFrom ?? []).join(", "),
      requireMention: drafts[`${prefix}requireMention`] !== "0",
    };
    for (const f of acc?.fields ?? FALLBACK[id]?.fields ?? []) {
      const v = drafts[`${prefix}${f.key}`];
      if (v?.trim()) {
        (payload as unknown as Record<string, string>)[f.key] = v.trim();
      }
    }
    try {
      const r = await saveGatewayChannel({ data: payload });
      if (!r.ok) toast("Not connected", { description: r.error });
      else {
        toast(remove ? "Disconnected" : "Saved", { description: r.detail });
        setDrafts((d) => {
          const next = { ...d };
          for (const k of Object.keys(next)) if (k.startsWith(prefix)) delete next[k];
          return next;
        });
        setOpenId(null);
        void refresh();
      }
    } catch (err) {
      if (isCliAuthFailure(err)) markCliAuthNeeded();
      toast("Not connected", {
        description: isCliAuthFailure(err)
          ? messageForCliAuthFailure(err)
          : err instanceof Error
            ? err.message
            : "Save failed",
      });
    } finally {
      setSaving(null);
    }
  }

  async function lineageAction(
    kind: "import" | "export",
    who: "openclaw" | "hermes" | "both",
    replace: string[] = [],
  ) {
    if (kind === "import") {
      setImportSource(who);
      const r = await importLineageChannels({ data: { source: who, replace } });
      if (!r.ok) {
        toast("Import", { description: r.error });
        setConflicts([]);
        void refresh();
        return;
      }
      const nextConflicts = (r.conflicts ?? []) as ImportConflict[];
      setConflicts(nextConflicts);
      if (nextConflicts.length) {
        toast("Import conflicts", { description: r.detail });
      } else {
        toast("Imported", { description: r.detail });
      }
      void refresh();
      return;
    }
    const r = await exportLineageChannels({ data: { target: who } });
    if (!r.ok) toast("Export", { description: r.error });
    else toast("Exported", { description: r.detail });
    void refresh();
  }

  function keepConflict(id: string) {
    setConflicts((rows) => rows.filter((c) => c.id !== id));
    toast("Kept existing", { description: `${id} was left as-is.` });
  }

  const connected = channels.filter((c) => c.status === "connected").length;
  const pending = wakes.filter((w) => !w.fired);
  const ocCount = lineage?.openclawChannels.filter((c) => c.hasToken).length ?? 0;
  const hmCount = lineage?.hermesChannels.filter((c) => c.hasToken).length ?? 0;
  const bridgeNotice = channelsBridgeNotice(openclawStatus.savedRuntime);
  const probeSummary = channelsProbeSummary(openclawStatus.probe);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header>
          <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
            Control plane
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-tight">Gateway</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            One config. Connect Telegram, Discord, Slack, WhatsApp, Signal, and email — pairing or
            an allow list. OpenClaw and Hermes are import/export only.
          </p>
        </header>

        <OpenClawTargetPanel onStatusChange={onOpenclawStatus} controlRef={openclawControl} />

        <section className="grid gap-3 sm:grid-cols-3">
          <Stat label="Channels live" value={`${connected}/${channels.length}`} />
          <Stat label="Last pulse" value={formatRelative(lastPulseAt)} />
          <Stat label="Gated wakes" value={String(pending.length)} />
        </section>

        <section className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]">
          <p className="text-[11px] font-medium tracking-wide text-accent uppercase">Compatibility</p>
          <h2 className="mt-1 font-display text-xl">Import / export</h2>
          <p className="mt-1 max-w-lg text-sm text-muted">
            {ready
              ? "Bring an existing OpenClaw or Hermes setup into Paddy. Export writes their files without changing Paddy."
              : "On your machine, import OpenClaw or Hermes into Paddy. Export is optional compatibility — Paddy stays the source of truth."}
          </p>
          {(lineage?.openclaw || lineage?.hermes) && ready ? (
            <p className="mt-2 text-xs text-subtle">
              {lineage.openclaw ? `OpenClaw file found · ${ocCount} channel${ocCount === 1 ? "" : "s"}` : null}
              {lineage.openclaw && lineage.hermes ? " · " : null}
              {lineage.hermes ? `Hermes file found · ${hmCount} channel${hmCount === 1 ? "" : "s"}` : null}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void lineageAction("import", "openclaw")}>
              Import OpenClaw
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void lineageAction("import", "hermes")}>
              Import Hermes
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void lineageAction("import", "both")}>
              Import both
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => void lineageAction("export", "openclaw")}>
              Export → OpenClaw
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void lineageAction("export", "hermes")}>
              Export → Hermes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void lineageAction("export", "both")}>
              Export → Both
            </Button>
          </div>
          {conflicts.length ? (
            <ul className="mt-4 space-y-2">
              {conflicts.map((c) => (
                <li key={c.id} className="rounded-xl bg-bg p-3">
                  <p className="text-sm text-fg">{c.id}</p>
                  <p className="mt-0.5 text-xs text-muted">{c.reason}</p>
                  <p className="mt-1 text-xs text-subtle">
                    Current {c.currentMode}
                    {c.currentUsers?.length ? ` · ${c.currentUsers.join(", ")}` : ""}
                    {" → "}
                    import {c.incomingMode}
                    {c.incomingUsers?.length ? ` · ${c.incomingUsers.join(", ")}` : ""}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => keepConflict(c.id)}>
                      Keep existing
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void lineageAction("import", importSource, [c.id])}
                    >
                      Replace with imported
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-wide text-accent uppercase">CLI</p>
              <h2 className="mt-1 font-display text-xl">paddy gateway</h2>
              <p className="mt-1 max-w-md text-sm text-muted">
                Same verbs as the other harnesses. This preview has no shell — copy a command and run
                it locally.
              </p>
            </div>
            <Terminal className="size-5 shrink-0 text-accent" />
          </div>
          <ul className="mt-4 space-y-2">
            {CLI_COMMANDS.map((row) => (
              <li
                key={row.cmd}
                className="flex items-start justify-between gap-3 rounded-xl bg-bg px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm break-all text-fg">{row.cmd}</p>
                  <p className="mt-0.5 text-xs text-muted">{row.blurb}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => {
                    void navigator.clipboard.writeText(row.cmd);
                    toast("Copied");
                  }}
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">Heartbeat</h2>
              <p className="mt-1 max-w-md text-sm text-muted">
                Fire a pulse — the model wakes only if a watch matches.
              </p>
            </div>
            <Button onClick={pulse} variant="secondary" className="shrink-0">
              <Radio className="size-4" />
              Fire pulse
            </Button>
          </div>
          {pending.length ? (
            <ul className="mt-4 space-y-2">
              {pending.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-col gap-2 rounded-xl bg-bg p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm text-fg">{w.reason}</p>
                    <p className="text-xs text-muted">Due {formatRelative(w.at)}</p>
                  </div>
                  <Button size="sm" disabled={busy} onClick={() => void wake(w.id)}>
                    Admit wake
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-subtle">No queued wakes. Silence is valid.</p>
          )}
        </section>

        <section>
          <div className="mb-3">
            <h2 className="font-display text-xl">Channels</h2>
            <p className="mt-1 max-w-lg text-sm text-muted">
              One list. Saving writes Paddy config — tokens in secrets, access policy on the channel.
            </p>
          </div>
          {bridgeNotice.paused ? (
            <div
              className="mb-3 rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]"
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm text-fg">{bridgeNotice.message}</p>
                <Badge variant="warn">bridge · paused</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={openclawStatus.probe.status === "loading"}
                  aria-busy={openclawStatus.probe.status === "loading"}
                  onClick={() => openclawControl.current?.probe()}
                >
                  <Activity className="size-3.5" />
                  {openclawStatus.probe.status === "loading" ? "Probing…" : "Probe OpenClaw"}
                </Button>
                <span
                  className={
                    probeSummary.tone === "danger"
                      ? "text-sm text-danger"
                      : probeSummary.tone === "ok"
                        ? "text-sm text-fg"
                        : "text-sm text-muted"
                  }
                >
                  {probeSummary.text}
                </span>
              </div>
            </div>
          ) : null}
          <ul className="grid gap-3 sm:grid-cols-2">
            {channels.map((ch) => {
              const st = STATUS[ch.status];
              const acc = accounts.find((a) => a.id === ch.id);
              const setup = acc ?? (ch.id !== "web" && FALLBACK[ch.id]
                ? {
                    ...FALLBACK[ch.id],
                    id: ch.id as BridgeChannelId,
                    title: ch.name,
                    href: "",
                    dmPolicy: "pairing" as DmPolicy,
                    allowFrom: [] as string[],
                    requireMention: true,
                    configured: Boolean(ch.configured),
                    fields: FALLBACK[ch.id].fields.map((f) => ({ ...f, set: false, preview: "" })),
                  }
                : null);
              const open = openId === ch.id;
              return (
                <li
                  key={ch.id}
                  className="flex flex-col gap-3 rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-medium">{ch.name}</h3>
                      <p className="mt-0.5 text-xs text-muted">
                        {ch.label ? `${ch.label} · ` : ""}
                        {ch.blurb}
                      </p>
                    </div>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>
                  {ch.error ? <p className="text-xs text-danger">{ch.error}</p> : null}
                  {ch.pendingPair ? (
                    <div className="rounded-xl bg-bg p-3">
                      <p className="text-[11px] tracking-wide text-muted uppercase">Pairing code</p>
                      <p className="mt-1 font-mono text-lg tracking-[0.18em]">{ch.pendingPair.code}</p>
                      <p className="mt-1 text-xs text-muted">
                        {ch.pendingPair.from} is unknown. Approve before anything reaches the model.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void pair(ch.id, false, ch.pendingPair?.code)}
                        >
                          Deny
                        </Button>
                        <Button size="sm" onClick={() => void pair(ch.id, true, ch.pendingPair?.code)}>
                          Approve pair
                        </Button>
                      </div>
                    </div>
                  ) : ch.lastMessage ? (
                    <p className="line-clamp-2 text-sm text-fg/85">
                      <span className="text-muted">{ch.lastMessage.from}: </span>
                      {ch.lastMessage.text}
                    </p>
                  ) : (
                    <p className="text-sm text-subtle">No traffic yet.</p>
                  )}
                  {setup && open ? (
                    <form
                      className="flex flex-col gap-2 rounded-xl bg-bg p-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save(ch.id as BridgeChannelId);
                      }}
                    >
                      {setup.fields.map((f) => (
                        <label key={f.key} className="block">
                          <span className="text-[11px] text-muted">{f.label}</span>
                          <Input
                            className="mt-1"
                            type="password"
                            autoComplete="off"
                            placeholder={
                              acc?.fields.find((x) => x.key === f.key)?.set
                                ? acc.fields.find((x) => x.key === f.key)?.preview
                                : f.placeholder
                            }
                            value={drafts[`${ch.id}:${f.key}`] ?? ""}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [`${ch.id}:${f.key}`]: e.target.value }))
                            }
                          />
                        </label>
                      ))}
                      <label className="block">
                        <span className="text-[11px] text-muted">Access policy</span>
                        <select
                          className="mt-1 flex h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg"
                          value={drafts[`${ch.id}:dmPolicy`] ?? acc?.dmPolicy ?? "pairing"}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [`${ch.id}:dmPolicy`]: e.target.value }))
                          }
                        >
                          <option value="pairing">pairing</option>
                          <option value="allowlist">allowlist</option>
                          <option value="open">open</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-muted">Allowed users</span>
                        <Input
                          className="mt-1"
                          placeholder="telegram user id, @name"
                          value={
                            drafts[`${ch.id}:allowFrom`] ?? (acc?.allowFrom ?? []).join(", ")
                          }
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [`${ch.id}:allowFrom`]: e.target.value }))
                          }
                        />
                      </label>
                      <p className="text-xs text-subtle">{setup.how}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" size="sm" disabled={saving === ch.id}>
                          {saving === ch.id ? "Saving…" : "Save"}
                        </Button>
                        {acc?.configured ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => void save(ch.id as BridgeChannelId, true)}
                          >
                            Disconnect
                          </Button>
                        ) : null}
                        <Button type="button" size="sm" variant="ghost" onClick={() => setOpenId(null)}>
                          Close
                        </Button>
                      </div>
                    </form>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-[11px] text-subtle tabular-nums">
                      {ch.lastMessage ? formatRelative(ch.lastMessage.at) : "—"}
                      {ch.unread ? ` · ${ch.unread} unread` : ""}
                    </span>
                    <div className="flex gap-2">
                      {setup && !open ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpenId(ch.id)}
                        >
                          {acc?.configured || ch.configured ? "Edit" : "Connect"}
                        </Button>
                      ) : null}
                      {ch.lastMessage && ch.id !== "web" && !ch.pendingPair ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void admit(ch.id)}
                        >
                          <Send className="size-3.5" />
                          Admit
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 font-mono text-lg tabular-nums text-fg">{value}</p>
    </div>
  );
}
