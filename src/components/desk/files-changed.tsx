import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, FileDiff } from "lucide-react";
import type { DiffFile, DiffFileStatus } from "@/lib/desk/client";
import { api } from "@/lib/desk/client";
import { capHunks, languageForPath, middleTruncate, parsePatch, type DiffHunk, type DiffLine } from "@/components/desk/diff";
import { MONOKAI, tokenizeLines, type Token } from "@/components/desk/highlight";
import { createRequestGate, runLatest } from "@/components/desk/request-gate";
import { cn } from "@/lib/utils";

/** Rows shown before "Show full diff". Keeps a 5k-line rewrite from freezing the tab. */
export const DIFF_ROW_CAP = 400;

const STATUS: Record<DiffFileStatus, { letter: string; label: string; color: string }> = {
  added: { letter: "A", label: "added", color: MONOKAI.green },
  modified: { letter: "M", label: "modified", color: "#E6DB74" },
  deleted: { letter: "D", label: "deleted", color: MONOKAI.pink },
};

/** Per-turn diff results keyed by turn ordinal; `key` is the range+version they were fetched for. */
export type TurnDiffCache = Map<number, { key: string; files: DiffFile[] }>;

type LoadState = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; files: DiffFile[] };

/**
 * Per-turn "Files changed (N)" disclosure in the chat. N comes from the
 * assistant snapshot (free); the diff itself is fetched only when opened, and
 * refetched when `version` changes while open (new step files, turn end).
 */
export function FilesChangedBlock({
  sessionId,
  from,
  paths,
  version,
  open,
  onOpenChange,
  cache,
  turn,
}: {
  sessionId: string;
  from?: string;
  paths: string[];
  version: string;
  /** Owned by the parent (keyed by turn) so it survives a remount while the turn grows. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Parent-owned per-turn results, so a block remounted under a newer message doesn't reload. */
  cache?: TurnDiffCache;
  turn?: number;
}) {
  const fetchKey = `${from ?? ""}|${version}`;
  const [state, setState] = useState<LoadState>(() => {
    const hit = turn === undefined ? undefined : cache?.get(turn);
    return hit ? { kind: "ready", files: hit.files } : { kind: "idle" };
  });
  const gate = useMemo(createRequestGate, []);
  const panelId = useId();

  const load = () => {
    setState((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    void runLatest(gate, () => api.diff(sessionId, from), {
      onData: (data) => {
        if (turn !== undefined) cache?.set(turn, { key: fetchKey, files: data.files });
        setState({ kind: "ready", files: data.files });
      },
      onError: (err) => setState({ kind: "error", message: err instanceof Error ? err.message : "Could not load the diff" }),
    }).catch(() => setState({ kind: "error", message: "Could not show the diff" }));
  };

  useEffect(() => {
    if (!open) return;
    // Same turn, range and version already loaded (e.g. remounted as the turn grew): show it, don't refetch.
    if (turn !== undefined && cache?.get(turn)?.key === fetchKey) return;
    load();
    // load is recreated each render; the inputs that matter are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, from, version]);
  useEffect(() => () => gate.invalidate(), [gate]);

  const count = state.kind === "ready" ? state.files.length : paths.length;
  return (
    <section className="mt-3 overflow-hidden rounded-xl shadow-[var(--shadow-border)]" aria-label="Files changed">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-2 bg-elevated px-3 py-2 text-left text-xs text-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        <FileDiff aria-hidden className="size-3.5" />
        <span className="font-medium">Files changed ({count})</span>
        {state.kind === "ready" && <Totals files={state.files} />}
      </button>
      {open && (
        <div id={panelId} className="border-t border-border bg-bg p-2">
          <FileDiffList state={state} onRetry={load} pathMax={64} />
        </div>
      )}
    </section>
  );
}

/** Right-inspector "Changes" tab: the newest turn's files, same rows as the chat block. */
export function ChangesPanel({ files, loading, error, onRetry }: { files: DiffFile[]; loading: boolean; error: string | null; onRetry: () => void }) {
  const state: LoadState = error ? { kind: "error", message: error } : loading && !files.length ? { kind: "loading" } : { kind: "ready", files };
  return (
    <div className="space-y-2">
      <p className="px-1 text-[11px] text-muted">
        Latest turn{state.kind === "ready" && files.length ? ` · ${files.length} file${files.length === 1 ? "" : "s"}` : ""}
      </p>
      <FileDiffList state={state} onRetry={onRetry} pathMax={28} />
    </div>
  );
}

function Totals({ files }: { files: DiffFile[] }) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <span className="ml-auto font-mono text-[11px] tabular-nums">
      <span className="text-ok">+{additions}</span> <span className="text-danger">−{deletions}</span>
    </span>
  );
}

function FileDiffList({ state, onRetry, pathMax }: { state: LoadState; onRetry: () => void; pathMax: number }) {
  if (state.kind === "idle" || state.kind === "loading") {
    return (
      <p role="status" className="px-2 py-3 text-xs text-muted">
        Loading changes…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className="flex items-center gap-2 px-2 py-3 text-xs text-danger">
        <span className="min-w-0 flex-1 truncate" title={state.message}>
          {state.message}
        </span>
        <button type="button" onClick={onRetry} className="rounded-md px-2 py-1 text-muted shadow-[var(--shadow-border)] hover:text-fg">
          Retry
        </button>
      </div>
    );
  }
  if (!state.files.length) return <p className="px-2 py-3 text-xs text-muted">No file changes</p>;
  return (
    <ul className="space-y-1">
      {state.files.map((file) => (
        <FileRow key={file.file} file={file} pathMax={pathMax} />
      ))}
    </ul>
  );
}

function FileRow({ file, pathMax }: { file: DiffFile; pathMax: number }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const status = STATUS[file.status] ?? STATUS.modified;
  return (
    <li className="overflow-hidden rounded-lg">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        title={file.file}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ChevronRight aria-hidden className={cn("size-3 shrink-0 text-muted transition-transform", open && "rotate-90")} />
        <span
          className="w-4 shrink-0 text-center font-mono text-[11px] font-semibold"
          style={{ color: status.color }}
          title={status.label}
        >
          {status.letter}
          <span className="sr-only"> {status.label}</span>
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{middleTruncate(file.file, pathMax)}</span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums">
          <span className="text-ok">+{file.additions}</span> <span className="text-danger">−{file.deletions}</span>
        </span>
      </button>
      {open && (
        <div id={panelId}>
          <DiffView file={file} />
        </div>
      )}
    </li>
  );
}

type SideTokens = { old: (Token[] | null)[] | null; new: (Token[] | null)[] | null };

function DiffView({ file }: { file: DiffFile }) {
  const parsed = useMemo(() => parsePatch(file.patch), [file.patch]);
  const [full, setFull] = useState(false);
  const shown = useMemo(() => (full ? { hunks: parsed.hunks, hidden: 0 } : capHunks(parsed.hunks, DIFF_ROW_CAP)), [parsed, full]);
  const tokens = useSideTokens(shown.hunks, file.file);

  const frame: CSSProperties = { background: MONOKAI.bg, color: MONOKAI.fg };
  if (file.binary || parsed.binary) {
    return <Note style={frame}>Binary file — no text diff to show.</Note>;
  }
  if (!parsed.hunks.length) {
    return <Note style={frame}>{file.truncated ? "This diff is too large to show." : "No text changes (mode or rename only)."}</Note>;
  }
  let oldIndex = 0;
  let newIndex = 0;
  return (
    <div className="mt-1 overflow-hidden rounded-lg" style={frame}>
      <div className="scrollbar-thin max-h-[32rem] overflow-auto">
        <table className="w-full border-collapse font-mono text-[11px] leading-[1.6]">
          <caption className="sr-only">Diff of {file.file}</caption>
          <tbody>
            {shown.hunks.map((hunk, hunkIndex) => [
              <tr key={`h${hunkIndex}`} style={{ background: MONOKAI.gutter, color: MONOKAI.muted }}>
                <td colSpan={4} className="px-2 py-0.5 whitespace-pre">
                  {hunk.header}
                </td>
              </tr>,
              ...hunk.lines.map((line, lineIndex) => {
                const lineTokens =
                  line.kind === "del" ? tokens.old?.[oldIndex++] : line.kind === "add" ? tokens.new?.[newIndex++] : line.kind === "ctx" ? (oldIndex++, tokens.new?.[newIndex++]) : undefined;
                return <Row key={`${hunkIndex}:${lineIndex}`} line={line} tokens={lineTokens} />;
              }),
            ])}
          </tbody>
        </table>
      </div>
      {(shown.hidden > 0 || file.truncated) && (
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[11px]" style={{ borderColor: MONOKAI.gutter, color: MONOKAI.muted }}>
          {shown.hidden > 0 && (
            <button type="button" onClick={() => setFull(true)} className="underline hover:text-[#F8F8F2] focus-visible:outline-2 focus-visible:outline-accent">
              Show full diff ({shown.hidden} more line{shown.hidden === 1 ? "" : "s"})
            </button>
          )}
          {file.truncated && <span>Diff cut: the file is too large to show in full.</span>}
        </div>
      )}
    </div>
  );
}

const MARK: Record<DiffLine["kind"], string> = { add: "+", del: "-", ctx: " ", meta: "" };

function Row({ line, tokens }: { line: DiffLine; tokens?: Token[] | null }) {
  if (line.kind === "meta") {
    return (
      <tr style={{ color: MONOKAI.muted }}>
        <td colSpan={4} className="px-2 whitespace-pre italic">
          {line.text}
        </td>
      </tr>
    );
  }
  const background = line.kind === "add" ? MONOKAI.addBg : line.kind === "del" ? MONOKAI.delBg : undefined;
  const markColor = line.kind === "add" ? MONOKAI.green : line.kind === "del" ? MONOKAI.pink : MONOKAI.muted;
  return (
    <tr style={{ background }}>
      <td className="w-px px-2 text-right tabular-nums select-none" style={{ color: MONOKAI.muted }}>
        {line.oldNo ?? ""}
      </td>
      <td className="w-px px-2 text-right tabular-nums select-none" style={{ color: MONOKAI.muted }}>
        {line.newNo ?? ""}
      </td>
      <td className="w-px pl-1 select-none" style={{ color: markColor }} aria-label={line.kind === "add" ? "added" : line.kind === "del" ? "removed" : undefined}>
        {MARK[line.kind]}
      </td>
      <td className="pr-3 whitespace-pre">
        {tokens
          ? tokens.map((token, index) => (
              <span
                key={index}
                style={{
                  color: token.color,
                  fontStyle: token.fontStyle && token.fontStyle & 1 ? "italic" : undefined,
                  fontWeight: token.fontStyle && token.fontStyle & 2 ? 600 : undefined,
                  textDecoration: token.fontStyle && token.fontStyle & 4 ? "underline" : undefined,
                }}
              >
                {token.content}
              </span>
            ))
          : line.text || " "}
      </td>
    </tr>
  );
}

function Note({ children, style }: { children: string; style: CSSProperties }) {
  return (
    <p className="mt-1 rounded-lg px-3 py-2 text-xs" style={{ ...style, color: MONOKAI.muted }}>
      {children}
    </p>
  );
}

/**
 * Highlight the old side (context + removed) and the new side (context +
 * added) as two continuous documents, so multi-line constructs tokenize the
 * way they read in each version. Plain text until (or unless) shiki is ready.
 */
function useSideTokens(hunks: DiffHunk[], path: string): SideTokens {
  const [tokens, setTokens] = useState<SideTokens>({ old: null, new: null });
  const latest = useRef(0);
  useEffect(() => {
    const ticket = ++latest.current;
    const lang = languageForPath(path);
    setTokens({ old: null, new: null });
    if (!lang) return;
    const oldSide: string[] = [];
    const newSide: string[] = [];
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.kind === "del" || line.kind === "ctx") oldSide.push(line.text);
        if (line.kind === "add" || line.kind === "ctx") newSide.push(line.text);
      }
    }
    void Promise.all([tokenizeLines(oldSide, lang), tokenizeLines(newSide, lang)]).then(([oldTokens, newTokens]) => {
      if (latest.current === ticket) setTokens({ old: oldTokens, new: newTokens });
    });
  }, [hunks, path]);
  return tokens;
}
