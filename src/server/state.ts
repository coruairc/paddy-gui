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
};

export const EMPTY_STATE: AppState = {
  projects: [],
  activeProjectId: null,
  appearance: "dark",
  connectionUrl: "",
  connectionUsername: "opencode",
  connectionPassword: "",
  ownedServerPassword: "",
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
  };
}

export function publicState(state: AppState) {
  return {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    appearance: state.appearance,
    connectionUrl: state.connectionUrl,
    connectionUsername: state.connectionUsername,
    hasConnectionPassword: Boolean(state.connectionPassword),
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}
