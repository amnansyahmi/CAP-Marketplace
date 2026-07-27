import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/lib/cart-context";
import { HelpBotMount } from "@/components/help-bot-mount";
import { Toaster } from "@/components/ui/sonner";

const serif = Cormorant_Garamond({ subsets: ["latin"], variable: "--font-serif", weight: ["500", "600"] });
const sans = Manrope({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Chef Ammar Product", template: "%s · Chef Ammar Product" },
  description: "Arabian cooking pastes made for generous tables. Kabsah, Mandy and Briyani, delivered across Malaysia.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${serif.variable} ${sans.variable}`}>
        <CartProvider>
          {children}
          <HelpBotMount />
          <Toaster />
        </CartProvider>
      </body>
    </html>
  );
}
