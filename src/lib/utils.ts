import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function money(value: number) { return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value); }
