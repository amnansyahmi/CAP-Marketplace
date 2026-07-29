/**
 * Checkout input validation, shared by the browser form and the order API so
 * both apply exactly the same rules. The server always re-runs this — client
 * validation is only there to give fast feedback.
 */

import { isMalaysianState } from "@/lib/shipping";

export type CheckoutInput = {
  fullName: string;
  email: string;
  phone: string;
  line1: string;
  line2?: string;
  postcode: string;
  city: string;
  state: string;
  notes?: string;
  /** Optional voucher. Validated and redeemed server-side, never trusted here. */
  discountCode?: string;
  items: { productId: string; quantity: number }[];
};

export type FieldErrors = Partial<Record<keyof CheckoutInput | "items", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Malaysian mobile/landline, tolerating +60, spaces and dashes. */
const PHONE = /^(\+?60|0)[\s-]?\d{1,2}[\s-]?\d{3,4}[\s-]?\d{4}$/;
const POSTCODE = /^\d{5}$/;

export function validateCheckout(input: Partial<CheckoutInput>): FieldErrors {
  const errors: FieldErrors = {};
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  if (text(input.fullName).length < 2) errors.fullName = "Please enter your full name.";
  if (!EMAIL.test(text(input.email))) errors.email = "Please enter a valid email address.";
  if (!PHONE.test(text(input.phone).replace(/\s+/g, " "))) errors.phone = "Please enter a valid Malaysian phone number.";
  if (text(input.line1).length < 4) errors.line1 = "Please enter your street address.";
  if (!POSTCODE.test(text(input.postcode))) errors.postcode = "Postcode must be 5 digits.";
  if (text(input.city).length < 2) errors.city = "Please enter your city or town.";
  if (!isMalaysianState(text(input.state))) errors.state = "Please choose a state.";

  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) errors.items = "Your bag is empty.";
  else if (items.some((i) => !i?.productId || !Number.isFinite(i.quantity) || i.quantity < 1)) {
    errors.items = "Your bag contains an invalid item.";
  }

  return errors;
}

export const hasErrors = (errors: FieldErrors) => Object.keys(errors).length > 0;
