import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  api,
  type ConnectionStatus,
  type Project,
  type ProviderAuthMethod,
  type RuntimeProvider,
} from "@/lib/desk/client";

const SECTIONS = [
  "General",
  "Connection",
  "Providers",
  "Agents",
  "Permissions",
  "MCP",
  "Projects",
  "Appearance",
  "About",
] as const;

type Section = (typeof SECTIONS)[number];

export function SettingsPanel({
  status,
  projects,
  appearance,
  model,
  hasConnectionPassword = false,
  onAppearance,
  onModelChange,
  onProjectsChange,
  onReconnect,
}: {
  status: ConnectionStatus | null;
  projects: Project[];
  appearance: "dark" | "light";
  model: string;
  hasConnectionPassword?: boolean;
  onAppearance: (appearance: "dark" | "light") => void;
  onModelChange: (model: string) => void;
  onProjectsChange: (projects: Project[]) => void;
  onReconnect: () => void;
}) {
  const [section, setSection] = useState<Section>("General");
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <nav className="hidden w-44 shrink-0 flex-col border-r border-border p-2 sm:flex">
        {SECTIONS.map((item) => (
          <button
            key={item}
            type="button"
            className={cn(
              "flex h-10 w-full items-center rounded-xl px-2.5 text-left text-sm transition-colors",
              section === item ? "bg-elevated text-fg" : "text-muted hover:bg-surface hover:text-fg",
            )}
            onClick={() => setSection(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="scrollbar-thin min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-2xl">
          <p className="font-display text-3xl tracking-tight">{section}</p>
          <div className="mt-4 sm:hidden">
            <select className="h-10 w-full rounded-md border border-border bg-surface px-2 text-sm" value={section} onChange={(event) => setSection(event.target.value as Section)}>
              {SECTIONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="mt-5">
          {section === "General" && <General status={status} />}
          {section === "Connection" && <Connection status={status} onReconnect={onReconnect} hasConnectionPassword={hasConnectionPassword} />}
          {section === "Providers" && <Providers model={model} onModelChange={onModelChange} />}
          {section === "Agents" && <Agents />}
          {section === "Permissions" && <Permissions />}
          {section === "MCP" && <Mcp />}
          {section === "Projects" && <Projects projects={projects} onChange={onProjectsChange} />}
          {section === "Appearance" && (
            <Appearance
              appearance={appearance}
              onChange={(value) => {
                onAppearance(value);
                void api.settings({ appearance: value });
              }}
            />
          )}
          {section === "About" && <About status={status} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function General({ status }: { status: ConnectionStatus | null }) {
  return (
    <div className="space-y-3 text-sm text-muted">
      <p>Paddy is the desk. The runtime on this computer does the work. Chats, models, and tools stay there — this screen only steers them.</p>
      <p>Status: {status?.connected ? "connected" : status?.error || "not connected"}</p>
      <Button
        variant="outline"
        onClick={() => {
          if (window.confirm("Reset local GUI settings? OpenCode configuration and chats are left alone.")) {
            void api.reset().then(() => window.location.reload());
          }
        }}
      >
        Reset local application settings
      </Button>
    </div>
  );
}

function Connection({ status, onReconnect, hasConnectionPassword = false }: { status: ConnectionStatus | null; onReconnect: () => void; hasConnectionPassword?: boolean }) {
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("opencode");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="max-w-md space-y-3 text-sm">
      <p className="text-muted">Leave the URL empty to use or start OpenCode on this computer. A password is stored only by the controller.</p>
      <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:4096" />
      <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" />
      <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={hasConnectionPassword ? "•••• (stored)" : "Server password"} autoComplete="off" />
      <div className="flex gap-2">
        <Button
          onClick={() => {
            void api.settings({ connectionUrl: url, connectionUsername: username, connectionPassword: password }).then(() => {
              setPassword("");
              setNote("Saved. Reconnect to apply.");
            });
          }}
        >
          Save
        </Button>
        {hasConnectionPassword && (
          <Button
            variant="outline"
            onClick={() => {
              if (window.confirm("Clear the stored OpenCode password?")) {
                void api.settings({ clearConnectionPassword: true }).then(() => {
                  setNote("Password cleared.");
                });
              }
            }}
          >
            Clear password
          </Button>
        )}
        <Button variant="outline" onClick={onReconnect}>Reconnect</Button>
      </div>
      {note && <p className="text-ok">{note}</p>}
      {status?.authRequired && <p className="text-warn">OpenCode is running, but this controller needs its password.</p>}
      {!status?.installed && <p className="text-danger">OpenCode was not found on PATH. Install it, then reconnect.</p>}
    </div>
  );
}

function Providers({ model, onModelChange }: { model: string; onModelChange: (model: string) => void }) {
  const [providers, setProviders] = useState<RuntimeProvider[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [auth, setAuth] = useState<Record<string, ProviderAuthMethod[]>>({});
  const [connected, setConnected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const payload = await api.providers();
      setProviders(payload.providers?.all ?? []);
      setDefaults(payload.providers?.default ?? {});
      setConnected(payload.providers?.connected ?? []);
      setAuth(payload.auth ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load provider configuration.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const needle = query.trim().toLowerCase();
  const visible = providers
    .filter((provider) =>
      !needle || `${provider.name ?? ""} ${provider.id} ${(provider.env ?? []).join(" ")}`.toLowerCase().includes(needle),
    )
    .sort((a, b) => Number(connected.includes(b.id)) - Number(connected.includes(a.id)) || (a.name ?? a.id).localeCompare(b.name ?? b.id));

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-sm text-muted">
        <p>Each provider below is reported by OpenCode. Credentials stay with OpenCode; selecting a model sets the desk default.</p>
        {model && <p>Current desk default: <span className="font-mono text-xs text-fg">{model}</span></p>}
      </div>
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter providers" className="max-w-md" />
      {error && <p className="text-sm text-danger">{error}</p>}
      {loading && <p className="text-sm text-muted">Loading providers from OpenCode…</p>}
      {!loading && !visible.length && <p className="text-sm text-muted">No providers match this filter.</p>}
      <div className="space-y-3">
        {visible.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            authMethods={auth[provider.id] ?? []}
            connected={connected.includes(provider.id)}
            defaultModel={defaults[provider.id] ?? ""}
            deskModel={model}
            onModelChange={onModelChange}
            onRefresh={() => void load()}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  authMethods,
  connected,
  defaultModel,
  deskModel,
  onModelChange,
  onRefresh,
}: {
  provider: RuntimeProvider;
  authMethods: ProviderAuthMethod[];
  connected: boolean;
  defaultModel: string;
  deskModel: string;
  onModelChange: (model: string) => void;
  onRefresh: () => void;
}) {
  const models = Object.entries(provider.models ?? {}).map(([key, item]) => ({
    id: item.id || key,
    name: item.name || item.id || key,
    status: item.status,
  }));
  const prefix = `${provider.id}/`;
  const currentForProvider = deskModel.startsWith(prefix) ? deskModel.slice(prefix.length) : "";
  const providerDefault = defaultModel === "[redacted]" ? "" : defaultModel;
  const initialChoice = currentForProvider || providerDefault || models[0]?.id || "";
  const [selected, setSelected] = useState(initialChoice);
  const [modelQuery, setModelQuery] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  useEffect(() => setSelected(currentForProvider || providerDefault || models[0]?.id || ""), [currentForProvider, providerDefault, provider.id]);

  const apiAuth = authMethods.some((method) => method.type === "api");
  const filteredModels = models.filter((item) => {
    const filter = modelQuery.trim().toLowerCase();
    return !filter || `${item.name} ${item.id}`.toLowerCase().includes(filter);
  });

  async function saveKey() {
    if (!keyDraft.trim()) return;
    setSavingKey(true);
    setError(null);
    setNote(null);
    try {
      await api.setKey(provider.id, keyDraft.trim());
      setKeyDraft("");
      setNote("Credential saved in OpenCode.");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this provider credential.");
    } finally {
      setSavingKey(false);
    }
  }

  async function removeKey() {
    setSavingKey(true);
    setError(null);
    setNote(null);
    try {
      await api.removeKey(provider.id);
      setNote("Provider credential removed from OpenCode.");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this provider credential.");
    } finally {
      setSavingKey(false);
    }
  }

  async function setDeskDefault() {
    if (!selected) return;
    const fullModel = `${provider.id}/${selected}`;
    setSavingModel(true);
    setError(null);
    setNote(null);
    // The desk default persists locally in Paddy state via the settings route;
    // OpenCode v2 has no remote global-config write. Update the desk model
    // first so the choice takes effect immediately, then persist it for real.
    onModelChange(fullModel);
    try {
      await api.settings({ deskModel: fullModel });
      setNote("Desk default model saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the desk default model.");
    } finally {
      setSavingModel(false);
    }
  }

  return (
    <details className="group rounded-xl border border-border bg-elevated shadow-[var(--shadow-border)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className={cn("size-2 shrink-0 rounded-full", connected ? "bg-ok" : "bg-subtle")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{provider.name || provider.id}</span>
          <span className="block truncate font-mono text-[11px] text-subtle">{provider.id}</span>
        </span>
        <span className="shrink-0 text-xs text-muted">{connected ? "Connected" : "Not connected"}</span>
        <span className="shrink-0 text-xs text-subtle">{models.length} models</span>
        <span className="shrink-0 text-muted transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-2">
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Provider configuration</h3>
            {provider.env?.length ? (
              <p className="text-xs text-subtle">OpenCode environment keys: <span className="font-mono">{provider.env.join(", ")}</span></p>
            ) : null}
            {authMethods.length ? (
              <ul className="space-y-1 text-xs text-muted">
                {authMethods.map((method, index) => (
                  <li key={`${method.type ?? "auth"}-${index}`}>{method.label || method.type || "Authentication supported"}</li>
                ))}
              </ul>
            ) : <p className="text-xs text-subtle">OpenCode reports no interactive authentication methods for this provider.</p>}
            {apiAuth ? (
              <>
                <Input type="password" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder={`API key for ${provider.name || provider.id}`} autoComplete="off" />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void saveKey()} disabled={!keyDraft.trim() || savingKey}>
                    {savingKey ? "Saving…" : "Save credential"}
                  </Button>
                  {connected && <Button size="sm" variant="outline" onClick={() => void removeKey()} disabled={savingKey}>Remove credential</Button>}
                </div>
              </>
            ) : (
              <p className="text-xs text-subtle">Configure this provider using its OpenCode sign-in method.</p>
            )}
          </section>
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Models</h3>
              {providerDefault && <span className="truncate text-[11px] text-subtle">OpenCode default: {providerDefault}</span>}
            </div>
            {models.length ? (
              <>
                {models.length > 12 && <Input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder={`Filter ${models.length} models`} className="h-8 text-xs" />}
                <select
                  size={Math.min(6, Math.max(3, filteredModels.length))}
                  className="w-full rounded-lg border border-border bg-bg p-1 text-xs"
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                >
                  {filteredModels.slice(0, 100).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}{item.status && item.status !== "active" ? ` · ${item.status}` : ""}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="outline" onClick={() => void setDeskDefault()} disabled={!selected || savingModel}>
                  {savingModel ? "Saving…" : currentForProvider === selected ? "Current desk default" : "Use as desk default"}
                </Button>
              </>
            ) : <p className="text-xs text-subtle">OpenCode reports no models for this provider.</p>}
          </section>
        </div>
        {note && <p className="text-xs text-ok">{note}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </details>
  );
}

function Agents() {
  const [agents, setAgents] = useState<{ name: string; description?: string; prompt?: string; temperature?: number; model?: { providerID?: string; modelID?: string } }[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void api.agents().then((payload) => {
      if (!Array.isArray(payload)) return;
      setAgents(payload as typeof agents);
      const first = payload[0] as { name?: string; prompt?: string; model?: { providerID?: string; modelID?: string } } | undefined;
      if (first?.name) {
        setName(first.name);
        setPrompt(first.prompt ?? "");
        setModel(first.model?.providerID && first.model.modelID ? `${first.model.providerID}/${first.model.modelID}` : "");
      }
    }).catch((err: Error) => setNote(err.message));
  }, []);
  const current = agents.find((item) => item.name === name);
  return (
    <div className="max-w-lg space-y-3 text-sm">
      <p className="text-muted">Agents are defined in OpenCode configuration and shown here read-only. Edit them in your OpenCode config.</p>
      <select className="h-9 w-full rounded-lg border border-border bg-bg px-2" value={name} onChange={(event) => {
        const next = agents.find((item) => item.name === event.target.value);
        setName(event.target.value);
        setPrompt(next?.prompt ?? "");
        setModel(next?.model?.providerID && next.model.modelID ? `${next.model.providerID}/${next.model.modelID}` : "");
      }}>
        {agents.map((item) => (
          <option key={item.name} value={item.name}>{item.name}</option>
        ))}
      </select>
      {current?.description && <p className="text-subtle">{current.description}</p>}
      <textarea value={prompt} readOnly rows={6} className="w-full rounded-lg border border-border bg-bg p-2 font-mono text-xs" placeholder="No instructions set in OpenCode" />
      <Input value={model} readOnly placeholder="No model set in OpenCode" />
      {note && <p className="text-muted">{note}</p>}
    </div>
  );
}

function Permissions() {
  const keys = ["edit", "bash", "webfetch", "doom_loop", "external_directory"] as const;
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void api.config().then((config) => {
      const permission = (config.permission ?? {}) as Record<string, unknown>;
      const next: Record<string, string> = {};
      for (const key of keys) {
        const value = permission[key];
        next[key] = typeof value === "string" ? value : "ask";
      }
      setValues(next);
    }).catch((err: Error) => setNote(err.message));
  }, []);
  return (
    <div className="max-w-lg space-y-3 text-sm">
      <p className="text-muted">These are OpenCode's permission defaults. Live prompts still appear in the chat and are never auto-approved.</p>
      <p className="text-muted">Permission defaults come from OpenCode configuration and are read-only here.</p>
      {keys.map((key) => (
        <div key={key} className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs">{key}</span>
          <span className="rounded-md border border-border bg-elevated px-2 py-1 font-mono text-xs text-fg">{values[key] ?? "ask"}</span>
        </div>
      ))}
      {note && <p className="text-muted">{note}</p>}
    </div>
  );
}

function Mcp() {
  const [servers, setServers] = useState<Record<string, { status?: string; error?: string }>>({});
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [note, setNote] = useState<string | null>(null);
  async function load() {
    const payload = await api.mcp();
    setServers((payload ?? {}) as typeof servers);
  }
  useEffect(() => {
    void load().catch((err: Error) => setNote(err.message));
  }, []);
  return (
    <div className="max-w-lg space-y-3 text-sm">
      <ul className="space-y-2">
        {Object.entries(servers).map(([id, info]) => (
          <li key={id} className="rounded-lg border border-border px-3 py-2">
            <div className="flex items-center justify-between">
              <span>{id}</span>
              <span className="text-xs text-subtle">{info.status || "unknown"}</span>
            </div>
            {info.error && <p className="mt-1 text-xs text-danger">{info.error}</p>}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void api.mcpAction(id, "connect").then(load)}>Enable</Button>
              <Button size="sm" variant="outline" onClick={() => void api.mcpAction(id, "disable").then(load)}>Disable</Button>
            </div>
          </li>
        ))}
        {!Object.keys(servers).length && <li className="text-subtle">No MCP servers configured.</li>}
      </ul>
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Server name" />
      <Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="command arg arg" />
      <Button
        onClick={() => {
          const parts = command.trim().split(/\s+/).filter(Boolean);
          if (!name || !parts.length) return;
          void api.addMcp(name, { type: "local", command: parts, enabled: true }).then(() => {
            setName("");
            setCommand("");
            setNote("MCP server added through OpenCode.");
            return load();
          }).catch((err: Error) => setNote(err.message));
        }}
      >
        Add MCP server
      </Button>
      {note && <p className="text-muted">{note}</p>}
    </div>
  );
}

function Projects({ projects, onChange }: { projects: Project[]; onChange: (projects: Project[]) => void }) {
  return (
    <ul className="space-y-2 text-sm">
      {projects.map((project) => (
        <li key={project.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <div className="min-w-0">
            <div>{project.name}</div>
            <div className="truncate text-xs text-subtle">{project.path}</div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void api.removeProject(project.id).then(() => onChange(projects.filter((item) => item.id !== project.id)));
            }}
          >
            Remove
          </Button>
        </li>
      ))}
      {!projects.length && <li className="text-subtle">No projects yet. Add one from the sidebar.</li>}
    </ul>
  );
}

function Appearance({ appearance, onChange }: { appearance: "dark" | "light"; onChange: (value: "dark" | "light") => void }) {
  return (
    <div className="flex gap-2">
      {(["dark", "light"] as const).map((value) => (
        <Button key={value} variant={appearance === value ? "default" : "outline"} onClick={() => onChange(value)}>
          {value}
        </Button>
      ))}
    </div>
  );
}

function About({ status }: { status: ConnectionStatus | null }) {
  const [diag, setDiag] = useState<string>("");
  return (
    <div className="space-y-2 text-sm text-muted">
      <p>Paddy {status?.controllerVersion ?? "0.2.0"}</p>
      <p>Runtime {status?.version ?? "not connected"}</p>
      <p>A local desk for the coding agent on this computer.</p>
      <Button size="sm" variant="outline" onClick={() => void api.diagnostics().then((data) => setDiag(JSON.stringify(data, null, 2)))}>
        Diagnostics
      </Button>
      {diag && <pre className="max-h-48 overflow-auto rounded-lg bg-bg p-3 text-xs">{diag}</pre>}
    </div>
  );
}
