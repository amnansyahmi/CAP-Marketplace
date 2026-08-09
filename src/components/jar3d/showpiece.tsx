"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { useCanRenderWebGL, useTooSlow } from "@/components/jar3d/capability";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * A jar that opens as you scroll past it.
 *
 * The section is taller than the screen; the jar is pinned in the middle of it
 * and how far you are through the section is how far the lid is off. Scroll
 * down and it unscrews, rises, and the paste comes up after it. Scroll back and
 * it screws shut again, because a one-way animation that has already fired is
 * dead space on the way back up.
 *
 * ## Why the progress never touches React state
 *
 * Scroll fires far more often than React should render. The value is written
 * into a ref by a passive scroll listener and read inside the animation loop,
 * so a full page scroll costs zero re-renders of this component or anything
 * under it.
 *
 * ## What happens when it cannot run
 *
 * Reduced motion, no WebGL, a renderer too slow — all of them leave the
 * photograph and the words in place. The section still says what it says; it
 * simply does not move. Nothing here is load-bearing for understanding the
 * product.
 */

const JarCanvas = dynamic(() => import("@/components/jar3d/jar-canvas").then((m) => m.JarCanvas), {
  ssr: false,
});

export function Showpiece({
  productId,
  image,
  wrap,
  name,
  arabic,
  accent,
  blurb,
}: {
  productId: string;
  image: string;
  wrap: string;
  name: string;
  arabic: string;
  accent: string;
  blurb: string;
}) {
  const section = useRef<HTMLDivElement>(null);
  const open = useRef(0);
  const reduced = useReducedMotion();
  const capable = useCanRenderWebGL();
  const tooSlow = useTooSlow(capable);
  // `tooSlow` has to be able to take a running canvas away again, not only stop
  // one from starting: the trouble is invisible until it is already rendering.
  const ready = capable && !tooSlow;

  /**
   * Whether the lid actually moves.
   *
   * Reduced motion does not mean no jar — it means no *autonomous* motion. The
   * model still loads and can still be turned by hand, because a drag is
   * something the visitor asked for. What stops is everything that moves on its
   * own: the rocking, and the lid unscrewing itself as the page scrolls past.
   */
  const animates = ready && !reduced;

  /**
   * How far through the section we are, as the lid's position.
   *
   * Measured against the *scrollable* part of the section — its height minus
   * one screen — so the lid is fully off exactly as the sticky jar reaches the
   * bottom of its travel, rather than some way before or after it.
   */
  useEffect(() => {
    const node = section.current;
    if (!node || !animates) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) {
        open.current = 0;
        return;
      }
      const scrolled = Math.min(travel, Math.max(0, -rect.top));
      open.current = scrolled / travel;
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [animates]);

  return (
    <section
      ref={section}
      aria-label={`${name}, opened`}
      /**
       * Two extra screens of travel, so the unscrewing reads as a deliberate
       * motion rather than a flicker.
       *
       * Collapsed by CSS rather than by JavaScript when the visitor has asked
       * for less motion: there is nothing to scrub through, and holding them on
       * a motionless jar for three screens would be worse than not having it.
       * A media query settles this before the first paint, where reading the
       * preference in React would render the tall version and then jump.
       */
      className="relative h-[280vh] motion-reduce:h-auto"
      style={{ backgroundColor: `${accent}0a` }}
    >
      {/* `pt` clears the sticky site header, which would otherwise sit over the
          top of the jar exactly when the lid rises into it. */}
      <div className="sticky top-0 flex h-screen items-center overflow-hidden pt-[4.5rem] motion-reduce:static motion-reduce:h-auto motion-reduce:py-20 md:pt-0">
        <div className="mx-auto grid w-full max-w-6xl gap-5 px-6 md:gap-8 md:grid-cols-2 md:items-center">
          <div className="order-2 md:order-1">
            <p className="font-serif text-3xl leading-none text-foreground/15 md:text-7xl" aria-hidden>
              {arabic}
            </p>
            <h2 className="mt-2 font-serif text-3xl leading-[1.05] md:mt-4 md:text-6xl">{name}</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground md:mt-5 md:text-lg md:leading-7">{blurb}</p>
            <p className="mt-5 text-[11px] md:mt-8 font-semibold uppercase tracking-[.2em] text-foreground/40">
              {animates ? "Keep scrolling" : "350g jar"}
            </p>
          </div>

          <div className="order-1 md:order-2">
            {/* Tall enough for the lid to travel up without leaving the frame.
                Narrower on a phone, where the jar and the words have to share
                one screen rather than sit side by side. */}
            <div className="relative mx-auto aspect-[3/4] w-full max-w-[220px] md:max-w-[380px]">
              <Image
                src={image}
                alt={`${name} jar`}
                fill
                sizes="(max-width: 768px) 220px, 380px"
                className={`object-contain transition-opacity duration-700 ${ready ? "opacity-0" : "opacity-100"}`}
              />
              {ready && (
                <JarCanvas
                  productId={productId}
                  image={wrap}
                  alt={`${name} jar`}
                  open={open}
                  className="absolute inset-0 animate-[fadeIn_.7s_ease-out_both]"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
