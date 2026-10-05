import { cn } from "@/lib/utils";

export function HelixMark({
  className,
  spinning = false,
}: {
  className?: string;
  spinning?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 overflow-hidden rounded-full bg-elevated shadow-[var(--shadow-border)]",
        spinning && "pulse-live",
        className,
      )}
    >
      <img src="/paddy-icon-circle.png" alt="" className="size-full object-cover" />
    </span>
  );
}
