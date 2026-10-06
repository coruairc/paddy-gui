import test from "node:test";
import assert from "node:assert/strict";
import {
  createAutonomousDrink,
  DEFAULT_DRINK_CONFIG,
  type AutonomousConfig,
  type AutonomousPhase,
} from "./autonomous-drink.ts";

/** A deterministic fake timer/random for driving the scheduler without waiting. */
function makeClock(random: () => number = () => 0.5) {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  return {
    random,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id: unknown) => {
      timers.delete(id as number);
    },
    pendingCount: () => timers.size,
    /** Advance the clock, firing any timers that become due, in order. */
    advance: (ms: number) => {
      const end = now + ms;
      for (;;) {
        let earliest: number | null = null;
        let earliestAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= end && t.at < earliestAt) {
            earliest = id;
            earliestAt = t.at;
          }
        }
        if (earliest === null) break;
        const t = timers.get(earliest)!;
        timers.delete(earliest);
        now = earliestAt;
        t.fn();
      }
      now = end;
    },
  };
}

const cfg: AutonomousConfig = {
  minInitialDelayMs: 30_000,
  maxInitialDelayMs: 60_000,
  minDelayMs: 30_000,
  maxDelayMs: 90_000,
};

function record(clock: ReturnType<typeof makeClock>) {
  const phases: AutonomousPhase[] = [];
  const drinks: number[] = [];
  const controller = createAutonomousDrink(
    cfg,
    clock,
    {
      onDrink: () => {
        phases.push("drink");
        drinks.push(1);
      },
      onIdle: () => phases.push("idle"),
    },
  );
  return { controller, phases, drinks };
}

test("starts idle and does not drink immediately", () => {
  const clock = makeClock();
  const { controller, phases, drinks } = record(clock);
  controller.start();
  assert.equal(controller.getPhase(), "idle");
  assert.equal(drinks.length, 0);
  assert.deepEqual(phases, []);
});

test("schedules exactly one initial delay", () => {
  const clock = makeClock();
  const { controller } = record(clock);
  controller.start();
  assert.equal(clock.pendingCount(), 1);
  // start() is idempotent — no duplicate timer.
  controller.start();
  assert.equal(clock.pendingCount(), 1);
});

test("drink starts only after the random initial delay", () => {
  const clock = makeClock();
  const { controller, drinks } = record(clock);
  controller.start();
  // Advance just before the initial delay (random=0.5 -> 45s mid of 30..60s).
  clock.advance(cfg.minInitialDelayMs + (cfg.maxInitialDelayMs - cfg.minInitialDelayMs) / 2 - 1);
  assert.equal(drinks.length, 0);
  clock.advance(1);
  assert.equal(controller.getPhase(), "drink");
  assert.equal(drinks.length, 1);
});

test("finishDrink returns to idle and schedules the next delay", () => {
  const clock = makeClock();
  const { controller, phases } = record(clock);
  controller.start();
  clock.advance(60_000);
  assert.equal(controller.getPhase(), "drink");
  controller.finishDrink();
  assert.equal(controller.getPhase(), "idle");
  assert.equal(clock.pendingCount(), 1);
  assert.ok(phases.includes("idle"));
});

test("drink never auto-interrupts itself (no timer pending during drink)", () => {
  const clock = makeClock();
  const { controller } = record(clock);
  controller.start();
  clock.advance(60_000);
  assert.equal(controller.getPhase(), "drink");
  // During a drink there must be no pending timer that could re-trigger.
  assert.equal(clock.pendingCount(), 0);
});

test("a new random delay is scheduled after each completed drink", () => {
  const clock = makeClock(() => 0);
  const { controller, drinks } = record(clock);
  controller.start();
  clock.advance(cfg.minInitialDelayMs); // first drink (min initial)
  assert.equal(drinks.length, 1);
  controller.finishDrink();
  clock.advance(cfg.minDelayMs); // second drink (min regular)
  assert.equal(drinks.length, 2);
  controller.finishDrink();
  clock.advance(cfg.minDelayMs); // third drink
  assert.equal(drinks.length, 3);
});

test("only idle and drink are ever selected (jig/coinToss impossible)", () => {
  const clock = makeClock();
  const { controller, phases } = record(clock);
  controller.start();
  for (let i = 0; i < 10; i++) {
    clock.advance(90_000);
    controller.finishDrink();
  }
  for (const p of phases) {
    assert.ok(p === "idle" || p === "drink", `unexpected phase: ${p}`);
  }
});

test("stop clears the pending timer (unmount cleanup)", () => {
  const clock = makeClock();
  const { controller, drinks } = record(clock);
  controller.start();
  assert.equal(clock.pendingCount(), 1);
  controller.stop();
  assert.equal(clock.pendingCount(), 0);
  clock.advance(120_000);
  assert.equal(drinks.length, 0);
});

test("pause suspends the timer; resume schedules a fresh delay", () => {
  const clock = makeClock();
  const { controller, drinks } = record(clock);
  controller.start();
  controller.pause();
  assert.equal(clock.pendingCount(), 0);
  clock.advance(120_000);
  assert.equal(drinks.length, 0);
  controller.resume();
  assert.equal(clock.pendingCount(), 1);
  clock.advance(60_000);
  assert.equal(drinks.length, 1);
});

test("no duplicate timers are ever created", () => {
  const clock = makeClock();
  const { controller } = record(clock);
  controller.start();
  controller.start();
  controller.pause();
  controller.pause();
  controller.resume();
  controller.resume();
  assert.equal(clock.pendingCount(), 1);
});

test("uses production defaults when no config is supplied", () => {
  assert.equal(DEFAULT_DRINK_CONFIG.minDelayMs, 30_000);
  assert.equal(DEFAULT_DRINK_CONFIG.maxDelayMs, 90_000);
  assert.equal(DEFAULT_DRINK_CONFIG.minInitialDelayMs, 30_000);
  assert.equal(DEFAULT_DRINK_CONFIG.maxInitialDelayMs, 60_000);
});
