import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api, type ConnectionStatus, type Project } from "@/lib/desk/client";

const SECTIONS = [
  "General",
  "Connection",
  "Providers",
  "Models",
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
  onAppearance,
  onProjectsChange,
  onReconnect,
}: {
  status: ConnectionStatus | null;
  projects: Project[];
  appearance: "dark" | "light";
  onAppearance: (appearance: "dark" | "light") => void;
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
          {section === "Connection" && <Connection status={status} onReconnect={onReconnect} />}
          {section === "Providers" && <Providers />}
          {section === "Models" && <Models />}
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

function Connection({ status, onReconnect }: { status: ConnectionStatus | null; onReconnect: () => void }) {
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("opencode");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="max-w-md space-y-3 text-sm">
      <p className="text-muted">Leave the URL empty to use or start OpenCode on this computer. A password is stored only by the controller.</p>
      <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:4096" />
      <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" />
      <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Server password" autoComplete="off" />
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
        <Button variant="outline" onClick={onReconnect}>Reconnect</Button>
      </div>
      {note && <p className="text-ok">{note}</p>}
      {status?.authRequired && <p className="text-warn">OpenCode is running, but this controller needs its password.</p>}
      {!status?.installed && <p className="text-danger">OpenCode was not found on PATH. Install it, then reconnect.</p>}
    </div>
  );
}

function Providers() {
  const [auth, setAuth] = useState<Record<string, { type?: string; label?: string }[]>>({});
  const [connected, setConnected] = useState<string[]>([]);
  const [provider, setProvider] = useState("");
  const [key, setKey] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const payload = await api.providers();
    const methods = (payload.auth ?? {}) as Record<string, { type?: string; label?: string }[]>;
    setAuth(methods);
    const list = payload.providers as { connected?: string[] } | null;
    setConnected(list?.connected ?? []);
    setProvider((current) => current || Object.keys(methods)[0] || "");
  }

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
  }, []);

  const ids = Object.keys(auth);
  return (
    <div className="max-w-lg space-y-3 text-sm">
      <p className="text-muted">Providers come from the installed OpenCode. Keys are sent to OpenCode and are not kept in the browser.</p>
      {error && <p className="text-danger">{error}</p>}
      <ul className="space-y-1">
        {ids.map((id) => (
          <li key={id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <span>{id}</span>
            <span className="text-xs text-subtle">{connected.includes(id) ? "Connected" : "Not connected"}</span>
          </li>
        ))}
        {!ids.length && <li className="text-subtle">No provider auth methods reported yet.</li>}
      </ul>
      <select className="h-9 w-full rounded-lg border border-border bg-bg px-2" value={provider} onChange={(event) => setProvider(event.target.value)}>
        {ids.map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>
      <Input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="API key" autoComplete="off" />
      <div className="flex gap-2">
        <Button
          onClick={() => {
            setError(null);
            void api.setKey(provider, key).then(() => {
              setKey("");
              setNote("Saved in OpenCode.");
              return load();
            }).catch((err: Error) => setError(err.message));
          }}
          disabled={!provider || !key}
        >
          Save key
        </Button>
        <Button variant="outline" onClick={() => void api.removeKey(provider).then(load).catch((err: Error) => setError(err.message))} disabled={!provider}>
          Remove
        </Button>
      </div>
      {note && <p className="text-ok">{note}</p>}
    </div>
  );
}

function Models() {
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void api.providers().then((payload) => {
      const record = payload.providers as { all?: { id?: string; models?: Record<string, { id?: string }> }[] } | null;
      const ids: string[] = [];
      for (const provider of record?.all ?? []) {
        if (!provider.id) continue;
        for (const model of Object.values(provider.models ?? {})) {
          if (model.id) ids.push(`${provider.id}/${model.id}`);
        }
      }
      setModels(ids);
    }).catch(() => setModels([]));
    void api.config().then((config) => {
      if (typeof config.model === "string") setSelected(config.model);
    }).catch(() => undefined);
  }, []);
  return (
    <div className="max-w-lg space-y-3 text-sm">
      <p className="text-muted">The list is whatever OpenCode currently exposes. Saving updates OpenCode configuration.</p>
      <select className="h-9 w-full rounded-lg border border-border bg-bg px-2" value={selected} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Select a model</option>
        {models.map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button onClick={() => void api.patchConfig({ model: selected }).then(() => setNote("Default model saved.")).catch((err: Error) => setNote(err.message))} disabled={!selected}>
          Set default
        </Button>
        <Button variant="outline" onClick={() => void api.patchConfig({ model: selected }, "project").then(() => setNote("Project model saved.")).catch((err: Error) => setNote(err.message))} disabled={!selected}>
          Set for this project
        </Button>
      </div>
      {note && <p className="text-muted">{note}</p>}
    </div>
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
      const first = payload[0] as { name?: string; prompt?: string } | undefined;
      if (first?.name) {
        setName(first.name);
        setPrompt(first.prompt ?? "");
      }
    }).catch((err: Error) => setNote(err.message));
  }, []);
  const current = agents.find((item) => item.name === name);
  return (
    <div className="max-w-lg space-y-3 text-sm">
      <p className="text-muted">Only fields OpenCode already supports are shown. Saving writes the agent block back through OpenCode config.</p>
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
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} className="w-full rounded-lg border border-border bg-bg p-2 font-mono text-xs" placeholder="Agent instructions" />
      <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="provider/model" />
      <Button
        onClick={() => {
          if (!name) return;
          const agent: Record<string, unknown> = {};
          if (prompt) agent.prompt = prompt;
          if (model) agent.model = model;
          void api.patchConfig({ agent: { [name]: agent } }).then(() => setNote("Agent saved.")).catch((err: Error) => setNote(err.message));
        }}
      >
        Save agent
      </Button>
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
      {keys.map((key) => (
        <label key={key} className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs">{key}</span>
          <select className="h-8 rounded-md border border-border bg-bg px-2" value={values[key] ?? "ask"} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}>
            <option value="ask">ask</option>
            <option value="allow">allow</option>
            <option value="deny">deny</option>
          </select>
        </label>
      ))}
      <Button onClick={() => void api.patchConfig({ permission: values }).then(() => setNote("Permissions saved.")).catch((err: Error) => setNote(err.message))}>
        Save permissions
      </Button>
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
