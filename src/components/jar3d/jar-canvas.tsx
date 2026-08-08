"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";

import { JarMesh } from "@/components/jar3d/jar-mesh";

/**
 * The interactive jar.
 *
 * Drag to turn it, let go and it eases back to a slow drift. Momentum carries
 * on after a flick, because a jar that stops dead the instant you release it
 * feels like a slider rather than an object.
 *
 * Rotation is held in a ref and written straight to the mesh inside the render
 * loop, never in React state. Sixty state updates a second would re-render the
 * tree sixty times a second for a value React has no opinion about.
 */
export function JarCanvas({
  productId,
  image,
  alt,
  /**
   * Radians per second when idle.
   *
   * Zero on pages where somebody is reading the label — a jar that turns away
   * while you are looking at the ingredients is an irritation, not a flourish.
   */
  drift = 0,
  /** Radians of gentle rocking either side of the current angle. */
  sway = 0,
  className,
}: {
  productId: string;
  image: string;
  alt: string;
  drift?: number;
  sway?: number;
  className?: string;
}) {
  const spin = useRef(0);
  const velocity = useRef(0);
  const dragging = useRef(false);
  const lastX = useRef(0);
  const [grabbing, setGrabbing] = useState(false);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    lastX.current = event.clientX;
    velocity.current = 0;
    setGrabbing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dx = event.clientX - lastX.current;
    lastX.current = event.clientX;
    // Scaled to the element's width, so a drag across the jar turns it about
    // the same amount whether it is rendered large or small.
    const width = event.currentTarget.clientWidth || 1;
    const turn = (dx / width) * Math.PI * 2;
    spin.current += turn;
    velocity.current = turn;
  }, []);

  const endDrag = useCallback(() => {
    dragging.current = false;
    setGrabbing(false);
  }, []);

  // Momentum, and the drift the jar settles back into.
  useEffect(() => {
    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (!dragging.current && Math.abs(velocity.current) > 0.0001) {
        spin.current += velocity.current * delta * 60;
        // Exponential decay, framerate-independent so a 120Hz screen does not
        // stop the jar twice as fast as a 60Hz one.
        velocity.current *= Math.pow(0.94, delta * 60);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={className}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{ cursor: grabbing ? "grabbing" : "grab", touchAction: "pan-y" }}
      // The canvas is decoration over information the page already carries in
      // text; the alt text is what a screen reader needs, not a draggable toy.
      role="img"
      aria-label={alt}
    >
      <Canvas
        // Transparent so the jar sits on whatever is behind it.
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        // Capped: retina phones would otherwise render four times the pixels
        // for a difference nobody can see on a jar this size.
        dpr={[1, 2]}
        // The jar is 2 units across and about 3.6 tall. This distance fits the
        // height with a little air, and the width never comes close.
        camera={{ position: [0, 0, 7.4], fov: 32 }}
        style={{ background: "transparent" }}
      >
        {/* useLoader suspends while the texture downloads. Without a boundary
            inside the Canvas, R3F renders an empty scene and never recovers. */}
        <Suspense fallback={null}>
          <JarMesh productId={productId} image={image} spin={spin} autoSpin={drift} sway={sway} />
        </Suspense>
      </Canvas>
    </div>
  );
}
