"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the visitor has asked for less motion.
 *
 * The CSS in globals.css already neutralises transitions and animations, but
 * JavaScript-driven effects — parallax, scroll reveals, the 3D jar — have to
 * check for themselves or they will keep moving regardless.
 *
 * The server snapshot is `true`, so nothing animates before the preference is
 * known: erring towards stillness is the safe default for someone who gets
 * motion sick, and it means the first client render matches the server's.
 *
 * This is a subscription to a browser API, which is what `useSyncExternalStore`
 * is for. Reading it in an effect and calling `setState` would work, but it
 * renders once with the wrong answer first and React now flags that as a
 * cascading render.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;

/** No `window` on the server, so assume the cautious answer. */
const getServerSnapshot = () => true;

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
