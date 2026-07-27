import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", { variants:{ variant:{ default:"bg-foreground text-background hover:bg-foreground/88", outline:"border border-border bg-transparent hover:bg-muted", ghost:"hover:bg-muted", warm:"bg-[#9b3d29] text-white hover:bg-[#81311f]" }, size:{ default:"h-11 px-5", sm:"h-9 px-3", lg:"h-13 px-7 text-base", icon:"size-11" } }, defaultVariants:{ variant:"default", size:"default" } });
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export function Button({ className, variant, size, asChild=false, ...props }:ButtonProps){ const Comp=asChild?Slot:"button"; return <Comp className={cn(buttonVariants({variant,size,className}))} {...props}/> }
