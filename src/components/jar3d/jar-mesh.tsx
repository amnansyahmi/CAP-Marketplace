"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { Crown } from "@/components/jar3d/crown";

import profiles from "@/../public/products/3d/profiles.json";
import parts from "@/../public/products/3d/parts.json";

/**
 * The jar as real geometry, in two pieces that come apart.
 *
 * ## Why a lathe rather than a cylinder
 *
 * The silhouette was measured off the photograph's alpha channel row by row, so
 * the cap flare, the shoulder and the slight taper at the base are the real
 * ones. A plain cylinder would read as a tin can, and the shoulder is most of
 * what makes a jar look like a jar.
 *
 * ## Why two pieces
 *
 * The lid has to lift off. The seam is not a guess: the glass steps sharply
 * inward where the metal cap ends, and `capSplit` in profiles.json is the
 * measured position of that step. Cutting there means the lid separates along
 * the join a person would unscrew, and the threads underneath are revealed
 * because they are genuinely part of the body's silhouette.
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
 */

type Point = { t: number; r: number };

type Profile = {
  points: Point[];
  aspect: number;
  capSplit: number;
  /** Sampled from the band of jar between the cap and the label. */
  paste: string;
  /** Where the rim of the open jar sits, above the cap join. */
  rimT: number;
  /** The threaded neck, measured from the lid-off photograph. */
  neck: Point[];
};

const PROFILES = profiles as Record<string, Profile>;
const { capTopFill } = parts;

/** Segments round the jar. Enough that the silhouette has no visible facets. */
const RADIAL_SEGMENTS = 96;

/**
 * What the jar is doing at each point through the scroll section.
 *
 * The reference this is modelled on plays a pre-rendered image sequence, which
 * is why every one of its jars tumbles along an identical path. This is real
 * geometry, so the same idea costs a list of keyframes and works from any
 * angle — and, because the cap and the base are photographs rather than
 * guesses, it can be turned right over without anything to hide.
 *
 * `x` tips the jar toward or away from the camera, `y` turns it on its own
 * axis, `z` rolls it sideways. `open` lifts the lid.
 */
type Beat = { at: number; x: number; y: number; z: number; open: number };

const CHOREOGRAPHY: Beat[] = [
  // Upright and square on: the label is the first thing anybody should read.
  { at: 0, x: 0, y: 0, z: 0, open: 0 },
  // Tipping back, bringing the top of the cap into view.
  { at: 0.28, x: -1, y: 0.9, z: 0.18, open: 0 },
  // Right over. The base is toward the camera here, which is the whole reason
  // the underside had to become a real photograph.
  { at: 0.52, x: -Math.PI, y: Math.PI, z: -0.2, open: 0 },
  // Still rolling, coming back up the other side.
  { at: 0.76, x: -5.4, y: 5, z: 0.15, open: 0 },
  // A full roll and a full turn: exactly where it started, so the sequence ends
  // on the label rather than on the plain back of the jar. Landing on an odd
  // half-turn was the first attempt and it finished facing backwards.
  { at: 0.88, x: -Math.PI * 2, y: Math.PI * 2, z: 0, open: 0 },
  // Settled and facing front before anything opens.
  { at: 1, x: -Math.PI * 2, y: Math.PI * 2, z: 0, open: 1 },
];

/** Smoothstep, so the jar eases between poses instead of hinging between them. */
const ease = (t: number) => t * t * (3 - 2 * t);

/** Where the jar should be at a given point through the section. */
function poseAt(progress: number): Omit<Beat, "at"> {
  const p = Math.min(1, Math.max(0, progress));
  let i = 0;
  while (i < CHOREOGRAPHY.length - 2 && p > CHOREOGRAPHY[i + 1].at) i += 1;

  const a = CHOREOGRAPHY[i];
  const b = CHOREOGRAPHY[i + 1];
  const span = Math.max(0.0001, b.at - a.at);
  const k = ease(Math.min(1, Math.max(0, (p - a.at) / span)));

  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
    open: a.open + (b.open - a.open) * k,
  };
}

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

/**
 * Lathes one slice of the profile.
 *
 * `t` runs 0 at the top of the jar to 1 at the bottom, matching how the
 * silhouette was measured in image space.
 *
 * The UVs are rewritten from each vertex's height rather than left as the
 * lathe's own 0-to-1. Both pieces share one wrapped texture, so a slice has to
 * sample the part of it that belongs to that height — otherwise the lid would
 * stretch the whole label across the cap.
 */
function latheFrom(source: Point[], height: number, closeTop: boolean, closeBottom: boolean) {
  const points: THREE.Vector2[] = [];
  const yOf = (t: number) => (1 - t) * height;

  const within = [...source].sort((a, b) => a.t - b.t);
  const ordered = [...within].reverse(); // lathe runs bottom to top

  if (closeBottom) points.push(new THREE.Vector2(0.0001, yOf(within[within.length - 1].t)));
  for (const point of ordered) points.push(new THREE.Vector2(Math.max(0.0001, point.r), yOf(point.t)));
  if (closeTop) points.push(new THREE.Vector2(0.0001, yOf(within[0].t)));

  const lathe = new THREE.LatheGeometry(points, RADIAL_SEGMENTS);

  const position = lathe.getAttribute("position");
  const uv = lathe.getAttribute("uv");
  for (let i = 0; i < position.count; i++) {
    // v = 0 at the bottom of the whole jar, 1 at the top, so every slice lines
    // up with the same texture.
    uv.setY(i, position.getY(i) / height);
  }
  uv.needsUpdate = true;

  // Centred on the jar's middle, so the assembled jar turns about its own axis.
  lathe.translate(0, -height / 2, 0);
  return lathe;
}

export function JarMesh({
  productId,
  image,
  spin,
  autoSpin,
  sway,
  progress,
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
  /**
   * How far through the scroll sequence we are, 0 to 1.
   *
   * Read every frame from a ref rather than taken as a prop value, because it is
   * driven by scrolling and React must not re-render for it. What the jar does
   * at each point is `CHOREOGRAPHY`.
   */
  progress?: React.RefObject<number>;
}) {
  const group = useRef<THREE.Group>(null);
  const lid = useRef<THREE.Group>(null);
  const texture = useLoader(THREE.TextureLoader, image);
  const capTop = useLoader(THREE.TextureLoader, "/products/3d/cap-top.webp");
  const jarBase = useLoader(THREE.TextureLoader, "/products/3d/jar-base.webp");
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  // On a still jar the frame loop is on demand, so anything that changes what
  // the picture should look like has to ask for a new one.
  const invalidate = useThree((state) => state.invalidate);

  const profile = PROFILES[productId] ?? Object.values(PROFILES)[0];

  // `aspect` is height ÷ *diameter*, but radii here are normalised so the
  // widest point is 1 — a diameter of 2. Multiplying by 2 keeps the jar's real
  // proportions; without it the jar comes out half as tall as it should be and
  // reads as a squat pot.
  const height = profile.aspect * 2;

  /**
   * Where the jar actually stops.
   *
   * Not `t = 1`. The silhouette was measured off scanlines and the last couple
   * catch the antialiased edge and the contact shadow, so the profile collapses
   * from a radius of 0.70 to 0.09 in one step. Lathing that far turns the base
   * into a spike; capping it at the last honest measurement gives the flat
   * bottom the jar really has.
   */
  const baseT = useMemo(() => {
    const solid = profile.points.filter((p) => p.r >= 0.5);
    return solid.length ? solid[solid.length - 1].t : 0.98;
  }, [profile]);

  const geometry = useMemo(() => {
    const split = profile.capSplit;
    return {
      // The lid is open underneath: you are meant to see up into it once it
      // lifts, and closing it would put a false disc where the liner sits.
      lid: latheFrom(profile.points.filter((p) => p.t <= split), height, false, false),
      /**
       * The body, now including the threaded neck.
       *
       * The neck comes from the lid-off photograph and reaches *above* the cap
       * join, because that is where it really is — the cap screws down over it.
       * Every earlier version stopped at the shoulder, so lifting the lid
       * revealed a jar with no neck and no rim to have been sealed.
       */
      body: latheFrom(
        [...profile.neck, ...profile.points.filter((p) => p.t > split && p.t <= baseT)],
        height,
        false,
        false,
      ),
    };
  }, [profile, height, baseT]);

  /** Where the lid sits when closed, and how wide its top is. */
  const lidTop = useMemo(() => {
    const radiusAtSplit = profile.points.find((p) => p.t >= profile.capSplit)?.r ?? 0.9;
    const capRadius = Math.max(...profile.points.filter((p) => p.t <= profile.capSplit).map((p) => p.r));
    return { y: height / 2, radius: capRadius, neck: radiusAtSplit };
  }, [profile, height]);

  const capTopGeometry = useMemo(() => {
    const disc = new THREE.CircleGeometry(lidTop.radius, RADIAL_SEGMENTS);
    // The photograph shows the whole jar from above, so the gold only fills the
    // middle `capTopFill` of it. Squeeze the UVs outward by that factor and the
    // disc is all cap, with none of the glass ring around it.
    const uv = disc.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, 0.5 + (uv.getX(i) - 0.5) * capTopFill, 0.5 + (uv.getY(i) - 0.5) * capTopFill);
    }
    uv.needsUpdate = true;
    disc.rotateX(-Math.PI / 2);
    return disc;
  }, [lidTop.radius]);

  /**
   * The underside of the jar.
   *
   * Never seen while the jar stands upright, which is why it did not exist
   * before. Once the jar starts tumbling it is in shot for several seconds, and
   * a flat disc of nothing there would be the one part of the model obviously
   * faked — so it is the real base photograph, shot through the glass.
   */
  /** The disc that caps the body, and where it sits. */
  const base = useMemo(() => {
    const point = profile.points.find((p) => p.t === baseT) ?? { t: baseT, r: 0.7 };
    const disc = new THREE.CircleGeometry(Math.max(0.05, point.r), RADIAL_SEGMENTS);
    // Faces down, so its front side is the one you see from underneath.
    disc.rotateX(Math.PI / 2);
    return { geometry: disc, y: (1 - point.t) * height - height / 2 };
  }, [profile, baseT, height]);

  /**
   * How far the lid travels when fully open.
   *
   * Enough to clear the thread and read as "off", not so far that the jar has
   * to be drawn small to keep it in shot. Zero when nothing is driving it, so a
   * jar that never opens is framed as tightly as it always was.
   */
  const lift = progress ? height * 0.32 : 0;

  /**
   * How much space the whole assembly needs, in world units.
   *
   * The lid leaves the jar's own bounding box on the way up, so the frame has
   * to allow for its travel or it simply flies out of shot — which is exactly
   * what the first version did.
   */
  const extent = useMemo(() => {
    // Standing still, the jar only ever needs its own footprint.
    if (!progress) return { width: 2, height, depth: 2 };

    // Tumbling, it passes through every orientation, so the frame has to hold
    // the sphere it sweeps out — otherwise it clips through the sides of the
    // canvas exactly as it turns onto its side. The extra height is the lid's
    // travel, which happens at the end with the jar upright again.
    const sweep = 2 * Math.hypot(height / 2, 1);
    return { width: sweep, height: Math.max(sweep, height + lift), depth: sweep };
  }, [height, lift, progress]);

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
      // Both faces, because a slice is an open tube — without this you can see
      // straight through the jar from the side where it closes.
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: texture },
        uLimb: { value: 0.42 },
        uSheen: { value: 0.06 },
      },
    });
  }, [texture]);

  const baseMaterial = useMemo(() => {
    jarBase.colorSpace = THREE.SRGBColorSpace;
    jarBase.anisotropy = 8;
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: jarBase },
        // Darker than the cap: this is the bottom of the jar and it sits in its
        // own shadow even on a lit table.
        uLimb: { value: 0.3 },
        uSheen: { value: 0.02 },
      },
    });
  }, [jarBase]);

  const capMaterial = useMemo(() => {
    capTop.colorSpace = THREE.SRGBColorSpace;
    capTop.anisotropy = 8;
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: capTop },
        // Flatter than the body: this face is a disc, not a curve, so limb
        // darkening across it would just look like dirt.
        uLimb: { value: 0.12 },
        uSheen: { value: 0.04 },
      },
    });
  }, [capTop]);

  /**
   * Pull the camera back far enough that the whole jar fits.
   *
   * A canvas does not have `object-fit`. With a fixed camera distance, a tall
   * narrow box — three jars side by side on a phone, say — sees a viewport
   * narrower than the jar is wide, and the sides are simply cut off. Fitting to
   * whichever dimension is tighter is the 3D equivalent of `object-contain`.
   *
   * The margin is generous at the top because the lid travels upward out of the
   * jar's own bounding box when it opens.
   */
  useEffect(() => {
    if (!camera.isPerspectiveCamera) return;
    const aspect = Math.max(0.0001, size.width / size.height);
    const halfFov = (camera.fov * Math.PI) / 360;

    const margin = 1.12;

    /**
     * Half the jar's depth.
     *
     * This is the part the first version left out, and it is why the cap ended
     * up clipped. A jar is not a picture: it is two units deep, so its front
     * surface sits a whole unit nearer the camera than its centre and is
     * magnified accordingly — about 17% at this field of view. Fitting the
     * *centre* plane therefore pushes the nearest edges outside the frame.
     *
     * It only started showing when the cap gained a real top face. Before that
     * the highest geometry was the lathe closing on the axis, where there is no
     * depth to magnify; the disc's rim is 0.93 out, so it magnified and spilled.
     *
     * Fitting `halfDepth + …` is fitting the closest plane instead.
     */
    const halfDepth = extent.depth / 2;
    const forHeight = halfDepth + (extent.height * margin) / (2 * Math.tan(halfFov));
    const forWidth = halfDepth + (extent.width * margin) / (2 * Math.tan(halfFov) * aspect);

    camera.position.z = Math.max(forHeight, forWidth);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, extent, invalidate]);

  // The first paint. `useLoader` suspends until the texture is decoded, so this
  // runs once it is genuinely ready to be drawn.
  useEffect(() => {
    invalidate();
  }, [texture, capTop, jarBase, material, geometry, invalidate]);

  const elapsed = useRef(0);
  /** The lid's own 0-to-1, derived from the pose and handed to the splash. */
  const openness = useRef(0);

  useFrame((_, delta) => {
    if (!group.current) return;
    elapsed.current += delta;
    spin.current += autoSpin * delta;

    // A slow rock either side of whatever the jar is currently turned to, so a
    // dragged jar keeps the angle the visitor chose.
    const rock = sway ? Math.sin(elapsed.current * 0.55) * sway : 0;

    const pose = progress ? poseAt(progress.current ?? 0) : null;
    openness.current = pose ? pose.open : 0;

    // Tipping and rolling are the sequence's to command; turning is shared with
    // whatever the visitor has dragged.
    group.current.rotation.x = pose ? pose.x : 0;
    group.current.rotation.z = pose ? pose.z : 0;

    // π offset because the texture puts the front of the label at u = 0.5,
    // while the lathe starts its sweep at u = 0.
    group.current.rotation.y = spin.current + rock + Math.PI + (pose ? pose.y : 0);

    if (lid.current) {
      const amount = openness.current;
      // Rises, and unscrews as it goes. Two and a bit turns is what this cap
      // actually takes, and turning it the other way looks like tightening.
      lid.current.position.y = amount * lift;
      lid.current.rotation.y = -amount * Math.PI * 2.2;
      // Tips very slightly as it clears the thread, so it reads as a lid coming
      // free rather than a disc on a rail.
      lid.current.rotation.z = amount * 0.09;
    }
  });

  return (
    // Sat low enough in the frame that the headroom reserved above it is where
    // the lid and the splash actually go. Fixed rather than animated, so the
    // composition never jumps while somebody is scrolling through it.
    <group ref={group} position={[0, -lift / 2, 0]}>
      <mesh geometry={geometry.body} material={material} />
      <mesh geometry={base.geometry} material={baseMaterial} position={[0, base.y, 0]} />
      {progress && (
        <Crown
          progress={openness}
          mouthRadius={lidTop.neck}
          mouthHeight={height / 2 - height * profile.rimT}
        />
      )}
      <group ref={lid}>
        <mesh geometry={geometry.lid} material={material} />
        <mesh geometry={capTopGeometry} material={capMaterial} position={[0, lidTop.y, 0]} />
      </group>
    </group>
  );
}
