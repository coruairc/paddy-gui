import { PaddyMascot, type PaddyAnimation } from "@/components/paddy-mascot";
import { isAnimationEnabled } from "@/components/paddy-animations";
import { useAutonomousDrink } from "@/components/use-autonomous-drink";
import { cn } from "@/lib/utils";

export type PaddyIdleMove = "drink" | "jig" | "coinToss";

const IDLE_CAPTION = "Standing by. Chat when you're ready.";
const MOTION_CAPTION: Record<PaddyIdleMove, string> = {
  drink: "Downing a pint. Chat when you're ready.",
  jig: "Irish dancing. Drop a message to join in.",
  coinToss: "Tossing a coin into the pot. Ask him anything.",
};

export function PaddyIdle({
  name,
  className,
  move: forced,
  busy = false,
}: {
  name: string;
  className?: string;
  /** Override for tests / Storybook. When set, autonomy is suspended. */
  move?: PaddyIdleMove;
  /** True while a session is working — keeps Paddy on idle. */
  busy?: boolean;
}) {
  const manual = forced !== undefined;
  const { animation: autonomous, onAnimationEnd } = useAutonomousDrink({
    suspended: busy || manual,
  });

  // A manually forced animation takes precedence; otherwise Paddy runs
  // autonomously between idle and drink.
  const animation: PaddyAnimation =
    manual && isAnimationEnabled(forced) ? forced : autonomous;

  const caption = animation === "idle" ? IDLE_CAPTION : MOTION_CAPTION[animation];

  return (
    <div
      className={cn(
        "mx-auto flex max-w-md flex-col items-center gap-6 pt-8 text-center sm:pt-16",
        className,
      )}
    >
      <div className={cn("paddy-idle-stage rise-in", `paddy-idle--${animation}`)} aria-hidden>
        <PaddyMascot
          animation={animation}
          onAnimationEnd={manual ? undefined : onAnimationEnd}
        />
      </div>
      <div className="rise-in stagger-2">
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">{name}</h1>
        <p className="mt-3 text-sm text-muted">{caption}</p>
      </div>
    </div>
  );
}
