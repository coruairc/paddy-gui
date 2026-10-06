/**
 * Autonomous Idle <-> Drink scheduler for Paddy.
 *
 * A small, framework-agnostic state machine that decides when Paddy should
 * take a drink. It only ever produces the `idle` and `drink` phases; Jig and
 * Coin Toss are intentionally outside this machine so they can never be
 * triggered automatically (see `enabledAnimations`).
 *
 * Timing is injected via `AutonomousClock` so the logic is unit-testable
 * without waiting 30–90 seconds.
 */

export type AutonomousPhase = "idle" | "drink";

export interface AutonomousConfig {
  /** Random delay before the very first drink. */
  minInitialDelayMs: number;
  maxInitialDelayMs: number;
  /** Random delay between subsequent drinks. */
  minDelayMs: number;
  maxDelayMs: number;
}

export interface AutonomousClock {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  /** Returns a number in [0, 1). */
  random: () => number;
}

export interface AutonomousHooks {
  onDrink: () => void;
  onIdle: () => void;
}

export interface AutonomousController {
  /** Start scheduling. Idempotent — calling twice does not double-schedule. */
  start: () => void;
  /** Notify that the current drink finished; returns to idle and schedules the next. */
  finishDrink: () => void;
  /** Suspend scheduling (e.g. tab hidden / session busy). */
  pause: () => void;
  /** Resume scheduling after a pause. */
  resume: () => void;
  /** Stop and clear any pending timer (unmount). */
  stop: () => void;
  getPhase: () => AutonomousPhase;
}

export const DEFAULT_DRINK_CONFIG: AutonomousConfig = {
  minInitialDelayMs: 30_000,
  maxInitialDelayMs: 60_000,
  minDelayMs: 30_000,
  maxDelayMs: 90_000,
};

export function createAutonomousDrink(
  config: AutonomousConfig,
  clock: AutonomousClock,
  hooks: AutonomousHooks,
): AutonomousController {
  let timerId: unknown = null;
  let phase: AutonomousPhase = "idle";
  let started = false;
  let paused = false;
  let waitingForFirst = true;

  const randomMs = (min: number, max: number) => Math.floor(min + clock.random() * (max - min));

  const clearTimer = () => {
    if (timerId !== null) {
      clock.clearTimeout(timerId);
      timerId = null;
    }
  };

  const scheduleNextDrink = () => {
    clearTimer();
    const [min, max] = waitingForFirst
      ? [config.minInitialDelayMs, config.maxInitialDelayMs]
      : [config.minDelayMs, config.maxDelayMs];
    timerId = clock.setTimeout(() => {
      timerId = null;
      phase = "drink";
      waitingForFirst = false;
      hooks.onDrink();
    }, randomMs(min, max));
  };

  return {
    start() {
      if (started) return;
      started = true;
      phase = "idle";
      waitingForFirst = true;
      scheduleNextDrink();
    },
    finishDrink() {
      if (phase !== "drink") return;
      phase = "idle";
      hooks.onIdle();
      if (paused) return;
      scheduleNextDrink();
    },
    pause() {
      if (paused) return;
      paused = true;
      clearTimer();
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (phase === "idle" && timerId === null) {
        scheduleNextDrink();
      }
    },
    stop() {
      clearTimer();
      started = false;
    },
    getPhase: () => phase,
  };
}
