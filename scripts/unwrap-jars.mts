/**
 * Turns each jar photograph into a texture that can be wrapped round a cylinder.
 *
 * ## The problem
 *
 * The product shots are straight-on views of a cylinder. A point on the jar's
 * surface at angle θ from the front does not appear at a position proportional
 * to θ — it appears at `x = r·sin(θ)`. So the label is progressively squashed
 * toward the left and right edges of the photo. Wrapping that image round a
 * cylinder unchanged would squash it *again*, and the label would read as if
 * painted on rather than printed round.
 *
 * ## The fix
 *
 * Invert the projection. For each column of the output, which represents a
 * constant slice of angle, sample the input at `sin(θ)`. That un-squashes the
 * edges and produces a flat label.
 *
 * The radius is measured **per row**, not once for the whole jar, because the
 * cap is narrower than the body and the base tapers. Using a single radius
 * would leave the cap's ribbing stretched.
 *
 * ## What cannot be recovered
 *
 * A photograph of a cylinder shows half of it. Worse, near θ = ±90° the surface
 * is edge-on: `dx/dθ → 0`, so an entire band of the label is compressed into a
 * couple of pixels. There is no information there to recover, and sharpening it
 * would be inventing detail.
 *
 * So only the middle ±72° is taken from the photograph, where the sampling is
 * still honest. The remaining 216° is built by continuing each row's colour
 * from the edge of the recovered arc — the label's horizontal bands carry on
 * round the jar, which is what the real packaging does. No text, no nutrition
 * panel and no barcode are invented, because inventing product information on
 * packaging is not a rendering decision.
 *
 * Run with: npm run jars
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = resolve(ROOT, "public/products");
const OUT = resolve(ROOT, "public/products/3d");

/** Beyond this the photograph has no usable detail left. */
const USABLE_ARC_DEG = 72;

/** Texture covers the full turn; the front is real, the rest is continued. */
const OUT_WIDTH = 1600;
const OUT_HEIGHT = 1200;

/** Alpha above this counts as jar rather than background. */
const OPAQUE = 24;

/** Rows either side to average when reading an edge colour. */
const EDGE_BLUR = 6;
/** Columns inward from the edge to average, for the same reason. */
const EDGE_SAMPLES = 5;

type Row = { centre: number; radius: number };

async function readImage(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** The jar's silhouette: where it starts and how wide it is on every row. */
function measureRows(img: Awaited<ReturnType<typeof readImage>>): (Row | null)[] {
  const rows: (Row | null)[] = [];
  for (let y = 0; y < img.height; y++) {
    let min = img.width;
    let max = -1;
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * img.channels + 3] > OPAQUE) {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
    rows.push(max >= min ? { centre: (min + max) / 2, radius: (max - min) / 2 } : null);
  }
  return rows;
}

/**
 * The jar's profile, as radius against height.
 *
 * Written out alongside the texture so the 3D jar is lathed from the real
 * silhouette — cap flare, shoulder and base taper included — rather than from a
 * cylinder somebody guessed at.
 */
function profileFrom(rows: (Row | null)[], samples = 96) {
  const first = rows.findIndex(Boolean);
  const last = rows.length - 1 - [...rows].reverse().findIndex(Boolean);
  const maxRadius = Math.max(...rows.filter(Boolean).map((r) => r!.radius));

  const points: { t: number; r: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const y = Math.round(first + t * (last - first));
    // Nearest measured row, in case a scanline caught an antialiased edge.
    let row = rows[y];
    for (let k = 1; !row && k < 12; k++) row = rows[y - k] ?? rows[y + k] ?? null;
    points.push({ t, r: row ? Number((row.radius / maxRadius).toFixed(4)) : 0 });
  }

  return { points, aspect: Number(((last - first + 1) / (maxRadius * 2)).toFixed(4)) };
}

async function unwrap(name: string) {
  const img = await readImage(resolve(SOURCE, `${name}.webp`));
  const rows = measureRows(img);

  const first = rows.findIndex(Boolean);
  const last = rows.length - 1 - [...rows].reverse().findIndex(Boolean);

  const out = Buffer.alloc(OUT_WIDTH * OUT_HEIGHT * 4);
  const usable = (USABLE_ARC_DEG * Math.PI) / 180;
  const sinLimit = Math.sin(usable);

  for (let oy = 0; oy < OUT_HEIGHT; oy++) {
    // Output rows span only the jar itself, so no transparent margin is baked in.
    const sy = Math.min(last, Math.max(first, Math.round(first + (oy / (OUT_HEIGHT - 1)) * (last - first))));
    let row = rows[sy];
    for (let k = 1; !row && k < 12; k++) row = rows[sy - k] ?? rows[sy + k] ?? null;
    if (!row) continue;

    // The colour at each end of the recovered arc, used to continue the row
    // round the back.
    //
    // Averaged across a band of columns *and* a band of rows. A single pixel
    // carries that row's photographic noise, and repeating it across 216° turns
    // the noise into a hard horizontal streak — the back ends up looking like a
    // corrupted scan rather than a jar.
    const edge = (sign: number) => {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let dy = -EDGE_BLUR; dy <= EDGE_BLUR; dy++) {
        const yy = Math.min(last, Math.max(first, sy + dy));
        let near = rows[yy];
        for (let k = 1; !near && k < 12; k++) near = rows[yy - k] ?? rows[yy + k] ?? null;
        if (!near) continue;
        for (let dx = 0; dx < EDGE_SAMPLES; dx++) {
          const sx = Math.round(near.centre + sign * near.radius * sinLimit * (1 - dx * 0.012));
          const i = (yy * img.width + Math.min(img.width - 1, Math.max(0, sx))) * img.channels;
          if (img.data[i + 3] <= OPAQUE) continue;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          a += img.data[i + 3];
          n += 1;
        }
      }
      if (n === 0) return [0, 0, 0, 0] as const;
      return [r / n, g / n, b / n, a / n] as const;
    };
    const leftEdge = edge(-1);
    const rightEdge = edge(1);

    for (let ox = 0; ox < OUT_WIDTH; ox++) {
      // θ = 0 at the front of the jar, running to ±180 at the back.
      const theta = (ox / OUT_WIDTH) * Math.PI * 2 - Math.PI;
      const o = (oy * OUT_WIDTH + ox) * 4;

      if (Math.abs(theta) <= usable) {
        // Straight inversion of the cylinder's projection.
        const sx = row.centre + row.radius * Math.sin(theta);
        const x0 = Math.floor(sx);
        const frac = sx - x0;
        const read = (x: number, c: number) =>
          img.data[(sy * img.width + Math.min(img.width - 1, Math.max(0, x))) * img.channels + c];

        for (let c = 0; c < 4; c++) {
          out[o + c] = Math.round(read(x0, c) * (1 - frac) + read(x0 + 1, c) * frac);
        }
      } else {
        // Behind the usable arc: continue the row's colour from whichever edge
        // is nearer, easing between the two so the back has no hard seam.
        const behind = Math.abs(theta) - usable;
        const span = Math.PI - usable;
        const mix = Math.min(1, behind / span);
        const source = theta > 0 ? rightEdge : leftEdge;
        const other = theta > 0 ? leftEdge : rightEdge;
        // Smoothstep, so the transition has no visible ridge.
        const blend = mix * mix * (3 - 2 * mix) * 0.5;
        for (let c = 0; c < 4; c++) {
          out[o + c] = Math.round(source[c] * (1 - blend) + other[c] * blend);
        }
      }
    }
  }

  mkdirSync(OUT, { recursive: true });
  await sharp(out, { raw: { width: OUT_WIDTH, height: OUT_HEIGHT, channels: 4 } })
    .webp({ quality: 86 })
    .toFile(resolve(OUT, `${name}-wrap.webp`));

  return profileFrom(rows);
}

const profiles: Record<string, unknown> = {};
for (const name of ["kabsah", "mandy", "briyani"]) {
  profiles[name] = await unwrap(name);
  console.log(`  · ${name}: wrapped`);
}

writeFileSync(resolve(OUT, "profiles.json"), `${JSON.stringify(profiles, null, 2)}\n`);
console.log(`\n  Wrote ${Object.keys(profiles).length} textures and profiles.json to public/products/3d\n`);
