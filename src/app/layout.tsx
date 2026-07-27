import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
const serif=Cormorant_Garamond({subsets:["latin"],variable:"--font-serif",weight:["500","600"]});
const sans=Manrope({subsets:["latin"],variable:"--font-sans"});
export const metadata:Metadata={title:"Chef Ammar Pantry",description:"Arabian cooking pastes made for generous tables."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body className={`${serif.variable} ${sans.variable}`}>{children}<Toaster/></body></html>}
