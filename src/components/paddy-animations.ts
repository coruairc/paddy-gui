import type { PaddyAnimation } from "@/components/paddy-mascot";

/**
 * Animation availability flags.
 *
 * - Idle and Drink are active.
 * - Jig and Coin Toss are fully implemented — assets, frame timelines,
 *   CSS/keyframes, and the animation controller all remain in the codebase —
 *   but are currently disabled.
 *
 * To re-enable one, flip its value to `true`. Nothing else needs to change:
 * the dev controls, the celebration trigger, and the forced-move override all
 * read from this table.
 */
export const enabledAnimations: Record<PaddyAnimation, boolean> = {
  idle: true,
  drink: true,
  jig: false,
  coinToss: false,
};

export function isAnimationEnabled(animation: PaddyAnimation): boolean {
  return enabledAnimations[animation] === true;
}
