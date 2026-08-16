/**
 * Live stock for the storefront.
 *
 * The fetch now lives in `LiveCatalogueProvider`, which reads stock and prices
 * together in one request from the root of the app — several components asking
 * the same question was several requests for one answer. This re-export keeps
 * the call sites that only care about stock reading the way they did.
 */

export { useAvailability } from "@/lib/live-catalogue";

export type Availability = { available: number | null; soldOut: boolean };
