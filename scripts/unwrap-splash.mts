/**
 * Turns the photographed splash into a crown that can be revolved around the
 * jar's mouth.
 *
 * ## Why not particles
 *
 * The first version threw a few dozen shaded lumps into the air. It read as
 * beads, because that is what it was. A real splash of thick paste is a
 * *connected sheet* — a crown that climbs out of the neck, flares, thins, and
 * only breaks into droplets at the very tips.
 *
 * ## Why not the photograph as a billboard
 *
 * The jar turns. A flat cut-out hanging over it is correct from exactly one
 * angle and obviously a sticker from every other.
 *
 * ## What this does instead
 *
 * The same trick the label gets: unwrap the photograph cylindrically, then
 * revolve it. The crown becomes real geometry lathed from the splash's own
 * measured silhouette, wearing the splash's own pixels — including its alpha,
 * which is what gives the rim its ragged, broken edge. No noise function
 * invents the shape; the photograph is the shape.
 *
 * Run as part of: npm run assets
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "public/products/3d");

/** Beyond this the photograph of a round thing has no usable detail left. */
const USABLE_ARC_DEG = 72;
const OUT_WIDTH = 1024;
const OUT_HEIGHT = 512;
const OPAQUE = 20;
/** Degrees either side of the seam over which the two halves cross-fade. */
const SEAM_BLEND_DEG = 12;

type Row = { centre: number; radius: number } | null;

async function read(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function measure(img: Awaited<ReturnType<typeof read>>): Row[] {
  const rows: Row[] = [];
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

const img = await read(resolve(OUT, "jar-splash.webp"));
const rows = measure(img);

/**
 * Where the lid stops, where the crown stops, and how wide the jar is.
 *
 * The frame holds three things stacked up: the floating lid, the splash, and
 * the jar. The lid is separated by clear air. The boundary between splash and
 * jar is the narrowest point between them — the waist where the crown necks
 * down into the mouth.
 */
const bodyTop = (() => {
  let best = { start: 0, end: 0 };
  let start: number | null = null;
  for (let y = 0; y < rows.length; y++) {
    if (!rows[y]) {
      if (start === null) start = y;
    } else if (start !== null) {
      if (y - start > best.end - best.start) best = { start, end: y - 1 };
      start = null;
    }
  }
  return best.end + 1;
})();

/** The jar's own radius, taken well down the body where it is straight. */
const jarRadius = (() => {
  const lower = rows.slice(Math.round(rows.length * 0.55), Math.round(rows.length * 0.85)).filter(Boolean);
  return lower.reduce((m, r) => Math.max(m, r!.radius), 0);
})();

/** The waist: narrowest row between the top of the splash and the jar's shoulder. */
const waist = (() => {
  let bestY = bodyTop;
  let bestR = Infinity;
  for (let y = bodyTop + 40; y < rows.length * 0.45; y++) {
    const r = rows[y];
    if (r && r.radius < bestR) {
      bestR = r.radius;
      bestY = y;
    }
  }
  return { y: bestY, radius: bestR };
})();

const top = rows.findIndex((r, y) => y >= bodyTop && r);
const height = waist.y - top;

console.log(`  splash rows ${top}..${waist.y} (${height}px)`);
console.log(`  jar radius ${jarRadius.toFixed(1)}px, waist radius ${waist.radius.toFixed(1)}px`);
console.log(`  spread ${(Math.max(...rows.slice(top, waist.y).filter(Boolean).map((r) => r!.radius)) / jarRadius).toFixed(3)}x jar radius`);
console.log(`  rise ${(height / jarRadius).toFixed(3)} jar radii`);

// ---------------------------------------------------------------- unwrap
const out = Buffer.alloc(OUT_WIDTH * OUT_HEIGHT * 4);
const usable = (USABLE_ARC_DEG * Math.PI) / 180;
const seam = (SEAM_BLEND_DEG * Math.PI) / 180;
const backSpan = 2 * Math.PI - 2 * usable;

const sample = (x: number, y: number, c: number) => {
  const x0 = Math.floor(x);
  const f = x - x0;
  const at = (xx: number) =>
    img.data[(y * img.width + Math.min(img.width - 1, Math.max(0, xx))) * img.channels + c];
  return at(x0) * (1 - f) + at(x0 + 1) * f;
};

/** Radius of the crown at each output row, as a fraction of the jar's radius. */
const profile: { v: number; r: number }[] = [];

for (let oy = 0; oy < OUT_HEIGHT; oy++) {
  // v = 0 at the waist, 1 at the top of the crown.
  const v = oy / (OUT_HEIGHT - 1);
  const sy = Math.round(waist.y - v * height);
  let row = rows[sy];
  for (let k = 1; !row && k < 10; k++) row = rows[sy - k] ?? rows[sy + k] ?? null;
  if (!row) continue;

  profile.push({ v: Number(v.toFixed(4)), r: Number((row.radius / jarRadius).toFixed(4)) });

  for (let ox = 0; ox < OUT_WIDTH; ox++) {
    const theta = (ox / OUT_WIDTH) * Math.PI * 2 - Math.PI;
    const o = (oy * OUT_WIDTH + ox) * 4;

    const readAt = (angle: number) => {
      const sx = row.centre + row.radius * Math.sin(angle);
      return [0, 1, 2, 3].map((c) => sample(sx, sy, c));
    };

    const absTheta = Math.abs(theta);
    let rgba: number[];

    if (absTheta <= usable - seam) {
      rgba = readAt(theta);
    } else {
      // Behind the honest arc, continue with the same stretched traverse the
      // label uses. A crown is close enough to rotationally symmetric that this
      // reads as more of the same splash rather than as a repeat.
      const psi = theta >= 0 ? theta - usable : theta + 2 * Math.PI - usable;
      const behind = readAt(usable - (psi / backSpan) * (2 * usable));
      if (absTheta >= usable + seam) {
        rgba = behind;
      } else {
        const mix = (absTheta - (usable - seam)) / (2 * seam);
        const smooth = mix * mix * (3 - 2 * mix);
        const front = readAt(theta);
        rgba = front.map((val, c) => val * (1 - smooth) + behind[c] * smooth);
      }
    }

    for (let c = 0; c < 4; c++) out[o + c] = Math.max(0, Math.min(255, Math.round(rgba[c])));
  }
}

await sharp(out, { raw: { width: OUT_WIDTH, height: OUT_HEIGHT, channels: 4 } })
  .webp({ quality: 88, alphaQuality: 100 })
  .toFile(resolve(OUT, "splash-wrap.webp"));

const spread = Math.max(...profile.map((p) => p.r));
writeFileSync(
  resolve(OUT, "splash.json"),
  `${JSON.stringify(
    {
      /** How far the crown reaches out, in jar radii. */
      spread: Number(spread.toFixed(4)),
      /** How far it rises above the waist, in jar radii. */
      rise: Number((height / jarRadius).toFixed(4)),
      profile,
    },
    null,
    2,
  )}\n`,
);

console.log(`\n  Wrote splash-wrap.webp and splash.json\n`);
