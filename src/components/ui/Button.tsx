import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-[var(--accent-primary-border)] bg-[var(--accent-primary)] text-[var(--text-inverse)] shadow-[0_1px_0_rgb(255_255_255_/_0.16)_inset] hover:border-[var(--accent-primary-hover)] hover:bg-[var(--accent-primary-hover)] active:bg-[var(--accent-primary-active)]",
        secondary:
          "border-[var(--border-default)] bg-[var(--surface-3)] text-[var(--text-primary)] shadow-[0_1px_0_rgb(255_255_255_/_0.06)_inset] hover:border-[var(--border-strong)] hover:bg-[var(--surface-4)]",
        outline:
          "border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-1)_42%,transparent)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
        ghost:
          "border-transparent bg-transparent text-[var(--text-tertiary)] hover:bg-[rgb(255_255_255_/_0.045)] hover:text-[var(--text-primary)] active:bg-[rgb(255_255_255_/_0.06)]",
        link: "border-transparent bg-transparent px-0 text-[var(--accent-secondary)] underline-offset-4 hover:text-[var(--accent-secondary-hover)] hover:underline",
        destructive:
          "border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)] hover:border-[var(--danger)]/45 hover:bg-[rgb(222_102_102_/_0.18)]",
      },
      size: {
        default: "h-9 px-3.5 text-sm rounded-[var(--radius-sm)]",
        sm: "h-8 px-3 text-xs rounded-[var(--radius-sm)]",
        lg: "h-10 px-4 text-sm rounded-[var(--radius-sm)]",
        icon: "h-9 w-9 rounded-[var(--radius-sm)]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
