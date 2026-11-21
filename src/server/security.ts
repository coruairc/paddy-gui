/**
 * Security boundary for the local controller.
 * The browser is never trusted. Paths, origins, and secrets are checked here.
 */

import { timingSafeEqual } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const host = address.replace(/^::ffff:/, "").trim();
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function isLoopbackHost(value: string | null | undefined): boolean {
  if (!value) return false;
  const first = value.split(",")[0]?.trim() ?? "";
  let hostname = first;
  if (hostname.startsWith("[")) {
    const end = hostname.indexOf("]");
    hostname = end >= 0 ? hostname.slice(1, end) : hostname;
  } else {
    const idx = hostname.lastIndexOf(":");
    if (idx > 0) hostname = hostname.slice(0, idx);
  }
  const h = hostname.trim().replace(/^::ffff:/, "");
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

export function bearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

/**
 * Anonymous trust is granted only when the controller is bound to a loopback
 * address AND the request's Host header names a loopback host. The socket peer
 * alone never grants trust; a non-loopback bind never grants anonymous trust.
 */
export function authorizePeer(input: {
  remoteAddress?: string | null;
  host?: string | null;
  bindHost?: string | null;
  authorization?: string | null;
  token?: string | null;
  localOnly?: boolean;
}): { ok: true } | { ok: false; status: 401; error: string } {
  const bindLoopback = input.bindHost == null ? true : isLoopbackAddress(input.bindHost);
  const hostLoopback = input.host == null ? true : isLoopbackHost(input.host);
  const peerLoopback = isLoopbackAddress(input.remoteAddress);
  const trusted =
    bindLoopback && hostLoopback && (peerLoopback || input.localOnly === true);

  if (trusted) return { ok: true };

  const expected = input.token?.trim() ?? "";
  if (!expected) {
    return {
      ok: false,
      status: 401,
      error: "Remote access is disabled. Set OPENCODE_WEB_TOKEN and connect with that token.",
    };
  }
  const presented = bearerToken(input.authorization);
  if (!presented) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

/** Reject cross-site browser calls. Missing Origin/Referer is allowed (non-browser clients). */
export function originAllowed(
  origin: string | null | undefined,
  host: string | null | undefined,
  referer?: string | null | undefined,
): boolean {
  const expected = (host ?? "").split(",")[0]?.trim() ?? "";
  if (!expected) return false;

  const check = (value: string): boolean => {
    try {
      const url = new URL(value);
      return url.host === expected;
    } catch {
      return false;
    }
  };

  if (origin) return check(origin);
  if (referer) return check(referer);
  return true;
}

export type PathCheck =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * A workspace must be an absolute directory the user explicitly added.
 * The browser cannot pass a path that is not on that allowlist.
 */
export function validateWorkspacePath(input: string, allowlist?: readonly string[]): PathCheck {
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, error: "Workspace path is required" };
  }
  if (input.includes("\0")) {
    return { ok: false, error: "Workspace path is invalid" };
  }
  if (!isAbsolute(input)) {
    return { ok: false, error: "Workspace path must be absolute" };
  }
  const resolved = resolve(input);
  let real = resolved;
  try {
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      return { ok: false, error: "Workspace path is not a directory" };
    }
    real = realpathSync(resolved);
  } catch {
    return { ok: false, error: "Workspace path does not exist" };
  }
  if (allowlist) {
    const allowed = allowlist.map((entry) => {
      try {
        return realpathSync(entry);
      } catch {
        return resolve(entry);
      }
    });
    const inside = allowed.some((root) => real === root || real.startsWith(root + sep));
    if (!inside) {
      return { ok: false, error: "Workspace is not in the project allowlist" };
    }
  }
  return { ok: true, path: real };
}

export function safeJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Malformed JSON" };
  }
}

const SECRET_KEY = /(^key$|api[_-]?key|token|password|secret|authorization|credential|private[_-]?key)/i;

/** Remove credential-shaped fields before anything reaches the browser or logs. */
export function redactSecrets<T>(value: T, extra: readonly string[] = []): T {
  const needles = extra.filter((item) => item && item.length >= 4);
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      let out = node;
      for (const needle of needles) {
        if (out.includes(needle)) out = out.split(needle).join("[redacted]");
      }
      return out;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (SECRET_KEY.test(key)) {
          out[key] = child ? "[redacted]" : child;
          continue;
        }
        out[key] = walk(child);
      }
      return out;
    }
    return node;
  };
  return walk(value) as T;
}
