import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { handleNode } from "./http.ts";
import { REQUEST_BODY_MAX_BYTES } from "./api.ts";

function startServer() {
  const server = http.createServer((req, res) => {
    handleNode(req, res).catch((err) => {
      res.statusCode = 500;
      res.end(String(err));
    });
  });
  return new Promise<{ server: http.Server; port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function stopServer(server: http.Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

function request(port: number, opts: { method?: string; path?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: opts.path ?? "/api/projects",
        method: opts.method ?? "GET",
        headers: opts.headers ?? {},
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function saveEnv() {
  return { host: process.env.OPENCODE_WEB_HOST, token: process.env.OPENCODE_WEB_TOKEN };
}

function restoreEnv(saved: { host: string | undefined; token: string | undefined }) {
  if (saved.host === undefined) delete process.env.OPENCODE_WEB_HOST;
  else process.env.OPENCODE_WEB_HOST = saved.host;
  if (saved.token === undefined) delete process.env.OPENCODE_WEB_TOKEN;
  else process.env.OPENCODE_WEB_TOKEN = saved.token;
}

test("non-loopback bind requires a token", async () => {
  const saved = saveEnv();
  process.env.OPENCODE_WEB_HOST = "0.0.0.0";
  process.env.OPENCODE_WEB_TOKEN = "secret";
  const { server, port } = await startServer();
  try {
    const denied = await request(port, { headers: { host: `127.0.0.1:${port}` } });
    assert.equal(denied.status, 401);
    const allowed = await request(port, { headers: { host: `127.0.0.1:${port}`, authorization: "Bearer secret" } });
    assert.equal(allowed.status, 200);
  } finally {
    await stopServer(server);
    restoreEnv(saved);
  }
});

test("DNS rebinding is rejected", async () => {
  const saved = saveEnv();
  process.env.OPENCODE_WEB_HOST = "127.0.0.1";
  process.env.OPENCODE_WEB_TOKEN = "secret";
  const { server, port } = await startServer();
  try {
    const res = await request(port, {
      headers: { host: "evil.example", origin: "http://evil.example" },
    });
    assert.equal(res.status, 401);
  } finally {
    await stopServer(server);
    restoreEnv(saved);
  }
});

test("cross-origin via Origin is rejected", async () => {
  const saved = saveEnv();
  process.env.OPENCODE_WEB_HOST = "127.0.0.1";
  delete process.env.OPENCODE_WEB_TOKEN;
  const { server, port } = await startServer();
  try {
    const res = await request(port, {
      headers: { host: `127.0.0.1:${port}`, origin: "http://evil.example" },
    });
    assert.equal(res.status, 403);
  } finally {
    await stopServer(server);
    restoreEnv(saved);
  }
});

test("cross-origin via Referer is rejected", async () => {
  const saved = saveEnv();
  process.env.OPENCODE_WEB_HOST = "127.0.0.1";
  delete process.env.OPENCODE_WEB_TOKEN;
  const { server, port } = await startServer();
  try {
    const res = await request(port, {
      headers: { host: `127.0.0.1:${port}`, referer: "http://evil.example" },
    });
    assert.equal(res.status, 403);
  } finally {
    await stopServer(server);
    restoreEnv(saved);
  }
});

test("same-origin browser request passes", async () => {
  const saved = saveEnv();
  process.env.OPENCODE_WEB_HOST = "127.0.0.1";
  delete process.env.OPENCODE_WEB_TOKEN;
  const { server, port } = await startServer();
  try {
    const res = await request(port, {
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
    });
    assert.equal(res.status, 200);
  } finally {
    await stopServer(server);
    restoreEnv(saved);
  }
});

test("cookie exchange sets HttpOnly cookie", async () => {
  const saved = saveEnv();
  process.env.OPENCODE_WEB_HOST = "127.0.0.1";
  process.env.OPENCODE_WEB_TOKEN = "secret";
  const { server, port } = await startServer();
  try {
    const res = await request(port, {
      path: "/api/projects?token=secret",
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
    });
    assert.equal(res.status, 200);
    const cookie = res.headers["set-cookie"];
    const value = Array.isArray(cookie) ? cookie.join("; ") : cookie ?? "";
    assert.match(value, /HttpOnly/);
    assert.match(value, /SameSite=Strict/);
    assert.match(value, /Path=\//);
  } finally {
    await stopServer(server);
    restoreEnv(saved);
  }
});

test("trusted local anonymous passes", async () => {
  const saved = saveEnv();
  process.env.OPENCODE_WEB_HOST = "127.0.0.1";
  delete process.env.OPENCODE_WEB_TOKEN;
  const { server, port } = await startServer();
  try {
    const res = await request(port, { headers: { host: `127.0.0.1:${port}` } });
    assert.equal(res.status, 200);
  } finally {
    await stopServer(server);
    restoreEnv(saved);
  }
});
test("a malformed paddy_token cookie is treated as absent, not a 500", async () => {
  const saved = saveEnv();
  process.env.OPENCODE_WEB_HOST = "0.0.0.0";
  process.env.OPENCODE_WEB_TOKEN = "secret";
  const { server, port } = await startServer();
  try {
    const res = await request(port, {
      headers: { host: `127.0.0.1:${port}`, cookie: "paddy_token=%E0%A4%A" },
    });
    assert.equal(res.status, 401);
  } finally {
    await stopServer(server);
    restoreEnv(saved);
  }
});

// ── Body cap on the Node adapter (R-NEW-2) ────────────────────────────────
// A fake request/response pair drives handleNode directly. The probe path is
// unknown to handleApi (which would answer 404), so a 400 proves the cap fired
// before the body reached the API layer.
function fakeNodePair(chunks: Buffer[], headers: Record<string, string>) {
  const req = Object.assign(Readable.from(chunks), {
    method: "POST",
    url: "/api/adapter-cap-probe",
    headers: { host: "127.0.0.1:8080", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;
  const sent = { status: 0, body: "" };
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    write() {},
    end(body?: string) {
      sent.status = res.statusCode;
      sent.body = body ?? "";
    },
  } as unknown as ServerResponse;
  return { req, res, sent };
}

test("an over-cap declared content-length is rejected 400 before handleApi runs", async () => {
  const saved = saveEnv();
  process.env.OPENCODE_WEB_HOST = "127.0.0.1";
  delete process.env.OPENCODE_WEB_TOKEN;
  try {
    const oversized = Buffer.alloc(REQUEST_BODY_MAX_BYTES + 1, 0x61);
    const { req, res, sent } = fakeNodePair([oversized], {
      "content-type": "application/json",
      "content-length": String(oversized.length),
    });
    await handleNode(req, res);
    assert.equal(sent.status, 400);
    assert.match(JSON.parse(sent.body).error, /too large/i);
    assert.doesNotMatch(sent.body, /Not found/, "handleApi was not reached");
  } finally {
    restoreEnv(saved);
  }
});

test("a streamed body over the cap is rejected 400 even without a content-length", async () => {
  const saved = saveEnv();
  process.env.OPENCODE_WEB_HOST = "127.0.0.1";
  delete process.env.OPENCODE_WEB_TOKEN;
  try {
    const half = Buffer.alloc(REQUEST_BODY_MAX_BYTES / 2 + 1, 0x61);
    const { req, res, sent } = fakeNodePair([half, half, half], {
      "content-type": "application/json",
    });
    await handleNode(req, res);
    assert.equal(sent.status, 400);
    assert.match(JSON.parse(sent.body).error, /too large/i);
  } finally {
    restoreEnv(saved);
  }
});

test("a streamed body that under-declares content-length is still capped", async () => {
  const saved = saveEnv();
  process.env.OPENCODE_WEB_HOST = "127.0.0.1";
  delete process.env.OPENCODE_WEB_TOKEN;
  try {
    const big = Buffer.alloc(REQUEST_BODY_MAX_BYTES + 10, 0x61);
    const { req, res, sent } = fakeNodePair([big], {
      "content-type": "application/json",
      "content-length": "2",
    });
    await handleNode(req, res);
    assert.equal(sent.status, 400);
    assert.match(JSON.parse(sent.body).error, /too large/i);
  } finally {
    restoreEnv(saved);
  }
});
