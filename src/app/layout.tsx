import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/lib/cart-context";
import { LiveCatalogueProvider } from "@/lib/live-catalogue";
import { Toaster } from "@/components/ui/sonner";

const serif = Cormorant_Garamond({ subsets: ["latin"], variable: "--font-serif", weight: ["500", "600"] });
const sans = Manrope({ subsets: ["latin"], variable: "--font-sans" });

const DESCRIPTION =
  "Arabian cooking pastes made for generous tables. Kabsah, Mandy and Briyani, delivered across Malaysia.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Chef Ammar Product", template: "%s · Chef Ammar Product" },
  description: DESCRIPTION,
  // Defaults every page inherits, so a link shared from anywhere on the shop
  // shows something better than a bare URL. Individual pages override the parts
  // they need.
  openGraph: {
    type: "website",
    siteName: "Chef Ammar Product",
    locale: "en_MY",
    title: "Chef Ammar Product",
    description: DESCRIPTION,
    images: ["/products/kabsah.webp"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Chef Ammar Product",
    description: DESCRIPTION,
    images: ["/products/kabsah.webp"],
  },
  alternates: { canonical: "/" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${serif.variable} ${sans.variable}`}>
        {/* Outside the cart on purpose: the bag's subtotal is priced from the
            live catalogue, so the prices have to be available to it. */}
        <LiveCatalogueProvider>
          <CartProvider>
            {children}
            <Toaster />
          </CartProvider>
        </LiveCatalogueProvider>
      </body>
    </html>
  );
}
