import { redirect } from "next/navigation";

/**
 * Stock moved in with price, because they are set together.
 *
 * Kept as a redirect rather than deleted: the admin nav, the reports page and
 * the shop owner's own bookmarks all pointed here.
 */
export default function StockPage() {
  redirect("/admin/products");
}
