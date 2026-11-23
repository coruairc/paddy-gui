import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Bot, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { agentRows, type AgentOption } from "./agents";
import { nextActiveIndex } from "./models";

export type AgentPickerProps = {
  /** `/api/agent` options (id + display name); the "" default row is added here. */
  agents: AgentOption[];
  /** Chosen id, or "" for OpenCode's default agent (a send then omits the param). */
  agent: string;
  onChange: (id: string) => void;
};

/** Place before paint on the client; SSR must not call useLayoutEffect. */
const usePlacementEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Compact agent dropdown for the composer. A flat listbox (the agent list is
 * small and id-keyed) anchored above the trigger because it sits at the bottom
 * of the viewport. Focus stays on the trigger and moves the highlight through
 * `aria-activedescendant`, like the model picker.
 */
export function AgentPicker({ agents, agent, onChange }: AgentPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  /** Viewport-clamped placement: the trigger can sit near the right edge of a narrow shell. */
  const [popup, setPopup] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => agentRows(agents), [agents]);
  const selectedIndex = rows.findIndex((row) => row.id === agent);
  const current = rows[selectedIndex] ?? rows[0];

  // Fixed placement (not absolute) so the popup can shift left to stay on
  // screen instead of widening the shell at 390px, where the chat column is
  // narrower than the list.
  usePlacementEffect(() => {
    if (!open) {
      setPopup(null);
      return;
    }
    function place() {
      const node = trigger.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 16);
      setPopup({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - rect.top + 6,
        width,
      });
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Scroll only the popup's own list: scrollIntoView also moves ancestor
  // scrollers, which shifted the fixed shell horizontally before.
  useEffect(() => {
    const list = listbox.current;
    if (!open || !list) return;
    const node = list.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (!node) return;
    if (node.offsetTop < list.scrollTop || node.offsetTop + node.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = node.offsetTop - list.clientHeight / 2 + node.offsetHeight / 2;
    }
  }, [open, activeIndex]);

  function openAt(index: number) {
    setActiveIndex(index >= 0 ? index : 0);
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  function choose(index: number) {
    const row = rows[index];
    if (!row) return;
    onChange(row.id);
    close(true);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openAt(event.key === "ArrowUp" ? rows.length - 1 : selectedIndex);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openAt(selectedIndex);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(nextActiveIndex(activeIndex, rows.length, event.key));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      // Not a trap: close, then let Tab move focus to the next control.
      setOpen(false);
    }
  }

  return (
    <div ref={wrapper} className="relative min-w-0" data-agent-picker>
      <button
        ref={trigger}
        type="button"
        data-agent-trigger
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? "agent-picker-listbox" : undefined}
        aria-activedescendant={open ? `agent-option-${activeIndex}` : undefined}
        aria-label={`Agent: ${current.name}. Open agent picker.`}
        title={current.name}
        onClick={() => {
          if (open) close(false);
          else openAt(selectedIndex);
        }}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "flex h-7 max-w-full min-w-0 items-center gap-1 rounded-lg px-2 text-[11px] transition-colors",
          "text-muted hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          open && "bg-surface text-fg",
        )}
      >
        <Bot className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{current.name}</span>
        <ChevronDown
          className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && popup && (
        <div
          ref={listbox}
          id="agent-picker-listbox"
          role="listbox"
          aria-label="Agents"
          style={{ left: popup.left, bottom: popup.bottom, width: popup.width }}
          className="scrollbar-thin fixed z-50 max-h-[min(18rem,50dvh)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-elevated py-1 shadow-[var(--shadow-border-hover)] focus-within:ring-2 focus-within:ring-accent/40"
        >
          {rows.map((row, index) => {
            const selected = row.id === agent;
            return (
              <div
                key={row.id || "default"}
                id={`agent-option-${index}`}
                role="option"
                aria-selected={selected}
                data-index={index}
                data-agent-option={row.id}
                data-active={index === activeIndex ? "true" : "false"}
                tabIndex={-1}
                onClick={() => choose(index)}
                onMouseMove={() => setActiveIndex(index)}
                className={cn(
                  "flex min-h-8 cursor-pointer items-center gap-2 px-2.5 py-1 text-xs transition-colors",
                  index === activeIndex ? "bg-surface text-fg" : "text-muted hover:bg-surface",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                {selected && <Check className="size-3 shrink-0 text-accent" aria-hidden />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
