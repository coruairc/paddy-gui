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
    {
      provider: { apiKey: "sk-live-secret", name: "openai" },
      note: "token sk-live-secret leaked",
      exact: "sk-live-secret",
    },
    ["sk-live-secret"],
  );
  assert.equal(redacted.provider.apiKey, "[redacted]");
  // Whole-string equality: a string node exactly equal to a needle is redacted.
  assert.equal(redacted.exact, "[redacted]");
  // Locked D-04 tradeoff: prose that merely embeds a secret now survives
  // verbatim — needles no longer scrub substrings. Dedicated credential
  // fields stay covered by key-based redaction, exact values by equality.
  assert.equal(redacted.note, "token sk-live-secret leaked");
});

test("identifier payloads round-trip byte-identical through redaction", () => {
  // Needle "token" (length 5, passes the >= 4 filter) is a substring of the
  // provider id. The old substring code produced "alibaba-[redacted]-plan";
  // exact-match must leave the payload byte-identical (V2-03, D-04).
  const payload = {
    all: [{ id: "alibaba-token-plan", models: {} }],
    connected: ["alibaba-token-plan"],
  };
  const out = redactSecrets(payload, ["token"]);
  assert.deepEqual(out, payload);
  assert.equal(JSON.stringify(out), JSON.stringify(payload));
});

test("exact needle values are still redacted", () => {
  const out = redactSecrets({ a: "token", b: "alibaba-token-plan" }, ["token"]);
  assert.equal(out.a, "[redacted]");
  assert.equal(out.b, "alibaba-token-plan");
});

test("needle length filter and whole-string equality boundaries", () => {
  // 3-char needle is filtered out by the length >= 4 rule.
  assert.equal(redactSecrets("abc", ["abc"]), "abc");
  // 4-char needle is kept and matches on whole-string equality.
  assert.equal(redactSecrets("abcd", ["abcd"]), "[redacted]");
  // A substring of the value never matches under exact equality.
  assert.equal(redactSecrets("xabcdx", ["abcd"]), "xabcdx");
  // A needle longer than the value never matches.
  assert.equal(redactSecrets("abcd", ["abcdef"]), "abcd");
});

test("malformed JSON is rejected", () => {
  assert.equal(safeJson("{").ok, false);
  assert.deepEqual(safeJson('{"a":1}'), { ok: true, value: { a: 1 } });
});