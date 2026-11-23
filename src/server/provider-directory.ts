/**
 * models.dev provider directory for Settings → Providers.
 *
 * models.dev is not OpenCode: this module is the only place the controller
 * fetches the public catalog, and it never contacts the provider API URLs the
 * catalog mentions. The response is projected to display metadata, cached in
 * memory, and bounded so a large or malformed catalog cannot hold the page.
 */

import { safeJson } from "./security.ts";

/** The only new outbound host approved for Part C. */
export const PROVIDER_DIRECTORY_URL = "https://models.dev/api.json?type=all";
export const PROVIDER_DIRECTORY_TTL_MS = 24 * 60 * 60 * 1_000;
export const PROVIDER_DIRECTORY_NEGATIVE_TTL_MS = 60 * 1_000;
export const PROVIDER_DIRECTORY_TIMEOUT_MS = 5_000;
export const PROVIDER_DIRECTORY_MAX_BYTES = 8 * 1024 * 1024;
/** Upper bound on providers in one catalog response (live models.dev has ~328). */
export const PROVIDER_DIRECTORY_MAX_PROVIDERS = 1_000;
/** Upper bound on model rows listed per provider. */
export const PROVIDER_DIRECTORY_MAX_MODELS = 200;

const MAX_PROVIDER_ID = 256;
const MAX_PROVIDER_NAME = 300;
const MAX_PROVIDER_DOC = 2_048;
const MAX_MODEL_ID = 256;
const MAX_MODEL_NAME = 300;

export type DirectoryModel = { id: string; name?: string };

/** Browser-safe display metadata for one models.dev provider. */
export type DirectoryProvider = {
  id: string;
  name: string;
  doc?: string;
  /** Total models the source listed; `models` may be capped below this. */
  modelCount: number;
  models: DirectoryModel[];
};

export type ProviderDirectoryResult = {
  providers: DirectoryProvider[];
  /** Retryable failure message; the catalog is empty when set. */
  error?: string;
  /** Epoch ms of the successful fetch that produced `providers`. */
  fetchedAt?: number;
};

export type ProviderDirectoryOptions = {
  /** Injected for tests; production uses the global fetch. */
  fetch?: typeof fetch;
  now?: () => number;
  /** Injected for tests so the 5s timeout does not wait in real time. */
  setTimeout?: (handler: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

const TIMEOUT_ERROR = "The provider catalog request timed out";
const FETCH_ERROR = "Could not load the provider catalog";
const SHAPE_ERROR = "The provider catalog response had an unexpected shape";

/**
 * Fetches, projects, and caches the models.dev catalog. A failure is cached
 * briefly so a flapping upstream cannot be hammered by every page load.
 */
export class ProviderDirectory {
  private readonly fetchImpl: typeof fetch;
  private readonly nowImpl: () => number;
  private readonly setTimeoutImpl: (handler: () => void, ms: number) => unknown;
  private readonly clearTimeoutImpl: (handle: unknown) => void;
  private cache: { result: ProviderDirectoryResult; expiresAt: number } | null = null;
  private inflight: Promise<ProviderDirectoryResult> | null = null;

  constructor(options: ProviderDirectoryOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.nowImpl = options.now ?? Date.now;
    this.setTimeoutImpl = options.setTimeout ?? ((handler, ms) => setTimeout(handler, ms));
    this.clearTimeoutImpl =
      options.clearTimeout ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  }

  async get(): Promise<ProviderDirectoryResult> {
    if (this.cache && this.cache.expiresAt > this.nowImpl()) return this.cache.result;
    if (this.inflight) return this.inflight;
    const run = this.load();
    this.inflight = run;
    try {
      return await run;
    } finally {
      if (this.inflight === run) this.inflight = null;
    }
  }

  private async load(): Promise<ProviderDirectoryResult> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = this.setTimeoutImpl(() => {
      timedOut = true;
      controller.abort();
    }, PROVIDER_DIRECTORY_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(PROVIDER_DIRECTORY_URL, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal,
          // A 3xx would send us to an unapproved host; only models.dev is allowed.
          // Mode "error" makes such a response a retryable fetch failure below.
          redirect: "error",
        });
      } catch {
        return this.rememberFailure(timedOut ? TIMEOUT_ERROR : FETCH_ERROR);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return this.rememberFailure(`The provider catalog request failed (${response.status})`);
      }
      let text: string;
      try {
        text = await readCappedText(response, PROVIDER_DIRECTORY_MAX_BYTES);
      } catch (err) {
        return this.rememberFailure(
          timedOut || isAbortError(err) ? TIMEOUT_ERROR : errorText(err, FETCH_ERROR),
        );
      }
      const parsed = safeJson(text);
      if (!parsed.ok)
        return this.rememberFailure("The provider catalog response was not valid JSON");
      const providers = projectDirectory(parsed.value);
      // A valid JSON object with no usable provider is not a catalog: cache it
      // as a failure so the UI never claims everything is configured for 24h.
      if (providers === null || providers.length === 0) return this.rememberFailure(SHAPE_ERROR);
      const fetchedAt = this.nowImpl();
      const result: ProviderDirectoryResult = { providers, fetchedAt };
      this.cache = { result, expiresAt: fetchedAt + PROVIDER_DIRECTORY_TTL_MS };
      return result;
    } finally {
      this.clearTimeoutImpl(timer);
    }
  }

  private rememberFailure(error: string): ProviderDirectoryResult {
    const result: ProviderDirectoryResult = { providers: [], error };
    this.cache = { result, expiresAt: this.nowImpl() + PROVIDER_DIRECTORY_NEGATIVE_TTL_MS };
    return result;
  }
}

let singleton: ProviderDirectory | null = null;

/** Process-wide cache shared by the API routes. */
export function getProviderDirectory(): ProviderDirectory {
  if (!singleton) singleton = new ProviderDirectory();
  return singleton;
}

/**
 * Explicit projection: only fields the UI renders cross this boundary. The
 * source's `env`, `npm`, `api` (base URL), model `cost`/`limit`/`family`, and
 * anything credential-shaped are dropped by construction.
 */
function projectDirectory(value: unknown): DirectoryProvider[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const providers: DirectoryProvider[] = [];
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (providers.length >= PROVIDER_DIRECTORY_MAX_PROVIDERS) break;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const id = boundedIdentifier(entry.id, MAX_PROVIDER_ID) ?? boundedIdentifier(key, MAX_PROVIDER_ID);
    if (!id || seen.has(id)) continue;
    const name = boundedString(entry.name, MAX_PROVIDER_NAME) ?? id;
    const doc = httpsDoc(entry.doc, MAX_PROVIDER_DOC);
    const { models, total } = projectModels(entry.models);
    seen.add(id);
    providers.push({
      id,
      name,
      ...(doc ? { doc } : {}),
      modelCount: total,
      models,
    });
  }
  return providers;
}

function projectModels(raw: unknown): { models: DirectoryModel[]; total: number } {
  const models: DirectoryModel[] = [];
  const seen = new Set<string>();
  let total = 0;

  const visit = (candidate: unknown, fallbackID?: string) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    const record = candidate as Record<string, unknown>;
    const id =
      boundedIdentifier(record.id, MAX_MODEL_ID) ??
      boundedIdentifier(fallbackID, MAX_MODEL_ID) ??
      "";
    if (!id || seen.has(id)) return;
    seen.add(id);
    total += 1;
    if (models.length >= PROVIDER_DIRECTORY_MAX_MODELS) return;
    const name = boundedString(record.name, MAX_MODEL_NAME);
    models.push(name ? { id, name } : { id });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) visit(item);
  } else if (raw && typeof raw === "object") {
    for (const [key, item] of Object.entries(raw as Record<string, unknown>)) visit(item, key);
  }
  return { models, total };
}

/** Trimmed, non-empty, bounded string; anything else is absent. Display-only: truncates. */
function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Identifiers must be real source ids, so an overlong value is rejected, never
 * truncated: two long ids sharing a prefix would otherwise collapse.
 */
function boundedIdentifier(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return undefined;
  return trimmed;
}

/** A display link is only kept when it is an absolute https: URL. */
function httpsDoc(value: unknown, max: number): string | undefined {
  const raw = boundedIdentifier(value, max);
  if (!raw) return undefined;
  try {
    return new URL(raw).protocol === "https:" ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a body as text with a hard byte cap. Mirrors opencode-client's
 * readCapped, but a models.dev overflow is a catalog error, not an OpenCode one.
 */
async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const tooLarge = () =>
    new Error(
      `The provider catalog is too large to load (over ${Math.round(maxBytes / (1024 * 1024))} MB)`,
    );
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}

function errorText(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}
