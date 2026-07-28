"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "@/lib/use-reduced-motion";
import type { Product } from "@/lib/products";

/**
 * The three jars, with depth.
 *
 * They are the best asset on the page, so they get to behave like objects
 * rather than a flat image: the centre jar sits forward and moves least, the
 * outer two sit back and drift further, which reads as parallax. Pointer
 * position tilts the group; scroll lifts it.
 *
 * Everything here is skipped when reduced motion is requested — the jars still
 * render, they simply hold still.
 */
export function HeroJars({ products }: { products: Product[] }) {
  const reduced = useReducedMotion();
  const frame = useRef<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [scrolled, setScrolled] = useState(0);

  useEffect(() => {
    if (reduced) return;

    const onPointerMove = (event: PointerEvent) => {
      const node = container.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      // -1 to 1 across the panel, so the effect is relative to the artwork
      // rather than the window.
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;

      // Coalesce into one frame: pointermove fires far more often than the
      // screen refreshes, and setting state on each would waste renders.
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => setPointer({ x, y }));
    };

    const onScroll = () => {
      const node = container.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setScrolled(Math.max(-1, Math.min(1, -rect.top / Math.max(1, rect.height))));
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [reduced]);

  return (
    <div ref={container} className="absolute inset-0">
      {/* Warm light behind the jars, so they sit in a space rather than on a flat panel. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 size-[110%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(255,236,209,.95), rgba(222,210,189,.35) 60%, transparent 75%)",
          transform: `translate(calc(-50% + ${pointer.x * 12}px), calc(-50% + ${pointer.y * 10}px))`,
          transition: reduced ? undefined : "transform .9s cubic-bezier(.22,.61,.36,1)",
        }}
      />

      <div className="absolute inset-0 flex items-end justify-center gap-[3%] px-[6%] pb-[7%]">
        {products.map((product, i) => {
          const isCentre = i === 1;
          // Depth: the centre jar is nearest, so it reacts least.
          const depth = isCentre ? 0.45 : 1;
          const drift = (i - 1) * 6;
          return (
            <div
              key={product.id}
              className={`relative w-[30%] ${isCentre ? "h-[88%]" : "h-[72%]"}`}
              style={{
                zIndex: isCentre ? 2 : 1,
                transform: reduced
                  ? undefined
                  : `translate3d(${pointer.x * 14 * depth + drift}px, ${
                      pointer.y * 8 * depth - scrolled * 26 * depth
                    }px, 0) rotate(${pointer.x * 1.1 * depth}deg)`,
                transition: "transform .7s cubic-bezier(.22,.61,.36,1)",
                willChange: reduced ? undefined : "transform",
              }}
            >
              <Image
                src={product.image}
                alt={`${product.name} jar`}
                fill
                priority={isCentre}
                sizes="(max-width: 1024px) 30vw, 22vw"
                className="object-contain object-bottom drop-shadow-[0_22px_34px_rgba(60,32,12,.28)]"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
