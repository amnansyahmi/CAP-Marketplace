/**
 * Working out what is actually going in the box.
 *
 * Couriers price on the packed parcel, not the product. A 350g jar does not
 * ship as 350g: there is a box, there is padding, and glass needs enough of
 * both to survive Pos Laju. Quoting the bare product weight would under-buy
 * postage and leave the shop paying the difference on every order.
 *
 * Volumetric weight matters too. Six jars are light for their size, and every
 * Malaysian courier charges the greater of actual and volumetric weight, so a
 * quote based on actual weight alone would be short.
 *
 * The numbers below are deliberately conservative estimates rather than
 * measurements. Once the shop has weighed a real packed box, replace them —
 * they are in one place for exactly that reason.
 */

import { productById } from "@/lib/products";
import type { Parcel } from "@/lib/easyparcel";

/** Packaging that goes in every box regardless of how many jars. */
const BOX_TARE_GRAMS = 250;

/** Padding per jar — glass needs wrapping, not just a gap. */
const PADDING_PER_JAR_GRAMS = 60;

/**
 * Divisor Malaysian couriers use for volumetric weight: cm³ / 6000 = kg.
 * Standard across J&T, Pos Laju and DHL domestic.
 */
const VOLUMETRIC_DIVISOR = 6000;

/** A jar's footprint in the box, including its share of padding. */
const JAR_DIAMETER_CM = 9;
const JAR_HEIGHT_CM = 12;

export type ParcelLine = { productId: string; quantity: number };

/**
 * Box sizes the shop actually keeps, smallest first.
 *
 * Picking from a real list rather than computing an arbitrary cuboid: the
 * quote should describe a box that exists, otherwise the courier's own
 * measurement at collection will not match what was paid for.
 */
const BOXES = [
  { maxJars: 2, widthCm: 20, lengthCm: 14, heightCm: 14 },
  { maxJars: 4, widthCm: 24, lengthCm: 20, heightCm: 14 },
  { maxJars: 6, widthCm: 30, lengthCm: 22, heightCm: 15 },
  { maxJars: 12, widthCm: 36, lengthCm: 28, heightCm: 16 },
] as const;

function boxFor(jars: number) {
  return BOXES.find((box) => jars <= box.maxJars) ?? BOXES[BOXES.length - 1];
}

/** Total jars in an order, ignoring anything not in the catalogue. */
export function totalJars(lines: ParcelLine[]): number {
  return lines.reduce((sum, line) => {
    const product = productById(line.productId);
    if (!product) return sum;
    return sum + Math.max(0, Math.floor(line.quantity));
  }, 0);
}

/**
 * The parcel to quote and book, for a given bag.
 *
 * Charges on the greater of actual and volumetric weight, the way the courier
 * will.
 */
export function parcelFor(lines: ParcelLine[]): Parcel {
  const jars = Math.max(1, totalJars(lines));

  const goodsGrams = lines.reduce((sum, line) => {
    const product = productById(line.productId);
    if (!product) return sum;
    return sum + product.weightGrams * Math.max(0, Math.floor(line.quantity));
  }, 0);

  const actualGrams = goodsGrams + BOX_TARE_GRAMS + PADDING_PER_JAR_GRAMS * jars;

  // More than one layer of jars once the base is full.
  const box = boxFor(jars);
  const perLayer = Math.max(1, Math.floor((box.widthCm * box.lengthCm) / (JAR_DIAMETER_CM * JAR_DIAMETER_CM)));
  const layers = Math.max(1, Math.ceil(jars / perLayer));
  const heightCm = Math.max(box.heightCm, layers * JAR_HEIGHT_CM + 3);

  const volumetricKg = (box.widthCm * box.lengthCm * heightCm) / VOLUMETRIC_DIVISOR;
  const actualKg = actualGrams / 1000;

  return {
    // Couriers bill on whichever is larger, and round up to the next 100g.
    weightKg: Math.ceil(Math.max(actualKg, volumetricKg) * 10) / 10,
    widthCm: box.widthCm,
    lengthCm: box.lengthCm,
    heightCm,
  };
}

/** What goes on the consignment note. Couriers require a description. */
export function parcelContents(lines: ParcelLine[]): string {
  const jars = totalJars(lines);
  return `${jars} × 350g cooking paste (food, non-hazardous)`;
}
