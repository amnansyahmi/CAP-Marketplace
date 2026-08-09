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
 * ## What is behind the jar
 *
 * A photograph of a cylinder shows half of it, and near θ = ±90° the surface is
 * edge-on — `dx/dθ → 0`, so a whole band of label is compressed into a couple
 * of pixels. Only the middle ±72° is taken from any one photograph, where the
 * sampling is still honest.
 *
 * The remaining 216° used to be *continued* from the edge colours, which was a
 * guess dressed up as a jar. It is now taken from a second photograph: the same
 * jar with an unprinted label. That is what the back of this packaging actually
 * looks like — two plain bands — so the back of the model is now photographed
 * rather than invented.
 *
 * Two honest limits remain. The blank shot gives 144° of usable arc and the
 * back needs 216°, so it is stretched by half; on plain horizontal bands that
 * is invisible. And if the real retail jar carries an ingredients panel or a
 * barcode round the back, this will not show it — no photograph of one exists,
 * and inventing product information is not a rendering decision.
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

/** Texture covers the full turn; the front is real, the back is the blank jar. */
const OUT_WIDTH = 1600;
const OUT_HEIGHT = 1200;

/** Alpha above this counts as jar rather than background. */
const OPAQUE = 24;

/** Rows either side to average when reading an edge colour. */
const EDGE_BLUR = 6;
/** Columns inward from the edge to average, for the same reason. */
const EDGE_SAMPLES = 5;

/** Degrees either side of each seam over which the two photographs cross-fade. */
const SEAM_BLEND_DEG = 10;

type Row = { centre: number; radius: number };
type Image = Awaited<ReturnType<typeof readImage>>;

async function readImage(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** The jar's silhouette: where it starts and how wide it is on every row. */
function measureRows(img: Image): (Row | null)[] {
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

/** First and last row containing any jar. */
function extentOf(rows: (Row | null)[]) {
  const first = rows.findIndex(Boolean);
  const last = rows.length - 1 - [...rows].reverse().findIndex(Boolean);
  return { first, last };
}

/** Nearest measured row, in case a scanline caught only an antialiased edge. */
function rowNear(rows: (Row | null)[], y: number): Row | null {
  let row = rows[y] ?? null;
  for (let k = 1; !row && k < 12; k++) row = rows[y - k] ?? rows[y + k] ?? null;
  return row;
}

/** Bilinear read of one channel. */
function sample(img: Image, x: number, y: number, c: number) {
  const x0 = Math.floor(x);
  const frac = x - x0;
  const at = (xx: number) =>
    img.data[(y * img.width + Math.min(img.width - 1, Math.max(0, xx))) * img.channels + c];
  return at(x0) * (1 - frac) + at(x0 + 1) * frac;
}

/**
 * The jar's profile, as radius against height.
 *
 * Written out alongside the texture so the 3D jar is lathed from the real
 * silhouette — cap flare, shoulder and base taper included — rather than from a
 * cylinder somebody guessed at.
 */
function profileFrom(rows: (Row | null)[], samples = 96) {
  const { first, last } = extentOf(rows);
  const maxRadius = Math.max(...rows.filter(Boolean).map((r) => r!.radius));

  const points: { t: number; r: number }[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const y = Math.round(first + t * (last - first));
    const row = rowNear(rows, y);
    points.push({ t, r: row ? Number((row.radius / maxRadius).toFixed(4)) : 0 });
  }

  return { points, aspect: Number(((last - first + 1) / (maxRadius * 2)).toFixed(4)), capSplit: capSplitOf(points) };
}

/**
 * Where the metal cap stops and the glass begins, as a fraction of jar height
 * from the top.
 *
 * The cap is a straight wide cylinder; below it the glass neck steps in sharply
 * before the shoulder flares back out. That inward step is the seam, and it is
 * the largest negative change in radius anywhere in the top third of the jar.
 * Finding it by measurement means the lid lifts off at the join rather than at
 * a height somebody eyeballed once and then never revisited per product.
 */
function capSplitOf(points: { t: number; r: number }[]) {
  let bestT = 0.13;
  let bestDrop = 0;
  for (let i = 1; i < points.length - 1 && points[i].t < 0.33; i++) {
    const drop = points[i].r - points[i + 1].r;
    if (drop > bestDrop) {
      bestDrop = drop;
      bestT = points[i + 1].t;
    }
  }
  return Number(bestT.toFixed(4));
}

async function unwrap(name: string, blank: Image, blankRows: (Row | null)[]) {
  const img = await readImage(resolve(SOURCE, `${name}.webp`));
  const rows = measureRows(img);
  const { first, last } = extentOf(rows);
  const blankExtent = extentOf(blankRows);

  const out = Buffer.alloc(OUT_WIDTH * OUT_HEIGHT * 4);
  const usable = (USABLE_ARC_DEG * Math.PI) / 180;
  const seam = (SEAM_BLEND_DEG * Math.PI) / 180;
  /** How much of the back's 216° each degree of the blank's 144° has to cover. */
  const backSpan = 2 * Math.PI - 2 * usable;

  /** Mean colour just inside one edge of a photograph's usable arc. */
  const edgeOf = (source: Image, sourceRows: (Row | null)[], y: number, lo: number, hi: number, sign: number) => {
    let acc = [0, 0, 0, 0];
    let n = 0;
    for (let dy = -EDGE_BLUR; dy <= EDGE_BLUR; dy++) {
      const yy = Math.min(hi, Math.max(lo, y + dy));
      const near = rowNear(sourceRows, yy);
      if (!near) continue;
      for (let dx = 0; dx < EDGE_SAMPLES; dx++) {
        const sx = Math.round(near.centre + sign * near.radius * Math.sin(usable) * (1 - dx * 0.012));
        const i = (yy * source.width + Math.min(source.width - 1, Math.max(0, sx))) * source.channels;
        if (source.data[i + 3] <= OPAQUE) continue;
        acc = [acc[0] + source.data[i], acc[1] + source.data[i + 1], acc[2] + source.data[i + 2], acc[3] + source.data[i + 3]];
        n += 1;
      }
    }
    return n === 0 ? null : (acc.map((v) => v / n) as number[]);
  };

  /**
   * One exposure match for the whole jar, measured at the seam.
   *
   * The two jars were photographed in separate sessions and the blank came out
   * about a fifth brighter, so it needs correcting or the back of the jar
   * glows. Doing this *per row* was the obvious first move and it was wrong:
   * dividing two noisy edge samples gives a gain that wobbles from row to row,
   * and on the pale label band a shadowed edge pixel dragged the correction to
   * its floor and turned the whole band grey.
   *
   * Pooling every row into a single ratio keeps the match — the seam is what
   * has to line up — while making horizontal banding impossible to express.
   */
  const gain = (() => {
    const front = [0, 0, 0];
    const back = [0, 0, 0];
    let n = 0;
    for (let y = first; y <= last; y += 4) {
      const t = (y - first) / Math.max(1, last - first);
      const by = Math.round(blankExtent.first + t * (blankExtent.last - blankExtent.first));
      for (const sign of [-1, 1]) {
        const a = edgeOf(img, rows, y, first, last, sign);
        const b = edgeOf(blank, blankRows, by, blankExtent.first, blankExtent.last, sign);
        if (!a || !b) continue;
        for (let c = 0; c < 3; c++) {
          front[c] += a[c];
          back[c] += b[c];
        }
        n += 1;
      }
    }
    if (n === 0) return [1, 1, 1];
    return front.map((v, c) => Math.min(1.4, Math.max(0.7, v / Math.max(1, back[c]))));
  })();

  for (let oy = 0; oy < OUT_HEIGHT; oy++) {
    const t = oy / (OUT_HEIGHT - 1);

    // Both photographs are sampled at the same *proportional* height, so the
    // two jars line up even though they were shot at different scales.
    const sy = Math.min(last, Math.max(first, Math.round(first + t * (last - first))));
    const by = Math.min(
      blankExtent.last,
      Math.max(blankExtent.first, Math.round(blankExtent.first + t * (blankExtent.last - blankExtent.first))),
    );

    const row = rowNear(rows, sy);
    const blankRow = rowNear(blankRows, by);
    if (!row) continue;

    for (let ox = 0; ox < OUT_WIDTH; ox++) {
      // θ = 0 at the front of the jar, running to ±180 at the back.
      const theta = (ox / OUT_WIDTH) * Math.PI * 2 - Math.PI;
      const o = (oy * OUT_WIDTH + ox) * 4;

      /** The labelled photograph, straight inversion of the projection. */
      const front = () => {
        const sx = row.centre + row.radius * Math.sin(theta);
        return [0, 1, 2, 3].map((c) => sample(img, sx, sy, c));
      };

      /** The blank photograph, stretched across the back. */
      const back = () => {
        if (!blankRow) return null;
        // Distance travelled round the back from the right-hand seam.
        const psi = theta >= 0 ? theta - usable : theta + 2 * Math.PI - usable;
        // Traverse the blank's usable arc from its right edge to its left.
        const phi = usable - (psi / backSpan) * (2 * usable);
        const bx = blankRow.centre + blankRow.radius * Math.sin(phi);
        const rgba = [0, 1, 2, 3].map((c) => sample(blank, bx, by, c));
        return [rgba[0] * gain[0], rgba[1] * gain[1], rgba[2] * gain[2], rgba[3]];
      };

      const absTheta = Math.abs(theta);
      let rgba: number[];

      if (absTheta <= usable - seam) {
        rgba = front();
      } else if (absTheta >= usable + seam) {
        rgba = back() ?? front();
      } else {
        // Across the seam, cross-fade so neither photograph starts abruptly.
        const mix = (absTheta - (usable - seam)) / (2 * seam);
        const smooth = mix * mix * (3 - 2 * mix);
        const a = front();
        const b = back();
        rgba = b ? a.map((v, c) => v * (1 - smooth) + b[c] * smooth) : a;
      }

      for (let c = 0; c < 4; c++) out[o + c] = Math.max(0, Math.min(255, Math.round(rgba[c])));
    }
  }

  mkdirSync(OUT, { recursive: true });
  await sharp(out, { raw: { width: OUT_WIDTH, height: OUT_HEIGHT, channels: 4 } })
    .webp({ quality: 86 })
    .toFile(resolve(OUT, `${name}-wrap.webp`));

  return { ...profileFrom(rows), paste: pasteColour(out) };
}

/**
 * The colour of the paste itself, for the droplets thrown out of the jar.
 *
 * Taken from the band of jar between the bottom of the cap and the top of the
 * label, which is the only place the contents are visible unobstructed. Sampled
 * from the finished texture and only across the front arc, where the pixels
 * came from the labelled photograph rather than the blank one.
 *
 * Then lifted. What that band shows is paste seen *through* brown glass, and a
 * splash in the air has nothing in front of it — using the glassed-over colour
 * makes the droplets look like mud. The lift is the one number here chosen by
 * eye rather than measured, so it is written down as such.
 */
function pasteColour(texture: Buffer) {
  const top = Math.round(OUT_HEIGHT * 0.16);
  const bottom = Math.round(OUT_HEIGHT * 0.24);
  // The middle third of the width is the front of the jar.
  const from = Math.round(OUT_WIDTH * 0.4);
  const to = Math.round(OUT_WIDTH * 0.6);

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = from; x < to; x++) {
      const i = (y * OUT_WIDTH + x) * 4;
      if (texture[i + 3] < 200) continue;
      r += texture[i];
      g += texture[i + 1];
      b += texture[i + 2];
      n += 1;
    }
  }
  if (n === 0) return "#8a3a18";

  const LIFT = 1.5;
  const hex = [r / n, g / n, b / n]
    .map((v) => Math.min(255, Math.round(v * LIFT)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

const blank = await readImage(resolve(OUT, "jar-blank.webp"));
const blankRows = measureRows(blank);

const profiles: Record<string, unknown> = {};
for (const name of ["kabsah", "mandy", "briyani"]) {
  const profile = await unwrap(name, blank, blankRows);
  profiles[name] = profile;
  const p = profile as { capSplit: number; paste: string };
  console.log(`  · ${name}: wrapped, cap splits at t=${p.capSplit}, paste ${p.paste}`);
}

writeFileSync(resolve(OUT, "profiles.json"), `${JSON.stringify(profiles, null, 2)}\n`);
console.log(`\n  Wrote ${Object.keys(profiles).length} textures and profiles.json to public/products/3d\n`);
