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
          toast: "!rounded-md !border !border-border !bg-popover !text-popover-foreground !shadow-none",
          title: "!text-[11px] !font-semibold !uppercase !tracking-[.1em]",
          actionButton: "!rounded !bg-primary !text-primary-foreground !text-[11px] !font-medium",
        },
      }}
      style={
        {
          // Wider than the 356px default so the letterspaced title and the
          // "View bag" action sit on one line.
          "--width": "25rem",
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
