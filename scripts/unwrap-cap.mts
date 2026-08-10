/**
 * Turns the photograph of the bare cap into two textures the model can wear.
 *
 * ## Why the cap needed its own photograph
 *
 * Until now the lid wore a slice of the jar's own wrap. That wrap is honest
 * about the label, because a label is the one part of the jar that genuinely
 * differs all the way round — but it is the wrong tool for the cap:
 *
 * - Only 72° of the jar photograph is usable, so the rest of the cap's band was
 *   the back of a *blank* jar stretched round. The cap's chamfer therefore rose
 *   and fell as it turned, when on a machined cap it is a dead level line.
 * - At that scale the cap is about 160 pixels tall in the wrap. The knurling is
 *   at the limit of what survives.
 *
 * The bare cap was then photographed on its own, filling 1141 pixels, and this
 * reads that instead.
 *
 * ## What the photograph is, geometrically
 *
 * A cap resting mouth-down, seen from slightly below. That single fact fixes
 * everything else, because a cap is a surface of revolution: a point at azimuth
 * θ and height `w` above the rim lands at
 *
 *     x = cx + R(w)·cos θ
 *     v  = w·cos φ + R(w)·sin θ·sin φ        (v measured up from the rim plane)
 *
 * where φ is how far above the rim plane the camera sits. Everything below is
 * that formula, forwards to unwrap the outside and backwards to read the inside.
 *
 * φ is not guessed. The far lip of the mouth is a circle, so it draws an ellipse
 * across the bottom of the picture, and the ratio of that ellipse's axes *is*
 * sin φ. Fitting it gives the camera angle to a fraction of a degree.
 *
 * ## Why the outside is rebuilt rather than copied
 *
 * The knurling is a machined pattern: identical flutes at an identical pitch the
 * whole way round. So the strip is split in two — what varies *up* the cap (the
 * knurled band, the chamfer, the flange) and what varies *around* it (one flute,
 * repeated). Every flute in the sharp part of the arc is folded onto one another
 * and averaged, and the result is tiled a whole number of times into a whole
 * number of pixels each.
 *
 * Nothing is invented: the flute's shape, its pitch and the bands' positions are
 * all the photographed ones. What it buys is a texture that closes exactly at the
 * seam, has no wobble in the chamfer, and cannot alias — which copying an arc of
 * photograph and stretching it round does on all three counts.
 *
 * It also drops variation with azimuth, which on a turned metal cap is the
 * studio's key light and nothing else. A key light baked into a lid that
 * unscrews would travel round with it; the shader puts a stationary one back.
 *
 * ## Why the inside is a ramp rather than a picture
 *
 * The interior is threads: horizontal rings, rotationally symmetric. Again the
 * only thing that varies with azimuth is the lighting, so the inside is read as
 * one column of colour against depth, averaged across the arc — which is all the
 * information the surface actually carries.
 *
 * The honest limit is the ceiling. From 13° above the rim the far wall is in view
 * the whole way up, but the disc closing the top is not, and nothing here
 * pretends otherwise: the model's ceiling wears the deepest wall colour and lets
 * the shader take it down.
 *
 * Run with: npm run cap
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "public/products/3d");
const SOURCE = resolve(OUT, "cap-inside.webp");

/**
 * Height of the unwrapped outside. The cap stands about 230 pixels tall in the
 * photograph, so this is a touch above what the source can actually resolve and
 * nothing is being thrown away.
 */
const WRAP_HEIGHT = 256;
/** Samples down the inside. Only the depth axis carries any detail. */
const INNER_STEPS = 256;
/** The inside ramp is written a few pixels wide so it filters cleanly. */
const INNER_WIDTH = 8;

/**
 * How far either side of dead-on to trust the outside of the cap.
 *
 * The same limit the label unwrap uses, and for the same reason: past this the
 * surface is turning away fast enough that one output pixel is fed by a smear of
 * source pixels.
 */
const USABLE_ARC_DEG = 72;

type Image = { data: Buffer; width: number; height: number; channels: number };

const at = (img: Image, x: number, y: number) => (y * img.width + x) * img.channels;

/** Bilinear sample. Returns null outside the cut-out, so callers can back off. */
function sample(img: Image, x: number, y: number): [number, number, number] | null {
  if (x < 0 || y < 0 || x > img.width - 2 || y > img.height - 2) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  const out: [number, number, number] = [0, 0, 0];
  let alpha = 0;
  for (let c = 0; c < 3; c++) {
    const a = img.data[at(img, x0, y0) + c];
    const b = img.data[at(img, x0 + 1, y0) + c];
    const d = img.data[at(img, x0, y0 + 1) + c];
    const e = img.data[at(img, x0 + 1, y0 + 1) + c];
    out[c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
  for (const [px, py, weight] of [
    [x0, y0, (1 - fx) * (1 - fy)],
    [x0 + 1, y0, fx * (1 - fy)],
    [x0, y0 + 1, (1 - fx) * fy],
    [x0 + 1, y0 + 1, fx * fy],
  ] as const) {
    alpha += img.data[at(img, px, py) + 3] * weight;
  }

  return alpha < 140 ? null : out;
}

const source = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const img: Image = {
  data: source.data,
  width: source.info.width,
  height: source.info.height,
  channels: source.info.channels,
};

console.log(`\n  Reading cap-inside.webp (${img.width}x${img.height})`);

/** Left and right edge of the cut-out on one row, or null if the row is empty. */
function span(y: number): [number, number] | null {
  let left = -1;
  let right = -1;
  for (let x = 0; x < img.width; x++) {
    if (img.data[at(img, x, y) + 3] > 140) {
      if (left < 0) left = x;
      right = x;
    }
  }
  return left < 0 ? null : [left, right];
}

const spans: ([number, number] | null)[] = [];
for (let y = 0; y < img.height; y++) spans.push(span(y));

// The widest row is the mouth's outer lip, which is the widest thing on a cap.
let widest = { y: 0, width: 0, left: 0, right: 0 };
for (let y = 0; y < img.height; y++) {
  const s = spans[y];
  if (s && s[1] - s[0] > widest.width) widest = { y, width: s[1] - s[0], left: s[0], right: s[1] };
}
const cx = (widest.left + widest.right) / 2;
const outerRadius = widest.width / 2;

/**
 * Least squares for `y = c + m·dx + k·f(dx)` over a set of boundary points.
 *
 * The three terms are, in order: where the circle's plane sits, how far the cap
 * is rotated within the frame, and how squashed the circle is. The rotation term
 * is not decoration — the cap is about a degree off level in the photograph, and
 * without it the fit splits the difference and puts the chamfer band a full ten
 * pixels out on one side.
 */
function solve(points: { dx: number; y: number; f: number }[]) {
  const n = points.length;
  let sx = 0;
  let sf = 0;
  let sy = 0;
  let sxx = 0;
  let sff = 0;
  let sxf = 0;
  let sxy = 0;
  let sfy = 0;
  for (const p of points) {
    sx += p.dx;
    sf += p.f;
    sy += p.y;
    sxx += p.dx * p.dx;
    sff += p.f * p.f;
    sxf += p.dx * p.f;
    sxy += p.dx * p.y;
    sfy += p.f * p.y;
  }
  // Normal equations for [c, m, k].
  const A = [
    [n, sx, sf],
    [sx, sxx, sxf],
    [sf, sxf, sff],
  ];
  const b = [sy, sxy, sfy];
  // Gaussian elimination; three unknowns, so this stays readable.
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    for (let r = i + 1; r < 3; r++) {
      const factor = A[r][i] / A[i][i];
      for (let c = i; c < 3; c++) A[r][c] -= factor * A[i][c];
      b[r] -= factor * b[i];
    }
  }
  const out = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let sum = b[i];
    for (let c = i + 1; c < 3; c++) sum -= A[i][c] * out[c];
    out[i] = sum / A[i][i];
  }
  return { c: out[0], m: out[1], k: out[2] };
}

/**
 * The camera's elevation above the rim plane, from the far lip's ellipse.
 *
 * The bottom edge of the cut-out *is* that lip, drawn as the lower half of an
 * ellipse whose semi-major axis is the cap's own radius. So the semi-minor axis
 * the fit returns, divided by that radius, is sin φ outright.
 *
 * The outer eighth of the arc is dropped. There the boundary runs almost
 * vertically, one pixel of edge covers many degrees of azimuth, and the tips
 * drag the fit around out of all proportion to what they actually know.
 */
function fitRim() {
  const points: { dx: number; y: number; f: number }[] = [];
  for (let x = 0; x < img.width; x++) {
    const dx = x - cx;
    const ratio = dx / outerRadius;
    if (Math.abs(ratio) > 0.88) continue;
    let bottom = -1;
    for (let y = img.height - 1; y >= 0; y--) {
      if (img.data[at(img, x, y) + 3] > 140) {
        bottom = y;
        break;
      }
    }
    if (bottom < 0) continue;
    points.push({ dx, y: bottom, f: Math.sqrt(1 - ratio * ratio) });
  }

  const fit = solve(points);
  const residual = Math.sqrt(
    points.reduce((sum, p) => sum + (fit.c + fit.m * p.dx + fit.k * p.f - p.y) ** 2, 0) / points.length,
  );
  return {
    centreY: fit.c,
    tilt: fit.m,
    minor: fit.k,
    residual,
    phi: Math.asin(Math.max(0.02, Math.min(0.99, fit.k / outerRadius))),
  };
}

const rim = fitRim();
const cosPhi = Math.cos(rim.phi);
const sinPhi = Math.sin(rim.phi);

console.log(`  · centre x ${cx.toFixed(1)}, outer radius ${outerRadius.toFixed(1)}px`);
console.log(
  `  · camera sits ${((rim.phi * 180) / Math.PI).toFixed(2)}° above the rim plane` +
    ` (fit to ±${rim.residual.toFixed(1)}px, cap ${((Math.atan(rim.tilt) * 180) / Math.PI).toFixed(2)}° off level)`,
);

/** Image row for a height above the rim, at the silhouette (sin θ = 0). */
const rowForHeight = (w: number) => rim.centreY - w * cosPhi;
/** Half-width of the cut-out on a row, interpolated. */
function halfWidthAt(y: number) {
  const y0 = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const s = spans[y0];
  return s ? (s[1] - s[0]) / 2 : outerRadius;
}

/**
 * How tall the cap is, in the photograph's pixels.
 *
 * The topmost pixel is the *near* edge of the closed top, so it sits a full
 * `R·sin φ` above the top plane's centre. Solving for the height therefore needs
 * the radius up there, which needs the height — so it is iterated. Three passes
 * is more than enough; it converges in two.
 */
let height = outerRadius;
let topRadius = outerRadius;
for (let i = 0; i < 4; i++) {
  const apexRise = rim.centreY - (spans.findIndex((s) => s !== null) as number);
  height = (apexRise - topRadius * sinPhi) / cosPhi;
  topRadius = halfWidthAt(rowForHeight(height));
}
const aspect = height / (outerRadius * 2);
console.log(`  · cap is ${height.toFixed(0)}px tall, ${(aspect * 100).toFixed(1)}% of its diameter`);

/**
 * The cap's radius at each height, straight off the silhouette.
 *
 * At the silhouette sin θ is zero, so the projection collapses to
 * `v = w·cos φ` — the row and the height are simply proportional, and the
 * half-width there is the radius. This is what gives the flange its flare
 * rather than assuming a plain cylinder.
 */
const RADIUS_STEPS = 128;
const radii: number[] = [];
for (let i = 0; i <= RADIUS_STEPS; i++) {
  const w = (i / RADIUS_STEPS) * height;
  radii.push(halfWidthAt(rowForHeight(w)));
}
// Three passes of a small box blur. The silhouette is a staircase at the pixel
// level and a lathe run through it shows every step as a ring.
for (let pass = 0; pass < 3; pass++) {
  const copy = [...radii];
  for (let i = 1; i < radii.length - 1; i++) radii[i] = (copy[i - 1] + copy[i] + copy[i + 1]) / 3;
}
const radiusAt = (w: number) => {
  const f = Math.max(0, Math.min(1, w / height)) * RADIUS_STEPS;
  const i = Math.min(RADIUS_STEPS - 1, Math.floor(f));
  return radii[i] + (radii[i + 1] - radii[i]) * (f - i);
};

/* ------------------------------------------------------------------ outside */

/**
 * Unwrap the near half of the cap into azimuth-by-height, over the usable arc.
 *
 * `NaN` marks a column the photograph cannot answer for.
 */
const arc = (USABLE_ARC_DEG * Math.PI) / 180;
const ARC_COLUMNS = 720;
const strip = new Float64Array(ARC_COLUMNS * WRAP_HEIGHT * 3).fill(Number.NaN);

for (let c = 0; c < ARC_COLUMNS; c++) {
  // θ = π/2 is dead-on to the camera; the arc opens either side of it.
  const theta = Math.PI / 2 + ((c / (ARC_COLUMNS - 1)) * 2 - 1) * arc;
  for (let r = 0; r < WRAP_HEIGHT; r++) {
    // Row 0 is the top of the cap, the last row is the rim.
    const w = (1 - r / (WRAP_HEIGHT - 1)) * height;
    const radius = radiusAt(w);
    const dx = radius * Math.cos(theta);
    const x = cx + dx;
    const y = rim.centreY + rim.tilt * dx - (w * cosPhi + radius * Math.sin(theta) * sinPhi);
    const rgb = sample(img, x, y);
    if (!rgb) continue;
    const i = (r * ARC_COLUMNS + c) * 3;
    strip[i] = rgb[0];
    strip[i + 1] = rgb[1];
    strip[i + 2] = rgb[2];
  }
}

const degreesPerColumn = (2 * USABLE_ARC_DEG) / (ARC_COLUMNS - 1);
const centreColumn = (ARC_COLUMNS - 1) / 2;

/**
 * What colour the cap is in the jar photographs.
 *
 * Read from the label wraps rather than from the jar photographs directly,
 * because the wraps have already had the green screen keyed and despilled — so
 * this is the same pixels the label wears, and the cap will match its own jar
 * rather than a differently balanced shoot.
 *
 * Only the middle fifth of each wrap is used. That is the part that is real
 * photography; the rest is the blank jar's back, brought in at a pooled
 * exposure, and averaging that in would tug the answer toward a different shot
 * all over again.
 */
async function capBandColour(): Promise<[number, number, number] | null> {
  const profiles = JSON.parse(readFileSync(resolve(OUT, "profiles.json"), "utf8")) as Record<
    string,
    { capSplit: number }
  >;

  const total = [0, 0, 0];
  let counted = 0;

  for (const [id, profile] of Object.entries(profiles)) {
    let raw;
    try {
      raw = await sharp(resolve(OUT, `${id}-wrap.webp`))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch {
      continue;
    }

    const { width, height, channels } = raw.info;
    const band = profile.capSplit * height;
    const from = Math.round(width * 0.4);
    const to = Math.round(width * 0.6);

    for (let y = Math.round(band * 0.1); y < band * 0.75; y++) {
      for (let x = from; x < to; x++) {
        const i = (y * width + x) * channels;
        if (raw.data[i + 3] < 200) continue;
        total[0] += raw.data[i];
        total[1] += raw.data[i + 1];
        total[2] += raw.data[i + 2];
        counted += 1;
      }
    }
  }

  return counted > 0 ? [total[0] / counted, total[1] / counted, total[2] / counted] : null;
}

/**
 * The part of the strip worth building from.
 *
 * Tighter than the unwrap itself. Checked rather than assumed: shifting each
 * column of the strip against the middle one to see where the chamfer band
 * lands, the answer is within a pixel or two out to about 40° and then runs
 * away to twelve. Past that the projection is grazing enough that a small error
 * in the camera angle bows the bands, and a bowed band folded into one flute
 * smears the very edge this is meant to sharpen.
 */
const SHARP_ARC_DEG = 40;
const sharpFrom = Math.round(centreColumn - SHARP_ARC_DEG / degreesPerColumn);
const sharpTo = Math.round(centreColumn + SHARP_ARC_DEG / degreesPerColumn);

/**
 * How many flutes go round the cap.
 *
 * Autocorrelating the horizontal detail in the knurled band, to a twentieth of
 * a column. The search starts low enough that a true pitch would win over its
 * own double, and covers what this kind of closure is knurled at.
 */
function fluteCount() {
  const bandTop = Math.round(WRAP_HEIGHT * 0.15);
  const bandBottom = Math.round(WRAP_HEIGHT * 0.55);

  // One row of horizontal derivative, averaged down the band.
  const signal = new Float64Array(ARC_COLUMNS);
  for (let c = 1; c < ARC_COLUMNS - 1; c++) {
    let sum = 0;
    let n = 0;
    for (let r = bandTop; r < bandBottom; r++) {
      const a = strip[(r * ARC_COLUMNS + c - 1) * 3];
      const b = strip[(r * ARC_COLUMNS + c + 1) * 3];
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      sum += b - a;
      n += 1;
    }
    signal[c] = n ? sum / n : 0;
  }

  let best = { lag: 0, score: -Infinity };
  for (let lag = 3; lag < 60; lag += 0.05) {
    const flutes = 360 / (lag * degreesPerColumn);
    if (flutes < 60 || flutes > 260) continue;
    let sum = 0;
    let n = 0;
    for (let c = sharpFrom; c < sharpTo - lag - 1; c++) {
      const j = c + lag;
      const j0 = Math.floor(j);
      const f = j - j0;
      sum += signal[c] * (signal[j0] * (1 - f) + signal[j0 + 1] * f);
      n += 1;
    }
    const score = n ? sum / n : 0;
    if (score > best.score) best = { lag, score };
  }

  return { flutes: Math.round(360 / (best.lag * degreesPerColumn)), lag: best.lag };
}

const { flutes, lag: measuredLag } = fluteCount();
/** Columns per flute, snapped to a pitch that divides the circle exactly. */
const pitchColumns = 360 / flutes / degreesPerColumn;
console.log(
  `  · knurling repeats ${flutes} times round the cap` +
    ` (${measuredLag.toFixed(2)} columns measured, ${pitchColumns.toFixed(2)} used)`,
);

/**
 * Build the wrap out of one averaged flute rather than a slice of photograph.
 *
 * Repeating a slice was the first attempt and it aliased hard: the flutes come
 * off the photograph at about thirteen columns each and land on seven output
 * pixels, and resampling a stripe pattern down like that beats against the pixel
 * grid into broad grey bands. It also cannot close, because a whole number of
 * flutes rarely divides the count that goes round.
 *
 * So the strip is split in two. The **structure** is what varies up the cap —
 * the knurled band, the chamfer, the flange — taken as each row's average across
 * the sharp arc. The **detail** is what varies around it, which on a machined
 * closure is one flute repeated: every flute in the sharp arc is folded onto one
 * another and averaged, so the output flute is the mean of about thirty
 * photographed ones and carries their noise divided by the square root of that.
 *
 * The output is then a whole number of pixels per flute and a whole number of
 * flutes round, so it tiles exactly, wraps with no seam, and has nothing left to
 * alias against.
 *
 * What this throws away is variation with azimuth, which on a turned metal cap
 * is the studio's key light and nothing else — and a key light baked into a lid
 * that unscrews would travel round with it. The shader puts a stationary one
 * back.
 */
const FLUTE_PIXELS = 10;
const WRAP_WIDTH = flutes * FLUTE_PIXELS;
const wrap = Buffer.alloc(WRAP_WIDTH * WRAP_HEIGHT * 4);
{
  const structure = new Float64Array(WRAP_HEIGHT * 3);
  for (let r = 0; r < WRAP_HEIGHT; r++) {
    const sum = [0, 0, 0];
    let n = 0;
    for (let c = sharpFrom; c <= sharpTo; c++) {
      const i = (r * ARC_COLUMNS + c) * 3;
      if (Number.isNaN(strip[i])) continue;
      for (let ch = 0; ch < 3; ch++) sum[ch] += strip[i + ch];
      n += 1;
    }
    for (let ch = 0; ch < 3; ch++) structure[r * 3 + ch] = n ? sum[ch] / n : 0;
  }

  /**
   * Anchor the colour to the cap in the product photographs.
   *
   * Two reasons the raw average is the wrong level. It is dragged pale, because
   * the flanks of the arc catch the light at a glance. And it is dragged *red*,
   * because the bare cap was shot on a different day under a different balance
   * from the jars — the same brass reads noticeably more orange in one than the
   * other.
   *
   * Neither matters in the abstract; both matter enormously on screen, because
   * this cap has to sit directly on top of a label and a body of glass that came
   * out of the jar photographs. So the target is the cap *in those* — the band
   * above the label, over the arc of them that is real photography — and the
   * whole thing is scaled per channel to meet it. That moves the level without
   * touching the shape of anything.
   */
  {
    const target = await capBandColour();
    const here = [0, 0, 0];
    let n = 0;
    for (let r = Math.round(WRAP_HEIGHT * 0.1); r < WRAP_HEIGHT * 0.75; r++) {
      for (let c = sharpFrom; c <= sharpTo; c++) {
        const i = (r * ARC_COLUMNS + c) * 3;
        if (Number.isNaN(strip[i])) continue;
        for (let ch = 0; ch < 3; ch++) here[ch] += strip[i + ch];
        n += 1;
      }
    }

    if (target && n > 0) {
      const gains = [0, 1, 2].map((ch) => Math.max(0.6, Math.min(1.4, target[ch] / (here[ch] / n))));
      for (let r = 0; r < WRAP_HEIGHT; r++) {
        for (let ch = 0; ch < 3; ch++) structure[r * 3 + ch] *= gains[ch];
      }
      console.log(
        `  · colour anchored to the jars' own cap, rgb(${target.map(Math.round).join(", ")})` +
          ` (×${gains.map((g) => g.toFixed(2)).join(", ")})`,
      );
    } else {
      console.log(`  · no jar wraps to anchor against; run npm run jars first`);
    }
  }

  const detail = new Float64Array(WRAP_HEIGHT * FLUTE_PIXELS * 3);
  const weight = new Float64Array(WRAP_HEIGHT * FLUTE_PIXELS);

  /** How deep the grooves are in the columns that face the camera squarely. */
  const deadOn = Math.round(8 / degreesPerColumn);
  let sharpSquares = 0;
  let sharpCount = 0;

  const half = Math.round(pitchColumns / 2);
  for (let r = 0; r < WRAP_HEIGHT; r++) {
    for (let c = sharpFrom; c <= sharpTo; c++) {
      const i = (r * ARC_COLUMNS + c) * 3;
      if (Number.isNaN(strip[i])) continue;

      // The flute's own shape is what is left after taking away the surface it
      // sits on, so the local level is measured over exactly one pitch — wide
      // enough to average the flute away, narrow enough to follow the cap.
      const local = [0, 0, 0];
      let n = 0;
      for (let d = -half; d <= half; d++) {
        const j = ((r * ARC_COLUMNS + c + d) * 3) | 0;
        if (c + d < 0 || c + d >= ARC_COLUMNS || Number.isNaN(strip[j])) continue;
        for (let ch = 0; ch < 3; ch++) local[ch] += strip[j + ch];
        n += 1;
      }
      if (!n) continue;

      const phase = (((c - centreColumn) / pitchColumns) % 1 + 1) % 1;
      const slot = phase * FLUTE_PIXELS;
      const s0 = Math.floor(slot) % FLUTE_PIXELS;
      const s1 = (s0 + 1) % FLUTE_PIXELS;
      const f = slot - Math.floor(slot);

      /**
       * How much this column's flute is worth.
       *
       * A degree of azimuth is worth `R·sin θ` pixels of photograph, so a flute
       * out at the edge of the arc is carried by fewer source pixels than one
       * dead ahead, and comes off softer. Averaging them flat lets the soft ones
       * blunt the sharp ones; weighting by the square of that resolution keeps
       * the groove as crisp as the best of them while still averaging away
       * thirty flutes' worth of noise.
       */
      const theta = Math.PI / 2 + (c - centreColumn) * degreesPerColumn * (Math.PI / 180);
      const sharpness = Math.sin(theta) ** 2;

      for (const [slotIndex, w] of [
        [s0, (1 - f) * sharpness],
        [s1, f * sharpness],
      ] as const) {
        const o = (r * FLUTE_PIXELS + slotIndex) * 3;
        for (let ch = 0; ch < 3; ch++) detail[o + ch] += (strip[i + ch] - local[ch] / n) * w;
        weight[r * FLUTE_PIXELS + slotIndex] += w;
      }

      if (Math.abs(c - centreColumn) <= deadOn) {
        sharpSquares += ((strip[i] - local[0] / n) ** 2 + (strip[i + 2] - local[2] / n) ** 2) / 2;
        sharpCount += 1;
      }
    }
  }

  /**
   * Give the folded flute back the depth the folding cost it.
   *
   * Averaging thirty flutes is what kills the noise, but flutes are not measured
   * equally well across the arc and even the weighting cannot make a soft one
   * sharp — so the mean groove comes out shallower than any single well-resolved
   * one. Measured against the columns facing the camera squarely, the loss is
   * about a third, and against the product photograph the flat result was half
   * the contrast of the real cap.
   *
   * This scales the averaged flute back to the depth the sharpest photographed
   * flutes actually have. It is a restoration, not an invention: the number
   * comes out of the same photograph, and it is capped so a bad fold cannot turn
   * into a cartoon.
   */
  {
    let foldedSquares = 0;
    let foldedCount = 0;
    for (let r = 0; r < WRAP_HEIGHT; r++) {
      for (let slot = 0; slot < FLUTE_PIXELS; slot++) {
        const w = weight[r * FLUTE_PIXELS + slot];
        if (!(w > 0)) continue;
        const o = (r * FLUTE_PIXELS + slot) * 3;
        foldedSquares += ((detail[o] / w) ** 2 + (detail[o + 2] / w) ** 2) / 2;
        foldedCount += 1;
      }
    }
    const sharp = Math.sqrt(sharpSquares / Math.max(1, sharpCount));
    const folded = Math.sqrt(foldedSquares / Math.max(1, foldedCount));
    const gain = folded > 0.01 ? Math.max(1, Math.min(2, sharp / folded)) : 1;
    for (let i = 0; i < detail.length; i++) detail[i] *= gain;
    console.log(`  · grooves restored to their photographed depth (×${gain.toFixed(2)})`);
  }

  for (let r = 0; r < WRAP_HEIGHT; r++) {
    for (let x = 0; x < WRAP_WIDTH; x++) {
      const slot = x % FLUTE_PIXELS;
      const w = weight[r * FLUTE_PIXELS + slot];
      const o = (r * WRAP_WIDTH + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const d = w > 0 ? detail[(r * FLUTE_PIXELS + slot) * 3 + ch] / w : 0;
        wrap[o + ch] = Math.max(0, Math.min(255, Math.round(structure[r * 3 + ch] + d)));
      }
      wrap[o + 3] = 255;
    }
  }

  const folded = Math.round((sharpTo - sharpFrom) / pitchColumns);
  console.log(`  · folded ${folded} flutes into one, tiled ${flutes}× into ${WRAP_WIDTH}x${WRAP_HEIGHT}`);
}

await sharp(wrap, { raw: { width: WRAP_WIDTH, height: WRAP_HEIGHT, channels: 4 } })
  .webp({ quality: 94 })
  .toFile(resolve(OUT, "cap-wrap.webp"));

/* ------------------------------------------------------------------- inside */

/**
 * The mouth's inner radius.
 *
 * The lip has a real thickness, so the interior starts inside the silhouette.
 * Its inner edge is another circle in the same plane, so it draws another
 * ellipse — and the same fit, run over where the lip's lit face gives way to the
 * shaded wall, returns its semi-minor axis. Dividing by sin φ, already known,
 * turns that straight into a radius.
 *
 * The edge is found by brightness rather than by a gradient peak: the lip face
 * catches the light square on and the wall behind it does not, so walking up
 * from the bottom until the column falls to two thirds of the lip's own
 * brightness lands on the step every time. Hunting for the darkest pixel instead
 * walks right past it into the shadowed wall.
 */
function fitInnerRim() {
  const edges: { dx: number; y: number }[] = [];
  for (let x = 0; x < img.width; x++) {
    const dx = x - cx;
    // Only the middle of the arc: out at the sides the lip is edge-on and there
    // is no face to measure.
    if (Math.abs(dx) > outerRadius * 0.55) continue;

    let bottom = -1;
    for (let y = img.height - 1; y >= 0; y--) {
      if (img.data[at(img, x, y) + 3] > 140) {
        bottom = y;
        break;
      }
    }
    if (bottom < 4) continue;

    const lumAt = (y: number) => {
      const i = at(img, x, y);
      return (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    };

    let peak = 0;
    for (let y = bottom; y > bottom - 12 && y >= 0; y--) peak = Math.max(peak, lumAt(y));

    let edge = -1;
    for (let y = bottom - 2; y > bottom - outerRadius * 0.12 && y >= 0; y--) {
      if (lumAt(y) < peak * 0.67) {
        edge = y;
        break;
      }
    }
    if (edge < 0) continue;
    edges.push({ dx, y: edge });
  }

  if (edges.length < 32) return outerRadius * 0.93;

  /**
   * Only the squash is solved for here, not the whole ellipse again.
   *
   * The inner edge is a circle in the *same* plane as the outer one, so it
   * shares the rim's centre and the rim's tilt — and over the middle half of the
   * arc, where the lip has a face to measure at all, the squash term only varies
   * by a sixth. Letting the centre float against that is ill-conditioned enough
   * that it trades a real radius away for a fraction of a pixel of fit, which is
   * exactly what it did: a wall measured at 95% of the outer radius came back
   * pinned to the safety clamp at 86%.
   *
   * The median rather than the mean, because a few columns catch a highlight on
   * the thread behind the lip and read the step early.
   */
  const radius = outerRadius * 0.93;
  const estimates = edges
    .filter((e) => Math.abs(e.dx) < radius * 0.9)
    .map((e) => {
      const drop = rim.centreY + rim.tilt * e.dx - e.y;
      const sinTheta = Math.sqrt(1 - (e.dx / radius) ** 2);
      return -drop / (sinPhi * sinTheta);
    })
    .sort((a, b) => a - b);

  const median = estimates[Math.floor(estimates.length / 2)];
  return Math.max(0.86, Math.min(0.98, median / outerRadius)) * outerRadius;
}

const innerR = fitInnerRim();
console.log(`  · inner wall sits at ${((innerR / outerRadius) * 100).toFixed(1)}% of the outer radius`);

/**
 * How deep into the cap the near lip lets us see.
 *
 * A point on the far wall is hidden once it rises above the near lip's own
 * projected height. Setting those equal gives `w < 2·R·sin|θ|·tan φ`, which at
 * the deepest — dead centre, where sin|θ| is 1 — is `2·R·tan φ`.
 */
const visibleDepth = 0.84 * 2 * innerR * Math.tan(rim.phi);

/**
 * How deep the cavity is.
 *
 * Not measurable from outside: what the photograph gives is the cap's overall
 * height, and the closed end has a wall thickness and a liner behind it. A
 * cavity of 86% of the shell is what this closure measures out to, and the
 * number only decides where the ramp's last sample lands.
 */
const CAVITY = 0.86;
const cavityDepth = height * CAVITY;

const reach = Math.min(1, visibleDepth / cavityDepth);
console.log(
  reach >= 1
    ? `  · the whole cavity is in view; only the ceiling is hidden`
    : `  · the near lip hides the last ${((1 - reach) * 100).toFixed(0)}% of the cavity`,
);

/**
 * Read the inside as colour against depth.
 *
 * At each depth, samples are taken across the arc of far wall that is still in
 * view and averaged. Averaging is the point: it cancels the one-sided key light,
 * which is the only thing that varies with azimuth on a threaded wall.
 */
const ramp = Buffer.alloc(INNER_WIDTH * INNER_STEPS * 4);
const lastSeen: [number, number, number] = [0, 0, 0];

for (let step = 0; step < INNER_STEPS; step++) {
  // Row 0 is the ceiling, the last row is the rim.
  const depth = (1 - step / (INNER_STEPS - 1)) * cavityDepth;

  let sum = [0, 0, 0];
  let n = 0;
  // θ = −π/2 is the far wall dead ahead; sample either side of it.
  for (let d = -55; d <= 55; d += 1) {
    const theta = -Math.PI / 2 + (d * Math.PI) / 180;
    const sinT = Math.sin(theta);
    // Hidden behind the near lip at this azimuth. The last sixth is dropped as
    // well: right at the limit the wall is grazing, and one output pixel there
    // is fed by a smear of the whole thread pitch.
    if (depth >= 0.84 * 2 * innerR * Math.abs(sinT) * Math.tan(rim.phi)) continue;

    const dx = innerR * Math.cos(theta);
    const x = cx + dx;
    const y = rim.centreY + rim.tilt * dx - (depth * cosPhi + innerR * sinT * sinPhi);
    const rgb = sample(img, x, y);
    if (!rgb) continue;
    sum = [sum[0] + rgb[0], sum[1] + rgb[1], sum[2] + rgb[2]];
    n += 1;
  }

  let rgb: [number, number, number];
  if (n >= 8) {
    rgb = [sum[0] / n, sum[1] / n, sum[2] / n];
    lastSeen[0] = rgb[0];
    lastSeen[1] = rgb[1];
    lastSeen[2] = rgb[2];
  } else {
    // Past what the camera could see. Hold the deepest real reading rather than
    // fading to a colour nothing measured.
    rgb = [lastSeen[0], lastSeen[1], lastSeen[2]];
  }

  /**
   * How much light gets this far into the cavity.
   *
   * The one thing the photograph genuinely cannot tell us. It was taken of a cap
   * lying open, mouth toward the room, so its inside is about as bright as its
   * outside — and rendered at that level the lifted lid came out *brighter*
   * inside than the lit brass around it. Which is backwards, and read as a curl
   * of card rather than as a cap with a cavity: with no shadow anywhere, there
   * was nothing to say the surface had gone round a corner.
   *
   * So light falls off with depth, from full at the rim to a little over half at
   * the ceiling. Not measured, and not pretending to be — it is the contact
   * shading a flat photograph of a lit interior cannot carry, and the depth axis
   * is the only axis it can vary along on a surface this symmetric.
   */
  const reached = 1 - 0.44 * (depth / cavityDepth) ** 0.75;
  const shaded = rgb.map((v) => Math.round(Math.max(0, Math.min(255, v * reached))));

  for (let x = 0; x < INNER_WIDTH; x++) {
    const o = (step * INNER_WIDTH + x) * 4;
    ramp[o] = shaded[0];
    ramp[o + 1] = shaded[1];
    ramp[o + 2] = shaded[2];
    ramp[o + 3] = 255;
  }
}

// Smooth the ramp down its length. Individual thread rings are finer than the
// model will ever resolve, and leaving them in only aliases.
{
  const copy = Buffer.from(ramp);
  for (let step = 1; step < INNER_STEPS - 1; step++) {
    for (let c = 0; c < 3; c++) {
      const a = copy[((step - 1) * INNER_WIDTH) * 4 + c];
      const b = copy[(step * INNER_WIDTH) * 4 + c];
      const d = copy[((step + 1) * INNER_WIDTH) * 4 + c];
      const v = Math.round((a + b * 2 + d) / 4);
      for (let x = 0; x < INNER_WIDTH; x++) ramp[(step * INNER_WIDTH + x) * 4 + c] = v;
    }
  }
}

await sharp(ramp, { raw: { width: INNER_WIDTH, height: INNER_STEPS, channels: 4 } })
  .webp({ quality: 95 })
  .toFile(resolve(OUT, "cap-inner.webp"));

/**
 * The ceiling gets no entry of its own.
 *
 * It is genuinely not in the photograph — from 13° above the rim there is no
 * line of sight to it — and the model does not need one invented. The disc that
 * closes the cavity wears the deepest row of this ramp, which is the wall colour
 * right beside it, and the shader's own falloff takes it down from there: seen
 * from below, which is the only way it is ever seen, that face is close to
 * edge-on and darkens on its own. A view-dependent guess beats a baked one.
 */
const cap = {
  /** Cap height ÷ diameter, as photographed. */
  aspect: Number(aspect.toFixed(4)),
  /**
   * How much the cap tapers from its top to the flange at the rim, as a
   * fraction. Small — this closure is very nearly a cylinder — and recorded so
   * the model's own cap silhouette, which comes from a far smaller photograph,
   * can be sanity-checked against it.
   */
  taper: Number((1 - radii[RADIUS_STEPS] / radii[0]).toFixed(4)),
  /** Inner wall radius, as a fraction of the cap's widest. */
  innerRadius: Number((innerR / outerRadius).toFixed(4)),
  /** Cavity depth, as a fraction of the cap's height. */
  cavity: CAVITY,
  /** How much of that cavity the photograph actually saw. */
  measuredDepth: Number(reach.toFixed(3)),
  /** Flutes round the knurling. */
  flutes,
  /** Camera elevation above the rim plane, in degrees. */
  cameraDeg: Number(((rim.phi * 180) / Math.PI).toFixed(2)),
};

writeFileSync(resolve(OUT, "cap.json"), `${JSON.stringify(cap, null, 2)}\n`);

console.log(`\n  Wrote cap-wrap.webp, cap-inner.webp and cap.json\n`);
