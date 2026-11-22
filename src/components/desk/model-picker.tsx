import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, ChevronDown, Search, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeskModel } from "@/lib/desk/client";
import {
  filterModels,
  groupModelsByProvider,
  modelSlug,
  type ActiveModel,
} from "./models";

export type ModelPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: DeskModel[];
  defaultKey: string;
  active: ActiveModel;
  catalogLoaded: boolean;
  connected: boolean;
  loading: boolean;
  loadError: string | null;
  onSelect: (key: string) => void;
  onRetry?: () => void;
};

export function ModelPicker({
  open,
  onOpenChange,
  models,
  defaultKey,
  active,
  catalogLoaded,
  connected,
  loading,
  loadError,
  onSelect,
  onRetry,
}: ModelPickerProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const label = active.label || active.key || "Choose model";
  const state = !connected
    ? "offline"
    : loadError
      ? "error"
      : loading
        ? "loading"
        : !catalogLoaded
          ? "loading"
          : models.length === 0
            ? "empty"
            : "list";
  const filtered = useMemo(() => filterModels(models, query), [models, query]);
  const groups = useMemo(() => groupModelsByProvider(filtered), [filtered]);
  const noMatch = state === "list" && filtered.length === 0;

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  return (
    <div
      className="relative"
      data-model-picker
      data-model-picker-state={noMatch ? "no-match" : state}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="max-w-[14rem]"
        data-model-picker-trigger
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? "model-picker-popup" : undefined}
        aria-label={`Model: ${label}. Open model picker.`}
        aria-describedby={active.isStale ? "model-picker-stale" : undefined}
        onClick={() => onOpenChange(!open)}
      >
        {active.isStale && <AlertCircle className="text-warn" aria-hidden />}
        <span className="max-w-[10rem] truncate max-sm:max-w-[7rem]" title={label}>
          {label}
        </span>
        <ChevronDown
          className={open ? "rotate-180 transition-transform duration-150" : "transition-transform duration-150"}
          aria-hidden
        />
      </Button>
      {active.isStale && (
        <span id="model-picker-stale" className="sr-only">
          The saved model is not in the catalog. Showing OpenCode&apos;s default.
        </span>
      )}
      {open && (
        <div
          id="model-picker-popup"
          className="absolute top-full right-0 z-50 mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border bg-elevated shadow-[var(--shadow-border-hover)] focus-within:ring-2 focus-within:ring-accent/40"
        >
          {state === "offline" ? (
            <StatePanel icon={<WifiOff className="size-4 text-muted" aria-hidden />} title="OpenCode is offline" body="Reconnect from the header to load models." />
          ) : state === "error" ? (
            <StatePanel
              icon={<AlertCircle className="size-4 text-muted" aria-hidden />}
              title="Could not load models"
              body={loadError ?? "Try again."}
              onRetry={onRetry}
            />
          ) : state === "loading" ? (
            <StatePanel title="Loading models…" />
          ) : state === "empty" ? (
            <StatePanel
              title="No models available"
              body="OpenCode reports no models. Add a provider in Settings, then reopen."
            />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Search className="size-3.5 shrink-0 text-muted" aria-hidden />
                <input
                  ref={inputRef}
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="model-picker-listbox"
                  aria-autocomplete="list"
                  aria-label="Filter models"
                  placeholder="Filter models"
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-6 min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-muted focus:outline-none"
                />
                <span role="status" aria-live="polite" className="sr-only">
                  {filtered.length === 0
                    ? "No models match"
                    : `${filtered.length} model${filtered.length === 1 ? "" : "s"}`}
                </span>
              </div>
              <div role="listbox" id="model-picker-listbox" aria-label="Models">
                {noMatch ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" role="status">
                    <p className="text-xs font-medium text-fg">
                      No models match “{query.slice(0, 40)}”
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}>
                      Clear filter
                    </Button>
                  </div>
                ) : (
                  groups.map((group) => (
                    <div
                      key={group.providerID}
                      role="group"
                      aria-labelledby={`model-group-${modelSlug(group.providerID)}`}
                    >
                      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-elevated px-3 py-2">
                        <span
                          id={`model-group-${modelSlug(group.providerID)}`}
                          className="truncate text-[11px] font-medium tracking-wide text-muted uppercase"
                        >
                          {group.label}
                        </span>
                        <span className="text-[11px] text-muted tabular-nums" aria-hidden>
                          {group.models.length}
                        </span>
                      </div>
                      {group.models.map((model) => (
                        <OptionRow
                          key={model.key}
                          model={model}
                          selected={model.key === active.key}
                          isDefault={model.key === defaultKey}
                          onSelect={() => onSelect(model.key)}
                        />
                      ))}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatePanel({
  icon,
  title,
  body,
  onRetry,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" role="status">
      {icon}
      <p className="text-xs font-medium text-fg">{title}</p>
      {body && <p className="max-w-[34ch] text-[11px] text-muted">{body}</p>}
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry loading models
        </Button>
      )}
    </div>
  );
}

function formatTokens(value: number): string | null {
  if (!value || value <= 0) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function formatRelease(value: number): string | null {
  if (!value || value <= 0) return null;
  return new Date(value).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function OptionRow({
  model,
  selected,
  isDefault,
  onSelect,
}: {
  model: DeskModel;
  selected: boolean;
  isDefault: boolean;
  onSelect: () => void;
}) {
  const context = formatTokens(model.context);
  const released = formatRelease(model.released);
  const deprecated = model.status === "deprecated";
  return (
    <div
      role="option"
      id={`model-option-${modelSlug(model.key)}`}
      aria-selected={selected}
      tabIndex={-1}
      data-model-option={model.key}
      className="flex min-h-11 cursor-pointer flex-col justify-center gap-1 border-l-2 border-transparent px-3 py-2 transition-colors hover:bg-surface"
      onClick={onSelect}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-sm leading-normal ${deprecated ? "text-muted" : "text-fg"}`}
          title={model.name || model.id}
        >
          {model.name || model.id}
        </span>
        {isDefault && <span className="text-[11px] text-muted">Default</span>}
        {selected && <Check className="text-accent" aria-hidden />}
      </span>
      <span className="flex min-w-0 items-center gap-1 truncate text-[11px] leading-snug text-muted">
        <span>{model.status}</span>
        <span aria-hidden>·</span>
        <span>{context ? `${context} context` : "context unknown"}</span>
        <span aria-hidden>·</span>
        <span>{released ?? "release unknown"}</span>
      </span>
    </div>
  );
}
