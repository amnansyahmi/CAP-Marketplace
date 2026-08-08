"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";

import profiles from "@/../public/products/3d/profiles.json";

/**
 * The jar as real geometry.
 *
 * ## Why a lathe rather than a cylinder
 *
 * The silhouette was measured off the photograph's alpha channel row by row, so
 * the cap flare, the shoulder and the slight taper at the base are the real
 * ones. A plain cylinder would read as a tin can, and the shoulder is most of
 * what makes a jar look like a jar.
 *
 * ## Why the material is unlit
 *
 * The photograph already has studio lighting baked into it — the highlight down
 * the gold cap, the glow through the paste. Lighting it again with scene lights
 * would double every shadow and turn the cap muddy. So the base colour is taken
 * from the texture exactly as photographed.
 *
 * What is added on top is **view-dependent**, not baked: the surface darkens
 * where it turns away from the camera, and a soft highlight sits where the
 * light would be. Both are computed against the view direction, so they stay
 * put while the jar turns underneath them. That is what sells it as a solid
 * object rather than a picture on a tube.
 *
 * The honest limitation: the highlight *photographed into* the texture does
 * rotate with the jar. Nothing can be done about that without relighting the
 * shot, and at any reasonable turn speed it reads as reflection rather than
 * error.
 */

type Profile = { points: { t: number; r: number }[]; aspect: number };

const PROFILES = profiles as Record<string, Profile>;

/** Segments round the jar. Enough that the silhouette has no visible facets. */
const RADIAL_SEGMENTS = 96;

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
  uniform float uLimb;
  uniform float uSheen;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    vec4 texel = texture2D(map, vUv);

    // How square-on this bit of surface is to the camera. Falls to zero at the
    // silhouette, which is exactly where a round object goes dark.
    float facing = clamp(dot(normalize(vNormalView), normalize(vViewDir)), 0.0, 1.0);

    // Limb darkening. Deliberately gentle: the photograph already contains some
    // of this, and doubling it makes the jar look like a black-edged sticker.
    float shade = mix(1.0 - uLimb, 1.0, pow(facing, 0.65));

    // A soft band of light up the left of the jar, where the key light sits in
    // the original photograph. Computed in view space so it stays still.
    float sheen = pow(clamp(dot(normalize(vNormalView), normalize(vec3(-0.55, 0.35, 0.75))), 0.0, 1.0), 6.0);

    vec3 colour = texel.rgb * shade + sheen * uSheen;

    gl_FragColor = vec4(colour, texel.a);
    #include <colorspace_fragment>
  }
`;

export function JarMesh({
  productId,
  image,
  spin,
  autoSpin,
  sway,
}: {
  productId: string;
  /** The unwrapped 360° texture. */
  image: string;
  /** Radians. Driven by the parent so drag and scroll can both feed it. */
  spin: React.RefObject<number>;
  /**
   * Idle movement.
   *
   * `sway` rocks gently either side of the label instead of turning all the way
   * round. A hero jar that drifts continuously spends most of its time showing
   * the plain back of the label, which is the least interesting view of the
   * product and the one with no branding on it.
   */
  autoSpin: number;
  sway?: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const texture = useLoader(THREE.TextureLoader, image);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  // On a still jar the frame loop is on demand, so anything that changes what
  // the picture should look like has to ask for a new one.
  const invalidate = useThree((state) => state.invalidate);

  const geometry = useMemo(() => {
    const profile = PROFILES[productId] ?? Object.values(PROFILES)[0];

    // Lathe points run bottom to top in the geometry, but the profile was
    // measured top to bottom in image space, so it is reversed here.
    const points: THREE.Vector2[] = [];
    const ordered = [...profile.points].reverse();

    // Close the base, so the jar is a solid rather than an open tube.
    points.push(new THREE.Vector2(0.0001, 0));

    // `aspect` is height ÷ *diameter*, but radii here are normalised so the
    // widest point is 1 — a diameter of 2. Multiplying by 2 keeps the jar's
    // real proportions; without it the jar comes out half as tall as it should
    // be and reads as a squat pot.
    const height = profile.aspect * 2;

    for (const point of ordered) {
      points.push(new THREE.Vector2(Math.max(0.0001, point.r), (1 - point.t) * height));
    }

    // And close the lid.
    points.push(new THREE.Vector2(0.0001, height));

    const lathe = new THREE.LatheGeometry(points, RADIAL_SEGMENTS);
    // Centre it so it turns about its own middle rather than its base.
    lathe.translate(0, -height / 2, 0);
    return lathe;
  }, [productId]);

  /** How much space the jar needs, in world units. */
  const extent = useMemo(() => {
    const profile = PROFILES[productId] ?? Object.values(PROFILES)[0];
    // Diameter is 2 because radii are normalised to a maximum of 1.
    return { width: 2, height: profile.aspect * 2 };
  }, [productId]);

  const material = useMemo(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    // The texture wraps the whole way round, so the seam at the back needs the
    // two ends to meet rather than clamp.
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = 8;

    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      // Both faces, because the closing points at r≈0 leave a pinhole at each
      // end that would otherwise show the inside of the jar.
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: texture },
        uLimb: { value: 0.42 },
        uSheen: { value: 0.06 },
      },
    });
  }, [texture]);

  /**
   * Pull the camera back far enough that the whole jar fits.
   *
   * A canvas does not have `object-fit`. With a fixed camera distance, a tall
   * narrow box — three jars side by side on a phone, say — sees a viewport
   * narrower than the jar is wide, and the sides are simply cut off. Fitting to
   * whichever dimension is tighter is the 3D equivalent of `object-contain`.
   */
  useEffect(() => {
    if (!camera.isPerspectiveCamera) return;
    const aspect = Math.max(0.0001, size.width / size.height);
    const halfFov = (camera.fov * Math.PI) / 360;

    // A little air, so the jar never touches the edge of its box.
    const margin = 1.12;
    const forHeight = (extent.height * margin) / (2 * Math.tan(halfFov));
    const forWidth = (extent.width * margin) / (2 * Math.tan(halfFov) * aspect);

    camera.position.z = Math.max(forHeight, forWidth);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, extent, invalidate]);

  // The first paint. `useLoader` suspends until the texture is decoded, so this
  // runs once it is genuinely ready to be drawn.
  useEffect(() => {
    invalidate();
  }, [texture, material, geometry, invalidate]);

  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!mesh.current) return;
    elapsed.current += delta;
    spin.current += autoSpin * delta;

    // A slow rock either side of whatever the jar is currently turned to, so a
    // dragged jar keeps the angle the visitor chose.
    const rock = sway ? Math.sin(elapsed.current * 0.55) * sway : 0;

    // π offset because the texture puts the front of the label at u = 0.5,
    // while the lathe starts its sweep at u = 0.
    mesh.current.rotation.y = spin.current + rock + Math.PI;
  });

  return <mesh ref={mesh} geometry={geometry} material={material} />;
}
