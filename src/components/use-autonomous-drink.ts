import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAutonomousDrink,
  DEFAULT_DRINK_CONFIG,
  type AutonomousConfig,
  type AutonomousController,
} from "@/components/autonomous-drink";

export interface UseAutonomousDrinkOptions {
  /** Override timing (production uses `DEFAULT_DRINK_CONFIG`). */
  config?: AutonomousConfig;
  /** True to suspend the schedule (e.g. while a session is working). */
  suspended?: boolean;
}

/**
 * Wires the autonomous drink scheduler to React and the browser:
 *  - starts on mount, schedules the first drink after a random initial delay;
 *  - pauses the timer while the tab is hidden, reschedules on return;
 *  - exposes `onAnimationEnd` to notify the scheduler when a drink finishes;
 *  - cleans up timers and the visibility listener on unmount.
 */
export function useAutonomousDrink(
  options: UseAutonomousDrinkOptions = {},
): { animation: "idle" | "drink"; onAnimationEnd: () => void } {
  const { config = DEFAULT_DRINK_CONFIG, suspended = false } = options;
  const [animation, setAnimation] = useState<"idle" | "drink">("idle");
  const controllerRef = useRef<AutonomousController | null>(null);
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );

  // Create the scheduler + visibility listener exactly once.
  useEffect(() => {
    const controller = createAutonomousDrink(
      config,
      {
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id as number),
        random: Math.random,
      },
      {
        onDrink: () => setAnimation("drink"),
        onIdle: () => setAnimation("idle"),
      },
    );
    controllerRef.current = controller;

    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);

    controller.start();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      controller.stop();
      controllerRef.current = null;
    };
  }, [config]);

  // Pause/resume based on the combined suspended state (busy OR hidden).
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (suspended || hidden) controller.pause();
    else controller.resume();
  }, [suspended, hidden]);

  const onAnimationEnd = useCallback(() => {
    controllerRef.current?.finishDrink();
  }, []);

  return { animation, onAnimationEnd };
}
