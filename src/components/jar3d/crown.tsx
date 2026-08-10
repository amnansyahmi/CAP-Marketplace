"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";

import splash from "@/../public/products/3d/splash.json";

/**
 * The paste coming out of the jar, as a crown rather than a cloud.
 *
 * ## What was wrong before
 *
 * The first version was a few dozen shaded lumps thrown into the air. It read
 * as beads, because that is what it was. A splash of thick paste is a
 * *connected sheet*: it climbs out of the neck, flares, thins, and only breaks
 * into separate droplets at the very tips.
 *
 * ## Where the shape comes from
 *
 * Not from a noise function. The splash was photographed, and that photograph
 * was unwrapped cylindrically exactly like the label — so this is a lathe of
 * the splash's own measured silhouette, wearing the splash's own pixels. The
 * ragged, broken top edge is the photograph's alpha channel cutting through the
 * geometry; nothing here invents a single spike.
 *
 * The honest limit is the same one the label has: a photograph shows one side
 * of a round thing, so the back half is the front stretched round. On a crown
 * of paste, which is close to rotationally symmetric anyway, that reads as more
 * splash rather than as a repeat.
 */

const SPLASH = splash as {
  /** How far the crown reaches out, in jar radii. */
  spread: number;
  /** How far it rises above the mouth, in jar radii. */
  rise: number;
  profile: { v: number; r: number }[];
};

/** Segments around. The silhouette is cut by alpha, so this only needs to be smooth. */
const RADIAL_SEGMENTS = 96;

/** Samples up the profile. More than the eye can resolve at this size. */
const RINGS = 56;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float uOpacity;
  uniform vec3 uTint;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    vec4 texel = texture2D(map, vUv);

    // The paste was photographed under the same studio light as the jar, so the
    // colour is used as shot. What is added is view-dependent only: a little
    // extra darkening where the sheet turns away, which keeps the far side of
    // the crown from reading as flat card.
    float facing = clamp(dot(normalize(vNormalView), normalize(vViewDir)), 0.0, 1.0);
    float shade = mix(0.74, 1.06, pow(facing, 0.6));

    gl_FragColor = vec4(texel.rgb * uTint * shade, texel.a * uOpacity);
    #include <colorspace_fragment>
  }
`;

export function Crown({
  /** How far the lid is off, 0 to 1. The crown rises with it. */
  progress,
  /** Radius of the jar's mouth, in world units. */
  mouthRadius,
  /** Height of the mouth above the jar's centre. */
  mouthHeight,
}: {
  progress: React.RefObject<number>;
  mouthRadius: number;
  mouthHeight: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const texture = useLoader(THREE.TextureLoader, "/products/3d/splash-wrap.webp");

  /**
   * The photographed splash's waist against this jar's mouth.
   *
   * Both are measured in jar radii so they already agree to within a percent,
   * but tying them together means a re-shot splash or a re-measured neck stays
   * seated instead of drifting.
   */
  const fit = mouthRadius / (SPLASH.profile[0]?.r || 0.83);
  const invalidate = useThree((state) => state.invalidate);

  const geometry = useMemo(() => {
    // Thin the measured profile down to something worth lathing.
    const step = Math.max(1, Math.floor(SPLASH.profile.length / RINGS));
    const sampled = SPLASH.profile.filter((_, i) => i % step === 0);

    const points = sampled.map(
      (p) =>
        // Radii are in jar radii and the jar's radius is 1, so they carry over
        // unchanged. Height climbs from the mouth.
        new THREE.Vector2(Math.max(0.01, p.r), p.v * SPLASH.rise),
    );

    const lathe = new THREE.LatheGeometry(points, RADIAL_SEGMENTS);

    // The texture was written with its first row at the mouth, so v has to run
    // the same way up the geometry rather than along the lathe's own arc.
    const position = lathe.getAttribute("position");
    const uv = lathe.getAttribute("uv");
    for (let i = 0; i < position.count; i++) {
      uv.setY(i, 1 - position.getY(i) / SPLASH.rise);
    }
    uv.needsUpdate = true;

    return lathe;
  }, []);

  const material = useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = 8;

    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      // The paste is opaque where it exists; the alpha is a cut-out, not a
      // fade. Testing rather than blending keeps the sheet sorting correctly
      // against itself as it turns.
      alphaTest: 0.25,
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: texture },
        uOpacity: { value: 1 },
        uTint: { value: new THREE.Color(1, 1, 1) },
      },
    });
  }, [texture]);

  useEffect(() => {
    invalidate();
  }, [texture, invalidate]);

  useFrame(() => {
    if (!mesh.current) return;
    const p = progress.current ?? 0;

    // Nothing until the seal is actually broken. Paste leaving a closed jar is
    // the detail that makes the whole thing read as fake.
    const t = Math.max(0, (p - 0.15) / 0.85);

    if (t <= 0.001) {
      mesh.current.visible = false;
      return;
    }
    mesh.current.visible = true;

    // It erupts before it spreads: the column climbs out of the neck first and
    // the crown opens after, which is the order a real splash does it in.
    const climb = Math.min(1, t * 1.45);
    const flare = t * t * (3 - 2 * t);

    // `fit` corrects the photographed jar's mouth to this model's, so the
    // crown always sits exactly on the rim rather than floating inside it or
    // hanging off the edge. It is normally within a percent of 1.
    const wide = fit * (0.72 + 0.28 * flare);
    mesh.current.scale.set(wide, fit * climb, wide);

    // Fades in over the first instant only. The end of the scroll is a resting
    // frame, so there is no fade-out to leave the visitor on an empty jar.
    material.uniforms.uOpacity.value = Math.min(1, t * 6);
  });

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      position={[0, mouthHeight, 0]}
      frustumCulled={false}
    />
  );
}
