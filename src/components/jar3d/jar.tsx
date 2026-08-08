"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * A jar that turns — when that is a good idea, and a photograph when it is not.
 *
 * Three rules, in order of how much they matter:
 *
 * 1. **The photograph renders first, always.** It is the real product shot and
 *    it is already on the page. WebGL is loaded afterwards and fades in over
 *    the top. Nobody waits on a 3D library to find out what they are buying.
 *
 * 2. **It only loads when it is on screen.** A jar three sections down the page
 *    does not need a renderer until somebody scrolls to it, and most visitors
 *    never will.
 *
 * 3. **It gives up quietly.** Reduced motion, no WebGL, a context that fails to
 *    create — every one of those leaves the photograph in place. A spinning jar
 *    is a flourish; the product shot is the product.
 */

const JarCanvas = dynamic(() => import("@/components/jar3d/jar-canvas").then((m) => m.JarCanvas), {
  ssr: false,
});

/**
 * Whether this browser can actually give us a context.
 *
 * `'webgl2' in window` is not the question — plenty of devices expose the API
 * and then fail to create a context, or fall back to a software renderer that
 * turns a hero into a slideshow. Asking for a real context is the only answer
 * that means anything.
 */
function canRenderWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    // Release it immediately; contexts are a limited resource.
    const lose = (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function Jar({
  productId,
  /** The original product photograph, shown first and kept as the fallback. */
  image,
  /** The unwrapped 360° texture. */
  wrap,
  alt,
  priority = false,
  drift,
  className = "",
  sizes = "(max-width: 1024px) 60vw, 30vw",
  /** Shows a "drag to turn" hint, but only once the jar can actually turn. */
  hint = false,
}: {
  productId: string;
  image: string;
  wrap: string;
  alt: string;
  priority?: boolean;
  drift?: number;
  className?: string;
  sizes?: string;
  hint?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);

  // Only bother once it is close to being seen.
  useEffect(() => {
    if (reduced) return;
    const node = host.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setNear(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "300px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (!near || reduced) return;
    if (!canRenderWebGL()) return;

    // A frame's grace so the photograph has painted before the renderer starts
    // competing for the main thread.
    const timer = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(timer);
  }, [near, reduced]);

  return (
    // Always `relative`, because the photograph inside uses `fill` and needs a
    // positioned box with a real height. Callers pass sizing, not positioning —
    // a caller adding `absolute` here would collapse this to nothing.
    <div ref={host} className={`relative ${className}`}>
      {/* Never unmounted. It is the fallback, the loading state, and what
          anyone with JavaScript disabled sees. */}
      <Image
        src={image}
        alt={alt}
        fill
        priority={priority}
        sizes={sizes}
        className={`object-contain object-bottom drop-shadow-[0_22px_34px_rgba(60,32,12,.28)] transition-opacity duration-700 ${
          ready ? "opacity-0" : "opacity-100"
        }`}
      />

      {ready && (
        <JarCanvas
          productId={productId}
          image={wrap}
          alt={alt}
          drift={drift}
          className="absolute inset-0 animate-[fadeIn_.7s_ease-out_both]"
        />
      )}

      {/* Only once it can actually be dragged. Telling somebody to turn a
          photograph is worse than saying nothing. */}
      {hint && ready && (
        <p className="pointer-events-none absolute inset-x-0 bottom-0 animate-[fadeIn_.7s_ease-out_both] text-center text-[10px] font-semibold uppercase tracking-[.18em] text-foreground/40">
          Drag to turn
        </p>
      )}
    </div>
  );
}
