/**
 * The hosted order form the "Shop now" webview opens.
 *
 * The form lives on bcl.my rather than on a page we own, so the address is
 * configuration instead of a literal buried in a component: publishing a new
 * form version is an environment variable change, not a deploy of new code.
 *
 * `NEXT_PUBLIC_` because the value is read in the browser, where the iframe is
 * created. It is a public address either way — nothing secret belongs here.
 */
export const SHOP_NOW_URL =
  process.env.NEXT_PUBLIC_SHOP_NOW_URL?.trim() || "https://chefammar.bcl.my/form/marketplace-v5";
