"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Whether this machine should be running WebGL at all, and whether it should
 * carry on once it has started.
 *
 * Both questions live here because both are asked from two places — the small
 * jars and the scroll showpiece — and a check that exists twice is a check that
 * will eventually only get fixed once.
 */

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
 * Whether this browser can give us a context worth having.
 *
 * `'webgl2' in window` is not the question — plenty of devices expose the API
 * and then fail to create a context, or fall back to a software renderer that
 * turns a hero into a slideshow. So this asks for a real context *and* asks
 * what is behind it.
 */
export function canRenderWebGL(): boolean {
  if (probed === undefined) probed = probeWebGL();
  return probed;
}

/**
 * The answer, worked out once.
 *
 * Probing means creating a real GL context and throwing it away. A page can
 * hold four jars, and asking each of them to do that — repeatedly, since a
 * store snapshot is read on every render — would be four contexts created and
 * destroyed for a fact that cannot change while the page is open.
 */
let probed: boolean | undefined;

function probeWebGL(): boolean {
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

    // Release it immediately; contexts are a limited resource.
    (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();

    return !SOFTWARE_RENDERERS.test(renderer);
  } catch {
    return false;
  }
}

/**
 * Reports true once the renderer has proved too slow for this machine.
 *
 * Refusing known software renderers by name catches the common case, but it
 * cannot know about a weak integrated GPU, a throttling laptop, or a machine
 * that is simply busy. So rather than predict, this measures: `longtask`
 * entries are the browser's own record of the main thread not answering, and if
 * enough pile up while the jar is on screen the caller is told to give up.
 *
 * Sampling starts after a settling delay, because mounting a WebGL context is
 * legitimately expensive once and that should not condemn it. The answer only
 * ever goes from false to true — a machine that struggled once is not asked to
 * prove itself again on the same page.
 */
export function useTooSlow(active: boolean): boolean {
  const [tooSlow, setTooSlow] = useState(false);

  useEffect(() => {
    if (!active || tooSlow) return;
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
  }, [active, tooSlow]);

  return tooSlow;
}

/**
 * `canRenderWebGL` as a hook, safe to call during render.
 *
 * Reports false on the server and through hydration — there is no `document`
 * there and the first client render has to match what the server produced —
 * then the real answer immediately after. Reading it through a store rather
 * than setting state in an effect means no render happens carrying an answer we
 * already know is provisional.
 */
const noSubscribe = () => () => {};

export function useCanRenderWebGL(): boolean {
  return useSyncExternalStore(noSubscribe, canRenderWebGL, () => false);
}
