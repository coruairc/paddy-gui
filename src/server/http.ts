/**
 * Node adapter for the controller. Binds no sockets itself — Vite (or a test)
 * calls this. Authorization uses the socket address, never a spoofable header.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { handleApi, REQUEST_BODY_MAX_BYTES } from "./api.ts";
import { authorizePeer, isLoopbackAddress, isLoopbackHost, originAllowed } from "./security.ts";
import { getRuntime } from "./runtime.ts";

export async function handleNode(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const remote = req.socket.remoteAddress;
  const host = header(req, "host") ?? "127.0.0.1";
  const requestUrl = new URL(req.url ?? "/", `http://${host}`);
  const queryToken = requestUrl.searchParams.get("token");
  const cookieToken = cookie(req, "paddy_token");
  const authorization = header(req, "authorization");
  // Origin/Referer check FIRST -> 403 for cross-origin regardless of token
  if (!originAllowed(header(req, "origin"), host, header(req, "referer"))) {
    sendJson(res, 403, { error: "Cross-origin request rejected" });
    return;
  }
  const auth = authorizePeer({
    remoteAddress: remote,
    host,
    bindHost: process.env.OPENCODE_WEB_HOST,
    authorization: authorization ?? (queryToken ? `Bearer ${queryToken}` : cookieToken ? `Bearer ${cookieToken}` : null),
    token: process.env.OPENCODE_WEB_TOKEN,
    // Docker maps a host-loopback port to a container interface, so the
    // socket peer is not literally loopback even though the published port
    // is local-only. Do not enable this shortcut for a non-loopback bind.
    localOnly: isLoopbackAddress(process.env.OPENCODE_WEB_HOST) && isLoopbackHost(host),
  });
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return;
  }
  const expectedToken = process.env.OPENCODE_WEB_TOKEN?.trim() ?? "";
  if (queryToken && expectedToken) {
    const a = Buffer.from(queryToken, "utf8");
    const b = Buffer.from(expectedToken, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      res.setHeader("set-cookie", "paddy_token=" + encodeURIComponent(queryToken) + "; HttpOnly; SameSite=Strict; Path=/");
    }
  }
  const proto = "http";
  let raw: Buffer | null = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await readBodyCapped(req);
    if (!body.ok) {
      sendJson(res, 400, { error: body.error });
      return;
    }
    raw = body.body;
  }
  const request = new Request(`${proto}://${host}${req.url ?? "/"}`, {
    method: req.method,
    headers: toHeaders(req),
    body: raw ? new Uint8Array(raw) : undefined,
  });
  const result = await handleApi(getRuntime(), request);
  if (result.stream) {
    res.writeHead(result.status, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const reader = result.stream.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        res.write(chunk.value);
      }
    } catch {
      /* client disconnected */
    }
    res.end();
    return;
  }
  sendJson(res, result.status, result.body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body ?? null));
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function cookie(req: IncomingMessage, name: string): string | null {
  const raw = header(req, "cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null; // a malformed cookie is treated as absent, not a 500
    }
  }
  return null;
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

/** Reject an oversized body before buffering anything (same cap as api.ts). */
const BODY_TOO_LARGE = "Request body is too large";

type BodyRead = { ok: true; body: Buffer | null } | { ok: false; error: string };

function readBodyCapped(req: IncomingMessage): Promise<BodyRead> {
  return new Promise((resolve) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > REQUEST_BODY_MAX_BYTES) {
      req.resume(); // drain so the socket is not left half-read
      resolve({ ok: false, error: BODY_TOO_LARGE });
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const finish = (result: BodyRead) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      received += chunk.length;
      if (received > REQUEST_BODY_MAX_BYTES) {
        chunks.length = 0;
        finish({ ok: false, error: BODY_TOO_LARGE });
        req.resume();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => finish({ ok: true, body: Buffer.concat(chunks) }));
    req.on("error", () => finish({ ok: false, error: "Request could not be read" }));
  });
}
