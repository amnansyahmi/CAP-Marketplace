/**
 * Who the shop legally is.
 *
 * Policy pages are only worth having if they are true, and a policy that names
 * the wrong entity or an address nobody reads is worse than none — it is a
 * promise the business cannot keep. So none of this is invented: every value
 * comes from the environment, and anything unset is reported as missing rather
 * than filled with a plausible-looking placeholder.
 *
 * The admin shows what is still missing, because a payment gateway will ask for
 * these during merchant verification and a shop that discovers the gap at that
 * point has already lost a week.
 */

export type ShopDetails = {
  tradingName: string;
  /** Registered entity, when it differs from the trading name. */
  legalName?: string;
  /** SSM registration number for a Malaysian business. */
  registrationNumber?: string;
  supportEmail?: string;
  supportPhone?: string;
  /** Where post can actually reach the business. */
  addressLines: string[];
  whatsapp?: string;
  instagram?: string;
};

const list = (value: string | undefined) =>
  (value ?? "")
    .split("|")
    .map((line) => line.trim())
    .filter(Boolean);

export function shopDetails(): ShopDetails {
  return {
    // The one value with a sensible default — it is the brand, not a legal fact.
    tradingName: process.env.NEXT_PUBLIC_SHOP_NAME || "Chef Ammar Product",
    legalName: process.env.NEXT_PUBLIC_SHOP_LEGAL_NAME || undefined,
    registrationNumber: process.env.NEXT_PUBLIC_SHOP_REGISTRATION || undefined,
    supportEmail: process.env.NEXT_PUBLIC_SHOP_EMAIL || undefined,
    supportPhone: process.env.NEXT_PUBLIC_SHOP_PHONE || undefined,
    // Pipe-separated, because an address is several lines and environment
    // variables are one.
    addressLines: list(process.env.NEXT_PUBLIC_SHOP_ADDRESS),
    whatsapp: process.env.NEXT_PUBLIC_SHOP_WHATSAPP || undefined,
    instagram: process.env.NEXT_PUBLIC_SHOP_INSTAGRAM || undefined,
  };
}

/** What a payment gateway will expect to see before it approves a merchant. */
export function missingShopDetails(details = shopDetails()): string[] {
  const missing: string[] = [];
  if (!details.legalName) missing.push("registered business name");
  if (!details.registrationNumber) missing.push("SSM registration number");
  if (!details.supportEmail) missing.push("support email");
  if (!details.supportPhone) missing.push("support phone");
  if (details.addressLines.length === 0) missing.push("business address");
  return missing;
}

/** A WhatsApp link, when a number is configured. */
export function whatsappLink(details = shopDetails()): string | undefined {
  if (!details.whatsapp) return undefined;
  const digits = details.whatsapp.replace(/[^\d]/g, "");
  return digits ? `https://wa.me/${digits}` : undefined;
}
