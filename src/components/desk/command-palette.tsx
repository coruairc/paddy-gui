import type { ReactNode } from "react";
import { AlertCircle, Boxes, Loader, SearchX, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeskCommand } from "@/lib/desk/client";
import { commandSlug } from "./commands";

export type CommandPaletteProps = {
  open: boolean;
  commands: DeskCommand[];
  hasCatalog: boolean;
  query: string;
  activeIndex: number;
  connected: boolean;
  loading: boolean;
  loadError: string | null;
  onSelect: (name: string) => void;
  onRetry?: () => void;
  onClear?: () => void;
};

export function CommandPalette({
  open,
  commands,
  hasCatalog,
  query,
  activeIndex,
  connected,
  loading,
  loadError,
  onSelect,
  onRetry,
  onClear,
}: CommandPaletteProps) {
  if (!open) return null;
  const state = !connected
    ? "offline"
    : loadError
      ? "error"
      : loading && !hasCatalog
        ? "loading"
        : !hasCatalog
          ? "empty"
          : commands.length === 0
            ? "no-match"
            : "list";
  const noMatch = state === "no-match";

  return (
    <div
      id="command-palette"
      data-command-palette
      data-command-palette-state={noMatch ? "no-match" : state}
      className="absolute right-0 bottom-full left-0 z-40 mb-2 max-h-[min(22rem,50dvh)] overflow-hidden rounded-xl border border-border bg-elevated shadow-[var(--shadow-border-hover)] focus-within:ring-2 focus-within:ring-accent/40"
    >
      {state === "offline" ? (
        <Panel
          icon={<AlertCircle className="size-4 text-muted" aria-hidden />}
          title="OpenCode is offline"
          body="Reconnect from the header to load commands."
        />
      ) : state === "error" ? (
        <Panel
          icon={<AlertCircle className="size-4 text-danger" aria-hidden />}
          title="Could not load commands"
          body={loadError ?? "Try again."}
          retrying={loading}
          onRetry={onRetry}
        />
      ) : state === "loading" ? (
        <Panel icon={<Loader className="size-4 animate-spin text-muted" aria-hidden />} title="Loading commands…" />
      ) : state === "empty" ? (
        <Panel
          icon={<Boxes className="size-4 text-muted" aria-hidden />}
          title="No commands available"
          body="OpenCode returned no commands. Add command files in your project, then reopen."
        />
      ) : noMatch ? (
        <Panel
          icon={<SearchX className="size-4 text-muted" aria-hidden />}
          title={`No commands match “${query.length > 40 ? `${query.slice(0, 40)}…` : query}”`}
          body=""
          onClear={onClear}
        />
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="truncate text-[11px] text-muted">
              Commands matching “{query.length > 40 ? `${query.slice(0, 40)}…` : query}”
            </span>
            <span role="status" aria-live="polite" className="sr-only">
              {commands.length} command{commands.length === 1 ? "" : "s"}
            </span>
          </div>
          <div role="listbox" id="command-listbox" aria-label="Commands" className="scrollbar-thin max-h-[min(20rem,44dvh)] overflow-y-auto overscroll-contain">
            {commands.map((command, index) => (
              <div
                key={command.name}
                role="option"
                id={`command-option-${commandSlug(command.name)}`}
                aria-selected={index === activeIndex}
                tabIndex={-1}
                data-command-option={command.name}
                data-active={index === activeIndex ? "true" : "false"}
                className={`flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 border-l-2 px-3 py-2 transition-colors ${
                  index === activeIndex ? "border-accent bg-surface" : "border-transparent hover:bg-surface"
                }`}
                onClick={() => onSelect(command.name)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Terminal className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="truncate font-mono text-sm text-fg">/{command.name}</span>
                </span>
                <span className="truncate text-[11px] text-muted">
                  {command.description || "No description"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Panel({
  icon,
  title,
  body,
  retrying,
  onRetry,
  onClear,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  retrying?: boolean;
  onRetry?: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" role="status">
      {icon}
      <p className="text-xs font-medium text-fg">{title}</p>
      {body && <p className="line-clamp-2 max-w-[34ch] text-[11px] text-muted">{body}</p>}
      {onRetry && (
        <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      )}
      {onClear && (
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}
