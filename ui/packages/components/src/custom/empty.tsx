/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { cva, type VariantProps } from "class-variance-authority"
import { useObjectTranslation } from "@object-ui/i18n"

import { cn } from "../lib/utils"

function useEmptyValueLabel(): string {
  // useObjectTranslation is provider-safe (never throws); no try/catch, which
  // would wrap the hook call and violate rules-of-hooks. The "No value"
  // fallback still applies when the key is missing/untranslated.
  const { t } = useObjectTranslation()
  const v = t("detail.noValue")
  return !v || v === "detail.noValue" ? "No value" : v
}

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        // Padding is 24px, and 48px from `md` up, carried by a custom property
        // so that the ONE utility writing `padding` is unprefixed. A caller's
        // plain `px-3 py-8` / `py-10` / `p-4` then wins at every viewport,
        // which is what a `className` override reads as. The literal `md:p-12`
        // that stood here was a different tailwind-merge variant from any
        // unprefixed override, so `cn()` kept it and it won the cascade from
        // 768px up: three app-shell sites that wrote "less padding" got the
        // full 48px back on every desktop viewport (objectui#8525).
        //
        // No border utility. The `border-dashed` that stood here set only
        // `border-style`; preflight keeps `border-width` at 0 and no call site
        // or ancestor supplies one, so it drew nothing at any of the 44 sites
        // (measured on the console build). A dashed frame, if ever wanted, is
        // a deliberate `border border-dashed` pair with its own card — never a
        // width slipped into a cleanup.
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg p-(--empty-padding) [--empty-padding:--spacing(6)] md:[--empty-padding:--spacing(12)] text-center text-balance",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn(
        "flex max-w-sm flex-col items-center gap-2 text-center",
        className
      )}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "flex shrink-0 items-center justify-center mb-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn("text-lg font-medium tracking-tight", className)}
      {...props}
    />
  )
}

// `"div"`, because a `div` is what ships below. Upstream shadcn spells this
// `React.ComponentProps<"p">` over the same `div` — the type promised a
// paragraph the DOM never delivered (objectui#8571). The element itself is
// deliberate: a `p` cannot hold block content, so making this a real
// paragraph is a rendered-output change at every call site and its own card.
function EmptyDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance",
        className
      )}
      {...props}
    />
  )
}

/**
 * EmptyValue — universal inline placeholder for missing cell/field values.
 *
 * Use this anywhere a renderer would otherwise show "-" or "—" for a null,
 * undefined or empty value. It renders a muted, non-interactive EM-dash (the
 * `glyph` default below is U+2014, and every call site depends on that width)
 * that does not inherit link/button colors from surrounding ancestors, so a
 * missing value never looks clickable. This sentence said "en-dash" until
 * objectui#8506: the word was wrong, never the code — do not "fix" the glyph
 * to match a stale docblock.
 *
 * ⚠️ A caller that passes a `title` through `...props` must also pass
 * `pointer-events-auto` in `className`. `pointer-events-none` below stops this
 * span being a hit target, so a `title` on it never renders a tooltip — the
 * hover falls through to whichever ancestor has one. The attribute stays in the
 * DOM either way, which is exactly why nothing catches it: a test that reads
 * `getAttribute('title')` is green over a tooltip that can never appear
 * (objectui#8506, where `DetailSection` kept such a `title` and two landed pins
 * navigate by it).
 */
function EmptyValue({
  className,
  glyph = "—",
  ...props
}: React.ComponentProps<"span"> & { glyph?: string }) {
  const ariaLabel = useEmptyValueLabel()
  return (
    <span
      data-slot="empty-value"
      aria-label={ariaLabel}
      className={cn(
        "select-none text-muted-foreground/50 no-underline pointer-events-none",
        className
      )}
      {...props}
    >
      {glyph}
    </span>
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
  EmptyValue,
}
