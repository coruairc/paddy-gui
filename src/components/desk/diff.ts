/**
 * Pure helpers for the "Files changed" view: unified-diff parsing, line
 * capping, path display, language detection and per-turn file grouping.
 * No React, no DOM — covered by diff.test.ts.
 */

export type DiffLineKind = "add" | "del" | "ctx" | "meta";

export type DiffLine = {
  kind: DiffLineKind;
  /** Line text without the leading +/-/space marker. */
  text: string;
  oldNo?: number;
  newNo?: number;
};

export type DiffHunk = { header: string; lines: DiffLine[] };

export type ParsedPatch = { hunks: DiffHunk[]; binary: boolean };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const BINARY = /^(?:Binary files .* differ|GIT binary patch)$/;

/** Parse a git unified diff (one file). File headers before the first hunk are dropped. */
export function parsePatch(patch: string): ParsedPatch {
  const hunks: DiffHunk[] = [];
  let binary = false;
  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const head = HUNK.exec(line);
    if (head) {
      oldNo = Number(head[1]);
      newNo = Number(head[3]);
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) {
      if (BINARY.test(line)) binary = true;
      continue;
    }
    if (line.startsWith("+")) current.lines.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
    else if (line.startsWith("-")) current.lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ });
    else if (line.startsWith("\\")) current.lines.push({ kind: "meta", text: line });
    else if (line.startsWith(" ") || line === "") current.lines.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    else {
      // A new file section inside one patch string: stop attaching lines to the old hunk.
      current = null;
      if (BINARY.test(line)) binary = true;
    }
  }
  return { hunks, binary };
}

export function countLines(hunks: DiffHunk[]): number {
  return hunks.reduce((sum, hunk) => sum + hunk.lines.length + 1, 0);
}

/** Keep at most `max` rows (hunk headers count as one row). Returns how many rows were hidden. */
export function capHunks(hunks: DiffHunk[], max: number): { hunks: DiffHunk[]; hidden: number } {
  const total = countLines(hunks);
  if (total <= max) return { hunks, hidden: 0 };
  const out: DiffHunk[] = [];
  let left = max;
  for (const hunk of hunks) {
    if (left <= 1) break;
    left -= 1;
    const lines = hunk.lines.slice(0, left);
    left -= lines.length;
    out.push({ header: hunk.header, lines });
  }
  return { hunks: out, hidden: total - countLines(out) };
}

/** "src/components/desk/app.tsx" → "src/…/desk/app.tsx" — the file name always survives. */
export function middleTruncate(path: string, max = 48): string {
  if (path.length <= max) return path;
  const slash = path.lastIndexOf("/");
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  if (name.length + 2 >= max) return "…" + name.slice(name.length - (max - 1));
  const room = max - name.length - 2; // "…/"
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const head = Math.ceil(room / 2);
  const tail = room - head;
  return dir.slice(0, head) + "…" + (tail > 0 ? dir.slice(dir.length - tail) : "") + "/" + name;
}

const BY_EXTENSION: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  json: "json", jsonc: "jsonc", css: "css", scss: "scss", html: "html", htm: "html", vue: "vue", svelte: "svelte",
  md: "markdown", mdx: "markdown", yml: "yaml", yaml: "yaml", toml: "toml", xml: "xml", svg: "xml",
  py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift", php: "php",
  // C++ and Ruby are left out on purpose: each grammar chunk is ~800 kB minified.
  c: "c", h: "c", cs: "csharp", sql: "sql",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript",
};

const BY_NAME: Record<string, string> = { dockerfile: "dockerfile", makefile: "make" };

/** Shiki language id for a path, or null to render plain text. */
export function languageForPath(path: string): string | null {
  const name = (path.split("/").pop() ?? "").toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

type TurnMessage = { id: string; role: string; pending?: boolean; files?: string[] };

export type TurnFiles = {
  /** User message that opened the turn — the `from` for the diff route. Undefined = newest turn. */
  from?: string;
  files: string[];
};

/**
 * Group assistant `snapshot.files` by turn (a user prompt plus the assistant
 * steps after it) and key each group by the turn's last assistant message, which
 * is where the chat renders the "Files changed" block. A turn whose user id is
 * not a stored OpenCode id (a live echo) can only be fetched as the newest turn.
 */
export function turnFiles(messages: readonly TurnMessage[]): Map<string, TurnFiles> {
  const out = new Map<string, TurnFiles>();
  const lastUser = messages.reduce((index, message, i) => (message.role === "user" ? i : index), -1);
  let from: string | undefined;
  let fetchable = false;
  let anchor: string | null = null;
  let files: string[] = [];
  const flush = () => {
    if (anchor && files.length && fetchable) out.set(anchor, { from, files });
    anchor = null;
    files = [];
  };
  messages.forEach((message, index) => {
    if (message.role === "user") {
      flush();
      const stored = !message.pending && /^msg_[A-Za-z0-9_-]+$/.test(message.id);
      from = stored ? message.id : undefined;
      fetchable = stored || index === lastUser;
      return;
    }
    if (message.role !== "assistant") return;
    anchor = message.id;
    for (const file of message.files ?? []) if (!files.includes(file)) files.push(file);
  });
  flush();
  return out;
}

/** Fold a live `step-files` event into the assistant message it belongs to. */
export function mergeStepFiles<T extends { id: string; files?: string[] }>(list: T[], messageId: string, files: string[]): T[] {
  let changed = false;
  const next = list.map((message) => {
    if (message.id !== messageId) return message;
    const merged = [...(message.files ?? [])];
    for (const file of files) if (!merged.includes(file)) merged.push(file);
    if (merged.length === (message.files?.length ?? 0)) return message;
    changed = true;
    return { ...message, files: merged };
  });
  return changed ? next : list;
}
