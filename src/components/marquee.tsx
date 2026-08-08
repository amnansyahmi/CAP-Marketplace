import { cn } from "@/lib/utils";

/**
 * A slow scrolling band of text.
 *
 * Gives the page a pulse between two still sections without asking the visitor
 * to do anything. Only the first run is announced; the repeats exist purely to
 * keep the loop seamless and are hidden from assistive technology.
 *
 * Each run slides by exactly its own width, so run `n + 1` lands where run `n`
 * started and the reset is invisible. That means the runs *after* the first
 * have to cover the viewport on their own: with `repeat` copies of a run `w`
 * wide, the band stays filled up to a viewport of `(repeat - 1) * w`. Four
 * copies of a typical run covers past 4K; two would leave a bare strip on the
 * right of a wide monitor for most of the cycle.
 *
 * The animation is CSS, so `prefers-reduced-motion` in globals.css stops it
 * without any JavaScript involved.
 */
export function Marquee({
  items,
  className,
  separator = "·",
  repeat = 4,
}: {
  items: string[];
  className?: string;
  separator?: string;
  repeat?: number;
}) {
  const run = (index: number) => (
    <ul
      key={index}
      aria-hidden={index > 0 || undefined}
      className="flex shrink-0 items-center gap-10 pr-10 [animation:marquee_38s_linear_infinite] motion-reduce:[animation:none]"
    >
      {items.map((item, i) => (
        <li key={`${item}-${i}`} className="flex items-center gap-10 whitespace-nowrap">
          <span>{item}</span>
          <span aria-hidden className="text-primary/60">
            {separator}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className={cn(
        "flex overflow-hidden border-y border-border py-4 text-[11px] font-semibold uppercase tracking-[.28em] text-muted-foreground",
        className,
      )}
    >
      {Array.from({ length: Math.max(2, repeat) }, (_, i) => run(i))}
    </div>
  );
}
