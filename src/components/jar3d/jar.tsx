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
 * Renderers that run on the CPU.
 *
 * A machine with no usable GPU still reports WebGL — the browser quietly hands
 * back a software rasteriser instead. It answers every question correctly and
 * then takes tens of milliseconds per frame, on the main thread, which is how a
 * page ends up showing "Page Unresponsive".
 */
const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

/** How long the WebGL context is allowed to settle before it is judged. */
const SETTLE_MS = 1200;
/** How long to watch for. */
const SAMPLE_MS = 2500;
/** Blocked for more than this fraction of the window and the 3D is dropped. */
const MAX_BLOCKED_SHARE = 0.5;

/**
 * Whether this browser can actually give us a context worth having.
 *
 * `'webgl2' in window` is not the question — plenty of devices expose the API
 * and then fail to create a context, or fall back to a software renderer that
 * turns a hero into a slideshow. So this asks for a real context *and* asks
 * what is behind it.
 */
function canRenderWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;

    // What is actually doing the drawing. Some browsers mask this for
    // fingerprinting reasons; an unknown renderer is treated as fine, because
    // refusing everything we cannot identify would drop 3D on privacy-hardened
    // browsers that render it perfectly well.
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? "") : "";

    const lose = (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    lose?.loseContext();

    return !SOFTWARE_RENDERERS.test(renderer);
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
  sway,
  className = "",
  sizes = "(max-width: 1024px) 60vw, 30vw",
  /** Shows a "drag to turn" hint, but only once the jar can actually turn. */
  hint = false,
  /**
   * Below this rendered width, in CSS pixels, the photograph is kept.
   *
   * On a phone the three hero jars render about 104px across. A 3D jar that
   * small is not a flourish anyone can see — it is a quarter of a megabyte of
   * renderer plus a texture per jar, spent on something indistinguishable from
   * the photograph already sitting there.
   *
   * Measured: 104px on a 393px phone, 213-220px on tablet and desktop. 180
   * falls in the gap, so the hero keeps its 3D on larger screens and drops to
   * the photographs on a phone, without a media query having to guess.
   */
  minWidth = 180,
}: {
  productId: string;
  image: string;
  wrap: string;
  alt: string;
  priority?: boolean;
  drift?: number;
  sway?: number;
  className?: string;
  sizes?: string;
  hint?: boolean;
  minWidth?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  /** Set once the renderer has proved too slow. Never unset. */
  const [tooSlow, setTooSlow] = useState(false);

  /**
   * Whether the 3D jar is on screen right now.
   *
   * `tooSlow` has to be able to take a *running* canvas away again, not just
   * stop one from starting — the whole point is that the machine's trouble only
   * becomes visible once it is already rendering.
   */
  const showing3D = ready && !tooSlow;

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
    if (!near || reduced || tooSlow) return;
    // Too small to be worth the download.
    if ((host.current?.clientWidth ?? 0) < minWidth) return;
    if (!canRenderWebGL()) return;

    // A frame's grace so the photograph has painted before the renderer starts
    // competing for the main thread.
    const timer = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(timer);
  }, [near, reduced, minWidth, tooSlow]);

  /**
   * Give up if the renderer turns out to be too slow for this machine.
   *
   * Refusing known software renderers by name catches the common case, but it
   * cannot know about a weak integrated GPU, a throttling laptop, or a machine
   * that is simply busy. So rather than predict, this measures: `longtask`
   * entries are the browser's own record of the main thread not answering, and
   * if enough of them pile up while the jar is on screen the photograph comes
   * back for the rest of the session.
   *
   * Sampling starts after a settling delay, because mounting a WebGL context is
   * legitimately expensive once and that should not condemn it.
   */
  useEffect(() => {
    if (!ready) return;
    if (typeof PerformanceObserver === "undefined") return;

    let blocked = 0;
    let observer: PerformanceObserver | undefined;
    let decide: ReturnType<typeof setTimeout> | undefined;

    const start = setTimeout(() => {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) blocked += entry.duration;
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        // Not supported here — Safari, mostly. Leaving the 3D running is no
        // worse than having no check at all.
        return;
      }

      // If the thread spent more than this share of the window blocked, the jar
      // is costing more than it is worth.
      decide = setTimeout(() => {
        observer?.disconnect();
        if (blocked > SAMPLE_MS * MAX_BLOCKED_SHARE) setTooSlow(true);
      }, SAMPLE_MS);
    }, SETTLE_MS);

    return () => {
      clearTimeout(start);
      if (decide) clearTimeout(decide);
      observer?.disconnect();
    };
  }, [ready]);

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
          showing3D ? "opacity-0" : "opacity-100"
        }`}
      />

      {showing3D && (
        <JarCanvas
          productId={productId}
          image={wrap}
          alt={alt}
          drift={drift}
          sway={sway}
          className="absolute inset-0 animate-[fadeIn_.7s_ease-out_both]"
        />
      )}

      {/* Only once it can actually be dragged. Telling somebody to turn a
          photograph is worse than saying nothing. */}
      {hint && showing3D && (
        // Sits below the jar rather than across its base. Callers pad the
        // container, so this reaches into that padding instead of overlapping
        // the product.
        <p className="pointer-events-none absolute inset-x-0 -bottom-7 animate-[fadeIn_.7s_ease-out_both] text-center text-[10px] font-semibold uppercase tracking-[.18em] text-foreground/45">
          Drag to turn
        </p>
      )}
    </div>
  );
}
