/*
 * Authently — Open-source AI content engine
 * Copyright (C) 2026 The Authently Contributors
 *
 * This file is part of Authently.
 *
 * Authently is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// shadcn/ui Button — customized for Authently. DESIGN.md §4 mandates
// full-pill radius (9999px) for primary, ghost, and brand buttons and a
// brand-green focus ring. The `link` variant keeps the small rounded-md
// shape for transparent nav items.

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-[15px] font-medium leading-tight transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary CTA — dark pill, near-black on white. Mintlify "Get Started".
        default:
          "rounded-full bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:opacity-90",
        // Ghost / secondary — white pill with subtle border.
        ghost:
          "rounded-full border border-input bg-background text-foreground hover:opacity-90",
        // Brand accent — promotional CTA. Use sparingly.
        brand:
          "rounded-full bg-brand text-brand-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:opacity-90",
        // Destructive — pill-shaped to match the rest of the system.
        destructive:
          "rounded-full bg-destructive text-destructive-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:opacity-90",
        // Transparent nav button — small rounded-md, hover shifts to brand.
        link:
          "rounded-md bg-transparent text-foreground hover:text-brand",
      },
      size: {
        // Mintlify primary: ~8px / 24px padding, line-height kept tight.
        default: "h-10 px-6",
        sm: "h-8 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
