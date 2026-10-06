import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { isAnimationEnabled } from "@/components/paddy-animations";

export type PaddyAnimation = "idle" | "drink" | "jig" | "coinToss";
export type PaddyMascotController = { playPaddyAnimation: (animation: Exclude<PaddyAnimation, "idle">) => void };

type Step = { src: string; ms: number };

const src = (name: string, n: number) => `/paddy-sprites/${name}-${n}.png`;

const frames = (name: string, order: number[], durs: number[]): Step[] =>
  order.map((n, i) => ({ src: src(name, n), ms: durs[i] ?? durs[durs.length - 1] }));

/* Real sprite-frame timelines built from the supplied artwork. Every entry is a
   distinct drawn pose, shown for its own duration — this is frame animation,
   not an opacity crossfade. */
const IDLE = frames("paddy-idle", [1, 2, 3, 4, 5], [820, 760, 820, 760, 820]);

const DRINK = frames("paddy-drink", [1, 2, 3, 4, 5, 6, 7], [340, 300, 380, 520, 520, 380, 320]);

// Ping-pong so the dance loops seamlessly, repeated twice (~3.8s at 120ms).
const JIG_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3, 2];
const JIG = frames("paddy-jig", [...JIG_ORDER, ...JIG_ORDER], new Array(32).fill(120));

// Prepare -> flick -> coin up -> apex -> descend -> catch -> wink -> idle.
const TOSS = frames("paddy-toss", [1, 2, 3, 4, 5, 6, 7, 8], [350, 200, 200, 250, 200, 350, 330, 250]);

const TIMELINES: Record<PaddyAnimation, Step[]> = {
  idle: IDLE,
  drink: DRINK,
  jig: JIG,
  coinToss: TOSS,
};

function timelineFor(animation: PaddyAnimation): Step[] {
  return TIMELINES[animation];
}

/**
 * Drives discrete sprite frames on a requestAnimationFrame clock.
 *
 * Frames are written straight to the <img> element (via a ref), so React does
 * not re-render on every frame change — the component only re-renders when the
 * `animation` prop itself changes. Timing is elapsed-time based so it stays
 * consistent even if a frame is dropped.
 */
function useSpriteFrames(animation: PaddyAnimation, onEnd?: () => void) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    const timeline = timelineFor(animation);
    const total = timeline.reduce((sum, s) => sum + s.ms, 0);
    const img = imgRef.current;
    if (!img) return;

    img.src = timeline[0].src;
    let frame = 0;
    let raf = 0;
    let loopStart = performance.now();

    const tick = (now: number) => {
      let elapsed = now - loopStart;
      if (elapsed >= total) {
        if (animation === "idle") {
          loopStart = now;
          elapsed = 0;
        } else {
          img.src = timeline[timeline.length - 1].src;
          endRef.current?.();
          return;
        }
      }
      let acc = 0;
      let i = 0;
      while (i < timeline.length && acc + timeline[i].ms <= elapsed) {
        acc += timeline[i].ms;
        i += 1;
      }
      if (i !== frame) {
        frame = i;
        img.src = timeline[i].src;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animation]);

  return { imgRef, src: timelineFor(animation)[0]?.src ?? "" };
}

export function usePaddyAnimationController() {
  const [animation, setAnimation] = useState<PaddyAnimation>("idle");
  return { animation, playPaddyAnimation: (next: Exclude<PaddyAnimation, "idle">) => setAnimation(next) };
}

export const PaddyMascot = forwardRef<PaddyMascotController, {
  animation?: PaddyAnimation;
  className?: string;
  onAnimationEnd?: () => void;
}>(function PaddyMascot({ animation: controlled, className, onAnimationEnd }, ref) {
  const controller = usePaddyAnimationController();
  const animation = controlled ?? controller.animation;
  const { imgRef, src } = useSpriteFrames(animation, onAnimationEnd);

  // Preload and decode frames for enabled animations only, so switching to
  // Drink never triggers an in-frame fetch/decode. Disabled animations
  // (Jig / Coin Toss) are skipped.
  useEffect(() => {
    const seen = new Set<string>();
    for (const name of Object.keys(TIMELINES) as PaddyAnimation[]) {
      if (!isAnimationEnabled(name)) continue;
      for (const step of TIMELINES[name]) {
        if (seen.has(step.src)) continue;
        seen.add(step.src);
        const img = new Image();
        img.decoding = "async";
        img.src = step.src;
        img.decode?.().catch(() => {});
      }
    }
  }, []);

  useImperativeHandle(ref, () => ({ playPaddyAnimation: controller.playPaddyAnimation }), [controller.playPaddyAnimation]);

  return (
    <div className={cn("paddy-mascot", className)} data-paddy-animation={animation}>
      <div className="paddy-stage" role="img" aria-label="Paddy, the Irish OpenCode mascot">
        <div className="paddy-glow" aria-hidden="true" />
        <div className="paddy-body-wrap">
          <img ref={imgRef} className="paddy-body" src={src} alt="" draggable={false} />
        </div>
        {animation === "coinToss" && <div className="paddy-coin" aria-hidden="true" />}
      </div>
    </div>
  );
});
