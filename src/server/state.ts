/**
 * GUI metadata only. OpenCode owns sessions, models, and provider secrets.
 * This file stores project bookmarks, appearance, and an optional server password
 * that never leaves the controller.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
};

export type Appearance = "dark" | "light";

export type AppState = {
  projects: ProjectRecord[];
  activeProjectId: string | null;
  appearance: Appearance;
  /** Optional override. Empty means discover/start the local OpenCode server. */
  connectionUrl: string;
  connectionUsername: string;
  /** Never serialized to the browser. */
  connectionPassword: string;
  /** Password this controller generated for a server it spawned, kept so a
   *  controller restart can re-attach to the still-running server. */
  ownedServerPassword: string;
  /** Desk default provider/model id. Empty means unset — fall back to OpenCode config. */
  deskModel: string;
  /** Canonical `provider/model` keys the user added to the composer picker.
   *  OpenCode remains the authority for the model metadata. */
  availableModels: string[];
};

export const EMPTY_STATE: AppState = {
  projects: [],
  activeProjectId: null,
  appearance: "dark",
  connectionUrl: "",
  connectionUsername: "opencode",
  connectionPassword: "",
  ownedServerPassword: "",
  deskModel: "",
  availableModels: [],
};

export function stateFilePath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env.OPENCODE_WEB_HOME?.trim();
  const root = override || join(home, ".paddy");
  return join(root, "state.json");
}

export function readState(file: string): AppState {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<AppState>;
    return normalizeState(parsed);
  } catch {
    return { ...EMPTY_STATE, projects: [] };
  }
}

export function writeState(file: string, state: AppState): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(normalizeState(state), null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
    chmodSync(dirname(file), 0o700);
  } catch {
    /* windows or restricted fs */
  }
}

export function normalizeState(input: Partial<AppState> | null | undefined): AppState {
  const projects = Array.isArray(input?.projects)
    ? input.projects
        .filter((item) => item && typeof item.path === "string" && typeof item.id === "string")
        .map((item) => ({
          id: item.id,
          name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : item.path,
          path: item.path,
          createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        }))
    : [];
  const active =
    typeof input?.activeProjectId === "string" && projects.some((item) => item.id === input.activeProjectId)
      ? input.activeProjectId
      : (projects[0]?.id ?? null);
  return {
    projects,
    activeProjectId: active,
    appearance: input?.appearance === "light" ? "light" : "dark",
    connectionUrl: typeof input?.connectionUrl === "string" ? input.connectionUrl : "",
    connectionUsername:
      typeof input?.connectionUsername === "string" && input.connectionUsername
        ? input.connectionUsername
        : "opencode",
    connectionPassword: typeof input?.connectionPassword === "string" ? input.connectionPassword : "",
    ownedServerPassword:
      typeof input?.ownedServerPassword === "string" ? input.ownedServerPassword : "",
    // Values written before deskModel was validated (or hand-edited) load as unset.
    deskModel: loadDeskModel(input?.deskModel),
    availableModels: loadAvailableModels(input?.availableModels),
  };
}

export const DESK_MODEL_MAX_LENGTH = 256;
// `provider/model`: provider has no slash; the model id may (e.g. `openrouter/x/y`).
const DESK_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*\/[A-Za-z0-9._:@+-]+(?:\/[A-Za-z0-9._:@+-]+)*$/;

/** Bound for the curated picker list; keeps a hand-edited state file from
 *  turning every `/api/models` call into an unbounded lookup. */
export const AVAILABLE_MODELS_MAX = 500;

/** `null`/`""` clears the desk default; otherwise a bounded `provider/model` key. */
export function validateDeskModel(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (value === null || value === "") return { ok: true, value: "" };
  if (typeof value !== "string") return { ok: false, error: "deskModel must be a provider/model string or null" };
  if (value.length > DESK_MODEL_MAX_LENGTH) {
    return { ok: false, error: `deskModel must be at most ${DESK_MODEL_MAX_LENGTH} characters` };
  }
  if (!DESK_MODEL_PATTERN.test(value)) return { ok: false, error: "deskModel must look like provider/model" };
  return { ok: true, value };
}

function loadDeskModel(value: unknown): string {
  const checked = validateDeskModel(value);
  return checked.ok ? checked.value : "";
}

/** Validate a PATCH body list: every entry must be a bounded provider/model
 *  key. Dedupe preserves first-seen order; the cap applies after dedupe. */
export function validateAvailableModels(
  value: unknown,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "availableModels must be an array of provider/model keys" };
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length > DESK_MODEL_MAX_LENGTH || !DESK_MODEL_PATTERN.test(item)) {
      return { ok: false, error: "availableModels must contain provider/model keys" };
    }
    if (seen.has(item)) continue;
    seen.add(item);
    deduped.push(item);
  }
  if (deduped.length > AVAILABLE_MODELS_MAX) {
    return { ok: false, error: `availableModels may contain at most ${AVAILABLE_MODELS_MAX} models` };
  }
  return { ok: true, value: deduped };
}

/** State-file upgrade is forgiving: old files have no list, and a corrupt
 *  entry is dropped rather than making the whole controller state unreadable. */
function loadAvailableModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (out.length >= AVAILABLE_MODELS_MAX) break;
    const checked = validateDeskModel(item);
    if (!checked.ok || !checked.value || seen.has(checked.value)) continue;
    seen.add(checked.value);
    out.push(checked.value);
  }
  return out;
}

export function publicState(state: AppState) {
  return {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    appearance: state.appearance,
    connectionUrl: state.connectionUrl,
    connectionUsername: state.connectionUsername,
    hasConnectionPassword: Boolean(state.connectionPassword),
    deskModel: state.deskModel,
    availableModels: state.availableModels,
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}
