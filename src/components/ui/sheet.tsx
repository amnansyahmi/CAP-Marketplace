"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export const Sheet=Dialog.Root; export const SheetTrigger=Dialog.Trigger; export const SheetClose=Dialog.Close;
export function SheetContent({ className, children, ...props }:React.ComponentProps<typeof Dialog.Content>){ return <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] data-[state=open]:animate-in"/><Dialog.Content className={cn("fixed inset-y-0 right-0 z-50 w-full max-w-md border-l bg-background p-0 shadow-2xl outline-none",className)} {...props}>{children}<Dialog.Close className="absolute right-5 top-5 grid size-9 place-items-center border border-border bg-background"><X className="size-4"/><span className="sr-only">Close</span></Dialog.Close></Dialog.Content></Dialog.Portal> }
export function SheetHeader({className,...props}:React.HTMLAttributes<HTMLDivElement>){return <div className={cn("space-y-2",className)} {...props}/>}
export function SheetTitle({className,...props}:React.ComponentProps<typeof Dialog.Title>){return <Dialog.Title className={cn("font-serif text-2xl",className)} {...props}/>}
export function SheetDescription({className,...props}:React.ComponentProps<typeof Dialog.Description>){return <Dialog.Description className={cn("text-sm text-muted-foreground",className)} {...props}/>}
