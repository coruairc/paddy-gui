/**
 * Node adapter for the controller. Binds no sockets itself — Vite (or a test)
 * calls this. Authorization uses the socket address, never a spoofable header.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApi } from "./api.ts";
import { authorizePeer, originAllowed } from "./security.ts";
import { getRuntime } from "./runtime.ts";

export async function handleNode(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const remote = req.socket.remoteAddress;
  const authorization = header(req, "authorization");
  const auth = authorizePeer({
    remoteAddress: remote,
    authorization,
    token: process.env.OPENCODE_WEB_TOKEN,
  });
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return;
  }
  if (!originAllowed(header(req, "origin"), header(req, "host"))) {
    sendJson(res, 403, { error: "Cross-origin request rejected" });
    return;
  }
  const host = header(req, "host") ?? "127.0.0.1";
  const proto = "http";
  const request = new Request(`${proto}://${host}${req.url ?? "/"}`, {
    method: req.method,
    headers: toHeaders(req),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(await readRaw(req)),
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

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
