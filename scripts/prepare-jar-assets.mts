/**
 * Cuts the jar parts out of their green screen.
 *
 * ## Why not just "delete the green pixels"
 *
 * A hard threshold leaves two artefacts, and both are obvious once the jar is
 * lit and turning:
 *
 * 1. **A jagged edge.** The boundary between jar and screen is antialiased, so
 *    those pixels are a genuine blend of the two. Classifying each as fully in
 *    or fully out throws that away and leaves stair-steps.
 * 2. **A green rim.** Light bounces off a green screen onto the subject. The
 *    outer millimetre of a brown jar photographed this way is measurably green,
 *    and keeping it puts a lime halo around a warm product shot.
 *
 * So this builds a soft matte from how green a pixel is relative to its own
 * brightness, then *despills*: where green exceeds what red and blue can
 * justify, it is pulled back down to them. That is the standard chroma-key
 * pair, and it matters more than usual here because the jar is amber and gold —
 * the colours a green cast damages most.
 *
 * Run with: npm run assets
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE = resolve(ROOT, "public/products/source");
const OUT = resolve(ROOT, "public/products/3d");

/**
 * How green a pixel must be, relative to the larger of red and blue, before it
 * counts as screen at all. Below this it is left completely alone.
 */
const KEY_LOW = 1.12;
/** At or above this ratio the pixel is pure screen. Between the two it fades. */
const KEY_HIGH = 1.45;

type Keyed = {
  data: Buffer;
  width: number;
  height: number;
  /** Bounding box of everything that survived, so the result can be trimmed. */
  box: { left: number; top: number; right: number; bottom: number };
};

async function key(file: string): Promise<Keyed> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Green measured against whichever of red or blue is stronger. Using the
      // max rather than the average keeps deep shadows — where all three are
      // low and noisy — from reading as screen.
      const rival = Math.max(r, b);
      const ratio = rival === 0 ? (g > 8 ? 99 : 0) : g / rival;

      let alpha: number;
      if (ratio <= KEY_LOW) alpha = 255;
      else if (ratio >= KEY_HIGH) alpha = 0;
      else alpha = Math.round(255 * (1 - (ratio - KEY_LOW) / (KEY_HIGH - KEY_LOW)));

      const o = (y * width + x) * 4;

      // Despill. Green above what the other two channels support is spill, not
      // product, so it is clamped back to them. On the gold cap this is the
      // difference between brass and a faint pistachio tint.
      const ceiling = (r + b) / 2;
      const green = g > ceiling ? ceiling + (g - ceiling) * 0.15 : g;

      out[o] = r;
      out[o + 1] = Math.round(green);
      out[o + 2] = b;
      out[o + 3] = alpha;

      if (alpha > 16) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  return { data: out, width, height, box: { left, top, right, bottom } };
}

/** Keys, trims to the subject, and writes a transparent WebP. */
async function extract(name: string, out: string, pad = 2) {
  const k = await key(resolve(SOURCE, `${name}.png`));

  const left = Math.max(0, k.box.left - pad);
  const top = Math.max(0, k.box.top - pad);
  const width = Math.min(k.width - left, k.box.right - k.box.left + 1 + pad * 2);
  const height = Math.min(k.height - top, k.box.bottom - k.box.top + 1 + pad * 2);

  await sharp(k.data, { raw: { width: k.width, height: k.height, channels: 4 } })
    .extract({ left, top, width, height })
    .webp({ quality: 92, alphaQuality: 100 })
    .toFile(resolve(OUT, `${out}.webp`));

  console.log(`  · ${out}: ${width}x${height}`);
  return { width, height };
}

/**
 * How much of a top-down photograph the metal cap actually fills.
 *
 * The shot looks straight down the whole jar, so its outer edge is the jar at
 * its widest — but the gold disc is narrower than that, with a ring of glass
 * shoulder around it. Mapping the whole image onto the lid's top would paint
 * that brown ring onto the cap.
 *
 * Measured rather than eyeballed: walk outward from the centre averaging a ring
 * of samples at each radius, and take the point where the gold gives way to the
 * dark glass. Re-shoot the cap and this number follows.
 */
async function capFill(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cx = info.width / 2;
  const cy = info.height / 2;
  const radius = Math.min(cx, cy);

  const brightnessAt = (fraction: number) => {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < 96; k++) {
      const angle = (k / 96) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(angle) * radius * fraction);
      const y = Math.round(cy + Math.sin(angle) * radius * fraction);
      const i = (Math.min(info.height - 1, Math.max(0, y)) * info.width + Math.min(info.width - 1, Math.max(0, x))) * info.channels;
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      n += 1;
    }
    return sum / n;
  };

  // The gold sits around 145 and the glass ring below 115, so the midpoint is a
  // wide, safe place to put the boundary.
  const CUTOFF = 128;
  let fill = 1;
  for (let f = 0.5; f <= 1; f += 0.005) {
    if (brightnessAt(f) < CUTOFF) {
      fill = Number((f - 0.005).toFixed(3));
      break;
    }
  }
  return fill;
}

mkdirSync(OUT, { recursive: true });

await extract("jar-blank", "jar-blank");
await extract("cap-top", "cap-top");
await extract("jar-base", "jar-base");
await extract("jar-open", "jar-open");
await extract("jar-splash", "jar-splash");

const parts = { capTopFill: await capFill(resolve(OUT, "cap-top.webp")) };
writeFileSync(resolve(OUT, "parts.json"), `${JSON.stringify(parts, null, 2)}\n`);

console.log(`  · cap fills ${Math.round(parts.capTopFill * 100)}% of its photograph`);
console.log(`\n  Wrote transparent art to public/products/3d\n`);
