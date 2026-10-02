/**
 * Local controller runtime: find or start OpenCode, hold the event stream,
 * and keep GUI metadata. The browser never receives the server password.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { accessSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { OpenCodeClient, OpenCodeError } from "./opencode-client.ts";
import { normalizeEvent, type GuiEvent } from "./normalize.ts";
import { readState, stateFilePath, writeState, type AppState } from "./state.ts";

export const CONTROLLER_VERSION = "0.2.0";

export type ConnectionStatus = {
  installed: boolean;
  binary?: string;
  version?: string;
  connected: boolean;
  healthy: boolean;
  url?: string;
  startedByController: boolean;
  authRequired: boolean;
  error?: string;
  controllerVersion: string;
};

type Listener = (event: GuiEvent | { type: "connection"; status: ConnectionStatus }) => void;

export class ControllerRuntime {
  state: AppState;
  readonly stateFile: string;
  status: ConnectionStatus = {
    installed: false,
    connected: false,
    healthy: false,
    startedByController: false,
    authRequired: false,
    controllerVersion: CONTROLLER_VERSION,
  };
  client: OpenCodeClient | null = null;
  private child: ChildProcess | null = null;
  private ownedPassword = "";
  private listeners = new Set<Listener>();
  private loopAbort: AbortController | null = null;
  private connecting: Promise<ConnectionStatus> | null = null;

  constructor(stateFile = stateFilePath()) {
    this.stateFile = stateFile;
    this.state = readState(stateFile);
  }

  persist(): void {
    writeState(this.stateFile, this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener({ type: "connection", status: this.status });
    return () => this.listeners.delete(listener);
  }

  private emit(event: GuiEvent | { type: "connection"; status: ConnectionStatus }): void {
    for (const listener of this.listeners) listener(event);
  }

  private setStatus(patch: Partial<ConnectionStatus>): ConnectionStatus {
    this.status = { ...this.status, ...patch, controllerVersion: CONTROLLER_VERSION };
    this.emit({ type: "connection", status: this.status });
    return this.status;
  }

  detectBinary(): string | null {
    const fromEnv = process.env.OPENCODE_BIN?.trim();
    const candidates = [
      fromEnv,
      which("opencode"),
      join(homedir(), ".opencode", "bin", "opencode"),
      "/usr/local/bin/opencode",
      "/usr/bin/opencode",
    ].filter(Boolean) as string[];
    for (const candidate of candidates) {
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  async connect(): Promise<ConnectionStatus> {
    if (this.connecting) return this.connecting;
    this.connecting = this.connectInner().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connectInner(): Promise<ConnectionStatus> {
    const binary = this.detectBinary();
    this.setStatus({
      installed: Boolean(binary),
      binary: binary ?? undefined,
      error: undefined,
      authRequired: false,
    });
    if (!binary && !this.state.connectionUrl && !process.env.OPENCODE_URL) {
      return this.setStatus({
        installed: false,
        connected: false,
        healthy: false,
        error: "OpenCode is not installed",
      });
    }
    const explicit = (this.state.connectionUrl || process.env.OPENCODE_URL || "").trim();
    if (explicit) {
      return this.attach(explicit, this.credentials(), false);
    }
    const probed = await this.probe("http://127.0.0.1:4096", this.credentials());
    if (probed === "ok") return this.attach("http://127.0.0.1:4096", this.credentials(), false);
    if (probed === "auth") {
      return this.setStatus({
        installed: true,
        connected: false,
        healthy: false,
        url: "http://127.0.0.1:4096",
        authRequired: true,
        error: "OpenCode is running but the controller does not have its password",
      });
    }
    if (!binary) {
      return this.setStatus({ installed: false, connected: false, healthy: false, error: "OpenCode is not installed" });
    }
    const port = await freePort(4096);
    const password = this.ownedPassword || randomPassword();
    this.ownedPassword = password;
    const username = "opencode";
    await this.spawnServer(binary, port, username, password);
    const ready = await this.waitUntilReady(`http://127.0.0.1:${port}`, { username, password });
    if (!ready) {
      return this.setStatus({
        installed: true,
        connected: false,
        healthy: false,
        url: `http://127.0.0.1:${port}`,
        startedByController: true,
        error: "OpenCode did not become ready. Check that the binary can start, then reconnect.",
      });
    }
    return this.attach(`http://127.0.0.1:${port}`, { username, password }, true);
  }

  private credentials(): { username: string; password: string } {
    return {
      username: this.state.connectionUsername || process.env.OPENCODE_SERVER_USERNAME || "opencode",
      password: this.state.connectionPassword || process.env.OPENCODE_SERVER_PASSWORD || this.ownedPassword || "",
    };
  }

  private async attach(
    url: string,
    auth: { username: string; password: string },
    startedByController: boolean,
  ): Promise<ConnectionStatus> {
    const client = new OpenCodeClient({ baseUrl: url, username: auth.username, password: auth.password });
    try {
      const health = await client.getStatus();
      this.client?.disconnect();
      this.client = client;
      this.startEventLoop();
      return this.setStatus({
        installed: true,
        connected: true,
        healthy: health.healthy !== false,
        version: health.version,
        url,
        startedByController,
        authRequired: false,
        error: undefined,
      });
    } catch (err) {
      const authRequired = err instanceof OpenCodeError && err.status === 401;
      return this.setStatus({
        installed: true,
        connected: false,
        healthy: false,
        url,
        startedByController,
        authRequired,
        error: err instanceof Error ? err.message : "OpenCode is unavailable",
      });
    }
  }

  private async probe(url: string, auth: { username: string; password: string }): Promise<"ok" | "auth" | "down"> {
    const client = new OpenCodeClient({ baseUrl: url, username: auth.username, password: auth.password });
    try {
      await client.getStatus();
      return "ok";
    } catch (err) {
      if (err instanceof OpenCodeError && err.status === 401) return "auth";
      return "down";
    }
  }

  private async waitUntilReady(url: string, auth: { username: string; password: string }): Promise<boolean> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const probed = await this.probe(url, auth);
      if (probed === "ok") return true;
      await sleep(250);
    }
    return false;
  }

  private spawnServer(binary: string, port: number, username: string, password: string): Promise<void> {
    if (this.child && !this.child.killed) return Promise.resolve();
    return new Promise((resolvePromise, reject) => {
      const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
        env: {
          ...process.env,
          OPENCODE_SERVER_USERNAME: username,
          OPENCODE_SERVER_PASSWORD: password,
        },
        stdio: "ignore",
      });
      this.child = child;
      const timer = setTimeout(() => resolvePromise(), 600);
      child.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.once("exit", (code) => {
        if (this.child === child) this.child = null;
        this.setStatus({
          connected: false,
          healthy: false,
          startedByController: false,
          error: `OpenCode exited (${code ?? "signal"})`,
        });
      });
    });
  }

  private startEventLoop(): void {
    this.loopAbort?.abort();
    const abort = new AbortController();
    this.loopAbort = abort;
    void this.eventLoop(abort.signal);
  }

  private async eventLoop(signal: AbortSignal): Promise<void> {
    let delay = 500;
    while (!signal.aborted) {
      const client = this.client;
      if (!client) return;
      try {
        await client.subscribeToEvents((raw) => {
          const normalized = normalizeEvent(raw);
          if (normalized) this.emit(normalized);
        }, signal);
        if (signal.aborted) return;
        this.setStatus({ connected: false, healthy: false, error: "Connection lost" });
      } catch (err) {
        if (signal.aborted) return;
        this.setStatus({
          connected: false,
          healthy: false,
          error: err instanceof Error ? err.message : "Connection lost",
        });
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 15_000);
      if (signal.aborted) return;
      try {
        await client.getStatus();
        this.setStatus({ connected: true, healthy: true, error: undefined });
        delay = 500;
      } catch {
        /* keep backing off */
      }
    }
  }

  async disconnect(): Promise<ConnectionStatus> {
    this.loopAbort?.abort();
    this.client?.disconnect();
    this.client = null;
    if (this.child && !this.child.killed) {
      this.child.kill();
      this.child = null;
    }
    return this.setStatus({
      connected: false,
      healthy: false,
      startedByController: false,
      error: undefined,
    });
  }

  requireClient(): OpenCodeClient {
    if (!this.client || !this.status.connected) {
      throw new OpenCodeError(503, this.status.error || "OpenCode is unavailable", true);
    }
    return this.client;
  }
}

function randomPassword(): string {
  return `ocw_${randomBytes(24).toString("hex")}`;
}

function which(command: string): string | null {
  try {
    const found = execFileSync("which", [command], { encoding: "utf8" }).trim();
    return found || null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function freePort(preferred: number): Promise<number> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => {
      const fallback = createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const address = fallback.address();
        const port = typeof address === "object" && address ? address.port : preferred;
        fallback.close(() => resolvePromise(port));
      });
    });
    server.listen(preferred, "127.0.0.1", () => {
      server.close(() => resolvePromise(preferred));
    });
  });
}

let singleton: ControllerRuntime | null = null;

export function getRuntime(): ControllerRuntime {
  if (!singleton) singleton = new ControllerRuntime();
  return singleton;
}
