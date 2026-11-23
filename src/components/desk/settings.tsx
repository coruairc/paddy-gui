import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  Blocks,
  Bot,
  Folder,
  Info,
  Palette,
  PlugZap,
  Plus,
  Server,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { browserStorage, clearAllLastSessions, forgetProject } from "@/components/desk/last-session";
import { modelSaveFailure } from "@/components/desk/models";
import { createRequestGate } from "@/components/desk/request-gate";
import {
  api,
  type ConnectionStatus,
  type OAuthAttempt,
  type Project,
  type ProviderAuthFormField,
  type ProviderAuthMethod,
  type ProviderDirectoryEntry,
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

/** Desktop nav icons; the native mobile <select> stays unadorned. */
const SECTION_ICONS: Record<Section, LucideIcon> = {
  General: Settings2,
  Connection: PlugZap,
  Providers: Blocks,
  Agents: Bot,
  Permissions: ShieldCheck,
  MCP: Server,
  Projects: Folder,
  Appearance: Palette,
  About: Info,
};

export function SettingsPanel({
  status,
  projects,
  appearance,
  model,
  availableModels = [],
  hasConnectionPassword = false,
  onAppearance,
  onModelChange,
  onAvailableModelsChange,
  onCatalogChange,
  onProjectsChange,
  onAddProject,
  onReconnect,
}: {
  status: ConnectionStatus | null;
  projects: Project[];
  appearance: "dark" | "light";
  model: string;
  /** Curated `provider/model` keys added to the composer picker. */
  availableModels?: string[];
  hasConnectionPassword?: boolean;
  onAppearance: (appearance: "dark" | "light") => void;
  onModelChange: (model: string) => void;
  /** Called only after the controller accepts the new list. */
  onAvailableModelsChange?: (models: string[]) => void;
  /** Invalidate the composer's cached model catalog (providers changed). */
  onCatalogChange?: () => void;
  onProjectsChange: (projects: Project[]) => void;
  onAddProject: (trigger: HTMLElement | null) => void;
  onReconnect: () => void;
}) {
  const [section, setSection] = useState<Section>("General");
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <nav className="hidden w-44 shrink-0 flex-col border-r border-border p-2 sm:flex">
        {SECTIONS.map((item) => {
          const Icon = SECTION_ICONS[item];
          return (
            <button
              key={item}
              type="button"
              className={cn(
                "flex h-10 w-full items-center rounded-xl px-2.5 text-left text-sm transition-colors",
                section === item ? "bg-elevated text-fg" : "text-muted hover:bg-surface hover:text-fg",
              )}
              onClick={() => setSection(item)}
            >
              <Icon className="mr-2 size-4 shrink-0" aria-hidden="true" />
              {item}
            </button>
          );
        })}
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
          {section === "Providers" && (
            <Providers
              model={model}
              onModelChange={onModelChange}
              availableModels={availableModels}
              onAvailableModelsChange={onAvailableModelsChange}
              onCatalogChange={onCatalogChange}
            />
          )}
          {section === "Agents" && <Agents />}
          {section === "Permissions" && <Permissions />}
          {section === "MCP" && <Mcp />}
          {section === "Projects" && <Projects projects={projects} onChange={onProjectsChange} onAdd={onAddProject} />}
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
            void api.reset().then(() => {
              clearAllLastSessions(browserStorage());
              window.location.reload();
            });
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

const PROVIDER_TABS = [
  { id: "configured", label: "Configured" },
  { id: "available", label: "Not configured" },
] as const;

type ProviderTab = (typeof PROVIDER_TABS)[number]["id"];

function Providers({
  model,
  onModelChange,
  availableModels,
  onAvailableModelsChange,
  onCatalogChange,
}: {
  model: string;
  onModelChange: (model: string) => void;
  availableModels: string[];
  onAvailableModelsChange?: (models: string[]) => void;
  onCatalogChange?: () => void;
}) {
  const [providers, setProviders] = useState<RuntimeProvider[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [auth, setAuth] = useState<Record<string, ProviderAuthMethod[]>>({});
  const [connected, setConnected] = useState<string[]>([]);
  /** Keys currently offered by the composer catalog (`/api/models`), or null when unknown. */
  const [pickerKeys, setPickerKeys] = useState<Set<string> | null>(null);
  const [directory, setDirectory] = useState<ProviderDirectoryEntry[] | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  /** A newer catalog refresh (or Retry) supersedes an in-flight one. */
  const [directoryGate] = useState(createRequestGate);
  const [tab, setTab] = useState<ProviderTab>("configured");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tabId = useId();
  const tabRefs = useRef<Record<ProviderTab, HTMLButtonElement | null>>({
    configured: null,
    available: null,
  });

  async function load() {
    setError(null);
    // Providers are the main content; the picker catalog only decides whether a
    // row is already available, so its failure degrades to "unknown".
    const [providersResult, modelsResult] = await Promise.allSettled([api.providers(), api.models()]);
    if (providersResult.status === "fulfilled") {
      const payload = providersResult.value;
      setProviders(payload.providers?.all ?? []);
      setDefaults(payload.providers?.default ?? {});
      setConnected(payload.providers?.connected ?? []);
      setAuth(payload.auth ?? {});
    } else {
      const err = providersResult.reason;
      setError(err instanceof Error ? err.message : "Could not load provider configuration.");
    }
    setPickerKeys(
      modelsResult.status === "fulfilled"
        ? new Set(modelsResult.value.models.map((item) => item.key))
        : null,
    );
    setLoading(false);
  }

  async function loadDirectory() {
    const ticket = directoryGate.begin();
    setDirectoryLoading(true);
    setDirectoryError(null);
    try {
      const payload = await api.providerDirectory();
      if (!directoryGate.isCurrent(ticket)) return;
      setDirectory(payload.directory);
      // The controller returns a retryable catalog error with an empty list;
      // the Configured tab keeps working from its own data (AC-C2).
      setDirectoryError(payload.error ?? null);
    } catch (err) {
      if (!directoryGate.isCurrent(ticket)) return;
      setDirectory([]);
      setDirectoryError(
        err instanceof Error ? err.message : "Could not load the provider catalog.",
      );
    } finally {
      // A stale response leaves loading to the request that superseded it.
      if (directoryGate.isCurrent(ticket)) setDirectoryLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadDirectory();
  }, []);
  useEffect(() => () => directoryGate.invalidate(), [directoryGate]);

  /** A connection can move a provider between tabs, so refresh both sources. */
  function refreshAll() {
    void load();
    void loadDirectory();
    onCatalogChange?.();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const order = PROVIDER_TABS.map((item) => item.id);
    const index = order.indexOf(tab);
    let next: ProviderTab | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = order[(index + 1) % order.length];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = order[(index - 1 + order.length) % order.length];
    } else if (event.key === "Home") {
      next = order[0];
    } else if (event.key === "End") {
      next = order[order.length - 1];
    }
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  const needle = query.trim().toLowerCase();
  const visible = providers
    .filter((provider) =>
      !needle || `${provider.name ?? ""} ${provider.id} ${(provider.env ?? []).join(" ")}`.toLowerCase().includes(needle),
    )
    .sort((a, b) => Number(connected.includes(b.id)) - Number(connected.includes(a.id)) || (a.name ?? a.id).localeCompare(b.name ?? b.id));

  const notConfigured = (directory ?? []).filter((entry) => !entry.configured);
  const unconfiguredVisible = notConfigured.filter(
    (entry) => !needle || `${entry.name} ${entry.id}`.toLowerCase().includes(needle),
  );
  const notConfiguredCount = directoryError ? null : directory ? notConfigured.length : null;
  const configuredCount = loading ? null : providers.length;

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-sm text-muted">
        <p>Configured providers are reported by OpenCode. Not configured providers are supported by OpenCode and listed in its public model catalog. Credentials stay with OpenCode.</p>
        {model && <p>Current desk default: <span className="font-mono text-xs text-fg">{model}</span></p>}
      </div>
      <div
        role="tablist"
        aria-label="Provider status"
        className="flex gap-1 border-b border-border pb-2"
      >
        {PROVIDER_TABS.map((item) => {
          const active = item.id === tab;
          const count = item.id === "configured" ? configuredCount : notConfiguredCount;
          return (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[item.id] = element;
              }}
              type="button"
              role="tab"
              id={`${tabId}-${item.id}-tab`}
              aria-controls={active ? `${tabId}-${item.id}-panel` : undefined}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                active ? "bg-elevated text-fg" : "text-muted hover:bg-surface hover:text-fg",
              )}
              onClick={() => setTab(item.id)}
              onKeyDown={onTabKeyDown}
            >
              {item.label}
              {" "}
              <span className="text-xs text-subtle">{count ?? "…"}</span>
            </button>
          );
        })}
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter providers"
        aria-label="Filter providers"
        className="max-w-md"
      />
      {tab === "configured" ? (
        <div
          role="tabpanel"
          id={`${tabId}-configured-panel`}
          aria-labelledby={`${tabId}-configured-tab`}
          tabIndex={0}
          className="space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {loading && <p role="status" className="text-sm text-muted">Loading providers from OpenCode…</p>}
          {!loading && !visible.length && <p className="text-sm text-muted">No providers match this filter.</p>}
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {visible.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                authMethods={auth[provider.integrationID ?? provider.id] ?? auth[provider.id] ?? []}
                connected={connected.includes(provider.id)}
                defaultModel={defaults[provider.id] ?? ""}
                deskModel={model}
                availableModels={availableModels}
                pickerKeys={pickerKeys}
                onModelChange={onModelChange}
                onAvailableModelsChange={(next) => {
                  onAvailableModelsChange?.(next);
                  onCatalogChange?.();
                }}
                onRefresh={refreshAll}
              />
            ))}
          </div>
        </div>
      ) : (
        <div
          role="tabpanel"
          id={`${tabId}-available-panel`}
          aria-labelledby={`${tabId}-available-tab`}
          tabIndex={0}
          className="space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {directoryLoading && <p role="status" className="text-sm text-muted">Loading the provider catalog…</p>}
          {!directoryLoading && directoryError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-danger">{directoryError}</p>
              <Button size="sm" variant="outline" onClick={() => void loadDirectory()}>
                Retry
              </Button>
            </div>
          )}
          {!directoryLoading && !directoryError && !unconfiguredVisible.length && (
            <p className="text-sm text-muted">
              {needle ? "No providers match this filter." : "Every OpenCode-supported provider is configured."}
            </p>
          )}
          {!directoryError && (
            <div className="grid items-start gap-3 lg:grid-cols-2">
              {unconfiguredVisible.map((entry) => (
                <DirectoryCard key={entry.id} entry={entry} onConnected={refreshAll} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type ProviderModelRow = {
  id: string;
  name: string;
  status?: string;
  providerID: string;
  type?: string;
  enabled?: boolean;
};

function ProviderCard({
  provider,
  authMethods,
  connected,
  defaultModel,
  deskModel,
  availableModels,
  pickerKeys,
  onModelChange,
  onAvailableModelsChange,
  onRefresh,
}: {
  provider: RuntimeProvider;
  authMethods: ProviderAuthMethod[];
  connected: boolean;
  defaultModel: string;
  deskModel: string;
  availableModels: string[];
  pickerKeys: Set<string> | null;
  onModelChange: (model: string) => void;
  onAvailableModelsChange: (models: string[]) => void;
  onRefresh: () => void;
}) {
  const integrationID = provider.integrationID ?? provider.id;
  const models: ProviderModelRow[] = Object.entries(provider.models ?? {}).map(([key, item]) => ({
    id: item.id || key,
    name: item.name || item.id || key,
    status: item.status,
    // OpenCode may list a model under a provider alias; its own providerID is
    // the canonical half of the picker key.
    providerID: item.providerID || provider.id,
    type: item.type,
    enabled: item.enabled,
  }));
  const prefix = `${provider.id}/`;
  const currentForProvider = deskModel.startsWith(prefix) ? deskModel.slice(prefix.length) : "";
  const providerDefault = defaultModel === "[redacted]" ? "" : defaultModel;
  const initialChoice = currentForProvider || providerDefault || models[0]?.id || "";
  const [selected, setSelected] = useState(initialChoice);
  const [modelQuery, setModelQuery] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerNote, setPickerNote] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const [savingPicker, setSavingPicker] = useState(false);

  useEffect(() => setSelected(currentForProvider || providerDefault || models[0]?.id || ""), [currentForProvider, providerDefault, provider.id]);

  const filteredModels = models.filter((item) => {
    const filter = modelQuery.trim().toLowerCase();
    return !filter || `${item.name} ${item.id}`.toLowerCase().includes(filter);
  });
  const selectedModel = models.find((item) => item.id === selected);
  const selectedKey = selectedModel ? `${selectedModel.providerID}/${selectedModel.id}` : "";
  const curated = selectedKey !== "" && availableModels.includes(selectedKey);
  const inPicker = selectedKey !== "" && (pickerKeys?.has(selectedKey) ?? false);
  const addable =
    selectedModel !== undefined && selectedModel.type === "chat" && selectedModel.enabled !== false;

  async function setDeskDefault() {
    if (!selected) return;
    const fullModel = `${provider.id}/${selected}`;
    setSavingModel(true);
    setError(null);
    setNote(null);
    // The desk default persists locally in Paddy state via the settings route;
    // OpenCode v2 has no remote global-config write. Apply it only once the
    // server accepts it, so a rejected key (invalid or disabled) never becomes
    // the active model — the same outcome as the header picker's revert.
    try {
      await api.settings({ deskModel: fullModel });
      onModelChange(fullModel);
      setNote("Desk default model saved.");
    } catch (err) {
      if (modelSaveFailure(err) === "keep-for-turn") {
        onModelChange(fullModel);
        setNote("Model applied for this session only — it could not be saved and will not survive a reload.");
      } else {
        setError(err instanceof Error ? err.message : "That model was rejected.");
      }
    } finally {
      setSavingModel(false);
    }
  }

  async function changeAvailability(add: boolean) {
    if (!selectedKey) return;
    const next = add
      ? Array.from(new Set([...availableModels, selectedKey]))
      : availableModels.filter((key) => key !== selectedKey);
    setSavingPicker(true);
    setPickerError(null);
    setPickerNote(null);
    try {
      await api.settings({ availableModels: next });
      // The parent updates only after the controller accepted the list, so the
      // UI never claims availability the picker will not have.
      onAvailableModelsChange(next);
      setPickerNote(
        add ? "Added to the composer chat picker." : "Removed from the composer chat picker.",
      );
    } catch (err) {
      setPickerError(
        err instanceof Error ? err.message : "Could not update the composer chat picker.",
      );
    } finally {
      setSavingPicker(false);
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
            <ProviderAuthMethods
              integrationID={integrationID}
              providerName={provider.name || provider.id}
              authMethods={authMethods}
              connected={connected}
              onRefresh={onRefresh}
            />
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
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setPickerNote(null);
                    setPickerError(null);
                  }}
                >
                  {filteredModels.slice(0, 100).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.status && item.status !== "active" ? ` · ${item.status}` : ""}
                      {item.enabled === false ? " · disabled" : ""}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="outline" onClick={() => void setDeskDefault()} disabled={!selected || savingModel}>
                  {savingModel ? "Saving…" : currentForProvider === selected ? "Current desk default" : "Use as desk default"}
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  {curated ? (
                    <Button size="sm" variant="outline" onClick={() => void changeAvailability(false)} disabled={savingPicker}>
                      {savingPicker ? "Saving…" : "Remove from chat picker"}
                    </Button>
                  ) : inPicker ? (
                    <span className="text-xs text-subtle">In chat picker</span>
                  ) : pickerKeys === null ? (
                    <span className="text-xs text-subtle">Chat picker list unavailable</span>
                  ) : addable ? (
                    <Button size="sm" variant="outline" onClick={() => void changeAvailability(true)} disabled={savingPicker}>
                      {savingPicker ? "Saving…" : "Add to chat picker"}
                    </Button>
                  ) : (
                    <span className="text-xs text-subtle">
                      {selectedModel?.type !== "chat" ? "Not a chat model" : "Disabled in OpenCode"}
                    </span>
                  )}
                </div>
                {pickerNote && <p role="status" className="text-xs text-ok">{pickerNote}</p>}
                {pickerError && <p role="alert" className="text-xs text-danger">{pickerError}</p>}
              </>
            ) : (
              <div role="note" className="space-y-1 rounded-lg border border-border bg-bg px-3 py-2">
                <p className="flex items-start gap-1.5 text-xs text-warn">
                  <Info size={14} className="mt-px shrink-0" aria-hidden="true" />
                  <span>OpenCode hasn&apos;t loaded any models for this provider.</span>
                </p>
                <p className="text-xs text-muted">
                  This can happen with free or limited subscriptions (for example Copilot Free) or
                  an upstream model-sync issue. Try re-authenticating, or restart OpenCode.
                </p>
              </div>
            )}
          </section>
        </div>
        {note && <p className="text-xs text-ok">{note}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </details>
  );
}

/** Shared auth UI for active and catalog-only provider cards. */
function ProviderAuthMethods({
  integrationID,
  providerName,
  authMethods,
  connected,
  onRefresh,
  emptyHint = "OpenCode reports no interactive authentication methods for this provider.",
  configureHint = "Configure this provider using its OpenCode sign-in method.",
}: {
  integrationID: string;
  providerName: string;
  authMethods: ProviderAuthMethod[];
  connected: boolean;
  onRefresh: () => void;
  emptyHint?: string;
  configureHint?: string;
}) {
  const [keyDraft, setKeyDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const keyMethod = authMethods.some((method) => method.type === "key" || method.type === "api");

  async function saveKey() {
    if (!keyDraft.trim()) return;
    setSavingKey(true);
    setError(null);
    setNote(null);
    try {
      await api.setKey(integrationID, keyDraft.trim());
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
      await api.removeKey(integrationID);
      setNote("Provider credential removed from OpenCode.");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this provider credential.");
    } finally {
      setSavingKey(false);
    }
  }

  return (
    <div className="space-y-2">
      {authMethods.length ? (
        <ul className="space-y-2 text-xs text-muted">
          {authMethods.map((method, index) => (
            <li key={`${method.id ?? method.type ?? "auth"}-${index}`}>
              {method.type === "oauth" ? (
                <OAuthSignIn
                  integrationID={integrationID}
                  method={method}
                  providerName={providerName}
                  onRefresh={onRefresh}
                />
              ) : (
                <div className="space-y-0.5">
                  <p>{method.label || method.type || "Authentication supported"}</p>
                  {method.type === "env" && (
                    <p className="text-subtle">OpenCode reads this credential from the environment.</p>
                  )}
                  {method.type === "external" && (
                    <p className="text-subtle">Sign in through this provider outside Paddy, then reconnect.</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-subtle">{emptyHint}</p>}
      {keyMethod ? (
        <>
          <Input type="password" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder={`API key for ${providerName}`} autoComplete="off" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void saveKey()} disabled={!keyDraft.trim() || savingKey}>
              {savingKey ? "Saving…" : "Save credential"}
            </Button>
            {connected && <Button size="sm" variant="outline" onClick={() => void removeKey()} disabled={savingKey}>Remove credential</Button>}
          </div>
        </>
      ) : null}
      {!keyMethod && !authMethods.some((method) => method.type === "oauth") && (
        <p className="text-xs text-subtle">{configureHint}</p>
      )}
      {note && <p role="status" className="text-xs text-ok">{note}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** One OpenCode-supported provider the user has not configured yet (AC-C4/C5). */
function DirectoryCard({
  entry,
  onConnected,
}: {
  entry: ProviderDirectoryEntry;
  onConnected: () => void;
}) {
  return (
    <details className="group rounded-xl border border-border bg-elevated shadow-[var(--shadow-border)]">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="size-2 shrink-0 rounded-full bg-subtle" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{entry.name}</span>
          <span className="block truncate font-mono text-[11px] text-subtle">{entry.id}</span>
        </span>
        <span className="shrink-0 text-xs text-muted">Not connected</span>
        <span className="shrink-0 text-xs text-subtle">{entry.modelCount} models</span>
        <span className="shrink-0 text-muted transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-2">
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Provider configuration</h3>
            <ProviderAuthMethods
              integrationID={entry.integrationID}
              providerName={entry.name}
              authMethods={entry.auth}
              connected={false}
              onRefresh={onConnected}
              emptyHint="OpenCode reported no authentication methods for this provider."
              configureHint="Configure in OpenCode to use this provider, then reconnect to load its models."
            />
          </section>
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Models</h3>
              <span className="truncate text-[11px] text-subtle">{entry.modelCount} in the catalog</span>
            </div>
            <p className="text-xs text-muted">Connect to load models.</p>
            {entry.models.length ? (
              <details className="text-xs text-subtle">
                <summary className="cursor-pointer">Preview catalog models</summary>
                <ul className="mt-1 space-y-0.5">
                  {entry.models.slice(0, 8).map((item) => (
                    <li key={item.id} className="truncate">{item.name ?? item.id}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px]">
                  {entry.modelCount > 8 ? `Showing 8 of ${entry.modelCount}. ` : ""}
                  Catalog metadata only — models become available after OpenCode connects this provider.
                </p>
              </details>
            ) : null}
          </section>
        </div>
      </div>
    </details>
  );
}

const OAUTH_POLL_MS = 2_000;
const OAUTH_MAX_POLLS = 300;

type OAuthPhase = "idle" | "starting" | "pending" | "complete" | "failed";

/** OpenCode form conditions: hide a field until its `when` matchers pass. */
function fieldVisible(
  field: ProviderAuthFormField,
  answers: Record<string, string | boolean>,
): boolean {
  if (!field.when?.length) return true;
  return field.when.every((condition) => {
    if (!condition.key) return true;
    const value = answers[condition.key];
    const same = (expected: unknown) =>
      value === expected || String(value) === String(expected);
    switch (condition.op) {
      case "eq":
        return same(condition.value);
      case "neq":
        return !same(condition.value);
      case "in":
        return Array.isArray(condition.value) && condition.value.some(same);
      case "not_in":
        return Array.isArray(condition.value) && !condition.value.some(same);
      default:
        // Unknown operator: do not hide a field the user may need.
        return true;
    }
  });
}

function OAuthSignIn({
  integrationID,
  method,
  providerName,
  onRefresh,
}: {
  integrationID: string;
  method: ProviderAuthMethod;
  providerName: string;
  onRefresh: () => void;
}) {
  const fieldId = useId();
  const methodID = method.id ?? "";
  const allFields = (method.form ?? []).filter(
    (field): field is ProviderAuthFormField & { key: string } => Boolean(field.key) && !field.hidden,
  );
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const fields = allFields.filter((field) => fieldVisible(field, answers));
  const [phase, setPhase] = useState<OAuthPhase>("idle");
  const [attempt, setAttempt] = useState<OAuthAttempt | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [completing, setCompleting] = useState(false);
  const timerRef = useRef<number | null>(null);
  const pollCount = useRef(0);
  const attemptRef = useRef<string | null>(null);
  /** True when there is no live attempt the teardown should cancel. */
  const settledRef = useRef(true);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const live = attemptRef.current;
      if (live && !settledRef.current) {
        attemptRef.current = null;
        settledRef.current = true;
        void api.cancelOAuth(integrationID, live).catch(() => undefined);
      }
    };
  }, [integrationID]);

  function stopPolling() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function fieldAnswer(field: (typeof fields)[number]): string | boolean {
    const value = answers[field.key];
    if (value !== undefined) return value;
    if (field.type === "boolean") return false;
    return "";
  }

  function hasAnswer(field: (typeof fields)[number]): boolean {
    const value = fieldAnswer(field);
    return typeof value === "boolean" ? value : value.trim() !== "";
  }

  function answerPayload(): Record<string, unknown> | undefined {
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const value = fieldAnswer(field);
      if (typeof value === "boolean") {
        payload[field.key] = value;
      } else if (value.trim() !== "") {
        payload[field.key] = value.trim();
      }
    }
    return Object.keys(payload).length ? payload : undefined;
  }

  async function poll(attemptID: string) {
    if (!aliveRef.current) return;
    if (pollCount.current >= OAUTH_MAX_POLLS) {
      stopPolling();
      settledRef.current = true;
      attemptRef.current = null;
      setAttempt(null);
      setPhase("failed");
      setError("Sign-in timed out. Try again.");
      void api.cancelOAuth(integrationID, attemptID).catch(() => undefined);
      return;
    }
    pollCount.current += 1;
    try {
      const data = await api.oauthStatus(integrationID, attemptID);
      if (!aliveRef.current || attemptRef.current !== attemptID) return;
      const next = data.attempt;
      if (next.status === "pending") {
        setStatusMessage(next.message || "Waiting for you to finish signing in…");
        // Only one chain may own the timer. A poll that was in flight when
        // complete() replaced the chain must not schedule a second timer (WR-06).
        if (timerRef.current !== null) return;
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          void poll(attemptID);
        }, OAUTH_POLL_MS);
        return;
      }
      stopPolling();
      settledRef.current = true;
      attemptRef.current = null;
      setAttempt(null);
      setCode("");
      if (next.status === "complete") {
        setPhase("complete");
        setStatusMessage("Signed in. Provider and model data refreshed.");
        setError(null);
        setAnswers({});
        onRefresh();
        return;
      }
      setPhase("failed");
      setError(
        next.message ||
          (next.status === "expired"
            ? "This sign-in link expired. Try again."
            : "Sign-in did not complete. Try again."),
      );
    } catch (err) {
      if (!aliveRef.current || attemptRef.current !== attemptID) return;
      stopPolling();
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Could not check sign-in status. Try again.");
    }
  }

  async function start() {
    if (!methodID) {
      setError("OpenCode did not provide a method id for this sign-in.");
      return;
    }
    const missing = fields.some((field) => field.required && !hasAnswer(field));
    if (missing) {
      setError("Fill the required fields before signing in.");
      return;
    }
    stopPolling();
    const previous = attemptRef.current;
    attemptRef.current = null;
    settledRef.current = true;
    if (previous) void api.cancelOAuth(integrationID, previous).catch(() => undefined);
    setAttempt(null);
    setPhase("starting");
    setError(null);
    setStatusMessage(null);
    setCode("");
    setCopied("idle");
    const answer = answerPayload();
    try {
      const data = await api.startOAuth(integrationID, methodID, {
        ...(answer ? { answer } : {}),
        ...(method.label ? { label: method.label } : {}),
      });
      if (!aliveRef.current) {
        void api.cancelOAuth(integrationID, data.attempt.attemptID).catch(() => undefined);
        return;
      }
      attemptRef.current = data.attempt.attemptID;
      settledRef.current = false;
      pollCount.current = 0;
      setAttempt(data.attempt);
      setPhase("pending");
      setStatusMessage("Waiting for you to finish signing in…");
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void poll(data.attempt.attemptID);
      }, OAUTH_POLL_MS);
    } catch (err) {
      if (!aliveRef.current) return;
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Could not start sign-in. Try again.");
    }
  }

  async function complete() {
    if (!attempt || completing) return;
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Enter the authorization code or pasted redirect URL.");
      return;
    }
    setCompleting(true);
    setPhase("pending");
    setError(null);
    setStatusMessage("Verifying sign-in…");
    try {
      await api.completeOAuth(integrationID, attempt.attemptID, trimmed);
      if (!aliveRef.current || attemptRef.current !== attempt.attemptID) return;
      // Replace the scheduled 2s poll: two chains would overwrite timerRef and
      // leave an orphan timer that cancel/unmount cannot clear (WR-06).
      stopPolling();
      setCode("");
      void poll(attempt.attemptID);
    } catch (err) {
      if (!aliveRef.current || attemptRef.current !== attempt.attemptID) return;
      setPhase("pending");
      setError(err instanceof Error ? err.message : "Could not submit that code. Try again.");
      if (timerRef.current === null) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          void poll(attempt.attemptID);
        }, OAUTH_POLL_MS);
      }
    } finally {
      if (aliveRef.current) setCompleting(false);
    }
  }

  async function cancel() {
    const live = attempt?.attemptID ?? attemptRef.current;
    stopPolling();
    attemptRef.current = null;
    settledRef.current = true;
    setAttempt(null);
    setPhase("idle");
    setCode("");
    setError(null);
    setCopied("idle");
    if (!live) {
      setStatusMessage("Sign-in cancelled.");
      return;
    }
    try {
      await api.cancelOAuth(integrationID, live);
      if (aliveRef.current) setStatusMessage("Sign-in cancelled.");
    } catch {
      if (aliveRef.current) setStatusMessage("Sign-in cancelled here; the OpenCode attempt may still expire on its own.");
    }
  }

  async function copyLink() {
    if (!attempt?.url) return;
    try {
      await navigator.clipboard.writeText(attempt.url);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  const busy = phase === "starting" || (phase === "pending" && attempt === null);
  const label = method.label || `Sign in with ${providerName}`;

  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg">{label}</p>
        {phase !== "pending" && phase !== "starting" && (
          <Button size="sm" variant="outline" onClick={() => void start()} disabled={!methodID || busy}>
            {phase === "failed" ? "Try again" : "Sign in"}
          </Button>
        )}
        {phase === "starting" && <span role="status" className="text-xs text-muted">Starting sign-in…</span>}
      </div>

      {fields.length > 0 && !attempt && phase !== "complete" && (
        <div className="mt-2 space-y-2">
          {fields.map((field, index) => {
            const id = `${fieldId}-${index}`;
            const value = fieldAnswer(field);
            const options = field.options?.filter((option) => option.value !== undefined) ?? [];
            return (
              <div key={field.key} className="space-y-1">
                <label htmlFor={id} className="block text-xs text-muted">
                  {field.title || field.key}
                  {field.required ? " *" : ""}
                </label>
                {field.description && <p className="text-[11px] text-subtle">{field.description}</p>}
                {options.length ? (
                  <select
                    id={id}
                    className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-fg"
                    value={typeof value === "boolean" ? "" : value}
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  >
                    <option value="">Select…</option>
                    {options.map((option, optionIndex) => (
                      <option key={optionIndex} value={String(option.value)}>
                        {option.label || String(option.value)}
                      </option>
                    ))}
                  </select>
                ) : field.type === "boolean" ? (
                  <input
                    id={id}
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    checked={value === true}
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [field.key]: event.target.checked }))
                    }
                  />
                ) : (
                  <Input
                    id={id}
                    type={field.type === "password" || field.format === "password" ? "password" : "text"}
                    className="h-8 text-xs"
                    value={typeof value === "boolean" ? "" : value}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {attempt && (
        <div className="mt-2 space-y-2">
          {attempt.instructions && <p className="text-xs text-muted">{attempt.instructions}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {attempt.url && (
              <Button asChild size="sm" variant="outline">
                <a href={attempt.url} target="_blank" rel="noopener noreferrer">
                  Open sign-in
                </a>
              </Button>
            )}
            {attempt.url && (
              <Button size="sm" variant="outline" onClick={() => void copyLink()}>
                Copy link
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void cancel()}>
              Cancel
            </Button>
            {copied === "copied" && <span role="status" className="text-xs text-ok">Copied.</span>}
            {copied === "failed" && (
              <span role="alert" className="text-xs text-danger">Could not copy the link. Open it instead.</span>
            )}
          </div>
          {(attempt.mode === "code" || attempt.paste) && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <label htmlFor={`${fieldId}-code`} className="block text-xs text-muted">
                  {attempt.paste ? "Paste the redirect URL or code" : "Authorization code"}
                </label>
                <Input
                  id={`${fieldId}-code`}
                  className="h-8 text-xs"
                  value={code}
                  autoComplete="off"
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>
              <Button size="sm" onClick={() => void complete()} disabled={!code.trim() || completing}>
                {completing ? "Completing…" : "Complete"}
              </Button>
            </div>
          )}
        </div>
      )}

      {statusMessage && <p role="status" className="mt-1 text-xs text-muted">{statusMessage}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
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

function Projects({
  projects,
  onChange,
  onAdd,
}: {
  projects: Project[];
  onChange: (projects: Project[]) => void;
  onAdd: (trigger: HTMLElement | null) => void;
}) {
  return (
    <div className="space-y-2">
      {/* The dialog itself lives in the desk shell (app.tsx): one add flow,
          one focus-return path, shared with the sidebar trigger. */}
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={(event) => onAdd(event.currentTarget)}>
          <Plus className="size-3.5" aria-hidden />
          Add project
        </Button>
      </div>
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
                void api.removeProject(project.id).then(() => {
                  forgetProject(browserStorage(), project.id);
                  onChange(projects.filter((item) => item.id !== project.id));
                });
              }}
            >
              Remove
            </Button>
          </li>
        ))}
        {!projects.length && <li className="text-subtle">No projects yet.</li>}
      </ul>
    </div>
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
