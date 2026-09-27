import { useCallback, useEffect, useId, useState, type FormEvent, type RefObject } from "react";
import { Activity, Link2, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isCliAuthFailure,
  markCliAuthNeeded,
  messageForCliAuthFailure,
} from "@/lib/harness/cli-token";
import {
  getOpenClawTargetState,
  isLoopbackOpenClawUrl,
  normalizeOpenClawUrl,
  probeOpenClawGateway,
  saveOpenClawTarget,
  type AgentRuntime,
  type OpenClawTarget,
} from "@/lib/harness/openclaw-gateway-api";
import type { ChannelsProbeUi } from "@/lib/harness/channels-panel";

type ProbeUi = ChannelsProbeUi;

/** Imperative handle so the Channels panel can re-run this panel's existing Probe. */
export type OpenClawTargetControl = { probe: () => void };

export type OpenClawTargetStatus = {
  /** Server-resolved effective runtime (not the unsaved dropdown draft). */
  savedRuntime: AgentRuntime | null;
  probe: ProbeUi;
};

type OpenClawTargetPanelProps = {
  onStatusChange?: (status: OpenClawTargetStatus) => void;
  controlRef?: RefObject<OpenClawTargetControl | null>;
};

/**
 * Gateway → OpenClaw target: URL + auth-token + Probe + persist runtime.
 * Hosted demo forces “paddy” and disables OpenClaw loopback.
 */
export function OpenClawTargetPanel({ onStatusChange, controlRef }: OpenClawTargetPanelProps = {}) {
  const baseId = useId();
  const urlId = `${baseId}-url`;
  const tokenId = `${baseId}-token`;
  const modelId = `${baseId}-model`;
  const runtimeId = `${baseId}-runtime`;
  const probeStatusId = `${baseId}-probe-status`;

  const [hostedDemo, setHostedDemo] = useState(false);
  const [loopbackDisabled, setLoopbackDisabled] = useState(false);
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [runtime, setRuntime] = useState<AgentRuntime>("paddy");
  const [savedRuntime, setSavedRuntime] = useState<AgentRuntime | null>(null);
  const [url, setUrl] = useState("");
  const [tokenDraft, setTokenDraft] = useState(""); // write-only — never hydrated from server
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState<ProbeUi>({ status: "idle" });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const state = await getOpenClawTargetState();
      if (!state.ok) return;
      setHostedDemo(state.hostedDemo);
      setLoopbackDisabled(state.loopbackDisabled);
      setTokenConfigured(state.tokenConfigured);
      setNote(state.note);
      setRuntime(state.effectiveRuntime);
      setSavedRuntime(state.effectiveRuntime);
      setUrl(state.target.url ?? "");
      setModel(state.target.model ?? "");
      // Never echo token into the field.
      setTokenDraft("");
    } catch (err) {
      if (isCliAuthFailure(err)) markCliAuthNeeded();
      /* preview without the fn is fine */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sync to parent (Gateway Channels panel) — external to this component's tree.
  useEffect(() => {
    onStatusChange?.({ savedRuntime, probe });
  }, [onStatusChange, savedRuntime, probe]);

  const loopbackBlocked = loopbackDisabled && isLoopbackOpenClawUrl(url);
  const openclawControlsDisabled = hostedDemo || loading;

  async function onProbe() {
    const normalized = normalizeOpenClawUrl(url);
    if (!normalized) {
      setProbe({ status: "empty", detail: "Paste an OpenClaw gateway URL first." });
      return;
    }
    if (hostedDemo) {
      setProbe({
        status: "error",
        detail:
          note ||
          "Hosted preview stays on runtime “paddy” + SuperGrok. OpenClaw probe is disabled here.",
      });
      return;
    }
    if (loopbackBlocked) {
      setProbe({
        status: "error",
        detail: "OpenClaw loopback is non-functional in the hosted demo.",
      });
      return;
    }
    setProbe({ status: "loading" });
    try {
      const result = await probeOpenClawGateway({
        data: {
          url: normalized,
          // Only send a freshly pasted token; never re-send a server echo (there is none).
          ...(tokenDraft.trim() ? { token: tokenDraft.trim() } : {}),
        },
      });
      if (result.ok) {
        setProbe({ status: "ok", detail: result.detail });
        toast("OpenClaw reachable", { description: result.detail });
      } else {
        setProbe({ status: "error", detail: result.error });
        toast("OpenClaw not reachable", { description: result.error });
      }
    } catch (err) {
      if (isCliAuthFailure(err)) markCliAuthNeeded();
      const detail = isCliAuthFailure(err)
        ? messageForCliAuthFailure(err)
        : err instanceof Error
          ? err.message
          : "Probe failed";
      setProbe({ status: "error", detail });
      toast("Probe failed", { description: detail });
    }
  }

  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = { probe: () => void onProbe() };
    return () => {
      controlRef.current = null;
    };
  });

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (hostedDemo) {
      toast("Hosted demo", {
        description: note || "Runtime stays “paddy” + SuperGrok on the hosted preview.",
      });
      return;
    }
    setSaving(true);
    try {
      const result = await saveOpenClawTarget({
        data: {
          runtime,
          url,
          model,
          ...(tokenDraft.trim() ? { token: tokenDraft.trim() } : {}),
        },
      });
      if (!result.ok) {
        toast("Not saved", { description: result.error });
        return;
      }
      toast("Saved", { description: result.detail });
      setTokenDraft("");
      setRuntime(result.effectiveRuntime);
      setSavedRuntime(result.effectiveRuntime);
      void refresh();
    } catch (err) {
      if (isCliAuthFailure(err)) markCliAuthNeeded();
      toast("Not saved", {
        description: isCliAuthFailure(err)
          ? messageForCliAuthFailure(err)
          : err instanceof Error
            ? err.message
            : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]"
      aria-labelledby={`${baseId}-heading`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-accent uppercase">OpenClaw</p>
          <h2 id={`${baseId}-heading`} className="mt-1 font-display text-xl">
            Gateway target
          </h2>
          <p className="mt-1 max-w-lg text-sm text-muted">
            Paste an OpenClaw URL and gateway auth-token, Probe health, then persist{" "}
            <span className="font-mono text-xs">openclaw</span> (runtime · url · token · model).
          </p>
        </div>
        <Badge variant={runtime === "openclaw" ? "accent" : "default"}>
          runtime · {runtime}
        </Badge>
      </div>

      {hostedDemo ? (
        <p
          className="mt-3 rounded-xl bg-bg px-3 py-2 text-sm text-muted"
          role="status"
        >
          {note ||
            "Hosted preview: runtime stays “paddy” + SuperGrok. OpenClaw loopback is non-functional in this demo."}
        </p>
      ) : null}

      <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => void onSave(e)}>
        <label className="block" htmlFor={runtimeId}>
          <span className="text-[11px] text-muted">Runtime</span>
          <select
            id={runtimeId}
            className="mt-1 flex h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg disabled:opacity-40"
            value={runtime}
            disabled={openclawControlsDisabled}
            onChange={(e) => setRuntime(e.target.value === "openclaw" ? "openclaw" : "paddy")}
            aria-describedby={hostedDemo ? `${baseId}-hosted-hint` : undefined}
          >
            <option value="paddy">paddy (built-in harness + SuperGrok on hosted)</option>
            <option value="openclaw">openclaw (attach external gateway)</option>
          </select>
        </label>
        {hostedDemo ? (
          <p id={`${baseId}-hosted-hint`} className="sr-only">
            Runtime is forced to paddy on the hosted demo.
          </p>
        ) : null}

        <label className="block" htmlFor={urlId}>
          <span className="text-[11px] text-muted">OpenClaw URL</span>
          <Input
            id={urlId}
            className="mt-1"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="http://127.0.0.1:18789"
            value={url}
            disabled={openclawControlsDisabled}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={loopbackBlocked || undefined}
            aria-describedby={loopbackBlocked ? `${baseId}-loopback` : undefined}
          />
        </label>
        {loopbackBlocked ? (
          <p id={`${baseId}-loopback`} className="text-xs text-danger" role="alert">
            OpenClaw loopback is non-functional in the hosted demo.
          </p>
        ) : null}

        <label className="block" htmlFor={tokenId}>
          <span className="text-[11px] text-muted">
            Gateway auth-token{tokenConfigured ? " · set (write-only)" : ""}
          </span>
          <Input
            id={tokenId}
            className="mt-1"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            placeholder={tokenConfigured ? "•••••••• (paste to replace)" : "openclaw gateway auth-token"}
            value={tokenDraft}
            disabled={openclawControlsDisabled}
            onChange={(e) => setTokenDraft(e.target.value)}
          />
        </label>

        <label className="block" htmlFor={modelId}>
          <span className="text-[11px] text-muted">Model (optional)</span>
          <Input
            id={modelId}
            className="mt-1"
            type="text"
            autoComplete="off"
            placeholder="optional model id"
            value={model}
            disabled={openclawControlsDisabled}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={openclawControlsDisabled || probe.status === "loading"}
            aria-busy={probe.status === "loading"}
            aria-controls={probeStatusId}
            onClick={() => void onProbe()}
          >
            <Activity className="size-3.5" />
            {probe.status === "loading" ? "Probing…" : "Probe"}
          </Button>
          <Button type="submit" size="sm" disabled={openclawControlsDisabled || saving}>
            <Save className="size-3.5" />
            {saving ? "Saving…" : "Persist"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <Link2 className="size-3.5" />
            Reload
          </Button>
        </div>

        <div
          id={probeStatusId}
          className="min-h-[1.25rem] text-sm"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {probe.status === "idle" ? (
            <span className="text-subtle">Probe checks OpenClaw /health then /healthz.</span>
          ) : null}
          {probe.status === "loading" ? <span className="text-muted">Probing gateway…</span> : null}
          {probe.status === "empty" ? <span className="text-muted">{probe.detail}</span> : null}
          {probe.status === "ok" ? <span className="text-fg">{probe.detail}</span> : null}
          {probe.status === "error" ? <span className="text-danger">{probe.detail}</span> : null}
          {loading ? <span className="text-subtle"> Loading target…</span> : null}
        </div>
      </form>
    </section>
  );
}

/** Exported for tests / story-like reuse of the draft shape. */
export type OpenClawTargetDraft = OpenClawTarget & { tokenDraft?: string };
