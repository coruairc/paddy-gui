#!/usr/bin/env node
/**
 * Channel bridge — Telegram / Discord / Slack / WhatsApp send / Signal / email.
 * Spawned by paddy-gateway. Talks to /api/cli (inbound) with the CLI token.
 *
 * Runtime source of truth is canonical Paddy config (config.json + .env),
 * never the leftover channels.json file.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { loadPendingPairs, loadResolvedAccounts } from "../src/lib/harness/config.mjs";
import {
  appendOutboundDead,
  markOutboundFailure,
  outboundLimits,
  partitionOutbound,
  readOutboundQueue,
  writeOutboundQueue,
} from "../src/lib/harness/outbound.mjs";
import { channelBridgeState } from "../src/lib/harness/bridge-gate.mjs";

// openclaw.runtime=openclaw: OpenClaw owns the bots. Exit before any poller/timer starts.
// (paddy-gateway already skips spawning us; this covers a direct `node bin/paddy-bridge.mjs`.)
const bridgeGate = channelBridgeState();
if (!bridgeGate.start) {
  process.stdout.write(`paddy-bridge: ${bridgeGate.message}\n`);
  process.exit(0);
}

const HOME = process.env.PADDY_HOME?.trim() || join(homedir(), ".paddy");
const STATUS = join(HOME, "channels-status.json");
const WS = join(HOME, "workspace.json");
const OUT = join(HOME, "outbound.json");
const TOKEN_MAX = 8192;

function originFromArgv() {
  const i = process.argv.indexOf("--origin");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const host = process.env.PADDY_BIND || "127.0.0.1";
  const port = process.env.PADDY_PORT || "8080";
  const h = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${h}:${port}`;
}

const ORIGIN = originFromArgv();
const CLI_TOKEN = (process.env.PADDY_CLI_TOKEN || "").trim();

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

function loadCfg() {
  try {
    return {
      accounts: loadResolvedAccounts() || {},
      pending: loadPendingPairs() || [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`paddy-bridge: canonical config unreadable (${msg})\n`);
    return { accounts: {}, pending: [] };
  }
}

const live = {};
function setLive(id, patch) {
  live[id] = { id, configured: true, status: "idle", ...(live[id] || {}), ...patch };
  writeJson(STATUS, live);
}

function clip(s, n = 1500) {
  return String(s || "").slice(0, n);
}

async function inbound({ channelId, from, fromId, chatId, message, isGroup, botNames }) {
  if (!CLI_TOKEN) throw new Error("PADDY_CLI_TOKEN missing");
  const ws = readJson(WS, {});
  const sessionId = `${channelId}:${chatId}`;
  const history = (ws.channelHistory && ws.channelHistory[sessionId]) || [];
  const res = await fetch(`${ORIGIN}/api/cli`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${CLI_TOKEN}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      action: "inbound",
      channelId,
      channelName: channelId,
      from,
      fromId,
      chatId,
      message: clip(message, 4000),
      isGroup: Boolean(isGroup),
      botNames: botNames || [],
      history: history.slice(-10),
      files: ws.files,
      memories: ws.memories,
      skills: ws.skills,
      tickets: ws.tickets,
      dailyNotes: ws.dailyNotes,
      wakes: ws.wakes,
      canvas: ws.canvas,
      checkpoints: ws.checkpoints,
      preferredProvider: ws.preferredProvider,
    }),
  });
  const data = await res.json();
  if (data.workspace) {
    const next = { ...ws, ...data.workspace };
    const ch = { ...(ws.channelHistory || {}) };
    const thread = [...(ch[sessionId] || []), { role: "user", content: message }, { role: "assistant", content: data.text || data.reply || "" }];
    ch[sessionId] = thread.slice(-24);
    next.channelHistory = ch;
    writeJson(WS, next);
  }
  return data;
}

const busy = new Set();
async function handle({ channelId, from, fromId, chatId, message, isGroup, botNames, send }) {
  const key = `${channelId}:${chatId}`;
  if (busy.has(key)) return;
  busy.add(key);
  try {
    const data = await inbound({ channelId, from, fromId, chatId, message, isGroup, botNames });
    const reply = data.reply || data.text;
    if (reply && typeof send === "function") await send(clip(reply, TOKEN_MAX));
    setLive(channelId, {
      status: data.pairing ? "pairing" : "connected",
      lastAt: Date.now(),
      lastMessage: { from, text: clip(message, 160) },
      lastChatId: chatId,
      error: data.denied ? data.error : undefined,
    });
  } catch (err) {
    setLive(channelId, { status: "error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    busy.delete(key);
  }
}

async function runTelegram(acc, stop) {
  const token = acc.token.trim();
  const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json());
  if (!me.ok) throw new Error(me.description || "Telegram getMe failed");
  const username = me.result?.username ? `@${me.result.username}` : "";
  setLive("telegram", { status: "connected", label: username || "Telegram" });
  let offset = 0;
  while (!stop.v) {
    const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`;
    const j = await fetch(url).then((r) => r.json()).catch(() => null);
    if (!j?.ok) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const u of j.result || []) {
      offset = u.update_id + 1;
      const msg = u.message;
      if (!msg?.text || msg.from?.is_bot) continue;
      const chatId = String(msg.chat.id);
      const fromId = String(msg.from.id);
      const from = msg.from.username
        ? `@${msg.from.username}`
        : [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || fromId;
      const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
      await handle({
        channelId: "telegram",
        from,
        fromId,
        chatId,
        message: msg.text,
        isGroup,
        botNames: [username, me.result?.first_name].filter(Boolean),
        send: async (text) => {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text }),
          });
        },
      });
    }
  }
}

async function runDiscord(acc, stop) {
  const token = acc.token.trim();
  const intents = 1 | 512 | 4096 | 32768;
  const info = await fetch("https://discord.com/api/v10/gateway").then((r) => r.json());
  const url = `${info.url}?v=10&encoding=json`;
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let hb = null;
    let seq = null;
    let botId = "";
    let botName = "";
    const close = () => {
      if (hb) clearInterval(hb);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    stop.on = close;
    ws.addEventListener("open", () => setLive("discord", { status: "connected", label: "Discord" }));
    ws.addEventListener("error", (e) => reject(e));
    ws.addEventListener("close", () => {
      close();
      if (!stop.v) reject(new Error("Discord gateway closed"));
      else resolve();
    });
    ws.addEventListener("message", (ev) => {
      let p;
      try {
        p = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (p.s) seq = p.s;
      if (p.op === 10) {
        hb = setInterval(() => {
          ws.send(JSON.stringify({ op: 1, d: seq }));
        }, p.d.heartbeat_interval);
        ws.send(
          JSON.stringify({
            op: 2,
            d: {
              token,
              intents,
              properties: { os: "linux", browser: "paddy", device: "paddy" },
            },
          }),
        );
      }
      if (p.t === "READY") {
        botId = p.d?.user?.id || "";
        botName = p.d?.user?.username || "Paddy";
        setLive("discord", { status: "connected", label: botName });
      }
      if (p.t === "MESSAGE_CREATE") {
        const d = p.d || {};
        if (d.author?.bot) return;
        const chatId = String(d.channel_id);
        const fromId = String(d.author?.id || "");
        const from = d.author?.global_name || d.author?.username || fromId;
        const isGroup = Boolean(d.guild_id);
        const mentioned = Array.isArray(d.mentions) && d.mentions.some((m) => m.id === botId);
        void handle({
          channelId: "discord",
          from,
          fromId,
          chatId,
          message: d.content || "",
          isGroup,
          botNames: mentioned ? [botName, `<@${botId}>`] : [botName, `<@${botId}>`],
          send: async (text) => {
            await fetch(`https://discord.com/api/v10/channels/${chatId}/messages`, {
              method: "POST",
              headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
              body: JSON.stringify({ content: text.slice(0, 1900) }),
            });
          },
        });
      }
    });
  });
}

async function runSlack(acc, stop) {
  const bot = acc.token.trim();
  const app = acc.appToken.trim();
  async function open() {
    const r = await fetch("https://slack.com/api/apps.connections.open", {
      method: "POST",
      headers: { authorization: `Bearer ${app}`, "content-type": "application/x-www-form-urlencoded" },
    });
    const j = await r.json();
    if (!j.ok || !j.url) throw new Error(j.error || "Slack Socket Mode failed");
    return j.url;
  }
  const url = await open();
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const close = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    stop.on = close;
    ws.addEventListener("open", () => setLive("slack", { status: "connected", label: "Slack" }));
    ws.addEventListener("error", (e) => reject(e));
    ws.addEventListener("close", () => {
      if (!stop.v) reject(new Error("Slack socket closed"));
      else resolve();
    });
    ws.addEventListener("message", (ev) => {
      let p;
      try {
        p = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (p.envelope_id) ws.send(JSON.stringify({ envelope_id: p.envelope_id }));
      const evnt = p.payload?.event;
      if (!evnt || evnt.type !== "message" || evnt.subtype || evnt.bot_id) return;
      const chatId = String(evnt.channel || "");
      const fromId = String(evnt.user || "");
      void handle({
        channelId: "slack",
        from: fromId,
        fromId,
        chatId,
        message: evnt.text || "",
        isGroup: !evnt.channel_type || evnt.channel_type !== "im",
        botNames: ["@paddy", "<@"],
        send: async (text) => {
          await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: { authorization: `Bearer ${bot}`, "content-type": "application/json" },
            body: JSON.stringify({ channel: chatId, text }),
          });
        },
      });
    });
  });
}

async function runSignal(acc, stop) {
  const base = acc.host.replace(/\/$/, "");
  const number = encodeURIComponent(acc.number);
  setLive("signal", { status: "connected", label: acc.number });
  while (!stop.v) {
    try {
      const r = await fetch(`${base}/v1/receive/${number}`, { method: "GET" });
      if (r.ok) {
        const payload = await r.json();
        const list = Array.isArray(payload) ? payload : [payload];
        for (const item of list) {
          const env = item.envelope || item;
          const dataMessage = env.dataMessage || env.data_message || {};
          const text = dataMessage.message || env.message || "";
          const from = env.sourceNumber || env.source || env.sourceName || "";
          if (!text || !from) continue;
          await handle({
            channelId: "signal",
            from: String(from),
            fromId: String(from),
            chatId: String(from),
            message: String(text),
            isGroup: Boolean(dataMessage.groupInfo),
            botNames: [],
            send: async (body) => {
              await fetch(`${base}/v2/send`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ number: acc.number, recipients: [from], message: body }),
              });
            },
          });
        }
      }
    } catch (err) {
      setLive("signal", { status: "error", error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

function imapConnect(host, port) {
  return new Promise((resolve, reject) => {
    const sock = tlsConnect({ host, port, servername: host }, () => resolve(sock));
    sock.setEncoding("utf8");
    sock.on("error", reject);
  });
}

function waitTagged(sock, tag, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => {
      sock.off("data", onData);
      reject(new Error("IMAP timeout"));
    }, timeout);
    const onData = (chunk) => {
      buf += chunk;
      if (buf.includes(`\n${tag} OK`) || buf.includes(`\r${tag} OK`) || new RegExp(`^${tag} OK`, "m").test(buf)) {
        clearTimeout(t);
        sock.off("data", onData);
        resolve(buf);
      } else if (new RegExp(`^${tag} (NO|BAD)`, "m").test(buf)) {
        clearTimeout(t);
        sock.off("data", onData);
        reject(new Error(buf.slice(-200)));
      }
    };
    sock.on("data", onData);
  });
}

async function runEmail(acc, stop) {
  const host = acc.host.trim();
  const user = acc.user.trim();
  const pass = acc.pass.trim();
  const port = Number(acc.port) || 993;
  setLive("email", { status: "connected", label: user });
  let n = 1;
  const tag = () => `A${n++}`;
  while (!stop.v) {
    try {
      const sock = await imapConnect(host, port);
      await new Promise((r) => sock.once("data", r));
      const tLogin = tag();
      const loginWait = waitTagged(sock, tLogin);
      sock.write(`${tLogin} LOGIN "${user.replace(/"/g, '\\"')}" "${pass.replace(/"/g, '\\"')}"\r\n`);
      await loginWait;
      const tSel = tag();
      const selWait = waitTagged(sock, tSel);
      sock.write(`${tSel} SELECT INBOX\r\n`);
      await selWait;
      const tSearch = tag();
      const searchWait = waitTagged(sock, tSearch);
      sock.write(`${tSearch} SEARCH UNSEEN\r\n`);
      const searched = await searchWait;
      const ids = [...searched.matchAll(/\bSEARCH ([0-9 ]+)/g)].flatMap((m) =>
        (m[1] || "").trim().split(/\s+/).filter(Boolean),
      );
      for (const id of ids.slice(0, 5)) {
        const tFetch = tag();
        const fetchWait = waitTagged(sock, tFetch);
        sock.write(`${tFetch} FETCH ${id} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)] BODY.PEEK[TEXT])\r\n`);
        const fetched = await fetchWait;
        const fromMatch = fetched.match(/From:\s*(.+)/i);
        const subj = fetched.match(/Subject:\s*(.+)/i);
        const from = (fromMatch?.[1] || "mail").trim();
        const fromId = (from.match(/<([^>]+)>/) || [null, from])[1];
        const textStart = fetched.indexOf("\r\n\r\n");
        const body = fetched.slice(textStart >= 0 ? textStart : 0).slice(0, 2000);
        const message = `${(subj?.[1] || "").trim()}\n${body}`.trim();
        await handle({
          channelId: "email",
          from,
          fromId,
          chatId: fromId,
          message,
          isGroup: false,
          botNames: [],
          send: async (text) => sendSmtp(acc, fromId, subj?.[1] || "Re: Paddy", text),
        });
        const tStore = tag();
        const storeWait = waitTagged(sock, tStore);
        sock.write(`${tStore} STORE ${id} +FLAGS (\\Seen)\r\n`);
        await storeWait.catch(() => null);
      }
      sock.end();
    } catch (err) {
      setLive("email", { status: "error", error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, 60000));
  }
}

function sendSmtp(acc, to, subject, body) {
  const host = (acc.smtpHost || acc.host || "").replace(/^imap\./, "smtp.");
  const port = Number(acc.smtpPort) || 465;
  const user = acc.user;
  const pass = acc.pass;
  const from = acc.from || user;
  return new Promise((resolve, reject) => {
    const sock = tlsConnect({ host, port, servername: host }, () => {
      const b64 = (s) => Buffer.from(s).toString("base64");
      const lines = [
        `EHLO paddy.local`,
        `AUTH LOGIN`,
        b64(user),
        b64(pass),
        `MAIL FROM:<${from}>`,
        `RCPT TO:<${to}>`,
        `DATA`,
      ];
      let i = 0;
      const sendNext = () => {
        if (i < lines.length) sock.write(`${lines[i++]}\r\n`);
      };
      sock.setEncoding("utf8");
      sock.on("data", (chunk) => {
        if (i === 0 && /220/.test(chunk)) sendNext();
        else if (i > 0 && i < lines.length) sendNext();
        else if (i === lines.length) {
          sock.write(`Subject: ${subject}\r\nFrom: ${from}\r\nTo: ${to}\r\n\r\n${body}\r\n.\r\n`);
          i++;
        } else {
          sock.write("QUIT\r\n");
          sock.end();
          resolve();
        }
      });
    });
    sock.on("error", reject);
    setTimeout(() => reject(new Error("SMTP timeout")), 20000);
  });
}

function configured(id, acc) {
  if (!acc) return false;
  if (id === "telegram" || id === "discord") return Boolean(acc.token?.trim());
  if (id === "slack") return Boolean(acc.token?.trim() && acc.appToken?.trim());
  if (id === "whatsapp") return Boolean(acc.token?.trim() && acc.phoneId?.trim());
  if (id === "signal") return Boolean(acc.host?.trim() && acc.number?.trim());
  if (id === "email") return Boolean(acc.host?.trim() && acc.user?.trim() && acc.pass?.trim());
  return false;
}

const runners = {
  telegram: runTelegram,
  discord: runDiscord,
  slack: runSlack,
  signal: runSignal,
  email: runEmail,
};

const stops = {};

function stopAll() {
  for (const s of Object.values(stops)) {
    s.v = true;
    if (typeof s.on === "function") s.on();
  }
}

function fingerprint(cfg) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(cfg.accounts || {}).map(([k, v]) => [
        k,
        {
          t: v.token,
          a: v.appToken,
          p: v.phoneId,
          h: v.host,
          n: v.number,
          u: v.user,
          d: v.dmPolicy,
          f: v.allowFrom,
        },
      ]),
    ),
  );
}

function accountFingerprint(id, acc) {
  if (!acc) return "";
  return fingerprint({ accounts: { [id]: acc } });
}

async function startLoop(id, acc) {
  const stop = { v: false };
  stops[id] = stop;
  const run = runners[id];
  if (!run) {
    setLive(id, { status: "connected", label: id, configured: true });
    return;
  }
  while (!stop.v) {
    try {
      await run(acc, stop);
    } catch (err) {
      if (stop.v) return;
      setLive(id, { status: "error", error: err instanceof Error ? err.message : String(err) });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function halt(id) {
  const stop = stops[id];
  if (!stop) return;
  stop.v = true;
  if (typeof stop.on === "function") stop.on();
  delete stops[id];
}

const lastAccFp = {};

async function reconcile() {
  const cfg = loadCfg();
  for (const id of ["telegram", "discord", "slack", "whatsapp", "signal", "email"]) {
    const acc = cfg.accounts[id];
    const on = configured(id, acc);
    const accFp = on ? accountFingerprint(id, acc) : "";
    if (on && stops[id] && lastAccFp[id] !== accFp) {
      halt(id);
    }
    if (on && !stops[id]) {
      lastAccFp[id] = accFp;
      setLive(id, { status: "idle", configured: true });
      void startLoop(id, acc);
    }
    if (!on && stops[id]) {
      halt(id);
      delete lastAccFp[id];
      delete live[id];
      writeJson(STATUS, live);
    }
    if (id === "whatsapp" && on) {
      setLive("whatsapp", { status: "connected", label: "Cloud API · webhook /api/hooks/whatsapp" });
    }
  }
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopAll();
  process.exit(0);
});

if (!CLI_TOKEN) {
  process.stderr.write("paddy-bridge: PADDY_CLI_TOKEN missing — inbound turns will fail.\n");
}

async function assertOk(res, label) {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${label} HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
  }
}

async function sendOutbound(id, acc, chatId, message) {
  const text = clip(message, TOKEN_MAX);
  if (id === "telegram" && acc.token) {
    const res = await fetch(`https://api.telegram.org/bot${acc.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    await assertOk(res, "telegram");
    return;
  }
  if (id === "discord" && acc.token) {
    const res = await fetch(`https://discord.com/api/v10/channels/${chatId}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1900) }),
    });
    await assertOk(res, "discord");
    return;
  }
  if (id === "slack" && acc.token) {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: chatId, text }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      throw new Error(`slack ${body.error || `HTTP ${res.status}`}`);
    }
    return;
  }
  if (id === "whatsapp" && acc.token && acc.phoneId) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${acc.phoneId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: chatId,
        type: "text",
        text: { body: text },
      }),
    });
    await assertOk(res, "whatsapp");
    return;
  }
  if (id === "signal" && acc.host && acc.number) {
    const res = await fetch(`${String(acc.host).replace(/\/$/, "")}/v2/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ number: acc.number, recipients: [chatId], message: text }),
    });
    await assertOk(res, "signal");
    return;
  }
  throw new Error(`${id} not configured for outbound`);
}

async function drainOutbound() {
  const limits = outboundLimits(process.env);
  const queue = readOutboundQueue(HOME);
  if (!queue.length) return;
  const now = Date.now();
  const { due, waiting, dead } = partitionOutbound(queue, now, limits);
  if (dead.length) appendOutboundDead(dead, HOME, limits);

  // Persist non-dead jobs first (waiting + due) so a crash never drops the batch.
  let remaining = [...waiting, ...due];
  writeOutboundQueue(remaining, HOME);

  for (const row of due) {
    const id = row.channelId;
    const cfg = loadCfg();
    const acc = cfg.accounts?.[id];
    const chatId = row.chatId || live[id]?.lastChatId;

    const dropId = (jid) => {
      remaining = remaining.filter((j) => j.id !== jid);
      writeOutboundQueue(remaining, HOME);
    };
    const replaceJob = (next) => {
      remaining = remaining.map((j) => (j.id === next.id ? next : j));
      writeOutboundQueue(remaining, HOME);
    };

    if (!acc) {
      const failed = markOutboundFailure(row, new Error(`${id} account missing`), limits, Date.now());
      if (failed.attempts >= limits.maxAttempts) {
        appendOutboundDead([failed], HOME, limits);
        dropId(row.id);
      } else {
        replaceJob(failed);
      }
      continue;
    }
    if (!chatId && id !== "email") {
      const failed = markOutboundFailure(row, new Error("no chatId"), limits, Date.now());
      if (failed.attempts >= limits.maxAttempts) {
        appendOutboundDead([failed], HOME, limits);
        dropId(row.id);
      } else {
        replaceJob(failed);
      }
      continue;
    }
    try {
      if (id === "email") {
        await sendSmtp(acc, row.chatId || acc.from, "Paddy", row.message);
      } else {
        await sendOutbound(id, acc, chatId, row.message);
      }
      dropId(row.id);
    } catch (err) {
      const failed = markOutboundFailure(row, err, limits, Date.now());
      if (failed.attempts >= limits.maxAttempts) {
        appendOutboundDead([failed], HOME, limits);
        dropId(row.id);
      } else {
        replaceJob(failed);
      }
    }
  }
}

let lastFp = "";
setInterval(() => {
  const cfg = loadCfg();
  const fp = fingerprint(cfg);
  if (fp !== lastFp) {
    lastFp = fp;
    void reconcile();
  }
  void drainOutbound();
}, 2500);
void reconcile();
