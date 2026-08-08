"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";

import { JarMesh } from "@/components/jar3d/jar-mesh";

/**
 * The interactive jar.
 *
 * Drag to turn it, let go and it keeps some momentum, because a jar that stops
 * dead the instant you release it feels like a slider rather than an object.
 *
 * Rotation is held in a ref and written straight to the mesh inside the render
 * loop, never in React state. Sixty state updates a second would re-render the
 * tree sixty times a second for a value React has no opinion about.
 *
 * ## Drawing only when there is something to draw
 *
 * R3F's default is to redraw every frame forever. For a jar that is not moving
 * — which is every jar on a product page until somebody grabs it — that is a
 * full WebGL render per frame of an identical picture. On a machine without GPU
 * acceleration it saturates the main thread and the browser offers to kill the
 * page.
 *
 * So nothing is ever drawn on a timer. Off screen the loop is `never`; on
 * screen it is `demand`, and something has to ask: a drag, momentum, a resize,
 * or — for a jar that rocks by itself — a ticker capped well below the display
 * rate. A slow rock is indistinguishable at 30fps and costs half as much.
 */

/**
 * Frames per second for self-animating jars.
 *
 * The hero's rock takes about eleven seconds per cycle. Rendering that 60 times
 * a second is spending a full GPU frame to move a jar a fraction of a degree.
 */
const ANIMATED_FPS = 30;

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
  const host = useRef<HTMLDivElement>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [visible, setVisible] = useState(true);

  /** Asks this canvas — and only this one — for a single frame. */
  const invalidate = useRef<() => void>(() => {});

  const animates = drift !== 0 || sway !== 0;
  // Never "always". Every frame this canvas draws is one something asked for.
  const frameloop = visible ? "demand" : "never";

  // Stop drawing entirely once the jar is scrolled away. The hero keeps three
  // canvases alive; without this they carry on rendering down the whole page.
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { rootMargin: "100px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /**
   * The heartbeat for a jar that moves on its own.
   *
   * Only runs while the jar is actually on screen, and asks for a frame at
   * `ANIMATED_FPS` rather than at the display's rate. The requestAnimationFrame
   * callback itself is nearly free — it is the WebGL render it triggers that
   * costs, and this halves how often that happens.
   */
  useEffect(() => {
    if (!animates || !visible) return;

    const interval = 1000 / ANIMATED_FPS;
    let frame = 0;
    let last = 0;

    const tick = (now: number) => {
      if (now - last >= interval) {
        last = now;
        invalidate.current();
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animates, visible]);

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
    invalidate.current();
  }, []);

  const endDrag = useCallback(() => {
    dragging.current = false;
    setGrabbing(false);
  }, []);

  /**
   * Momentum after a flick.
   *
   * The loop only exists while there is momentum to spend. It used to run for
   * the life of the page, waking the main thread sixty times a second to
   * discover there was nothing to do.
   */
  useEffect(() => {
    if (!grabbing && Math.abs(velocity.current) <= 0.0001) return;

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (!dragging.current) {
        spin.current += velocity.current * delta * 60;
        // Exponential decay, framerate-independent so a 120Hz screen does not
        // stop the jar twice as fast as a 60Hz one.
        velocity.current *= Math.pow(0.94, delta * 60);
        invalidate.current();
        if (Math.abs(velocity.current) <= 0.0001) {
          velocity.current = 0;
          return;
        }
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [grabbing]);

  return (
    <div
      ref={host}
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
        frameloop={frameloop}
        // The jar is 2 units across and about 3.6 tall. JarMesh pulls the
        // camera back to fit whatever box it ends up in.
        camera={{ position: [0, 0, 7.4], fov: 32 }}
        style={{ background: "transparent" }}
        onCreated={(state) => {
          invalidate.current = state.invalidate;
        }}
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
