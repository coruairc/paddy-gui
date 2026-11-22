import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { handleNode } from "./http.ts";

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
