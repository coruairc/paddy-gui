import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { authorizePeer, isLoopbackHost, originAllowed, redactSecrets, safeJson, validateWorkspacePath } from "./security.ts";

test("loopback is allowed without a token", () => {
  assert.equal(authorizePeer({ remoteAddress: "127.0.0.1", host: "127.0.0.1:8080", bindHost: "127.0.0.1" }).ok, true);
  assert.equal(authorizePeer({ remoteAddress: "::ffff:127.0.0.1", host: "127.0.0.1:8080", bindHost: "127.0.0.1" }).ok, true);
  assert.equal(authorizePeer({ remoteAddress: "::1", host: "localhost:8080", bindHost: "::1" }).ok, true);
});

test("container-local mode is allowed only when explicitly enabled", () => {
  assert.equal(authorizePeer({ remoteAddress: "172.17.0.1", localOnly: true, host: "127.0.0.1:8080", bindHost: "127.0.0.1" }).ok, true);
  assert.equal(authorizePeer({ remoteAddress: "172.17.0.1", localOnly: false, host: "127.0.0.1:8080", bindHost: "127.0.0.1" }).ok, false);
});

test("remote access is rejected unless the token matches", () => {
  const denied = authorizePeer({ remoteAddress: "10.0.0.8", authorization: "Bearer no", host: "127.0.0.1:8080", bindHost: "0.0.0.0", token: "secret" });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 401);
  const missing = authorizePeer({ remoteAddress: "10.0.0.8", token: "secret", authorization: "Bearer wrong", host: "127.0.0.1:8080", bindHost: "0.0.0.0" });
  assert.equal(missing.ok, false);
  const allowed = authorizePeer({ remoteAddress: "10.0.0.8", token: "secret", authorization: "Bearer secret", host: "127.0.0.1:8080", bindHost: "0.0.0.0" });
  assert.equal(allowed.ok, true);
});

test("DNS rebinding is rejected for loopback peers", () => {
  const denied = authorizePeer({ remoteAddress: "127.0.0.1", host: "evil.example", bindHost: "127.0.0.1" });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 401);
  const withToken = authorizePeer({ remoteAddress: "127.0.0.1", host: "evil.example", bindHost: "127.0.0.1", token: "secret", authorization: "Bearer wrong" });
  assert.equal(withToken.ok, false);
  if (!withToken.ok) assert.equal(withToken.status, 401);
});

test("non-loopback bind never grants anonymous access", () => {
  const denied = authorizePeer({ remoteAddress: "127.0.0.1", host: "127.0.0.1:8080", bindHost: "0.0.0.0" });
  assert.equal(denied.ok, false);
  const allowed = authorizePeer({ remoteAddress: "127.0.0.1", host: "127.0.0.1:8080", bindHost: "0.0.0.0", token: "secret", authorization: "Bearer secret" });
  assert.equal(allowed.ok, true);
});

test("container shortcut requires a loopback host", () => {
  const denied = authorizePeer({ remoteAddress: "172.17.0.1", localOnly: true, host: "evil.example", bindHost: "127.0.0.1" });
  assert.equal(denied.ok, false);
});

test("cross-origin browser calls are rejected", () => {
  assert.equal(originAllowed("http://evil.example", "127.0.0.1:8080"), false);
  assert.equal(originAllowed("http://127.0.0.1:8080", "127.0.0.1:8080"), true);
  assert.equal(originAllowed(null, "127.0.0.1:8080"), true);
});

test("cross-origin referer is rejected", () => {
  assert.equal(originAllowed(null, "127.0.0.1:8080", "http://evil.example"), false);
  assert.equal(originAllowed(null, "127.0.0.1:8080", "http://127.0.0.1:8080"), true);
  assert.equal(originAllowed(null, "127.0.0.1:8080"), true);
});

test("isLoopbackHost parses hosts", () => {
  assert.equal(isLoopbackHost("127.0.0.1:8080"), true);
  assert.equal(isLoopbackHost("evil.example"), false);
  assert.equal(isLoopbackHost("[::1]:8080"), true);
});

test("invalid workspaces never pass the allowlist", () => {
  const root = mkdtempSync(join(tmpdir(), "ocw-"));
  const project = join(root, "app");
  mkdirSync(project);
  assert.equal(validateWorkspacePath("relative/path").ok, false);
  assert.equal(validateWorkspacePath("/no/such/paddy-path").ok, false);
  assert.equal(validateWorkspacePath(join(project, "missing-file")).ok, false);
  const file = join(root, "note.txt");
  writeFileSync(file, "x");
  assert.equal(validateWorkspacePath(file).ok, false);
  const outside = validateWorkspacePath(project, [join(root, "other")]);
  assert.equal(outside.ok, false);
  const inside = validateWorkspacePath(project, [root]);
  assert.equal(inside.ok, true);
});

test("secrets are stripped from objects and strings", () => {
  const redacted = redactSecrets(
    { provider: { apiKey: "sk-live-secret", name: "openai" }, note: "token sk-live-secret leaked" },
    ["sk-live-secret"],
  );
  assert.equal(redacted.provider.apiKey, "[redacted]");
  assert.equal(redacted.note.includes("sk-live-secret"), false);
  assert.equal(JSON.stringify(redacted).includes("sk-live-secret"), false);
});

test("malformed JSON is rejected", () => {
  assert.equal(safeJson("{").ok, false);
  assert.deepEqual(safeJson('{"a":1}'), { ok: true, value: { a: 1 } });
});