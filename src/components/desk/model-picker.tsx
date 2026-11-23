import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  Check,
  ChevronDown,
  Search,
  SearchX,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelixMark } from "@/components/helix-mark";
import { formatTokens } from "@/lib/utils";
import type { DeskModel } from "@/lib/desk/client";
import {
  filterModels,
  flattenGroups,
  groupModelsByProvider,
  isSelectableModel,
  modelSlug,
  nextActiveIndex,
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const openIntent = useRef<"down" | "up" | "enter">("down");

  const label = active.label || active.persistedKey || "Choose model";
  const filtered = useMemo(() => filterModels(models, query), [models, query]);
  const groups = useMemo(() => groupModelsByProvider(filtered), [filtered]);
  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const state = !connected
    ? "offline"
    : loadError
      ? "error"
      : (loading && models.length === 0) || !catalogLoaded
        ? "loading"
        : models.length === 0
          ? "empty"
          : filtered.length === 0
            ? "no-match"
            : "list";
  const activeOptionId = activeIndex >= 0 && flat[activeIndex] ? `model-option-${modelSlug(flat[activeIndex].key)}` : undefined;
  const defaultLabel = models.find((model) => model.key === defaultKey)?.name ?? defaultKey;

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(-1);
      return;
    }
    setQuery("");
    const list = flattenGroups(groupModelsByProvider(filterModels(models, "")));
    const effectiveIndex = list.findIndex((model) => model.key === active.key);
    if (effectiveIndex >= 0) setActiveIndex(effectiveIndex);
    else if (list.length === 0) setActiveIndex(-1);
    else setActiveIndex(openIntent.current === "up" ? list.length - 1 : 0);
    inputRef.current?.focus();
    // Intentionally open-scoped: SSE changes must not move the active row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && (state === "list" || state === "no-match")) inputRef.current?.focus();
  }, [open, state]);

  // A new filter is a new result set: start it at the top so the highlighted
  // first match is visible. Covers typing and the "Clear filter" button; the
  // sticky headers stay put because this only moves the listbox scroller.
  useEffect(() => {
    if (open) listboxRef.current?.scrollTo({ top: 0 });
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open || activeIndex !== -1 || flat.length === 0) return;
    const index = flat.findIndex((model) => model.key === active.key);
    setActiveIndex(index >= 0 ? index : 0);
    // Only adopts a default when the user has not navigated yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flat.length]);

  function requestOpen(intent: "down" | "up" | "enter") {
    if (open) return;
    openIntent.current = intent;
    onOpenChange(true);
  }

  function scrollToIndex(index: number) {
    const model = flat[index];
    if (!model) return;
    document
      .getElementById(`model-option-${modelSlug(model.key)}`)
      ?.scrollIntoView({ block: "nearest" });
  }

  function moveActive(key: "ArrowDown" | "ArrowUp" | "Home" | "End") {
    const next = nextActiveIndex(activeIndex, flat.length, key);
    setActiveIndex(next);
    scrollToIndex(next);
  }

  function closeToTrigger() {
    onOpenChange(false);
    triggerRef.current?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      requestOpen("down");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      requestOpen("up");
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      requestOpen("enter");
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.preventDefault();
      moveActive(event.key);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const model = flat[activeIndex];
      if (model && isSelectableModel(model)) {
        onSelect(model.key);
        closeToComposerOrTrigger();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeToTrigger();
    } else if (event.key === "Tab") {
      event.preventDefault();
      closeToTrigger();
    }
  }

  function closeToComposerOrTrigger() {
    onOpenChange(false);
    const composer = document.querySelector<HTMLTextAreaElement>("textarea[data-composer]");
    if (composer) composer.focus();
    else triggerRef.current?.focus();
  }

  return (
    <div
      ref={wrapperRef}
      className="relative"
      data-model-picker
      data-model-picker-state={state}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        className={`max-w-[14rem]${open ? " bg-elevated text-fg" : ""}`}
        data-model-picker-trigger
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? "model-picker-popup" : undefined}
        aria-label={`Model: ${label}. Open model picker.`}
        aria-describedby={active.isStale ? "model-picker-stale" : undefined}
        onClick={() => onOpenChange(!open)}
        onKeyDown={onTriggerKeyDown}
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
          Saved model “{active.persistedKey}” is not in this catalog. Showing OpenCode&apos;s default
          {defaultLabel ? ` (${defaultLabel})` : ""}.
        </span>
      )}
      {open && (
        <div
          id="model-picker-popup"
          className="absolute top-full right-0 z-50 mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border bg-elevated shadow-[var(--shadow-border-hover)] focus-within:ring-2 focus-within:ring-accent/40"
        >
          {state === "offline" ? (
            <StatePanel
              icon={<WifiOff className="size-4 text-muted" aria-hidden />}
              title="OpenCode is offline"
              body="Reconnect from the header to load the model list."
            />
          ) : state === "error" ? (
            <StatePanel
              icon={<AlertTriangle className="size-4 text-danger" aria-hidden />}
              title="Could not load models"
              body={loadError ?? "Try again."}
              retrying={loading}
              onRetry={onRetry}
            />
          ) : state === "loading" ? (
            <StatePanel icon={<HelixMark spinning className="size-6" />} title="Loading models…" />
          ) : state === "empty" ? (
            <StatePanel
              icon={<Boxes className="size-4 text-muted" aria-hidden />}
              title="No models available"
              body="OpenCode returned no chat models. Check provider credentials in Settings, then reopen this picker."
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
                  aria-activedescendant={activeOptionId}
                  aria-autocomplete="list"
                  aria-label="Filter models"
                  placeholder="Filter models"
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => {
                    const value = event.target.value;
                    setQuery(value);
                    const next = filterModels(models, value);
                    setActiveIndex(next.length ? 0 : -1);
                  }}
                  onKeyDown={onInputKeyDown}
                  className="h-6 min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-muted focus:outline-none"
                />
                <span role="status" aria-live="polite" className="sr-only">
                  {filtered.length === 0
                    ? "No models match"
                    : `${filtered.length} model${filtered.length === 1 ? "" : "s"}`}
                </span>
              </div>
              {active.isStale && (
                <div className="border-b border-border px-3 py-2 text-[11px] text-warn">
                  Saved model “{active.persistedKey}” is not in this catalog. Showing OpenCode&apos;s
                  default{defaultLabel ? ` (${defaultLabel})` : ""}.
                </div>
              )}
              <div
                ref={listboxRef}
                role="listbox"
                id="model-picker-listbox"
                aria-label="Models"
                className="scrollbar-thin max-h-[min(28rem,calc(100dvh-10rem))] scroll-pt-9 overflow-y-auto overscroll-contain"
              >
                {state === "no-match" ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" role="status">
                    <SearchX className="size-4 text-muted" aria-hidden />
                    <p className="text-xs font-medium text-fg">
                      No models match “{query.length > 40 ? `${query.slice(0, 40)}…` : query}”
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQuery("");
                        setActiveIndex(0);
                        inputRef.current?.focus();
                      }}
                    >
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
                      {group.models.map((model) => {
                        const index = flat.findIndex((item) => item.key === model.key);
                        return (
                          <OptionRow
                            key={model.key}
                            model={model}
                            selected={model.key === active.key}
                            isDefault={model.key === defaultKey}
                            isActive={index === activeIndex}
                            onSelect={() => {
                              if (!isSelectableModel(model)) return;
                              onSelect(model.key);
                              closeToComposerOrTrigger();
                            }}
                            onHover={() => setActiveIndex(index)}
                          />
                        );
                      })}
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
  retrying,
  onRetry,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  retrying?: boolean;
  onRetry?: () => void;
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
    </div>
  );
}

function formatRelease(value: number): string | null {
  if (!value || value <= 0) return null;
  return new Date(value).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function statusContent(status: string) {
  if (status === "alpha") return <Badge variant="warn">Alpha</Badge>;
  if (status === "beta") return <Badge variant="warn">Beta</Badge>;
  if (status === "deprecated") return <Badge variant="default">Deprecated</Badge>;
  return <span>active</span>;
}

function OptionRow({
  model,
  selected,
  isDefault,
  isActive,
  onSelect,
  onHover,
}: {
  model: DeskModel;
  selected: boolean;
  isDefault: boolean;
  isActive: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const context = model.context > 0 ? `${formatTokens(model.context)} context` : "context unknown";
  const released = formatRelease(model.released) ?? "release unknown";
  const deprecated = model.status === "deprecated";
  const disabled = !isSelectableModel(model);
  return (
    <div
      role="option"
      id={`model-option-${modelSlug(model.key)}`}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      data-model-option={model.key}
      data-active={isActive ? "true" : "false"}
      data-disabled={disabled ? "true" : undefined}
      title={disabled ? "Disabled in OpenCode" : undefined}
      className={`flex min-h-11 flex-col justify-center gap-1 border-l-2 px-3 py-2 transition-colors ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${isActive ? "border-accent bg-surface" : "border-transparent hover:bg-surface"}`}
      onClick={onSelect}
      onMouseMove={onHover}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-sm leading-normal ${deprecated || disabled ? "text-muted" : "text-fg"}`}
          title={model.name || model.id}
        >
          {model.name || model.id}
        </span>
        {disabled && <Badge variant="default">Disabled</Badge>}
        {isDefault && <Badge variant="default">Default</Badge>}
        {selected && <Check className="size-3.5 text-accent" aria-hidden />}
      </span>
      <span className="flex min-w-0 items-center gap-1 truncate text-[11px] leading-snug text-muted">
        {statusContent(model.status)}
        <span aria-hidden>·</span>
        <span>{context}</span>
        <span aria-hidden>·</span>
        <span>{released}</span>
      </span>
    </div>
  );
}
