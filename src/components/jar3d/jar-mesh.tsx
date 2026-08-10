"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { Crown } from "@/components/jar3d/crown";

import profiles from "@/../public/products/3d/profiles.json";
import parts from "@/../public/products/3d/parts.json";
import cap from "@/../public/products/3d/cap.json";

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
 * The photograph already has studio lighting baked into it — the glow through
 * the paste, the sheen down the glass. Lighting it again with scene lights would
 * double every shadow and turn the jar muddy. So the base colour is taken from
 * the texture exactly as photographed.
 *
 * What is added on top is **view-dependent**, not baked: the surface darkens
 * where it turns away from the camera, and a soft highlight sits where the
 * light would be. Both are computed against the view direction, so they stay
 * put while the jar turns underneath them. That is what sells it as a solid
 * object rather than a picture on a tube.
 *
 * The cap goes further. Its texture had the key light taken *out* of it, because
 * a lid that unscrews would otherwise carry the studio's highlight round with it,
 * and its shading is turned up to suit brass rather than glass: a steeper falloff
 * and a highlight tinted to the metal's own colour rather than white.
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
 * How quickly glass gives up its light as it turns away. Gentle: a jar stays
 * bright almost to its edge.
 */
const GLASS_FALLOFF = 0.65;
/** Metal does not. The cap's brass goes dark fast, and should. */
const METAL_FALLOFF = 1.7;

/** A dielectric reflects the light's own colour, so its highlight is white. */
const WHITE_SHEEN = new THREE.Color(1, 1, 1);
/**
 * Brass does not: a metal tints what it reflects, to roughly its own colour.
 *
 * These are **linear** values, which is the whole reason they look so much more
 * saturated than the gold does on screen. The cap's photographed colour is about
 * (0.60, 0.22, 0.03) in linear light — the blue channel is nearly nothing — so a
 * white highlight of even a tenth lands on that blue as a *tripling*, and the
 * brass comes out as pale salmon. It did, until this was measured rather than
 * eyeballed: this is that colour normalised, which is what its highlight is.
 */
const BRASS_SHEEN = new THREE.Color(1, 0.38, 0.1);

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
  /**
   * How fast the surface darkens as it turns away.
   *
   * Glass wants this low: it stays bright almost to the silhouette and then
   * goes. Turned metal wants it high — the brass falls off steeply and that
   * steepness is most of what makes it read as metal rather than as painted
   * card. One number, because it is the same falloff curve either way.
   */
  uniform float uFalloff;
  /**
   * What colour the highlight is.
   *
   * White for glass, and for the paste. Not for the cap: a metal tints its own
   * reflection, so a white highlight on brass reads as a pale plastic lid — which
   * is exactly what it looked like before this existed.
   */
  uniform vec3 uSheenColour;
  /**
   * How much to darken faces we are seeing from behind.
   *
   * Every part of the jar is a single-sided surface drawn from both sides, so
   * the back of the cap's top face is the *inside* of the cap and the back of
   * the body is the inside of the glass. Painting the photograph on both sides
   * puts a lit gold lid on the underside of the cap, which from below — where
   * the camera sits relative to the top of an upright jar — is the brightest
   * thing on screen and completely wrong.
   */
  uniform float uBackDark;

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
    float shade = mix(1.0 - uLimb, 1.0, pow(facing, uFalloff));

    // A soft band of light up the left of the jar, where the key light sits in
    // the original photograph. Computed in view space so it stays still.
    float sheen = pow(clamp(dot(normalize(vNormalView), normalize(vec3(-0.55, 0.35, 0.75))), 0.0, 1.0), 6.0);

    vec3 colour = texel.rgb * shade + sheen * uSheen * uSheenColour;

    // Interior surfaces keep the material's colour but lose the light.
    if (!gl_FrontFacing) colour *= (1.0 - uBackDark);

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

/**
 * Flips a lathe so it is a surface you look at from within.
 *
 * The inside of the cap is a real wall, not the back of the outside one, and it
 * has to be shaded as a wall: its normals must point at the camera when the
 * camera is inside it. Reversing the winding and negating the normals does both
 * — the triangles face inward, so front-face culling keeps them while the outer
 * shell is drawn over the top, and `facing` in the shader comes out positive
 * where the surface really is facing you.
 */
function turnInsideOut(geometry: THREE.BufferGeometry) {
  const index = geometry.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      index.setX(i, index.getX(i + 2));
      index.setX(i + 2, a);
    }
    index.needsUpdate = true;
  }
  const normal = geometry.getAttribute("normal");
  for (let i = 0; i < normal.count; i++) {
    normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
  }
  normal.needsUpdate = true;
  return geometry;
}

/** Rewrites a piece's UVs so a texture of its own runs top to bottom over it. */
function mapToOwnSpan(geometry: THREE.BufferGeometry, bottom: number, top: number) {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < position.count; i++) {
    uv.setY(i, (position.getY(i) - bottom) / Math.max(0.0001, top - bottom));
  }
  uv.needsUpdate = true;
  return geometry;
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
  const capSide = useLoader(THREE.TextureLoader, "/products/3d/cap-wrap.webp");
  const capLining = useLoader(THREE.TextureLoader, "/products/3d/cap-inner.webp");
  const jarBase = useLoader(THREE.TextureLoader, "/products/3d/jar-base.webp");
  const neckTexture = useLoader(THREE.TextureLoader, `/products/3d/${productId}-neck.webp`);
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

  /**
   * Where the cap actually starts, for exactly the same reason as the base.
   *
   * The first scanline catches the antialiased top edge and reports a radius of
   * 0.105 where the cap is really 0.805. Lathing from there gives the cap a
   * spike, and putting the top disc at the jar's full height — where the cap has
   * supposedly narrowed to a tenth of its width — left a wide gold plate
   * floating above a domed cap. Seen from slightly below, which is where the
   * camera sits relative to the top of an upright jar, that plate showed its
   * underside as a pale ellipse across the whole cap.
   */
  const capTopT = useMemo(() => {
    const solid = profile.points.filter((p) => p.r >= 0.5);
    return solid.length ? solid[0].t : 0.01;
  }, [profile]);

  /** Where the lid's own texture starts and stops, in world height. */
  /**
   * Where the lid's own texture starts and stops, in world height.
   *
   * Taken from the profile points the lid is *actually* lathed from, not from
   * `capSplit` itself. The silhouette was measured on a hundred-odd scanlines, so
   * the last point at or above the join sits up to one scanline short of it —
   * and anything positioned at `capSplit` therefore hangs below the lid's real
   * bottom edge. The rim ring did exactly that: a pale fringe all the way round,
   * a few pixels clear of the metal it was supposed to close, which is what made
   * a lifted lid look like a curl of torn paper.
   */
  const lidSpan = useMemo(() => {
    const yOf = (t: number) => (1 - t) * height - height / 2;
    const within = profile.points.filter((p) => p.t >= capTopT && p.t <= profile.capSplit);
    const last = within[within.length - 1] ?? { t: profile.capSplit, r: 0.93 };
    return { top: yOf(capTopT), bottom: yOf(last.t), bottomRadius: last.r };
  }, [profile, height, capTopT]);

  const geometry = useMemo(() => {
    const split = profile.capSplit;
    return {
      /**
       * The lid, wearing the cap's own photograph rather than a slice of the
       * jar's.
       *
       * It is open underneath: you are meant to see up into it once it lifts,
       * and what you see is the interior below rather than a false disc.
       */
      lid: mapToOwnSpan(
        latheFrom(
          profile.points.filter((p) => p.t >= capTopT && p.t <= split),
          height,
          false,
          false,
        ),
        lidSpan.bottom,
        lidSpan.top,
      ),
      body: latheFrom(profile.points.filter((p) => p.t >= split && p.t <= baseT), height, false, false),

      /**
       * The threaded neck, as its own mesh.
       *
       * It reaches *above* the cap join, because that is where it really is —
       * the cap screws down over it. That overlap is why it cannot share the
       * jar's texture: the lid and the neck occupy the same band of the jar's
       * height, so one image cannot hold both, and compositing the neck into
       * the shared wrap painted dark glass across the bottom half of the gold
       * cap. Its own mesh, its own strip.
       */
      neck: latheFrom(profile.neck, height, false, false),
    };
  }, [profile, height, baseT, capTopT, lidSpan]);

  /**
   * The inside of the cap.
   *
   * Every time the lid lifts and tilts you are looking up into it, and until the
   * bare cap was photographed there was nothing to show — so the underside was
   * simply darkened, which read as a hole rather than as a lid. It is in fact
   * gold, threaded, and lit right up to the top.
   *
   * Two pieces: a wall a hair inside the shell, and a disc closing it off at the
   * measured cavity depth. Both are turned inside out, because they are only ever
   * seen from within.
   */
  const interior = useMemo(() => {
    const split = profile.capSplit;
    // The cavity runs from the rim up to a ceiling short of the shell's top.
    const ceilingT = split - (split - capTopT) * cap.cavity;
    const yOf = (t: number) => (1 - t) * height - height / 2;

    const shell = profile.points.filter((p) => p.t >= ceilingT && p.t <= split);
    const lining = shell.map((p) => ({ t: p.t, r: p.r * cap.innerRadius }));
    const wall = turnInsideOut(
      mapToOwnSpan(latheFrom(lining, height, false, false), lidSpan.bottom, yOf(ceilingT)),
    );

    const top = lining[0] ?? { t: ceilingT, r: 0.8 };
    const disc = new THREE.CircleGeometry(Math.max(0.05, top.r), RADIAL_SEGMENTS);
    // Faces down, so it is the face you see looking up into a lifted lid.
    disc.rotateX(Math.PI / 2);
    // Pinned to the deepest row of the ramp: the wall colour right beside it.
    const uv = disc.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 1);
    uv.needsUpdate = true;

    /**
     * The metal edge at the mouth.
     *
     * Without it the lid is a knife: the shell stops at the rim in a line one
     * pixel wide and the lining starts immediately behind it, so a lifted lid
     * reads as a curl of paper rather than as a cap with a wall. It is not a
     * flourish — it is the ring of rolled lip you actually look at, and its
     * width is the gap between the two surfaces, which was measured off the
     * photograph rather than chosen.
     *
     * It wears the bottom row of the cap's wrap, which is that lip as
     * photographed.
     */
    const rim = new THREE.RingGeometry(
      Math.max(0.02, lidSpan.bottomRadius * cap.innerRadius),
      Math.max(0.03, lidSpan.bottomRadius),
      RADIAL_SEGMENTS,
    );
    rim.rotateX(Math.PI / 2);
    const rimPosition = rim.getAttribute("position");
    const rimUv = rim.getAttribute("uv");
    for (let i = 0; i < rimUv.count; i++) {
      // Round the ring for u, pinned to the rim for v.
      const angle = Math.atan2(rimPosition.getZ(i), rimPosition.getX(i));
      rimUv.setXY(i, angle / (Math.PI * 2), 0);
    }
    rimUv.needsUpdate = true;

    // The ceiling rides the wall's own top ring, for the same reason the rim
    // rides the shell's own bottom one: a scanline's worth of gap here is a
    // visible slot in a lid the size this one is drawn at.
    return { wall, ceiling: disc, rim, ceilingY: yOf(top.t), rimY: lidSpan.bottom };
  }, [profile, height, capTopT, lidSpan]);

  /** Where the lid's top sits, how wide it is there, and the mouth's radius. */
  const lidTop = useMemo(() => {
    const radiusAtSplit = profile.points.find((p) => p.t >= profile.capSplit)?.r ?? 0.9;
    const top = profile.points.find((p) => p.t >= capTopT) ?? { t: capTopT, r: 0.8 };
    return {
      // The cap's chamfered top edge, not the jar's outermost pixel.
      y: (1 - top.t) * height - height / 2,
      radius: top.r,
      neck: radiusAtSplit,
    };
  }, [profile, height, capTopT]);

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
        uFalloff: { value: GLASS_FALLOFF },
        uSheenColour: { value: WHITE_SHEEN },
        // The inside of the glass, seen through the open mouth.
        uBackDark: { value: 0.55 },
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
        uFalloff: { value: GLASS_FALLOFF },
        uSheenColour: { value: WHITE_SHEEN },
        // From above, the base disc is the floor of the jar under the paste.
        uBackDark: { value: 0.8 },
      },
    });
  }, [jarBase]);

  /**
   * The neck's strip runs top-to-bottom over its own small range of the jar,
   * so its UVs cannot use the shared full-height mapping.
   */
  const neckGeometry = useMemo(() => {
    const yOf = (t: number) => (1 - t) * height - height / 2;
    return mapToOwnSpan(geometry.neck, yOf(profile.capSplit), yOf(profile.rimT));
  }, [geometry.neck, profile, height]);

  const neckMaterial = useMemo(() => {
    neckTexture.colorSpace = THREE.SRGBColorSpace;
    neckTexture.wrapS = THREE.RepeatWrapping;
    neckTexture.anisotropy = 8;
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: neckTexture },
        uLimb: { value: 0.42 },
        uSheen: { value: 0.05 },
        uFalloff: { value: GLASS_FALLOFF },
        uSheenColour: { value: WHITE_SHEEN },
        uBackDark: { value: 0.55 },
      },
    });
  }, [neckTexture]);

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
        uSheen: { value: 0.18 },
        // Flat, so it barely turns away at all; the metal falloff would only
        // put a dark ring round a face that is square on to the camera.
        uFalloff: { value: GLASS_FALLOFF },
        uSheenColour: { value: BRASS_SHEEN },
        // Its back is the unlit inside of the cap.
        uBackDark: { value: 0.88 },
      },
    });
  }, [capTop]);

  /**
   * The side of the cap, from the cap's own photograph.
   *
   * More limb darkening and more sheen than the glass, because it is turned
   * metal and behaves like it: it falls off fast at the silhouette and carries a
   * bright, narrow highlight. Both are computed against the view, so the
   * highlight stays where the studio light is while the lid unscrews underneath
   * it — which is the whole reason the texture had the baked one taken out.
   */
  const capSideMaterial = useMemo(() => {
    capSide.colorSpace = THREE.SRGBColorSpace;
    capSide.wrapS = THREE.RepeatWrapping;
    capSide.anisotropy = 8;
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: capSide },
        uLimb: { value: 0.52 },
        uSheen: { value: 0.26 },
        uFalloff: { value: METAL_FALLOFF },
        uSheenColour: { value: BRASS_SHEEN },
        // Its back is the inside of the shell, which the lining is drawn over.
        uBackDark: { value: 0.9 },
      },
    });
  }, [capSide]);

  /**
   * The threaded lining and the disc that closes it.
   *
   * Front faces only. The pieces have been turned inside out, so the faces that
   * survive are the ones pointing back at a camera that is inside the cap, and
   * the ones that would otherwise be drawn across the mouth from outside are
   * gone. Nothing needs darkening for being seen from behind, because nothing
   * here ever is.
   */
  const liningMaterial = useMemo(() => {
    capLining.colorSpace = THREE.SRGBColorSpace;
    capLining.wrapS = THREE.RepeatWrapping;
    capLining.anisotropy = 4;
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: false,
      side: THREE.FrontSide,
      uniforms: {
        map: { value: capLining },
        // Strong, and deliberately so. A cavity reads as a cavity because its
        // walls fall away into shadow as they turn; this is that falling away,
        // and it is also what takes the ceiling down from the wall colour it
        // borrows.
        uLimb: { value: 0.55 },
        // Almost none. A cavity has no key light in it — and a highlight added
        // in linear light lands on this ramp's blue channel, which is about
        // 0.003, as a quadrupling. At 0.08 it turned the inside of the lid pale
        // and left it reading *brighter* than the lit brass outside it, which is
        // exactly backwards and is what made a lifted lid look like curled paper.
        uSheen: { value: 0.015 },
        uFalloff: { value: 1.4 },
        uSheenColour: { value: BRASS_SHEEN },
        uBackDark: { value: 0 },
      },
    });
  }, [capLining]);

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
  }, [texture, capTop, capSide, capLining, jarBase, neckTexture, material, geometry, invalidate]);

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
      /**
       * Tips as it clears the thread, so it reads as a lid coming free rather
       * than a disc on a rail — and, more importantly, so you can see into it.
       *
       * The camera sits level with the middle of the jar, which puts it barely
       * five degrees above a lid held up at the top of it. At five degrees a cap
       * is almost edge-on: the mouth is a dark slit and the whole thing reads as
       * a bent strip of card, which is exactly what it looked like. The
       * photograph of the bare cap was taken from thirteen, and that is the
       * difference between a ring and a cap you can see the inside of.
       *
       * The camera cannot be raised without re-framing every jar on the site, so
       * the lid leans instead: eight degrees of `x` turns its mouth toward the
       * viewer and lands the total on thirteen, which is the photograph's own
       * angle. Leaning it the other way was tried first and made things worse —
       * it cancels the five and puts the lid dead edge-on, a strip of foil.
       *
       * `z` is the slight sideways roll that keeps it from looking mechanical.
       */
      lid.current.rotation.x = amount * 0.14;
      lid.current.rotation.z = amount * 0.09;
    }
  });

  return (
    // Sat low enough in the frame that the headroom reserved above it is where
    // the lid and the splash actually go. Fixed rather than animated, so the
    // composition never jumps while somebody is scrolling through it.
    <group ref={group} position={[0, -lift / 2, 0]}>
      <mesh geometry={geometry.body} material={material} />
      <mesh geometry={neckGeometry} material={neckMaterial} />
      <mesh geometry={base.geometry} material={baseMaterial} position={[0, base.y, 0]} />
      {progress && (
        <Crown
          progress={openness}
          mouthRadius={lidTop.neck}
          mouthHeight={height / 2 - height * profile.rimT}
        />
      )}
      <group ref={lid}>
        <mesh geometry={geometry.lid} material={capSideMaterial} />
        <mesh geometry={capTopGeometry} material={capMaterial} position={[0, lidTop.y, 0]} />
        <mesh geometry={interior.wall} material={liningMaterial} />
        <mesh geometry={interior.ceiling} material={liningMaterial} position={[0, interior.ceilingY, 0]} />
        <mesh geometry={interior.rim} material={capSideMaterial} position={[0, interior.rimY, 0]} />
      </group>
    </group>
  );
}
