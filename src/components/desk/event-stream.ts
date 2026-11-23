/**
 * Supervised reconnection for the desk's SSE stream.
 *
 * An EventSource retries by itself only while it is CONNECTING. A fatal error
 * (wrong content-type during a dev-server restart, an HTTP error, a reset
 * network stack) puts it in CLOSED for good, so the desk has to make the next
 * attempt. Delays double per failure and are capped, and every attempt is
 * scheduled through an injected clock so the policy is testable.
 */

export interface ReconnectClock {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

export interface ReconnectConfig {
  /** Delay before the first retry. */
  baseDelayMs: number;
  /** Ceiling for any single delay; retries continue at this pace. */
  maxDelayMs: number;
}

export const DEFAULT_RECONNECT: ReconnectConfig = { baseDelayMs: 1_000, maxDelayMs: 15_000 };

/** Delay before retry `attempt` (1-based): base, 2×base, 4×base, … capped at maxDelayMs. */
export function reconnectDelay(
  attempt: number,
  config: ReconnectConfig = DEFAULT_RECONNECT,
): number {
  const step = Math.max(1, Math.floor(attempt));
  return Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** (step - 1));
}

/**
 * A catch-up response belongs to the project that was active when it started.
 * `chooseProject` can land while the refetch is in flight; its session list must
 * not be overwritten by the project the user left.
 */
export function catchUpProjectMatches(
  startedIn: string | null,
  activeProjectId: string | null,
): boolean {
  return startedIn === activeProjectId;
}

export interface ReconnectScheduler {
  /** The stream is dead and cannot retry itself: schedule one recreation. */
  failed: () => void;
  /** The browser is retrying on its own (CONNECTING); events may be missed. */
  interrupted: () => void;
  /** A stream opened; true when events missed during the gap need a catch-up. */
  opened: () => boolean;
  /** Cancel a scheduled recreation (unmount). */
  stop: () => void;
  /** Is a recreation scheduled? */
  retrying: () => boolean;
}

export function createReconnectScheduler(
  clock: ReconnectClock,
  onRetry: () => void,
  config: ReconnectConfig = DEFAULT_RECONNECT,
): ReconnectScheduler {
  let timer: unknown = null;
  let attempt = 0;
  let gap = false;

  return {
    failed() {
      gap = true;
      // Repeated error events for the same dead stream must not stack timers.
      if (timer !== null) return;
      attempt += 1;
      timer = clock.setTimeout(
        () => {
          timer = null;
          onRetry();
        },
        reconnectDelay(attempt, config),
      );
    },
    interrupted() {
      gap = true;
    },
    opened() {
      const missed = gap;
      gap = false;
      attempt = 0;
      // A native reconnect can win the race with our timer: keep only one stream.
      if (timer !== null) {
        clock.clearTimeout(timer);
        timer = null;
      }
      return missed;
    },
    stop() {
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
    },
    retrying: () => timer !== null,
  };
}
