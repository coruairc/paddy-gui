import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FolderGit2, Plus, Search, Settings, Square } from "lucide-react";
import { HelixMark } from "@/components/helix-mark";
import { Markdown } from "@/components/markdown";
import { PaddyIdle } from "@/components/paddy-idle";
import { SettingsPanel } from "@/components/desk/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatTime } from "@/lib/utils";
import {
  api,
  type ActivityItem,
  type Bootstrap,
  type ChatMessage,
  type ConnectionStatus,
  type DeskEvent,
  type DiffFile,
  type PermissionPrompt,
  type Project,
  type SessionSummary,
} from "@/lib/desk/client";

export function DeskApp() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverPassword, setServerPassword] = useState("");
  const [prompts, setPrompts] = useState<PermissionPrompt[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inspector, setInspector] = useState<"work" | "changes">("work");
  const [branch, setBranch] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [agent, setAgent] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [stick, setStick] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const [selectedDiff, setSelectedDiff] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;

  const project = projects.find((item) => item.id === activeProjectId) ?? null;

  const applyEvent = useCallback((event: DeskEvent) => {
    if (event.type === "connection") {
      setStatus(event.status);
      if (!event.status.connected) {
        setWorking(false);
        if (event.status.error) setError(event.status.error);
      }
      if (event.status.connected) setError(null);
      return;
    }
    if (event.type === "error") {
      setError(event.message);
      setWorking(false);
      return;
    }
    if (event.type === "malformed") return;
    if (event.type === "permission") {
      setPrompts((current) => (current.some((item) => item.id === event.prompt.id) ? current : [...current, event.prompt]));
      return;
    }
    if (event.type === "permission-cleared") {
      setPrompts((current) => current.filter((item) => item.id !== event.id));
      return;
    }
    if (event.type === "session") {
      setSessions((current) => upsertSession(current, event.session));
      return;
    }
    if (event.type === "session-deleted") {
      setSessions((current) => current.filter((item) => item.id !== event.id));
      return;
    }
    if (event.type === "status") {
      const current = sessionRef.current;
      if (current && event.sessionId && current !== event.sessionId) return;
      setWorking(event.state === "working" || event.state === "retry");
      if (event.state === "error" && event.detail) setError(event.detail);
      if (event.state === "idle") setWorking(false);
      return;
    }
    if (event.type === "diff") {
      setSessionId((current) => {
        if (!current || current === event.sessionId) setFiles(event.files);
        return current;
      });
      return;
    }
    setSessionId((current) => {
      if (!current || ("sessionId" in event && event.sessionId !== current)) return current;
      if (event.type === "text-delta") {
        setMessages((list) => appendDelta(list, event.messageId, event.delta));
        setWorking(true);
      } else if (event.type === "activity") {
        setMessages((list) => upsertActivity(list, event.messageId, event.item));
        setWorking(true);
        setInspector("work");
      } else if (event.type === "message") {
        setMessages((list) => mergeMessage(list, event.message));
      }
      return current;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | undefined;
    void api.bootstrap().then((data) => {
      if (cancelled) return;
      setBoot(data);
      setStatus(data.status);
      setProjects(data.projects);
      setActiveProjectId(data.activeProjectId);
      setSessions(data.sessions);
      setModel(data.model);
      document.documentElement.dataset.theme = data.appearance;
      if (data.status.error && !data.status.connected) setError(data.status.error);
      if (window.location.search.includes("token=")) {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      }
      const stream = new EventSource("/api/events");
      source = stream;
      stream.onmessage = (message) => {
        try {
          applyEvent(JSON.parse(message.data) as DeskEvent);
        } catch {
          /* ignore malformed frames */
        }
      };
      stream.onerror = () => setError((current) => current ?? "Lost the desk connection. Reconnecting…");
      stream.addEventListener("error", () => {
        if (stream.readyState === EventSource.CLOSED) stream.close();
      });
    }).catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [applyEvent]);

  useEffect(() => {
    if (!project || !status?.connected) return;
    void api.vcs().then((info) => setBranch(info.branch ?? null)).catch(() => setBranch(null));
    void api.providers().then((payload) => setModels(modelIds(payload.providers))).catch(() => setModels([]));
    void api.agents().then((payload) => setAgents(agentNames(payload))).catch(() => setAgents([]));
  }, [project, status?.connected]);

  useEffect(() => {
    if (!stick) return;
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, working, prompts, stick]);

  const groups = useMemo(() => groupByDate(sessions.filter((item) => !item.archived && matches(item, query))), [sessions, query]);
  const active = sessions.find((item) => item.id === sessionId) ?? null;
  const liveActivity = messages.flatMap((message) => message.activity).slice(-8);

  async function refreshSessions() {
    const data = await api.sessions();
    setSessions(data.sessions);
  }

  async function chooseProject(id: string) {
    await api.selectProject(id);
    setActiveProjectId(id);
    setSessionId(null);
    setMessages([]);
    setFiles([]);
    setSettingsOpen(false);
    const data = await api.sessions();
    setSessions(data.sessions);
  }

  async function addProject() {
    const path = window.prompt("Absolute path to the project");
    if (!path) return;
    try {
      const result = await api.addProject(path);
      setProjects((current) => (current.some((item) => item.id === result.project.id) ? current : [...current, result.project]));
      await chooseProject(result.project.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that project");
    }
  }

  async function openSession(id: string) {
    setSettingsOpen(false);
    setSessionId(id);
    setWorking(false);
    setError(null);
    setStick(true);
    try {
      const data = await api.openSession(id);
      setMessages(data.messages);
      setFiles(data.files);
      setSessions((current) => upsertSession(current, data.session));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that chat");
    }
  }

  async function newChat() {
    if (!project) {
      setError("Add a project before starting a chat.");
      return;
    }
    setSettingsOpen(false);
    setError(null);
    const created = await api.createSession();
    setSessions((current) => upsertSession(current, created.session));
    setSessionId(created.session.id);
    setMessages([]);
    setFiles([]);
    setWorking(false);
  }

  async function submit() {
    const text = draft.trim();
    if (!text || working) return;
    if (!project) {
      setError("Add a project before starting a chat.");
      return;
    }
    setDraft("");
    setError(null);
    setStick(true);
    setSettingsOpen(false);
    let id = sessionId;
    if (!id) {
      const created = await api.createSession();
      id = created.session.id;
      setSessionId(id);
      setSessions((current) => upsertSession(current, created.session));
    }
    setMessages((current) => [
      ...current,
      { id: `local_${Date.now()}`, role: "user", text, created: Date.now(), activity: [] },
    ]);
    setWorking(true);
    try {
      await api.send(id, text, model || undefined, agent || undefined);
    } catch (err) {
      setWorking(false);
      setError(err instanceof Error ? err.message : "Could not send that");
    }
  }

  async function stop() {
    if (!sessionId) return;
    await api.abort(sessionId);
    setWorking(false);
  }

  async function retry() {
    if (!sessionId) return;
    setWorking(true);
    setError(null);
    try {
      await api.retry(sessionId);
    } catch (err) {
      setWorking(false);
      setError(err instanceof Error ? err.message : "Could not retry");
    }
  }

  async function reply(prompt: PermissionPrompt, decision: "once" | "always" | "reject", message?: string) {
    await api.reply(prompt.id, decision, { sessionId: prompt.sessionId, kind: prompt.kind, message });
    setPrompts((current) => current.filter((item) => item.id !== prompt.id));
  }

  async function pickModel(next: string) {
    setModel(next);
    setModelOpen(false);
    if (!next) return;
    try {
      await api.patchConfig({ model: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that model");
    }
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav aria-label="Paddy" className="flex w-52 shrink-0 flex-col border-r border-border bg-bg sm:w-60">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
            <HelixMark spinning={working} className="size-7 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="truncate font-display text-lg leading-none tracking-tight">Paddy</p>
              <p className="truncate text-xs text-muted">Irishman</p>
            </div>
          </div>
          <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
            <button
              type="button"
              onClick={() => void newChat()}
              className="flex h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-sm text-fg transition-colors hover:bg-surface"
            >
              <Plus className="size-4 shrink-0" />
              New chat
            </button>
            <SectionLabel>Projects</SectionLabel>
            {projects.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void chooseProject(item.id)}
                className={cn(
                  "flex h-10 w-full items-center gap-2 rounded-xl px-2.5 text-left text-sm transition-colors",
                  item.id === activeProjectId ? "bg-elevated text-fg" : "text-muted hover:bg-surface hover:text-fg",
                )}
              >
                <span className="truncate">{item.name}</span>
              </button>
            ))}
            <button type="button" onClick={() => void addProject()} className="mt-0.5 px-2.5 py-1 text-left text-xs text-muted hover:text-fg">
              Add project
            </button>
            <div className="relative mt-2 px-1">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-subtle" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" className="h-8 border-0 bg-surface pl-7 text-xs shadow-[var(--shadow-border)]" />
            </div>
            <SectionLabel>Sessions</SectionLabel>
            {groups.map((group) => (
              <div key={group.label} className="mt-1">
                <p className="px-2.5 py-1 text-[11px] text-subtle">{group.label}</p>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void openSession(item.id)}
                    className={cn(
                      "flex h-9 w-full items-center rounded-xl px-2.5 text-left text-sm transition-colors",
                      item.id === sessionId && !settingsOpen ? "bg-elevated text-fg" : "text-muted hover:bg-surface hover:text-fg",
                    )}
                  >
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <p className="px-2.5 py-2 text-xs text-subtle">No chats yet.</p>}
          </div>
          <div className="border-t border-border p-2">
            <label className="px-2.5 text-[11px] tracking-wide text-muted uppercase">Agent</label>
            <select
              className="mt-1 h-10 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-fg"
              value={agent}
              onChange={(event) => setAgent(event.target.value)}
            >
              <option value="">Build</option>
              {agents.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className={cn(
                "mt-1 flex h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-sm transition-colors",
                settingsOpen ? "bg-elevated text-fg" : "text-muted hover:bg-surface hover:text-fg",
              )}
            >
              <Settings className="size-4" />
              Settings
            </button>
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-3 sm:px-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{settingsOpen ? "Settings" : active?.title || "Console"}</p>
              <p className="hidden truncate text-xs text-muted sm:block">
                {project ? `${project.name}${branch ? ` · ${branch}` : ""}` : "No project selected"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
                <span className={cn("size-1.5 rounded-full", status?.connected ? "bg-ok pulse-live" : "bg-subtle")} />
                {status?.connected ? "Live" : "Offline"}
              </span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setModelOpen((open) => !open)}
                  className="flex h-10 max-w-[14rem] items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm text-fg"
                >
                  <span className="truncate">{shortModel(model) || "Model"}</span>
                </button>
                {modelOpen && (
                  <ModelMenu models={models} current={model} onPick={(value) => void pickModel(value)} onClose={() => setModelOpen(false)} />
                )}
              </div>
              {active && !settingsOpen && (
                <div className="hidden items-center gap-2 sm:flex">
                  <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => void retry()} disabled={working}>Retry</button>
                  <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => {
                    const title = window.prompt("Rename chat", active.title);
                    if (title?.trim()) void api.renameSession(active.id, title.trim()).then(() => refreshSessions());
                  }}>Rename</button>
                  <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => void api.archiveSession(active.id, true).then(() => { setSessionId(null); setMessages([]); return refreshSessions(); })}>Archive</button>
                </div>
              )}
            </div>
          </header>

          {settingsOpen ? (
            <SettingsPanel
              status={status}
              projects={projects}
              appearance={boot?.appearance ?? "dark"}
              onAppearance={(appearance) => {
                document.documentElement.dataset.theme = appearance;
                setBoot((current) => (current ? { ...current, appearance } : current));
              }}
              onProjectsChange={setProjects}
              onReconnect={() => void api.connect().then(setStatus)}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div
                  className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
                    setStick(distance < 80);
                    setShowJump(distance >= 80);
                  }}
                >
                  {!messages.length ? (
                    <PaddyIdle name="Paddy" busy={working} />
                  ) : (
                    <div className="mx-auto flex max-w-2xl flex-col gap-6">
                      {messages.map((message) => (
                        <MessageView key={message.id} message={message} />
                      ))}
                      {prompts.map((item) => (
                        <PermissionCard key={item.id} prompt={item} onReply={(decision, message) => void reply(item, decision, message)} />
                      ))}
                      {working && (
                        <div className="flex items-center gap-3 text-muted">
                          <HelixMark spinning className="size-6 text-accent" />
                          <span className="shimmer-text text-sm">Working</span>
                        </div>
                      )}
                      <div ref={bottom} />
                    </div>
                  )}
                </div>
                {error && status?.authRequired ? (
                  <form
                    className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-1.5 text-[11px]"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const password = serverPassword.trim();
                      if (!password) return;
                      void api
                        .settings({ connectionPassword: password })
                        .then(() => api.connect())
                        .then((next) => {
                          setStatus(next);
                          setServerPassword("");
                          setError(next.connected ? null : (next.error ?? null));
                        })
                        .catch((err: Error) => setError(err.message));
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate text-danger">{error}</span>
                    <Input
                      type="password"
                      value={serverPassword}
                      onChange={(event) => setServerPassword(event.target.value)}
                      placeholder="OpenCode server password"
                      autoComplete="off"
                      className="h-7 w-52 px-2 text-[11px]"
                    />
                    <Button type="submit" size="sm" disabled={!serverPassword.trim()}>
                      Save and reconnect
                    </Button>
                  </form>
                ) : error ? (
                  <p className="truncate border-t border-border px-4 py-1.5 text-[11px] text-danger">
                    {error}
                    <button type="button" className="ml-2 text-muted hover:text-fg" onClick={() => void api.connect().then(setStatus)}>
                      Reconnect
                    </button>
                  </p>
                ) : null}
                {files.length > 0 && (
                  <button
                    type="button"
                    className="flex items-center gap-2 border-t border-border px-4 py-1.5 text-[11px] text-muted hover:text-fg lg:hidden"
                    onClick={() => setInspector("changes")}
                  >
                    <FolderGit2 className="size-3.5" />
                    {files.length} file{files.length === 1 ? "" : "s"} changed
                  </button>
                )}
                {showJump && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      className="mb-1 rounded-full bg-elevated px-3 py-1 text-[11px] text-muted shadow-[var(--shadow-border)]"
                      onClick={() => {
                        setStick(true);
                        bottom.current?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      <ArrowDown className="mr-1 inline size-3" /> Latest
                    </button>
                  </div>
                )}
                <form
                  className="border-t border-border px-3 py-3 sm:px-6"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                  }}
                >
                  <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl bg-elevated p-2 shadow-[var(--shadow-border)]">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void submit();
                        }
                      }}
                      rows={1}
                      placeholder="Message Paddy"
                      className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-fg placeholder:text-subtle focus:outline-none"
                    />
                    {working ? (
                      <Button type="button" size="icon" variant="danger" aria-label="Stop" onClick={() => void stop()}>
                        <Square />
                      </Button>
                    ) : (
                      <Button type="submit" size="icon" disabled={!draft.trim()} aria-label="Send">
                        <ArrowUp />
                      </Button>
                    )}
                  </div>
                  <p className="mx-auto mt-2 max-w-2xl px-2 text-[11px] text-subtle">
                    Enter to send · Shift+Enter for a line · work stays in {project?.name ?? "the selected project"}
                  </p>
                </form>
              </section>

              <aside className="hidden min-h-0 w-[22rem] shrink-0 flex-col border-l border-border bg-surface lg:flex">
                <div className="flex gap-1 border-b border-border p-2">
                  {(["work", "changes"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setInspector(tab)}
                      className={cn(
                        "flex-1 rounded-lg py-2 text-xs font-medium capitalize transition-colors",
                        inspector === tab ? "bg-elevated text-fg" : "text-muted hover:text-fg",
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
                  {inspector === "work" ? (
                    <WorkList items={liveActivity} working={working} />
                  ) : (
                    <ChangesList
                      files={files}
                      selected={selectedDiff}
                      onSelect={(file) => {
                        setSelectedDiff(file);
                        setInspector("changes");
                      }}
                    />
                  )}
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <p className="mt-3 mb-1 px-2.5 text-[11px] font-medium tracking-wide text-muted uppercase">{children}</p>;
}

function MessageView({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(message.activity.some((item) => item.status === "running"));
  if (message.role === "user") {
    return (
      <article className="rise-in">
        <div className="flex justify-end">
          <div className="max-w-[min(100%,36rem)] rounded-2xl rounded-br-md bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
            <p className="text-sm leading-relaxed text-fg">{message.text}</p>
            <p className="mt-1.5 text-right text-[11px] text-subtle tabular-nums">{formatTime(message.created)}</p>
          </div>
        </div>
      </article>
    );
  }
  return (
    <article className="rise-in">
      <div className="flex gap-3">
        <HelixMark className="mt-1 size-7 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Paddy</p>
          {message.activity.length > 0 && (
            <div className="mb-2">
              <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setOpen((value) => !value)}>
                {open ? "Hide" : "Show"} work · {message.activity.length}
              </button>
              {open ? (
                <ul className="mt-2 space-y-1.5">
                  {message.activity.map((item) => (
                    <ActivityRow key={item.id} item={item} />
                  ))}
                </ul>
              ) : (
                <div className="mt-1 space-y-0.5 text-xs text-subtle">
                  {message.activity.slice(-3).map((item) => (
                    <p key={item.id}>{item.status === "completed" ? "✓" : "▸"} {item.title}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          {message.text ? <Markdown text={message.text} /> : null}
          {message.error && <p className="mt-2 text-sm text-danger">{message.error}</p>}
        </div>
      </div>
    </article>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg bg-bg px-3 py-2">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((value) => !value)}>
        <span className="font-mono text-[10px] tracking-wide text-accent uppercase">{item.tool}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-fg">{item.title}</span>
        <span className={cn("size-1.5 rounded-full", item.status === "error" ? "bg-danger" : item.status === "completed" ? "bg-ok" : "bg-accent pulse-live")} />
      </button>
      {open && item.detail && <p className="mt-1 text-xs leading-relaxed text-muted">{item.detail}</p>}
    </li>
  );
}

function PermissionCard({
  prompt,
  onReply,
}: {
  prompt: PermissionPrompt;
  onReply: (decision: "once" | "always" | "reject", message?: string) => void;
}) {
  return (
    <article className="rise-in">
      <div className="flex gap-3">
        <HelixMark className="mt-1 size-7 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 rounded-2xl bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
          <p className="font-mono text-[10px] tracking-wide text-accent uppercase">
            {prompt.kind === "question" ? "question" : "permission"}
          </p>
          <p className="mt-1 text-sm text-fg">
            {prompt.kind === "question" ? "Paddy is asking" : "Paddy wants to"}
          </p>
          <p className="mt-0.5 text-xs text-muted">{prompt.title}</p>
          <pre className="mt-2 overflow-auto rounded-lg bg-bg p-3 font-mono text-xs leading-relaxed text-fg">{prompt.detail}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={() => onReply("reject")}>Deny</Button>
            {prompt.kind === "permission" && (
              <Button size="sm" variant="outline" onClick={() => onReply("always")}>Always</Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                if (prompt.kind !== "question") {
                  onReply("once");
                  return;
                }
                const answer = window.prompt("Answer");
                if (!answer?.trim()) return;
                onReply("once", answer.trim());
              }}
            >
              {prompt.kind === "question" ? "Answer" : "Allow"}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function WorkList({ items, working }: { items: ActivityItem[]; working: boolean }) {
  if (!items.length) {
    return <p className="p-2 text-sm text-muted">{working ? "Starting…" : "The loop is idle."}</p>;
  }
  return (
    <ol className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-lg bg-bg px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] tracking-wide text-accent uppercase">{item.tool}</span>
            <span className={cn("size-1.5 rounded-full", item.status === "completed" ? "bg-ok" : item.status === "error" ? "bg-danger" : "bg-accent pulse-live")} />
          </div>
          <p className="mt-1 text-sm text-fg">{item.title}</p>
          {item.detail ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function ChangesList({ files, selected, onSelect }: { files: DiffFile[]; selected: string | null; onSelect: (file: string) => void }) {
  if (!files.length) return <p className="p-2 text-sm text-muted">No file changes yet.</p>;
  const file = files.find((item) => item.file === selected) ?? files[0];
  return (
    <div className="space-y-2">
      <p className="px-1 text-[11px] text-muted">{files.length} file{files.length === 1 ? "" : "s"} changed</p>
      {files.map((item) => (
        <button
          key={item.file}
          type="button"
          onClick={() => onSelect(item.file)}
          className={cn("flex w-full items-center justify-between gap-2 rounded-lg bg-bg px-3 py-2 text-left", item.file === file?.file && "shadow-[var(--shadow-border)]")}
        >
          <span className="truncate font-mono text-xs text-fg">{item.file}</span>
          <span className="shrink-0 font-mono text-[10px] text-subtle">+{item.additions} −{item.deletions}</span>
        </button>
      ))}
      {file && (
        <pre className="max-h-80 overflow-auto rounded-lg bg-bg p-3 font-mono text-[11px] leading-relaxed">
          {file.patch.split("\n").map((line, index) => (
            <div key={index} className={cn(line.startsWith("+") && "text-ok", line.startsWith("-") && "text-danger")}>{line || " "}</div>
          ))}
        </pre>
      )}
      {file && (
        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(file.patch)}>
          Copy diff
        </Button>
      )}
    </div>
  );
}

function ModelMenu({
  models,
  current,
  onPick,
  onClose,
}: {
  models: string[];
  current: string;
  onPick: (model: string) => void;
  onClose: () => void;
}) {
  const groups = new Map<string, string[]>();
  for (const id of models) {
    const provider = id.split("/")[0] || "other";
    groups.set(provider, [...(groups.get(provider) ?? []), id]);
  }
  return (
    <>
      <button type="button" className="fixed inset-0 z-20 cursor-default" aria-label="Close models" onClick={onClose} />
      <div className="absolute top-11 right-0 z-30 max-h-80 w-72 overflow-y-auto rounded-xl bg-elevated p-2 shadow-[var(--shadow-border)]">
        {[...groups.entries()].map(([provider, items]) => (
          <div key={provider} className="mb-2">
            <p className="px-2 py-1 text-[11px] tracking-wide text-muted uppercase">{provider}</p>
            {items.slice(0, 12).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => onPick(id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface",
                  id === current && "bg-surface text-fg",
                )}
              >
                <span className="truncate">{id.slice(provider.length + 1)}</span>
                {id === current && <Badge variant="accent">on</Badge>}
              </button>
            ))}
          </div>
        ))}
        {!models.length && <p className="px-2 py-2 text-xs text-muted">No models from the runtime yet.</p>}
      </div>
    </>
  );
}

function shortModel(model: string): string {
  if (!model) return "";
  const slash = model.indexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

function matches(session: SessionSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || session.title.toLowerCase().includes(needle);
}

function groupByDate(sessions: SessionSummary[]): { label: string; items: SessionSummary[] }[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const today = now.getTime();
  const yesterday = today - 86_400_000;
  const groups = new Map<string, SessionSummary[]>();
  for (const session of [...sessions].sort((a, b) => b.updated - a.updated)) {
    const label = session.updated >= today ? "Today" : session.updated >= yesterday ? "Yesterday" : new Date(session.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    groups.set(label, [...(groups.get(label) ?? []), session]);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function upsertSession(list: SessionSummary[], session: SessionSummary): SessionSummary[] {
  return [...list.filter((item) => item.id !== session.id), session].sort((a, b) => b.updated - a.updated);
}

function appendDelta(list: ChatMessage[], messageId: string, delta: string): ChatMessage[] {
  if (!list.some((item) => item.id === messageId)) {
    return [...list, { id: messageId, role: "assistant", text: delta, created: Date.now(), activity: [] }];
  }
  return list.map((item) => (item.id === messageId ? { ...item, text: item.text + delta } : item));
}

function upsertActivity(list: ChatMessage[], messageId: string, item: ActivityItem): ChatMessage[] {
  if (!list.some((message) => message.id === messageId)) {
    return [...list, { id: messageId, role: "assistant", text: "", created: Date.now(), activity: [item] }];
  }
  return list.map((message) => {
    if (message.id !== messageId) return message;
    const activity = message.activity.some((entry) => entry.id === item.id)
      ? message.activity.map((entry) => (entry.id === item.id ? item : entry))
      : [...message.activity, item];
    return { ...message, activity };
  });
}

function mergeMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (!list.some((item) => item.id === message.id)) return [...list, message];
  return list.map((item) =>
    item.id === message.id
      ? { ...item, text: message.text || item.text, error: message.error ?? item.error, activity: message.activity.length ? message.activity : item.activity }
      : item,
  );
}

function modelIds(payload: unknown): string[] {
  const record = payload as { all?: { id?: string; models?: Record<string, { id?: string }> }[] } | null;
  const ids: string[] = [];
  for (const provider of record?.all ?? []) {
    if (!provider.id) continue;
    for (const model of Object.values(provider.models ?? {})) {
      if (model.id) ids.push(`${provider.id}/${model.id}`);
    }
  }
  return ids.slice(0, 200);
}

function agentNames(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((item) => (item && typeof item === "object" && "name" in item ? String((item as { name?: string }).name ?? "") : "")).filter(Boolean);
}
