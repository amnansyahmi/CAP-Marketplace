"use client";

import { useEffect, useState } from "react";

/**
 * Whether the visitor has asked for less motion.
 *
 * The CSS in globals.css already neutralises transitions and animations, but
 * JavaScript-driven effects — parallax, scroll reveals — have to check for
 * themselves or they will keep moving regardless.
 *
 * Starts `true` so nothing animates before the preference is known: erring
 * towards stillness is the safe default for someone who gets motion sick.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
