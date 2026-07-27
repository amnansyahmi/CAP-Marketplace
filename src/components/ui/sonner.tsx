"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      position="bottom-left"
      toastOptions={{
        classNames: {
          toast: "!rounded-none !border !border-border !bg-popover !text-popover-foreground !shadow-none",
          title: "!text-[11px] !font-semibold !uppercase !tracking-[.16em]",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
