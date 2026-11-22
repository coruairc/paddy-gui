/**
 * Pure slash-command helpers. Only a draft that STARTS with `/` is a command;
 * every other slash is ordinary prompt text.
 */

export function commandSlug(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function filterCommands<T extends { name: string; description?: string }>(
  commands: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().replace(/^\//, "").toLowerCase();
  if (!needle) return [...commands];
  return commands.filter((command) =>
    `${command.name} ${command.description ?? ""}`.toLowerCase().includes(needle),
  );
}

export type ParsedCommand = { name: string; args: string };

export function parseCommandInput(draft: string): ParsedCommand | null {
  if (!draft.startsWith("/")) return null;
  const rest = draft.slice(1);
  const match = rest.match(/^(\S+)([\s\S]*)$/);
  if (!match) return null;
  const name = match[1];
  if (!name) return null;
  return { name, args: match[2].replace(/^\s+/, "") };
}

/** Clamped navigation for the palette (no wrap-around). */
export function nextCommandIndex(
  current: number,
  length: number,
  key: "ArrowDown" | "ArrowUp" | "Home" | "End",
): number {
  if (length <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowDown") return current < 0 ? 0 : Math.min(current + 1, length - 1);
  return current < 0 ? length - 1 : Math.max(current - 1, 0);
}

/**
 * Auto-load the command catalog only once per palette opening. After a failed
 * load, only the Retry button (or a fresh `/`) loads again, so a broken
 * `/api/commands` is not hit back to back.
 */
export function shouldAutoLoadCommands(state: {
  open: boolean;
  catalogLoaded: boolean;
  loading: boolean;
  error: string | null;
}): boolean {
  return state.open && !state.catalogLoaded && !state.loading && state.error === null;
}
