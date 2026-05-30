import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-1)_42%,transparent)] p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative rounded-[var(--radius-sm)] px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.13em]",
      "text-[var(--text-tertiary)] transition-[background-color,color,box-shadow] duration-150",
      "hover:bg-[rgb(255_255_255_/_0.035)] hover:text-[var(--text-primary)]",
      "data-[state=active]:bg-[var(--accent-primary-soft)] data-[state=active]:text-[var(--accent-primary-hover)]",
      "data-[state=active]:shadow-[0_0_0_1px_var(--accent-primary-border)_inset]",
      "focus-visible:outline-none",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
