"use client";

import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

type RevealProps = {
  children: React.ReactNode;
  className?: string;
  /** Stagger, in milliseconds, for items revealed as a group. */
  delay?: number;
  /** Distance to travel, in pixels. Larger reads as heavier. */
  distance?: number;
  as?: "div" | "section" | "li" | "article";
};

/**
 * Fades and lifts its children into place as they enter the viewport.
 *
 * Content is visible from the first paint and only *then* animated, so the page
 * still reads with JavaScript disabled or broken — a reveal that starts at
 * opacity 0 and depends on a script to undo it will hide the shop from anyone
 * that script fails for.
 */
export function Reveal({ children, className, delay = 0, distance = 24, as = "div" }: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(false);

  /**
   * Whether to hide anything at all.
   *
   * `useReducedMotion` reports `true` on the server and through hydration, so
   * this is false for the first paint no matter what — the content is on screen
   * and staying there. It only becomes true on a client that has told us it
   * wants motion *and* can observe the viewport; without an observer nothing
   * would ever set `shown`, and arming would hide the page permanently.
   */
  const armed = !reduced && typeof IntersectionObserver !== "undefined";

  useEffect(() => {
    if (!armed) return;

    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      // Fires a little before the element arrives, so it has settled by the
      // time it is properly in view.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [armed]);

  const Tag = as as "div";
  const hidden = armed && !shown;

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={cn("motion-reduce:!translate-y-0 motion-reduce:!opacity-100", className)}
      style={{
        opacity: hidden ? 0 : 1,
        transform: hidden ? `translateY(${distance}px)` : "translateY(0)",
        transition: armed
          ? `opacity .75s cubic-bezier(.22,.61,.36,1) ${delay}ms, transform .75s cubic-bezier(.22,.61,.36,1) ${delay}ms`
          : undefined,
        willChange: hidden ? "opacity, transform" : undefined,
      }}
    >
      {children}
    </Tag>
  );
}
