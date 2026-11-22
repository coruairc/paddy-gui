import { AlertCircle, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeskModel } from "@/lib/desk/client";
import { modelSlug, parseModelKey, type ActiveModel } from "./models";

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
  const label = active.label || (active.key ? active.key : "") || "Choose model";
  const state = !connected
    ? "offline"
    : loadError
      ? "error"
      : loading
        ? "loading"
        : models.length === 0
          ? "empty"
          : "list";

  return (
    <div className="relative" data-model-picker data-model-picker-state={state}>
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
          {state === "offline" && (
            <StatePanel title="OpenCode is offline" body="Reconnect from the header to load models." />
          )}
          {state === "error" && (
            <StatePanel title="Could not load models" body={loadError ?? "Try again."} onRetry={onRetry} />
          )}
          {state === "loading" && <StatePanel title="Loading models…" />}
          {state === "empty" && (
            <StatePanel
              title="No models available"
              body="OpenCode reports no models. Add a provider in Settings, then reopen."
            />
          )}
          {state === "list" && (
            <div role="listbox" id="model-picker-listbox" aria-label="Models">
              {models.map((model) => (
                <OptionRow
                  key={model.key}
                  model={model}
                  selected={model.key === active.key}
                  isDefault={model.key === defaultKey}
                  onSelect={() => onSelect(model.key)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatePanel({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" role="status">
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
          className="min-w-0 flex-1 truncate text-sm leading-normal text-fg"
          title={model.name || model.id}
        >
          {model.name || model.id || parseModelKey(model.key)?.id}
        </span>
        {isDefault && <span className="text-[11px] text-muted">Default</span>}
        {selected && <Check className="text-accent" aria-hidden />}
      </span>
      <span className="flex min-w-0 items-center gap-1 truncate text-[11px] leading-snug text-muted">
        {model.status}
      </span>
    </div>
  );
}
