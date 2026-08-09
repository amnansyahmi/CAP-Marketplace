"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Paste thrown up out of the jar as the lid comes off.
 *
 * ## Why particles rather than the photograph
 *
 * The reference shot has a beautiful frozen splash, and pasting it in as a
 * billboard would look right from exactly one angle. The jar turns, so it would
 * be a flat sticker hanging in the air the moment anybody dragged it. These are
 * real bodies in the scene: they sit behind the jar's shoulder when they fall
 * behind it, and they orbit with it.
 *
 * ## Why they are lumps rather than spheres
 *
 * This is a coarse spice paste, not a liquid. Every droplet gets its own
 * random squash and a slow tumble, so the silhouette is irregular. A field of
 * perfect spheres reads as bubbles, which is the wrong material entirely.
 *
 * ## Why one draw call
 *
 * `InstancedMesh` draws all of them at once from a single geometry. Sixty
 * separate meshes would be sixty draw calls per frame for something that is
 * decoration, and this has to be affordable on a phone.
 */

/** Enough to read as a burst; few enough to stay cheap on a phone. */
const COUNT = 96;

/**
 * Downward pull on the droplets, in world units.
 *
 * Not real gravity — the jar is about 3.6 units tall, so this is tuned to how
 * the throw reads rather than to metres per second. Heavier looks like grit
 * being flicked; lighter looks like the paste is floating.
 */
const GRAVITY = 2.2;

/**
 * Shading for the droplets.
 *
 * They were flat-coloured to begin with, and a flat-coloured ball is a circle:
 * the burst read as soap bubbles rather than paste. This is the same
 * view-space trick the jar uses — brighter where the surface faces the light,
 * darker where it turns away — which costs nothing and is enough to make each
 * lump look like it has a near side and a far side.
 */
const dropletVertex = /* glsl */ `
  varying vec3 vNormalView;
  void main() {
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const dropletFragment = /* glsl */ `
  uniform vec3 uColour;
  uniform float uOpacity;
  varying vec3 vNormalView;

  void main() {
    vec3 light = normalize(vec3(-0.5, 0.75, 0.6));
    float lambert = clamp(dot(normalize(vNormalView), light), 0.0, 1.0);

    // Never fully black on the shadow side — this is a lit studio, and paste
    // picks up plenty of bounce.
    vec3 colour = uColour * mix(0.55, 1.25, lambert);

    // A tight specular, because the paste is oily and catches a hard highlight.
    float spec = pow(lambert, 22.0) * 0.5;

    gl_FragColor = vec4(colour + spec, uOpacity);
    #include <colorspace_fragment>
  }
`;

type Droplet = {
  /** Direction and speed of launch. */
  velocity: THREE.Vector3;
  /** Where it starts, spread around the mouth of the jar. */
  origin: THREE.Vector3;
  scale: number;
  squash: THREE.Vector3;
  tumble: THREE.Vector3;
  /** Fraction of the opening it waits through before launching. */
  delay: number;
};

/**
 * Deterministic randomness.
 *
 * The splash must look identical on the server-rendered first frame and on
 * every reload, and a seeded generator is how you get variety that is also
 * repeatable. `Math.random()` would give a different splash on each visit,
 * which sounds harmless until a screenshot test starts flickering.
 */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function Splash({
  /** How far through the opening we are, 0 to 1. */
  progress,
  /** Radius of the jar mouth, in world units. */
  mouthRadius,
  /** Height of the jar mouth above the jar's centre. */
  mouthHeight,
  /** Sampled from the paste in the product photograph. */
  colour,
}: {
  progress: React.RefObject<number>;
  mouthRadius: number;
  mouthHeight: number;
  colour: string;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const droplets = useMemo<Droplet[]>(() => {
    const random = seeded(20250809);
    return Array.from({ length: COUNT }, () => {
      // Launched up and outward in a ring, the way a splash leaves a neck.
      const angle = random() * Math.PI * 2;
      const spread = 0.3 + random() * 1.15;
      const lift = 1.3 + random() * 2.1;

      return {
        origin: new THREE.Vector3(
          Math.cos(angle) * mouthRadius * (0.15 + random() * 0.75),
          mouthHeight,
          Math.sin(angle) * mouthRadius * (0.15 + random() * 0.75),
        ),
        velocity: new THREE.Vector3(Math.cos(angle) * spread, lift, Math.sin(angle) * spread),
        scale: 0.018 + random() * 0.052,
        // Lumps, not beads.
        squash: new THREE.Vector3(1, 0.55 + random() * 0.8, 0.75 + random() * 0.5),
        tumble: new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1),
        // Staggered, so the burst has a leading edge rather than appearing whole.
        delay: random() * 0.22,
      };
    });
  }, [mouthRadius, mouthHeight]);

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 1), []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: dropletVertex,
        fragmentShader: dropletFragment,
        transparent: true,
        // Never write depth: the droplets fade out, and writing depth would
        // punch holes in the ones behind them.
        depthWrite: false,
        uniforms: {
          uColour: { value: new THREE.Color(colour) },
          uOpacity: { value: 1 },
        },
      }),
    [colour],
  );

  useFrame(() => {
    if (!mesh.current) return;
    const p = progress.current ?? 0;

    // Nothing until the lid has actually broken the seal. A splash that starts
    // while the cap is still on is the sort of detail that makes the whole
    // thing read as fake.
    const started = Math.max(0, (p - 0.18) / 0.82);

    for (let i = 0; i < COUNT; i++) {
      const d = droplets[i];
      // Each droplet runs its own clock, offset by its delay.
      const t = Math.max(0, (started - d.delay) / Math.max(0.01, 1 - d.delay));

      if (t <= 0) {
        // Parked inside the jar, where the body hides it.
        dummy.position.set(0, mouthHeight - 0.4, 0);
        dummy.scale.setScalar(0.0001);
      } else {
        // Ballistic: up fast, then gravity takes it. Straight-line motion looks
        // like sparks; an arc looks like something thrown.
        //
        // The timing is set so a fully-open jar sits at the *apex* of the
        // throw, not after it. This is scroll-scrubbed, so the end of the
        // section is the frame people stop on — and the frame worth stopping on
        // is the one from the reference shot, lid off and the paste still in
        // the air. Letting the arc complete left them looking at an empty jar.
        const flight = t * 0.55;
        dummy.position.set(
          d.origin.x + d.velocity.x * flight,
          d.origin.y + d.velocity.y * flight - GRAVITY * flight * flight,
          d.origin.z + d.velocity.z * flight,
        );

        // Grows into existence over the first instant, then holds.
        const pop = Math.min(1, t * 6);
        dummy.scale.set(
          d.scale * pop * d.squash.x,
          d.scale * pop * d.squash.y,
          d.scale * pop * d.squash.z,
        );

        dummy.rotation.set(d.tumble.x * flight * 3, d.tumble.y * flight * 3, d.tumble.z * flight * 3);
      }

      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    }

    mesh.current.instanceMatrix.needsUpdate = true;
    // Fades in only. There is no fade-out, because the end of the scroll is a
    // resting frame rather than a moment passed through.
    const opacity = Math.min(1, started * 5);
    material.uniforms.uOpacity.value = opacity;
    mesh.current.visible = started > 0 && opacity > 0.01;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, COUNT]} frustumCulled={false} />;
}
