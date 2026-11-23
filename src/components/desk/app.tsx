import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpLeft, Archive, Check, ChevronRight, Copy, Folder, FolderGit2, Pencil, Plus, RotateCcw, Search, Settings, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { HelixMark } from "@/components/helix-mark";
import { Markdown } from "@/components/markdown";
import { PaddyIdle } from "@/components/paddy-idle";
import { SettingsPanel } from "@/components/desk/settings";
import { ModelPicker } from "@/components/desk/model-picker";
import { CommandPalette } from "@/components/desk/command-palette";
import { filterCommands, nextCommandIndex, parseCommandInput, shouldAutoLoadCommands } from "@/components/desk/commands";
import { canSelectModel, modelForSend, modelSaveFailure, resolveActiveSource, resolveHeaderModel } from "@/components/desk/models";
import { ResizeHandle } from "@/components/desk/resize-handle";
import { createRequestGate, runLatest } from "@/components/desk/request-gate";
import { catchUpProjectMatches, createReconnectScheduler } from "@/components/desk/event-stream";
import { usePanelWidths } from "@/components/desk/use-panel-widths";
import { ChangesPanel, FilesChangedBlock, type TurnDiffs } from "@/components/desk/files-changed";
import { changesFailed, changesLoaded, changesLoading, changesSettled, EMPTY_CHANGES, type SessionChanges } from "@/components/desk/session-changes";
import { createArchiveUndo, shouldReturnFocus, type ArchiveNotice, type NoticeHold } from "@/components/desk/archive-undo";
import { agentOptions, type AgentOption } from "@/components/desk/agents";
import { AgentPicker } from "@/components/desk/agent-picker";
import { createTurnDiffCache, createTurnTracker, latestTurnFiles, mergeStepFiles, turnFiles, turnStateKey } from "@/components/desk/diff";
import {
  belongsToProject,
  browserStorage,
  cancelOpen,
  forgetSession,
  isMissingSession,
  isOpeningSelected,
  OPENING_CHAT_MESSAGE,
  pickResumeId,
  planSend,
  rememberSession,
  sessionForSend,
} from "@/components/desk/last-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatTime } from "@/lib/utils";
import {
  appendDelta,
  activityPreview,
  dropPendingBubbles,
  echoToReplace,
  mergeMessage,
  mergeMessages,
  replacePendingEcho,
  retryableUserId,
  settlePendingEcho,
  settleWorkingAfterCatchUp,
  upsertActivity,
  upsertSession,
  workingAfterCatchUp,
} from "./messages";
import {
  api,
  type ActivityItem,
  type Bootstrap,
  type ChatMessage,
  type ConnectionStatus,
  type DeskCommand,
  type DeskEvent,
  type DeskModel,
  type FsDirListing,
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
  /** Inspector latest-turn changes, tagged with the session they belong to (see session-changes.ts). */
  const [changes, setChanges] = useState<SessionChanges>(EMPTY_CHANGES);
  /** Archive is immediate; this offers Undo (a real `archived: false` restore) for ARCHIVE_UNDO_MS. */
  const [archiveUndo] = useState(() => createArchiveUndo((id, archived) => api.archiveSession(id, archived)));
  const [archiveNotice, setArchiveNotice] = useState<(ArchiveNotice & { projectId: string | null }) | null>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  /** Archive/undo failures show here, in the notice — not in the connection error bar (no Reconnect). */
  const [archiveFailure, setArchiveFailure] = useState<{ sessionId: string; text: string } | null>(null);
  /** Always mounted (empty when idle) so screen readers announce text added to it. */
  const noticeRegion = useRef<HTMLDivElement>(null);
  const focusUndoNext = useRef(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** SSE recovery notice, kept apart from `error` so a reconnect clears only its own message. */
  const [streamNotice, setStreamNotice] = useState<string | null>(null);
  const [serverPassword, setServerPassword] = useState("");
  const [prompts, setPrompts] = useState<PermissionPrompt[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  /** Set while openSession is fetching; sending is disabled until the server confirms the chat. */
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Add project is a dialog now; it settles the promise both callers await. */
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const addProjectResolve = useRef<((project: Project | null) => void) | null>(null);
  /** The control that opened the dialog, so focus can go back to it. */
  const addProjectReturnFocus = useRef<HTMLElement | null>(null);
  const panels = usePanelWidths(!settingsOpen);
  const [inspector, setInspector] = useState<"work" | "changes">("work");
  const [branch, setBranch] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [catalog, setCatalog] = useState<{ models: DeskModel[]; default: string; fetchedAt: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [modelSource, setModelSource] = useState<"desk" | "session">("desk");
  const [commandCatalog, setCommandCatalog] = useState<DeskCommand[] | null>(null);
  const [commandLoading, setCommandLoading] = useState(false);
  const [commandLoadError, setCommandLoadError] = useState<string | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const pendingCommandRef = useRef<string | null>(null);
  // Echo settled by session idle/error before its server user message arrived;
  // a late message still replaces it instead of showing the prompt twice.
  const settledCommandRef = useRef<string | null>(null);
  const commandTurnRef = useRef(false);
  const commandRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadCommandsRef = useRef<() => Promise<void>>(async () => {});
  // Per-catalog request gates: a response from before a project switch (or a
  // newer retry) is dropped instead of showing another project's list.
  const [modelGate] = useState(createRequestGate);
  const [commandGate] = useState(createRequestGate);
  const [modelSaveGate] = useState(createRequestGate);
  /** One ticket per openSession call; newChat/chooseProject/Archive/session-deleted invalidate it. */
  const [openGate] = useState(createRequestGate);
  /** The session id the server has confirmed (opened or created); only this one may be reused by a send. */
  const confirmedSessionRef = useRef<string | null>(null);
  /** Everything cancelOpen() touches; stable for the component's lifetime. */
  const [openTarget] = useState(() => ({ gate: openGate, setOpening: setOpeningSessionId, confirmedRef: confirmedSessionRef }));
  const [agent, setAgent] = useState("");
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [stick, setStick] = useState(true);
  const [showJump, setShowJump] = useState(false);
  /** Latest-turn diff refresh for the inspector (on idle, or Retry). */
  const [filesGate] = useState(createRequestGate);
  /** Bumped once per finished turn, so an expanded "Files changed" block refetches its turn. */
  const [turnEpoch, setTurnEpoch] = useState(0);
  /** One turn end per turn, even when execution.succeeded and session.idle both arrive. */
  const [turnTracker] = useState(createTurnTracker);
  /** Expanded "Files changed" blocks by turn ordinal; survives re-anchoring during a live turn. */
  // Both keyed by (session, turn): a chat change through any path (archive, delete,
  // ensureSession, open, new chat) can't show another chat's expansion or files.
  // The explicit clears on chat change below only free memory.
  const [expandedTurns, setExpandedTurns] = useState<ReadonlySet<string>>(() => new Set());
  /** Loaded turn diffs, bounded (TURN_DIFF_CACHE_LIMIT). */
  const [turnDiffs] = useState<TurnDiffs>(() => createTurnDiffCache());
  /** Inspector tab, readable from the event handler without re-subscribing. */
  const inspectorRef = useRef<"work" | "changes">("work");
  /** The latest-turn diff changed while the Changes tab was hidden: fetch when it opens. */
  const filesStaleRef = useRef(false);
  /** step-files can arrive before the assistant message it names; hold them until it does. */
  const stepFilesRef = useRef(new Map<string, string[]>());
  const bottom = useRef<HTMLDivElement>(null);
  /** The message list's own scroller. Scrolled directly so the app shell never moves. */
  const listRef = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;
  /** Project id readable from async catch-up without a stale effect closure. */
  const activeProjectIdRef = useRef<string | null>(null);
  activeProjectIdRef.current = activeProjectId;

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
    if (event.type === "commands-updated") {
      if (commandRefreshTimer.current) clearTimeout(commandRefreshTimer.current);
      commandRefreshTimer.current = setTimeout(() => {
        void loadCommandsRef.current();
      }, 300);
      return;
    }
    if (event.type === "model-selected") {
      const next = resolveHeaderModel(sessionRef.current, event.sessionId, event.model);
      if (next === null) return;
      setModel(next);
      setModelSource("session");
      return;
    }
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
      forgetSession(browserStorage(), event.id);
      // Deleted elsewhere while its archive notice is up: no dead Undo (it would only 404).
      archiveUndo.forget(event.id);
      if (noticeRegion.current?.dataset.session === event.id) returnNoticeFocus();
      setArchiveNotice((current) => (current?.sessionId === event.id ? null : current));
      setArchiveFailure((current) => (current?.sessionId === event.id ? null : current));
      if (sessionRef.current === event.id) {
        // The open chat is gone: the next send must start a new one, not reuse a dead id.
        cancelOpen(openTarget);
        pendingCommandRef.current = null;
        settledCommandRef.current = null;
        commandTurnRef.current = false;
        setSessionId(null);
        setMessages([]);
        setChanges(EMPTY_CHANGES);
        setWorking(false);
      }
      return;
    }
    if (event.type === "status") {
      const current = sessionRef.current;
      if (current && event.sessionId && current !== event.sessionId) return;
      setWorking(event.state === "working" || event.state === "retry");
      if (event.state === "working" || event.state === "retry") turnTracker.busy();
      if ((event.state === "error" || event.state === "idle") && pendingCommandRef.current) {
        const tempId = pendingCommandRef.current;
        pendingCommandRef.current = null;
        settledCommandRef.current = tempId;
        setMessages((list) => settlePendingEcho(list, tempId));
      }
      if (event.state === "error" && event.detail) {
        setError(event.detail);
        if (commandTurnRef.current) {
          commandTurnRef.current = false;
          setMessages((list) => [
            ...list,
            {
              id: `sys_${Date.now()}`,
              role: "system",
              text: event.detail ?? "Command failed",
              created: Date.now(),
              activity: [],
            },
          ]);
        }
      }
      if (event.state === "idle") {
        commandTurnRef.current = false;
        setWorking(false);
        if (current && turnTracker.idle()) {
          setTurnEpoch((value) => value + 1);
          // Only pay for the latest-turn diff when someone is looking at it.
          if (inspectorRef.current === "changes") refreshLatestFiles(current);
          else filesStaleRef.current = true;
        }
      }
      return;
    }
    if (event.type === "diff") {
      if (sessionRef.current === event.sessionId) setChanges(changesLoaded(event.sessionId, event.files));
      return;
    }
    if (!sessionRef.current || ("sessionId" in event && event.sessionId !== sessionRef.current)) return;
    if (event.type === "step-files") {
      const held = stepFilesRef.current.get(event.messageId) ?? [];
      stepFilesRef.current.set(event.messageId, [...held, ...event.files.filter((file) => !held.includes(file))]);
      setMessages((list) => mergeStepFiles(list, event.messageId, event.files));
      turnTracker.busy();
      return;
    }
    if (event.type === "text-delta") {
      setMessages((list) => appendDelta(list, event.messageId, event.delta));
      setWorking(true);
      turnTracker.busy();
    } else if (event.type === "activity") {
      setMessages((list) => upsertActivity(list, event.messageId, event.item));
      setWorking(true);
      turnTracker.busy();
      setInspector("work");
    } else if (event.type === "message") {
      const tempId =
        event.message.role === "user"
          ? echoToReplace({ pending: pendingCommandRef.current, settled: settledCommandRef.current })
          : null;
      if (tempId) {
        pendingCommandRef.current = null;
        settledCommandRef.current = null;
        setMessages((list) => replacePendingEcho(list, tempId, event.message));
        return;
      }
      const held = stepFilesRef.current.get(event.message.id);
      setMessages((list) => {
        const merged = mergeMessage(list, event.message);
        return held ? mergeStepFiles(merged, event.message.id, held) : merged;
      });
    }
    // refreshLatestFiles only touches refs, stable setters and a stable gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTarget]);

  // Track the visible tab for the event handler; catch up on a diff that went stale while hidden.
  useEffect(() => {
    inspectorRef.current = inspector;
    if (inspector === "changes" && filesStaleRef.current && sessionId) {
      filesStaleRef.current = false;
      refreshLatestFiles(sessionId);
    }
    // refreshLatestFiles only touches refs, stable setters and a stable gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspector, sessionId]);

  function refreshLatestFiles(id: string) {
    filesStaleRef.current = false;
    setChanges((current) => changesLoading(current, id));
    void runLatest(filesGate, () => api.diff(id), {
      onData: (data) => {
        if (sessionRef.current === id) setChanges(changesLoaded(id, data.files));
      },
      onError: (err) => {
        if (sessionRef.current === id) setChanges((current) => changesFailed(current, id, err instanceof Error ? err.message : "Could not load changes"));
      },
      onSettled: () => setChanges((current) => changesSettled(current, id)),
    }).catch(() => setChanges((current) => changesSettled(current, id)));
  }

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | undefined;
    const retry = createReconnectScheduler(
      {
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id as number),
      },
      () => connect(),
    );

    /**
     * Refetch what the disconnect gap swallowed. Merges by message id and only
     * touches messages, working state and session summaries, so scroll,
     * expanded turns and the inspector survive; a chat or project switched away
     * from meanwhile is left alone.
     */
    function catchUp() {
      const id = sessionRef.current;
      const projectAtStart = activeProjectIdRef.current;
      const chatCaughtUp = id
        ? api.openSession(id).then((data) => {
            if (cancelled || sessionRef.current !== id) return;
            setMessages((current) => mergeMessages(current, data.messages));
            setSessions((current) => upsertSession(current, data.session));
            // A turn that ended while the stream was down produced no idle frame:
            // settle it here or the spinner (and send) would stay blocked. Only
            // clear — a live idle that landed during this fetch must win over a
            // snapshot that still shows running (no later idle would undo true).
            const stillWorking = workingAfterCatchUp(data.messages);
            setWorking((current) => settleWorkingAfterCatchUp(current, stillWorking));
            if (!stillWorking && turnTracker.idle()) {
              setTurnEpoch((value) => value + 1);
              filesStaleRef.current = true;
            }
          })
        : Promise.resolve();
      const listRefreshed = api.sessions().then((data) => {
        if (!cancelled && catchUpProjectMatches(projectAtStart, activeProjectIdRef.current)) {
          setSessions(data.sessions);
        }
      });
      void Promise.allSettled([chatCaughtUp, listRefreshed]).then((results) => {
        if (cancelled || results.every((result) => result.status === "fulfilled")) return;
        toast.error("Reconnected, but could not catch up. Reload if messages look missing.");
      });
    }

    function connect() {
      if (cancelled) return;
      // One live source at a time, even if a late retry and a native reconnect race.
      source?.close();
      const stream = new EventSource("/api/events");
      source = stream;
      stream.onopen = () => {
        if (cancelled) return;
        setStreamNotice(null);
        if (retry.opened()) catchUp();
      };
      stream.onmessage = (message) => {
        try {
          applyEvent(JSON.parse(message.data) as DeskEvent);
        } catch {
          /* ignore malformed frames */
        }
      };
      stream.onerror = () => {
        if (cancelled) return;
        if (stream.readyState === EventSource.CLOSED) {
          // Fatal (e.g. wrong content-type during a restart): the browser will
          // not retry this stream, so schedule a fresh one under supervision.
          stream.close();
          retry.failed();
        } else {
          // CONNECTING: the browser is already retrying; only catch up after it.
          retry.interrupted();
        }
        setStreamNotice("Lost the live connection. Reconnecting…");
      };
    }

    void api.bootstrap().then((data) => {
      if (cancelled) return;
      setBoot(data);
      setStatus(data.status);
      setProjects(data.projects);
      setActiveProjectId(data.activeProjectId);
      activeProjectIdRef.current = data.activeProjectId;
      setSessions(data.sessions);
      setModel(data.model);
      setModelSource("desk");
      applyTheme(data.appearance);
      if (data.status.error && !data.status.connected) setError(data.status.error);
      if (window.location.search.includes("token=")) {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      }
      // Per-project key only, and only an id the project's session list still has.
      // openSession re-remembers it on success and forgets it on a 404.
      const resume = data.status.connected
        ? pickResumeId(browserStorage(), data.activeProjectId, data.sessions, data.sessionsComplete !== false)
        : null;
      if (resume) {
        // An id not found on a truncated first page is confirmed by the direct fetch in openSession.
        const projectPath = data.projects.find((item) => item.id === data.activeProjectId)?.path;
        setLoadingSession(true);
        void openSessionOrReport(resume.id, data.activeProjectId, resume.verify ? projectPath : undefined).finally(() =>
          setLoadingSession(false),
        );
      }
      connect();
    }).catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
      retry.stop();
      source?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyEvent]);

  useEffect(() => {
    if (!project || !status?.connected) return;
    void api.vcs().then((info) => setBranch(info.branch ?? null)).catch(() => setBranch(null));
    void api.agents().then((payload) => setAgents(agentOptions(payload))).catch(() => setAgents([]));
  }, [project, status?.connected]);

  // The Archive button that was clicked is gone: move keyboard focus to Undo
  // (only if focus was dropped, never stealing it), once per new notice.
  useEffect(() => {
    if (!archiveNotice || !focusUndoNext.current) return;
    focusUndoNext.current = false;
    if (!document.activeElement || document.activeElement === document.body) undoButton.current?.focus();
  }, [archiveNotice]);

  // The notice times out, but never while hovered or focused (the controller holds it).
  useEffect(() => {
    if (!archiveNotice || archiveNotice.paused) return;
    const timer = window.setTimeout(() => {
      if (!archiveUndo.expire()) return;
      returnNoticeFocus();
      setArchiveNotice(null);
      setArchiveFailure(null);
    }, Math.max(0, archiveNotice.until - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [archiveNotice, archiveUndo]);

  useEffect(() => {
    if (!stick) return;
    // Not scrollIntoView: that also scrolls every scrollable ancestor (the page),
    // which left a black band under the composer.
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, working, prompts, stick]);

  const groups = useMemo(() => groupByDate(sessions.filter((item) => !item.archived && matches(item, query))), [sessions, query]);
  const active = sessions.find((item) => item.id === sessionId) ?? null;
  const openingSelected = isOpeningSelected(openingSessionId, sessionId);
  // Same decision as submit(): the button is enabled exactly when planSend would not ignore or wait.
  const sendDisabled =
    planSend({
      text: draft,
      busy: messages.some((m) => m.pending),
      current: sessionId,
      confirmed: confirmedSessionRef.current,
      opening: openingSessionId,
    }).kind !== "go";
  const liveActivity = messages.flatMap((message) => message.activity).slice(-8);
  const turns = useMemo(() => turnFiles(messages), [messages]);
  /** The one prompt whose bubble carries Retry/Edit (see retryableUserId). */
  const retryableId = retryableUserId(messages);
  // Footer count from snapshot data in the chat: current even while the Changes tab is hidden.
  const latestFileCount = useMemo(() => latestTurnFiles(messages, turns).length, [messages, turns]);
  const catalogLoaded = catalog !== null;
  const commandQuery = draft.startsWith("/") ? draft.slice(1) : null;
  const paletteOpen = commandQuery !== null && !commandDismissed;
  const visibleCommands = filterCommands(commandCatalog ?? [], commandQuery ?? "");
  const activeCommand = visibleCommands[commandIndex] ?? visibleCommands[0] ?? null;
  useEffect(() => {
    if (
      shouldAutoLoadCommands({
        open: paletteOpen,
        catalogLoaded: commandCatalog !== null,
        loading: commandLoading,
        error: commandLoadError,
      })
    ) {
      void loadCommandsRef.current();
    }
  }, [paletteOpen, commandCatalog, commandLoading, commandLoadError]);
  useEffect(() => {
    // Closing the palette forgets the failure, so the next `/` tries once more.
    if (!paletteOpen) setCommandLoadError(null);
  }, [paletteOpen]);

  const effective = resolveActiveSource(
    modelSource,
    model,
    catalog?.models ?? [],
    catalog?.default ?? "",
    catalogLoaded,
  );

  async function loadModels(force = false) {
    if (!force && catalog && Date.now() - catalog.fetchedAt < 30_000) {
      setModelLoading(false);
      return;
    }
    const ticket = modelGate.begin();
    setModelLoading(true);
    try {
      const data = await api.models();
      if (!modelGate.isCurrent(ticket)) return;
      setCatalog({ models: data.models, default: data.default, fetchedAt: Date.now() });
      setModelLoadError(null);
    } catch (err) {
      if (!modelGate.isCurrent(ticket)) return;
      setModelLoadError(err instanceof Error ? err.message : "Could not load models");
    } finally {
      // A stale request leaves the flag to the current one (or to the reset on switch).
      if (modelGate.isCurrent(ticket)) setModelLoading(false);
    }
  }

  function chooseModel(key: string) {
    if (!canSelectModel(catalog?.models ?? [], key)) {
      setModelNote("That model is disabled in OpenCode.");
      return;
    }
    const previous = { model, source: modelSource };
    const ticket = modelSaveGate.begin();
    setModel(key);
    setModelSource("desk");
    setModelNote(null);
    void api.settings({ deskModel: key }).catch((err: unknown) => {
      if (!modelSaveGate.isCurrent(ticket)) return; // a newer choice owns the header
      if (modelSaveFailure(err) === "reject") {
        // The server refused the key (e.g. disabled since the catalog loaded): do not send with it.
        setModel(previous.model);
        setModelSource(previous.source);
        setModelNote(err instanceof Error ? err.message : "That model was rejected.");
        return;
      }
      setModelNote("Model saved for this turn only — it will not survive a reload.");
    });
  }

  async function loadCommands() {
    const ticket = commandGate.begin();
    setCommandLoading(true);
    try {
      const data = await api.commands();
      if (!commandGate.isCurrent(ticket)) return;
      setCommandCatalog(data.commands);
      setCommandLoadError(null);
    } catch (err) {
      if (!commandGate.isCurrent(ticket)) return;
      setCommandLoadError(err instanceof Error ? err.message : "Could not load commands");
    } finally {
      if (commandGate.isCurrent(ticket)) setCommandLoading(false);
    }
  }
  loadCommandsRef.current = loadCommands;

  function appendSystem(text: string) {
    setMessages((current) => [
      ...current,
      { id: `sys_${Date.now()}`, role: "system", text, created: Date.now(), activity: [] },
    ]);
  }

  /** Forget any in-flight command echo; its server message will never reach this view. */
  function resetCommandTurn() {
    pendingCommandRef.current = null;
    settledCommandRef.current = null;
    commandTurnRef.current = false;
  }

  async function ensureSession(): Promise<string | null> {
    const target = sessionForSend(sessionId, confirmedSessionRef.current);
    if (target.kind === "reuse") return target.id;
    if (target.kind === "wait") throw new Error(OPENING_CHAT_MESSAGE);
    const created = await api.createSession();
    const id = created.session.id;
    confirmedSessionRef.current = id;
    setSessionId(id);
    setSessions((current) => upsertSession(current, created.session));
    rememberSession(browserStorage(), activeProjectId, id);
    return id;
  }

  async function dispatchCommand(name: string, args: string) {
    if (working || messages.some((m) => m.pending)) return;
    if (!project) {
      setError("Add a project before running a command.");
      return;
    }
    const echo = `/${name}${args ? ` ${args}` : ""}`;
    setCommandDismissed(false);
    setCommandIndex(0);
    setStick(true);
    setSettingsOpen(false);
    let id: string | null = null;
    try {
      id = await ensureSession();
    } catch (err) {
      appendSystem(err instanceof Error ? err.message : "Could not start a chat");
      return;
    }
    if (!id) return;
    setDraft("");
    const tempId = `local_${Date.now()}`;
    pendingCommandRef.current = tempId;
    settledCommandRef.current = null;
    commandTurnRef.current = true;
    setMessages((current) => [
      ...current,
      { id: tempId, role: "user", text: echo, created: Date.now(), activity: [], pending: true },
    ]);
    setWorking(true);
    try {
      await api.runCommand(id, name, args);
    } catch (err) {
      pendingCommandRef.current = null;
      commandTurnRef.current = false;
      setMessages((current) => current.filter((m) => m.id !== tempId));
      setDraft(echo);
      setWorking(false);
      appendSystem(err instanceof Error ? err.message : "Command could not run");
    }
  }

  /** Closing the notice must not drop keyboard focus to <body>: hand it to the composer. */
  function returnNoticeFocus() {
    const active = document.activeElement;
    if (shouldReturnFocus(active, document.body, Boolean(noticeRegion.current?.contains(active)))) composer.current?.focus();
  }

  function closeNotice() {
    returnNoticeFocus();
    archiveUndo.dismiss();
    setArchiveNotice(null);
    setArchiveFailure(null);
  }

  /** Hover/focus hold the countdown (WCAG 2.2.1); mirror the controller's notice into state. */
  function holdNotice(hold: NoticeHold, held: boolean) {
    const next = held ? archiveUndo.pause(hold) : archiveUndo.resume(hold);
    setArchiveNotice((current) =>
      current && next?.sessionId === current.sessionId ? { ...next, projectId: current.projectId } : current,
    );
  }

  /** Restore the chat named in the archive notice and, if its project is still open, reopen it. */
  function undoArchive() {
    const notice = archiveNotice;
    setArchiveFailure(null);
    void archiveUndo
      .undo()
      .then(async (id) => {
        // A newer archive's notice (if any) stays, and keeps focus.
        if (!archiveUndo.notice) returnNoticeFocus();
        setArchiveNotice((current) => (current?.sessionId === notice?.sessionId ? null : current));
        if (!id) return;
        await refreshSessions();
        if (notice?.projectId === activeProjectId) await openSessionOrReport(id);
      })
      .catch((err: unknown) => {
        const back = archiveUndo.notice;
        if (back && notice && back.sessionId === notice.sessionId) {
          // undo() put the notice back: keep offering Undo, with the reason in the notice.
          setArchiveNotice({ ...back, projectId: notice.projectId });
          setArchiveFailure({
            sessionId: back.sessionId,
            text: `Could not restore it: ${err instanceof Error ? err.message : "unknown error"}`,
          });
        } else if (!back) {
          returnNoticeFocus();
          setArchiveNotice(null);
        }
      });
  }

  async function refreshSessions() {
    const data = await api.sessions();
    setSessions(data.sessions);
  }

  async function chooseProject(id: string) {
    await api.selectProject(id);
    // Sync now: a catch-up response for the old project must not land after this.
    activeProjectIdRef.current = id;
    resetCommandTurn();
    setActiveProjectId(id);
    cancelOpen(openTarget);
    setSessionId(null);
    setMessages([]);
    // Commands and models are fetched per project directory. Drop any request
    // still in flight for the old project and clear its loading flag.
    commandGate.invalidate();
    modelGate.invalidate();
    setCommandCatalog(null);
    setCommandLoadError(null);
    setCommandLoading(false);
    setCatalog(null);
    setModelLoadError(null);
    setModelLoading(false);
    setChanges(EMPTY_CHANGES);
    setExpandedTurns(new Set());
    turnDiffs.clear();
    turnTracker.reset();
    setSettingsOpen(false);
    setStick(true);
    const data = await api.sessions();
    setSessions(data.sessions);
  }

  /**
   * Open the Add project dialog and settle with its result. The sidebar button
   * and New chat both call this, so one dialog (not window.prompt, which some
   * contexts suppress and which the repo treats as an anti-pattern) owns the
   * whole flow: one path, one project selected.
   */
  function addProject(trigger?: HTMLElement | null): Promise<Project | null> {
    // A request left over from a dialog that was already replaced must not hang.
    addProjectResolve.current?.(null);
    addProjectReturnFocus.current = trigger ?? null;
    setAddProjectOpen(true);
    return new Promise((resolve) => {
      addProjectResolve.current = resolve;
    });
  }

  /** Close the dialog and hand its result to whoever awaited addProject(). */
  const closeAddProject = useCallback((project: Project | null) => {
    const resolve = addProjectResolve.current;
    addProjectResolve.current = null;
    setAddProjectOpen(false);
    resolve?.(project);
    const trigger = addProjectReturnFocus.current;
    addProjectReturnFocus.current = null;
    // Back to the control that opened the dialog, unless it is gone.
    if (trigger?.isConnected) requestAnimationFrame(() => trigger.focus());
  }, []);

  /** Dialog submit: the controller validates the path; failures land in the dialog. */
  async function addProjectTo(path: string, name?: string): Promise<Project> {
    const result = await api.addProject(path, name);
    setProjects((current) => (current.some((item) => item.id === result.project.id) ? current : [...current, result.project]));
    await chooseProject(result.project.id);
    setError(null);
    return result.project;
  }

  async function openSession(id: string, projectId: string | null = activeProjectId, expectDirectory?: string) {
    setSettingsOpen(false);
    resetCommandTurn();
    setMessages(dropPendingBubbles);
    filesGate.invalidate();
    setChanges(EMPTY_CHANGES);
    stepFilesRef.current.clear();
    turnTracker.reset();
    filesStaleRef.current = false;
    setExpandedTurns(new Set());
    turnDiffs.clear();
    // Shown as selected right away, but not reusable by a send until the server confirms it.
    confirmedSessionRef.current = null;
    setSessionId(id);
    sessionRef.current = id; // sync now, so the confirm/clear checks below never read a pre-render value
    setOpeningSessionId(id);
    setWorking(false);
    setError(null);
    setStick(true);
    // Latest open wins: a late response for a chat the user has left (or an
    // older request for the same id) must not touch the view or the opening flag.
    await runLatest(openGate, () => api.openSession(id), {
      onData: (data) => {
        if (expectDirectory !== undefined && !belongsToProject(data.session.directory, expectDirectory)) {
          // A remembered id that turned out to be another project's chat: forget it, show nothing.
          forgetSession(browserStorage(), id);
          setSessionId(null);
          setMessages([]);
          setChanges(EMPTY_CHANGES);
          return;
        }
        setMessages(data.messages);
        // An unloadable diff (e.g. too large) must not read as "No file changes".
        setChanges(changesLoaded(id, data.files, data.filesError ?? null));
        setSessions((current) => upsertSession(current, data.session));
        if (data.session.model) {
          setModel(data.session.model);
          setModelSource("session");
        } else {
          setModelSource("desk");
        }
        confirmedSessionRef.current = id;
        rememberSession(browserStorage(), projectId, id);
      },
      // A 404 means this id is gone for good, whichever open asked: forget only this id.
      onAnyError: (err) => {
        if (isMissingSession(err)) forgetSession(browserStorage(), id);
      },
      onError: (err) => {
        // Never keep (or write back) an id that failed to open.
        setSessionId(null);
        setMessages([]);
        setChanges(EMPTY_CHANGES);
        setError(err instanceof Error ? err.message : "Could not open that chat");
      },
      onSettled: () => setOpeningSessionId(null),
    });
  }

  /**
   * For fire-and-forget callers. runLatest lets a bug in onData reject; report it
   * on the chat that hit it (never on one the user has moved to) so it can't sit
   * on "Still opening…" or fail silently.
   */
  function openSessionOrReport(id: string, projectId?: string | null, expectDirectory?: string): Promise<void> {
    return openSession(id, projectId === undefined ? activeProjectId : projectId, expectDirectory).catch((err: unknown) => {
      if (sessionRef.current !== id) return;
      setOpeningSessionId(null);
      setError(err instanceof Error ? err.message : "Could not open that chat");
    });
  }

  async function newChat(trigger?: HTMLElement | null) {
    if (creatingChat) return;
    setCreatingChat(true);
    setSettingsOpen(false);
    setError(null);
    try {
      // A session belongs to a project. If none is selected yet, use the
      // existing Add Project flow, then create the chat in that project.
      const targetProject = project ?? await addProject(trigger);
      if (!targetProject) return;
      const created = await api.createSession();
      setSessions((current) => upsertSession(current, created.session));
      resetCommandTurn();
      setActiveProjectId(targetProject.id);
      activeProjectIdRef.current = targetProject.id;
      cancelOpen(openTarget, created.session.id);
      setSessionId(created.session.id);
      setMessages([]);
      setChanges(EMPTY_CHANGES);
      setExpandedTurns(new Set());
      turnDiffs.clear();
      turnTracker.reset();
      setPrompts([]);
      setWorking(false);
      rememberSession(browserStorage(), targetProject.id, created.session.id);
      setStick(true);
      setShowJump(false);
      setInspector("work");
      requestAnimationFrame(() => composer.current?.focus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a new chat");
    } finally {
      setCreatingChat(false);
    }
  }

  async function submit() {
    const text = draft.trim();
    const plan = planSend({
      text,
      busy: working || messages.some((m) => m.pending),
      current: sessionId,
      confirmed: confirmedSessionRef.current,
      opening: openingSessionId,
    });
    if (plan.kind === "ignore") return;
    if (plan.kind === "wait") {
      // The draft stays in the composer; nothing is created or reused.
      setError(plan.message);
      return;
    }
    if (!project) {
      setError("Add a project before starting a chat.");
      return;
    }
    const parsed = parseCommandInput(text);
    if (parsed) {
      await dispatchCommand(parsed.name, parsed.args);
      return;
    }
    setError(null);
    setStick(true);
    setSettingsOpen(false);
    let id: string | null = null;
    try {
      id = await ensureSession();
    } catch (err) {
      // The draft was not cleared yet, so the typed prompt survives.
      setError(err instanceof Error ? err.message : "Could not start a chat");
      return;
    }
    if (!id) return;
    // Clear only once a session exists, matching dispatchCommand.
    setDraft("");
    pendingCommandRef.current = null;
    settledCommandRef.current = null;
    const tempId = `local_${Date.now()}`;
    setMessages((current) => [
      ...current,
      { id: tempId, role: "user", text, created: Date.now(), activity: [], pending: true },
    ]);
    setWorking(true);
    try {
      await api.send(id, text, modelForSend(model, effective) || undefined, agent || undefined);
    } catch (err) {
      setMessages((current) => current.filter((m) => m.id !== tempId));
      setDraft(text);
      setWorking(false);
      setError(err instanceof Error ? err.message : "Could not send that");
    }
  }

  async function stop() {
    if (!sessionId) return;
    await api.abort(sessionId);
    setWorking(false);
  }

  /** Bubble Retry: resend the open chat's newest prompt (the old reply is regenerated). */
  async function retryOpenChat() {
    if (!sessionId || working) return;
    setError(null);
    setWorking(true);
    try {
      await api.retry(sessionId);
    } catch (err) {
      setWorking(false);
      toast.error(err instanceof Error ? err.message : "Could not resend that message");
    }
  }

  /**
   * Bubble Edit: the controller rewrites the newest prompt (drops it and its
   * reply, then sends the new text). Refetching is the honest way to settle the
   * transcript — the server's linear history is the truth, and live deltas for
   * the new reply keep merging by message id.
   */
  async function editLastPrompt(text: string): Promise<boolean> {
    if (!sessionId || working) return false;
    setError(null);
    setWorking(true);
    try {
      await api.editMessage(sessionId, text);
    } catch (err) {
      setWorking(false);
      toast.error(err instanceof Error ? err.message : "Could not edit that message");
      return false;
    }
    await openSessionOrReport(sessionId);
    requestAnimationFrame(() => composer.current?.focus());
    return true;
  }

  /**
   * Row Delete (no undo; the row asks twice). The SSE session-deleted branch is
   * the normal teardown driver; the open-chat part is mirrored here so the desk
   * is correct even if that event is missed — both paths are idempotent.
   */
  async function deleteChat(item: { id: string; title: string }): Promise<boolean> {
    try {
      await api.deleteSession(item.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete that chat");
      return false;
    }
    setSessions((current) => current.filter((row) => row.id !== item.id));
    forgetSession(browserStorage(), item.id);
    archiveUndo.forget(item.id);
    if (sessionRef.current === item.id) {
      cancelOpen(openTarget);
      setSessionId(null);
      setMessages([]);
      setChanges(EMPTY_CHANGES);
      setWorking(false);
    }
    try {
      await refreshSessions();
    } catch {
      /* the session-deleted event removes it anyway */
    }
    return true;
  }

  /** Inline rename. False keeps the editor open so the typed title is not lost. */
  async function renameChat(id: string, title: string): Promise<boolean> {
    try {
      await api.renameSession(id, title);
      // `sessions` feeds both this row and the header title, so renaming the open
      // chat updates the header too.
      await refreshSessions();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename that chat");
      return false;
    }
  }

  /**
   * Per-row Archive: archiveUndo keeps the Undo notice and its failure display.
   * The open-chat teardown runs only when the archived chat is the one on screen.
   */
  function archiveChat(item: { id: string; title: string }) {
    const archivedId = item.id;
    const archivedTitle = item.title;
    void archiveUndo.archive({ id: archivedId, title: archivedTitle }).then((notice) => {
      focusUndoNext.current = true;
      setArchiveFailure(null);
      setArchiveNotice({ ...notice, projectId: activeProjectId });
      forgetSession(browserStorage(), archivedId);
      // A slow archive must not clear a chat the user picked in the meantime.
      if (sessionRef.current === archivedId) {
        resetCommandTurn();
        cancelOpen(openTarget);
        setSessionId(null);
        setMessages([]);
        setChanges(EMPTY_CHANGES);
      }
      return refreshSessions();
    }).catch((err: unknown) => {
      // The row action is explicit, so its failure belongs in the notice even if
      // the open chat is a different one.
      setArchiveFailure({
        sessionId: archivedId,
        text: `Could not archive “${archivedTitle}”: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    });
  }

  async function reply(prompt: PermissionPrompt, decision: "once" | "always" | "reject", message?: string) {
    await api.reply(prompt.id, decision, { sessionId: prompt.sessionId, kind: prompt.kind, message });
    setPrompts((current) => current.filter((item) => item.id !== prompt.id));
    if (decision === "reject") {
      setMessages((current) => [
        ...current,
        { id: `sys_${Date.now()}`, role: "system", text: "Permission denied — run aborted.", created: Date.now(), activity: [] },
      ]);
      setWorking(false);
      if (prompt.sessionId) void api.abort(prompt.sessionId).catch(() => {});
    }
  }

  // relative: gives absolutely positioned descendants (sr-only labels) a containing
  // block inside the clipped shell, so they can't extend the document's scroll area.
  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav
          id="desk-sidebar"
          aria-label="Paddy"
          className="relative flex w-52 shrink-0 flex-col border-r border-border bg-bg sm:w-60 lg:w-[var(--desk-left)]"
          style={{ "--desk-left": `${panels.left.width}px` } as CSSProperties}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
            <HelixMark spinning={working} className="size-7 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="truncate font-display text-lg leading-none tracking-tight">Paddy</p>
              <p className="truncate text-xs text-muted">Irishman</p>
            </div>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
            <button
              type="button"
              onClick={(event) => void newChat(event.currentTarget)}
              disabled={creatingChat}
              className="flex h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-sm text-fg transition-colors hover:bg-surface"
            >
              <Plus className="size-4 shrink-0" />
              {creatingChat ? "Creating chat…" : "New chat"}
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
            <button
              type="button"
              onClick={(event) => void addProject(event.currentTarget)}
              className="flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-sm text-muted transition-colors hover:bg-surface hover:text-fg"
            >
              <Plus className="size-4 shrink-0" />
              <span className="truncate">Add project</span>
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
                  <SessionRow
                    key={item.id}
                    item={item}
                    active={item.id === sessionId && !settingsOpen}
                    onOpen={() => void openSessionOrReport(item.id)}
                    onRename={(title) => renameChat(item.id, title)}
                    onArchive={() => archiveChat(item)}
                    onDelete={() => deleteChat(item)}
                  />
                ))}
              </div>
            ))}
            {!groups.length && <p className="px-2.5 py-2 text-xs text-subtle">No chats yet.</p>}
          </div>
          <div className="border-t border-border p-2">
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
          {panels.wide && (
            <ResizeHandle
              side="left"
              label="Resize sidebar"
              controls="desk-sidebar"
              width={panels.left.width}
              min={panels.left.min}
              max={panels.left.max}
              onResize={panels.left.resize}
              onCommit={panels.left.commit}
              onReset={panels.left.reset}
            />
          )}
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
              {project && (
                <ModelPicker
                  open={pickerOpen}
                  onOpenChange={(next) => {
                    setPickerOpen(next);
                    if (next) void loadModels();
                  }}
                  models={catalog?.models ?? []}
                  defaultKey={catalog?.default ?? ""}
                  active={effective}
                  catalogLoaded={catalogLoaded}
                  connected={Boolean(status?.connected)}
                  loading={modelLoading}
                  loadError={modelLoadError}
                  onSelect={(key) => {
                    chooseModel(key);
                    setPickerOpen(false);
                  }}
                  onRetry={() => void loadModels(true)}
                />
              )}
              <span className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
                <span className={cn("size-1.5 rounded-full", status?.connected ? "bg-ok pulse-live" : "bg-subtle")} />
                {status?.connected ? "Live" : "Offline"}
              </span>
            </div>
          </header>

          {settingsOpen ? (
            <SettingsPanel
              status={status}
              projects={projects}
              appearance={boot?.appearance ?? "dark"}
              model={model}
              hasConnectionPassword={boot?.hasConnectionPassword ?? false}
              onAppearance={(appearance) => {
                applyTheme(appearance);
                setBoot((current) => (current ? { ...current, appearance } : current));
              }}
              onModelChange={(next) => {
                setModel(next);
                setModelSource("desk");
              }}
              onProjectsChange={setProjects}
              onAddProject={(trigger) => void addProject(trigger)}
              onReconnect={() => void api.connect().then(setStatus)}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div
                  ref={listRef}
                  className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8"
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
                    setStick(distance < 80);
                    setShowJump(distance >= 80);
                  }}
                >
                  {!messages.length && loadingSession ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted">
                      <HelixMark spinning className="size-8 text-accent" />
                      <span className="text-sm">Loading session…</span>
                    </div>
                  ) : !messages.length ? (
                    <PaddyIdle name="Paddy" busy={working} />
                  ) : (
                    <div className="mx-auto flex max-w-2xl flex-col gap-6">
                      {messages.map((message) => {
                        const turn = sessionId ? turns.get(message.id) : undefined;
                        const turnKey = turn?.turn ?? -1;
                        const expandKey = sessionId ? turnStateKey(sessionId, turnKey) : "";
                        return (
                          <div key={message.id}>
                            <MessageView
                              message={message}
                              retryable={message.id === retryableId && !working}
                              busy={working}
                              onRetry={() => void retryOpenChat()}
                              onEdit={editLastPrompt}
                            />
                            {turn && sessionId && (
                              <div className="pl-10">
                                <FilesChangedBlock
                                  key={`${sessionId}:t${turnKey}`}
                                  sessionId={sessionId}
                                  from={turn.from}
                                  paths={turn.files}
                                  version={`${turn.files.length}:${turnEpoch}`}
                                  open={expandedTurns.has(expandKey)}
                                  cache={turnDiffs}
                                  turn={turnKey}
                                  onOpenChange={(open) =>
                                    setExpandedTurns((current) => {
                                      const next = new Set(current);
                                      if (open) next.add(expandKey);
                                      else next.delete(expandKey);
                                      return next;
                                    })
                                  }
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {prompts.map((item) => (
                        <PermissionCard key={item.id} prompt={item} onReply={(decision, message) => reply(item, decision, message)} />
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
                <div
                  ref={noticeRegion}
                  role="status"
                  aria-live="polite"
                  data-session={archiveNotice?.sessionId ?? archiveFailure?.sessionId}
                  onMouseEnter={() => holdNotice("hover", true)}
                  onMouseLeave={() => holdNotice("hover", false)}
                  onFocus={() => holdNotice("focus", true)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) holdNotice("focus", false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || (!archiveNotice && !archiveFailure)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    closeNotice();
                  }}
                  className={
                    archiveNotice || archiveFailure
                      ? "flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-4 py-1.5 text-[11px] text-muted"
                      : undefined
                  }
                >
                  {archiveNotice ? (
                    <>
                      <span className="min-w-0 flex-1 truncate" title={archiveNotice.title}>
                        Chat archived · {archiveNotice.title}
                      </span>
                      <button
                        ref={undoButton}
                        type="button"
                        aria-label={`Undo archive of ${archiveNotice.title}`}
                        onClick={undoArchive}
                        className="shrink-0 rounded-md border border-border bg-surface px-2 py-0.5 text-fg hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        Undo
                      </button>
                      <button
                        type="button"
                        aria-label="Dismiss archive notice"
                        onClick={closeNotice}
                        className="shrink-0 rounded-md px-1.5 py-0.5 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        ×
                      </button>
                      {archiveFailure?.sessionId === archiveNotice.sessionId && (
                        <span className="w-full break-words text-danger">{archiveFailure.text}</span>
                      )}
                    </>
                  ) : archiveFailure ? (
                    <>
                      <span className="min-w-0 flex-1 break-words text-danger">{archiveFailure.text}</span>
                      <button
                        type="button"
                        aria-label="Dismiss"
                        onClick={closeNotice}
                        className="shrink-0 rounded-md px-1.5 py-0.5 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        ×
                      </button>
                    </>
                  ) : null}
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
                ) : streamNotice ? (
                  <p role="status" className="truncate border-t border-border px-4 py-1.5 text-[11px] text-muted">
                    {streamNotice}
                  </p>
                ) : error ? (
                  <p className="truncate border-t border-border px-4 py-1.5 text-[11px] text-danger">
                    {error}
                    <button type="button" className="ml-2 text-muted hover:text-fg" onClick={() => void api.connect().then(setStatus)}>
                      Reconnect
                    </button>
                  </p>
                ) : null}
                {latestFileCount > 0 && (
                  <button
                    type="button"
                    className="flex items-center gap-2 border-t border-border px-4 py-1.5 text-[11px] text-muted hover:text-fg lg:hidden"
                    onClick={() => setInspector("changes")}
                  >
                    <FolderGit2 className="size-3.5" />
                    {/* Snapshot-based (touched); the Changes tab it opens shows the net diff. */}
                    ~{latestFileCount} file{latestFileCount === 1 ? "" : "s"} touched
                  </button>
                )}
                {showJump && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      className="mb-1 rounded-full bg-elevated px-3 py-1 text-[11px] text-muted shadow-[var(--shadow-border)]"
                      onClick={() => {
                        setStick(true);
                        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
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
                  <div className="relative mx-auto max-w-2xl">
                    <CommandPalette
                      open={paletteOpen}
                      commands={visibleCommands}
                      hasCatalog={(commandCatalog?.length ?? 0) > 0}
                      query={commandQuery ?? ""}
                      activeIndex={commandIndex}
                      connected={Boolean(status?.connected)}
                      loading={commandLoading}
                      loadError={commandLoadError}
                      onSelect={(name) => {
                        const args = parseCommandInput(draft)?.args ?? "";
                        setDraft(`/${name}${args ? ` ${args}` : " "}`);
                        composer.current?.focus();
                      }}
                      onRetry={() => void loadCommands()}
                      onClear={() => {
                        setDraft("/");
                        setCommandIndex(0);
                        composer.current?.focus();
                      }}
                    />
                    <div className="rounded-2xl bg-elevated p-2 shadow-[var(--shadow-border)]">
                    <div className="flex items-end gap-2">
                    <textarea
                      ref={composer}
                      data-composer
                      role={paletteOpen ? "combobox" : undefined}
                      aria-expanded={paletteOpen ? true : undefined}
                      aria-controls={paletteOpen ? "command-listbox" : undefined}
                      aria-activedescendant={
                        paletteOpen && activeCommand
                          ? `command-option-${activeCommand.name.replace(/[^A-Za-z0-9_-]/g, "_")}`
                          : undefined
                      }
                      aria-autocomplete={paletteOpen ? "list" : undefined}
                      aria-label="Message Paddy"
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        setCommandDismissed(false);
                        setCommandIndex(0);
                      }}
                      onKeyDown={(event) => {
                        if (paletteOpen) {
                          if (
                            event.key === "ArrowDown" ||
                            event.key === "ArrowUp" ||
                            event.key === "Home" ||
                            event.key === "End"
                          ) {
                            event.preventDefault();
                            const next = nextCommandIndex(commandIndex, visibleCommands.length, event.key);
                            setCommandIndex(next);
                            const target = visibleCommands[next];
                            if (target) {
                              requestAnimationFrame(() => {
                                document
                                  .getElementById(`command-option-${target.name.replace(/[^A-Za-z0-9_-]/g, "_")}`)
                                  ?.scrollIntoView({ block: "nearest" });
                              });
                            }
                            return;
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setCommandDismissed(true);
                            return;
                          }
                          if (event.key === "Tab" && !event.shiftKey && activeCommand) {
                            event.preventDefault();
                            const parsed = parseCommandInput(draft);
                            setDraft(`/${activeCommand.name}${parsed?.args ? ` ${parsed.args}` : " "}`);
                            return;
                          }
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            if (working || messages.some((m) => m.pending)) return;
                            const parsed = parseCommandInput(draft);
                            if (activeCommand) void dispatchCommand(activeCommand.name, parsed?.args ?? "");
                            else if (parsed) void dispatchCommand(parsed.name, parsed.args);
                            return;
                          }
                        }
                        if (event.key === "Enter" && !event.shiftKey) {
                          if (working || messages.some((m) => m.pending)) {
                            event.preventDefault();
                            return;
                          }
                          event.preventDefault();
                          void submit();
                        }
                      }}
                      rows={1}
                      placeholder={openingSelected ? "Opening chat…" : "Message Paddy"}
                      className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-fg placeholder:text-subtle focus:outline-none"
                    />
                    {working ? (
                      <Button type="button" size="icon" variant="danger" aria-label="Stop" onClick={() => void stop()}>
                        <Square />
                      </Button>
                    ) : (
                      <Button type="submit" size="icon" disabled={sendDisabled} aria-label={openingSelected ? "Send (opening chat…)" : "Send"}>
                        <ArrowUp />
                      </Button>
                    )}
                    </div>
                    {/* Agent control sits inside the box but below the input row:
                        the textarea keeps its full width at narrow viewports. */}
                    <div className="mt-1 flex items-center gap-1 px-1">
                      <AgentPicker agents={agents} agent={agent} onChange={setAgent} />
                    </div>
                    </div>
                  </div>
                  {modelNote && (
                    <p className="mx-auto mt-2 max-w-2xl px-2 text-[11px] text-warn">{modelNote}</p>
                  )}
                  <p className="mx-auto mt-2 max-w-2xl px-2 text-[11px] text-subtle">
                    Enter to send · Shift+Enter for a line · work stays in {project?.name ?? "the selected project"}
                  </p>
                </form>
              </section>

              <aside
                id="desk-inspector"
                aria-label="Inspector"
                className="relative hidden min-h-0 w-[22rem] shrink-0 flex-col border-l border-border bg-surface lg:flex lg:w-[var(--desk-right)]"
                style={{ "--desk-right": `${panels.right.width}px` } as CSSProperties}
              >
                {panels.wide && (
                  <ResizeHandle
                    side="right"
                    label="Resize inspector"
                    controls="desk-inspector"
                    width={panels.right.width}
                    min={panels.right.min}
                    max={panels.right.max}
                    onResize={panels.right.resize}
                    onCommit={panels.right.commit}
                    onReset={panels.right.reset}
                  />
                )}
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
                    <ChangesPanel
                      changes={changes}
                      openSessionId={sessionId}
                      onRetry={() => {
                        if (sessionId) refreshLatestFiles(sessionId);
                      }}
                    />
                  )}
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
      {addProjectOpen && <AddProjectDialog onAdd={addProjectTo} onClose={closeAddProject} />}
    </div>
  );
}

/**
 * Swap the theme without colour transitions: elements with transition-colors
 * (sidebar pills) would otherwise fade from the old theme's colours for
 * ~150 ms. Transitions come back two frames later, after the new paint.
 */
function applyTheme(appearance: string) {
  const root = document.documentElement;
  root.dataset.themeSwitching = "";
  root.dataset.theme = appearance;
  requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.themeSwitching));
}

function SectionLabel({ children }: { children: string }) {
  return <p className="mt-3 mb-1 px-2.5 text-[11px] font-medium tracking-wide text-muted uppercase">{children}</p>;
}

const ROW_ACTION_CLASS =
  "flex size-6 items-center justify-center rounded-md text-subtle transition-colors hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40";

/**
 * One sidebar chat row. Retry / Rename / Archive live on the row (not in the
 * header) so each action names the chat it acts on. The icons are reachable by
 * keyboard, always visible on the active row and on touch, and revealed on
 * hover/focus for the rest.
 */
function SessionRow({
  item,
  active,
  onOpen,
  onRename,
  onArchive,
  onDelete,
}: {
  item: SessionSummary;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => Promise<boolean>;
  onArchive: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  /** Read in the blur handler: a save must not be cancelled by losing focus. */
  const savingRef = useRef(false);
  savingRef.current = saving;
  const input = useRef<HTMLInputElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  /** Delete is destructive and has no undo, so it takes a second click. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimer = useRef<number | null>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);

  const resetDelete = useCallback((returnFocus: boolean) => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = null;
    setConfirmingDelete(false);
    if (returnFocus) requestAnimationFrame(() => deleteButton.current?.focus());
  }, []);

  useEffect(() => {
    if (!confirmingDelete) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        resetDelete(true);
      }
    }
    /** Click-away (or another row) abandons the confirm; the second click is inside the button. */
    function onPointerDown(event: PointerEvent) {
      if (!deleteButton.current?.contains(event.target as Node)) resetDelete(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [confirmingDelete, resetDelete]);

  // The first click swaps the button; carry focus to the confirm so Enter/Space
  // finish it and a blur can abandon it.
  useEffect(() => {
    if (confirmingDelete) deleteButton.current?.focus();
  }, [confirmingDelete]);

  useEffect(
    () => () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  function askDelete() {
    setConfirmingDelete(true);
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => setConfirmingDelete(false), 4000);
  }

  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);

  function startEditing() {
    setValue(item.title);
    setEditing(true);
  }

  /** Focus goes back to the Rename trigger only for explicit exits — a blur must not steal the click. */
  function stopEditing(restoreFocus: boolean) {
    setEditing(false);
    if (restoreFocus) requestAnimationFrame(() => renameButton.current?.focus());
  }

  async function commit() {
    if (savingRef.current) return;
    const next = value.trim();
    if (!next || next === item.title) {
      stopEditing(true);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const ok = await onRename(next);
    savingRef.current = false;
    setSaving(false);
    if (!ok) {
      input.current?.focus();
      return;
    }
    stopEditing(true);
  }

  return (
    <div
      className={cn(
        "group/session flex h-9 w-full items-center rounded-xl transition-colors",
        active ? "bg-elevated text-fg" : "text-muted hover:bg-surface hover:text-fg",
      )}
    >
      {editing ? (
        <input
          ref={input}
          value={value}
          disabled={saving}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              stopEditing(true);
            }
          }}
          onBlur={() => {
            if (!savingRef.current) stopEditing(false);
          }}
          aria-label={`Rename '${item.title}'`}
          className="mx-1 h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      ) : (
        <button type="button" onClick={onOpen} title={item.title} className="h-full min-w-0 flex-1 truncate px-2.5 text-left text-sm">
          {item.title}
        </button>
      )}
      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 pr-1.5 transition-opacity",
          active ? "opacity-100" : "opacity-0 group-hover/session:opacity-100 group-focus-within/session:opacity-100 [@media(pointer:coarse)]:opacity-100",
        )}
      >
        <button
          ref={renameButton}
          type="button"
          aria-label={`Rename '${item.title}'`}
          title="Rename"
          onClick={startEditing}
          disabled={saving}
          className={ROW_ACTION_CLASS}
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Archive '${item.title}'`}
          title="Archive"
          onClick={onArchive}
          disabled={saving}
          className={ROW_ACTION_CLASS}
        >
          <Archive className="size-3.5" />
        </button>
        {confirmingDelete ? (
          <button
            ref={deleteButton}
            type="button"
            aria-label={`Confirm delete '${item.title}'`}
            onBlur={() => resetDelete(false)}
            onClick={() => {
              resetDelete(false);
              void onDelete();
            }}
            className="flex h-6 shrink-0 items-center rounded-md bg-danger/15 px-1.5 text-[11px] font-medium text-danger hover:bg-danger/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Delete?
          </button>
        ) : (
          <button
            ref={deleteButton}
            type="button"
            aria-label={`Delete '${item.title}'`}
            title="Delete"
            onClick={askDelete}
            onBlur={() => resetDelete(false)}
            disabled={saving}
            className={ROW_ACTION_CLASS}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Add project dialog: a real form instead of window.prompt (blocked in some
 * contexts, and a repo anti-pattern). Server validation failures render next to
 * the field that caused them, not in the desk's global error bar.
 */
function AddProjectDialog({
  onAdd,
  onClose,
}: {
  onAdd: (path: string, name?: string) => Promise<Project>;
  onClose: (project: Project | null) => void;
}) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Read by the Escape listener, which must not re-subscribe on every keystroke. */
  const pendingRef = useRef(false);
  pendingRef.current = pending;
  const input = useRef<HTMLInputElement>(null);
  /** Folder pane: `browsePath` is the folder being requested; `listing` is the last good answer. */
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [listing, setListing] = useState<FsDirListing | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);
  const [listingLoading, setListingLoading] = useState(true);
  const [listingReload, setListingReload] = useState(0);

  // Opened: the path is the only required field, so put the caret there.
  useEffect(() => {
    input.current?.focus();
  }, []);

  // One listing at a time; a slow answer for a folder the user already left is
  // dropped rather than overwriting the current one.
  useEffect(() => {
    let cancelled = false;
    setListingLoading(true);
    setListingError(null);
    api
      .fsDirs(browsePath ?? undefined)
      .then((data) => {
        if (cancelled) return;
        setListing(data);
        setListingLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setListingError(err instanceof Error ? err.message : "Could not list that folder");
        setListingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [browsePath, listingReload]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // While the controller is adding, Escape waits: that request cannot be
      // aborted, and closing now would pop a project in after the user cancelled.
      if (event.key === "Escape" && !pendingRef.current) {
        event.preventDefault();
        onClose(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return; // Enter twice must not add twice
    const trimmed = path.trim();
    if (!trimmed) {
      setError("Enter the absolute path to a project folder.");
      input.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      onClose(await onAdd(trimmed, name.trim() || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that project");
      setPending(false);
      input.current?.focus();
    }
  }

  /** Keep Tab inside the modal: aria-modal alone does not stop focus escaping. */
  function trapFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onClose(null);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
        onKeyDown={trapFocus}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-border bg-elevated p-5 shadow-[var(--shadow-border-hover)]"
      >
        <h2 id="add-project-title" className="text-sm font-medium text-fg">Add project</h2>
        <p id="add-project-hint" className="mt-1 text-xs text-muted">
          Paddy works in a folder on this machine. Browse below, or paste its absolute path.
        </p>

        {/* The finder: one focus-trapped surface with the form, above the path
            input so browsing and typing are the same decision. */}
        <section aria-label="Folders" className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-1 border-b border-border px-1.5 py-1">
            <button
              type="button"
              aria-label="Parent folder"
              title="Parent folder"
              onClick={() => listing?.parent && setBrowsePath(listing.parent)}
              disabled={listingLoading || Boolean(listingError) || !listing?.parent}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40"
            >
              <ArrowUpLeft className="size-3.5" />
            </button>
            <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={browsePath ?? listing?.path ?? "Home"}>
              {browsePath ?? listing?.path ?? "Home"}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (!listing) return;
                setPath(listing.path);
                setError(null);
                input.current?.focus();
              }}
              disabled={listingLoading || Boolean(listingError) || !listing}
            >
              Use this folder
            </Button>
          </div>
          <div className="scrollbar-thin max-h-52 min-h-24 overflow-y-auto overscroll-contain p-1">
            {listingLoading ? (
              <p role="status" className="px-2 py-3 text-xs text-muted">
                Loading folders…
              </p>
            ) : listingError ? (
              <div className="px-2 py-3 text-xs">
                <p role="alert" className="text-danger">
                  {listingError}
                </p>
                <div className="mt-1 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setListingReload((value) => value + 1)}
                    className="text-muted underline hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    Try again
                  </button>
                  {/* An unreadable subfolder must not trap the browse: the last
                      folder we successfully listed is one level up. */}
                  {listing && (
                    <button
                      type="button"
                      onClick={() => setBrowsePath(listing.path)}
                      className="text-muted underline hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      Back
                    </button>
                  )}
                </div>
              </div>
            ) : !listing || listing.entries.length === 0 ? (
              <p className="px-2 py-3 text-xs text-subtle">No subfolders.</p>
            ) : (
              listing.entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => setBrowsePath(entry.path)}
                  title={entry.name}
                  className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <Folder className="size-3.5 shrink-0 text-subtle" aria-hidden />
                  <span className="truncate">{entry.name}</span>
                  <ChevronRight className="ml-auto size-3 shrink-0 opacity-50" aria-hidden />
                </button>
              ))
            )}
          </div>
          {listing?.truncated && (
            <p className="border-t border-border px-2 py-1 text-[10px] text-warn">Showing the first 500 folders.</p>
          )}
        </section>

        <form className="mt-3 space-y-3" onSubmit={submit}>
          <div>
            <label htmlFor="add-project-path" className="text-[11px] font-medium tracking-wide text-muted uppercase">
              Project folder
            </label>
            <Input
              ref={input}
              id="add-project-path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/home/you/code/project"
              aria-describedby={error ? "add-project-hint add-project-error" : "add-project-hint"}
              aria-invalid={error ? true : undefined}
              autoComplete="off"
              spellCheck={false}
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="add-project-name" className="text-[11px] font-medium tracking-wide text-muted uppercase">
              Name <span className="normal-case text-subtle">(optional)</span>
            </label>
            <Input
              id="add-project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Defaults to the folder name"
              autoComplete="off"
              className="mt-1"
            />
          </div>
          {error && (
            <p id="add-project-error" role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onClose(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !path.trim()}>
              {pending ? "Adding…" : "Add project"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const BUBBLE_ACTION_CLASS =
  "pointer-events-auto flex size-6 items-center justify-center rounded-md text-subtle transition-colors hover:bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40";

/** Overlay row under a bubble: no bubble width/height shift when it appears. */
const BUBBLE_ACTIONS_CLASS =
  "pointer-events-none absolute top-full z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 [@media(pointer:coarse)]:opacity-100";

function MessageView({
  message,
  retryable,
  busy,
  onRetry,
  onEdit,
}: {
  message: ChatMessage;
  /** This is the open chat's newest settled prompt: Retry/Edit are allowed. */
  retryable: boolean;
  busy: boolean;
  onRetry: () => void;
  onEdit: (text: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(message.activity.some((item) => item.status === "running"));
  const preview = activityPreview(message.activity);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const editInput = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!editing) return;
    editInput.current?.focus();
    editInput.current?.select();
  }, [editing]);

  // A failed save disables the textarea while the request runs, which drops
  // focus to <body>; when it re-enables, put the caret back so Escape works.
  useEffect(() => {
    if (!editing || saving) return;
    editInput.current?.focus();
  }, [editing, saving]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy the message");
    }
  }

  function startEdit() {
    setDraft(message.text);
    setEditing(true);
  }

  function stopEdit(restoreFocus: boolean) {
    setEditing(false);
    if (restoreFocus) requestAnimationFrame(() => editButton.current?.focus());
  }

  async function commitEdit() {
    if (saving) return;
    const text = draft.trim();
    if (!text || text === message.text) {
      stopEdit(true);
      return;
    }
    setSaving(true);
    const ok = await onEdit(text);
    setSaving(false);
    if (!ok) {
      editInput.current?.focus();
      return;
    }
    setEditing(false);
  }

  /** Copy on every bubble; Retry/Edit only on the prompt the controller can rewrite. */
  function actions(align: "left" | "right") {
    return (
      <div className={cn(BUBBLE_ACTIONS_CLASS, align === "right" ? "right-0" : "left-0")}>
        {retryable && (
          <>
            <button
              type="button"
              aria-label="Resend last message"
              title="Resend last message"
              onClick={onRetry}
              disabled={busy}
              className={BUBBLE_ACTION_CLASS}
            >
              <RotateCcw className="size-3.5" />
            </button>
            <button
              ref={editButton}
              type="button"
              aria-label="Edit message"
              title="Edit last message"
              onClick={startEdit}
              disabled={busy}
              className={BUBBLE_ACTION_CLASS}
            >
              <Pencil className="size-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          aria-label="Copy message"
          title="Copy message"
          onClick={() => void copy()}
          className={BUBBLE_ACTION_CLASS}
        >
          {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    );
  }

  if (message.role === "system") {
    return <p className="text-xs text-muted">{message.text}</p>;
  }
  if (message.role === "user") {
    return (
      <article className="group/msg rise-in" data-command-echo={message.pending && message.text.startsWith("/") ? "true" : undefined}>
        <div className="flex justify-end">
          <div className="relative max-w-[min(100%,36rem)] rounded-2xl rounded-br-md bg-bubble px-4 py-3 text-bubble-fg selection:bg-black/30 selection:text-bubble-fg shadow-[var(--shadow-border)]">
            {editing ? (
              <textarea
                ref={editInput}
                value={draft}
                rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                cols={40}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void commitEdit();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    stopEdit(true);
                  }
                }}
                onBlur={() => {
                  // Clicking away abandons the draft; a save keeps the editor put.
                  if (!saving) stopEdit(false);
                }}
                aria-label="Edit last message"
                className="block max-h-60 w-full min-w-0 resize-none bg-transparent text-sm leading-relaxed text-bubble-fg focus:outline-none"
              />
            ) : (
              <p className="text-sm leading-relaxed text-bubble-fg">{message.text}</p>
            )}
            <div className="mt-1.5 flex items-center justify-end gap-1.5">
              {editing && <span className="mr-auto text-[10px] text-bubble-muted">Enter saves · Esc cancels</span>}
              {message.pending && <span className={cn("size-1.5 rounded-full bg-bubble-fg pulse-live")} style={{ opacity: 0.7 }} />}
              <p className="text-right text-[11px] text-bubble-muted tabular-nums">{formatTime(message.created)}</p>
            </div>
            {actions("right")}
          </div>
        </div>
      </article>
    );
  }
  return (
    <article className="group/msg rise-in">
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
                  {preview.hidden > 0 && <p>and {preview.hidden} earlier step{preview.hidden === 1 ? "" : "s"}</p>}
                  {preview.shown.map((item) => (
                    <p key={item.id}>{item.status === "completed" ? "✓" : "▸"} {item.title}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          {message.text || message.error ? (
            // Chat bubble for assistant replies: hugs short text, caps long text,
            // and mirrors the user bubble's corner treatment from the other side.
            <div className="relative w-fit max-w-[min(100%,36rem)] break-words rounded-2xl rounded-bl-md bg-reply-bubble px-4 py-3 text-reply-bubble-fg selection:bg-black/30 selection:text-reply-bubble-fg shadow-[var(--shadow-border)]">
              {message.text ? <Markdown text={message.text} /> : null}
              {message.error && <p className="mt-2 text-sm text-danger">{message.error}</p>}
              {actions("left")}
            </div>
          ) : null}
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
  onReply: (decision: "once" | "always" | "reject", message?: string) => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = `perm-title-${prompt.id}`;
  const isQuestion = prompt.kind === "question";

  async function handle(decision: "once" | "always" | "reject", message?: string) {
    setPending(true);
    try {
      await onReply(decision, message);
    } catch {
      toast.error("Could not reply. Try again.");
      setPending(false);
    }
  }

  function submitAnswer() {
    const trimmed = answer.trim();
    if (!trimmed) return;
    void handle("once", trimmed);
  }

  return (
    <article className="rise-in" aria-labelledby={titleId}>
      <div className="flex gap-3">
        <HelixMark className="mt-1 size-7 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 rounded-2xl bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
          <p className="font-mono text-[10px] tracking-wide text-accent uppercase">
            {isQuestion ? "question" : "permission"}
          </p>
          <p id={titleId} className="mt-1 text-sm text-fg">
            {isQuestion ? "Paddy is asking" : "Paddy wants to"}
          </p>
          <p className="mt-0.5 text-xs text-muted">{prompt.title}</p>
          <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-bg p-3 font-mono text-xs leading-relaxed text-fg">{prompt.detail}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="danger" disabled={pending} onClick={() => void handle("reject")}>
              {pending ? "…" : "Deny"}
            </Button>
            {!isQuestion && (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => void handle("always")}>
                {pending ? "…" : "Always"}
              </Button>
            )}
            <Button
              size="sm"
              disabled={pending || (isQuestion && asking && !answer.trim())}
              onClick={() => {
                if (!isQuestion) {
                  void handle("once");
                  return;
                }
                if (!asking) {
                  setAsking(true);
                  requestAnimationFrame(() => inputRef.current?.focus());
                  return;
                }
                submitAnswer();
              }}
            >
              {pending ? "…" : isQuestion ? "Answer" : "Allow"}
            </Button>
          </div>
          {isQuestion && asking && (
            <div className="mt-2">
              <Input
                ref={inputRef}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitAnswer();
                  }
                }}
                placeholder="Type your answer"
                className="h-8 text-xs"
              />
            </div>
          )}
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
