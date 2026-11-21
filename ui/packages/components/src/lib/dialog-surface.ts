/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The look every modal dialog shares (objectstack-ai/objectstack#35980): the
 * overlay behind it and the card it draws. `Dialog`, `AlertDialog` and the
 * form dialog's `MobileDialogContent` each append these to their own class
 * list, so a confirmation, a required-fields prompt and a create form are one
 * surface. A call site's `className` still comes last and wins.
 *
 * The two Shadcn primitives reach this file through one declared import and
 * one class token each (`scripts/shadcn-local-patches.mjs`); the look itself
 * lives here, outside the regenerated `src/ui/**`.
 *
 * Until #35980 the console drew this look with global rules on every
 * `[role="dialog"]`: a forced 20px corner, a 35% overlay with a blur behind
 * it, and the page's own grey for the card. Those rules are gone; the dialog
 * carries its look with it.
 */

/**
 * The overlay: a faint dim that says the page behind is out of reach for now,
 * and no blur, so the page stays readable. Dark mode dims more, because ten
 * per cent black on a near-black page is no change at all.
 */
export const DIALOG_OVERLAY_SURFACE = 'bg-black/10 dark:bg-black/40';

/**
 * The 40px → 32px step for controls inside a dialog, from `sm` up: anything
 * drawn at the shared 40px control height (`h-10`: the input, the select
 * trigger, the default and icon buttons) draws at 32px. The phone sheet keeps
 * its 44px touch targets, which ride their own `max-sm:` classes.
 */
export const DIALOG_COMPACT_CONTROLS = 'sm:[&_.h-10]:h-8 sm:[&_.h-10]:py-1 sm:[&_.h-10.w-10]:w-8';

/**
 * The card, in two layers:
 *
 * - the INNER card is the element itself: the theme's card colour (white in
 *   light mode; the raised grey in dark, not the page's own background), a
 *   hairline edge and a 12px corner;
 * - the OUTER ring is a 3px translucent band drawn as the first shadow, so it
 *   sits outside the card and is never clipped by a dialog that hides its
 *   own overflow (the form dialog scrolls its body inside). With the card's
 *   12px corner, the band's outer corner is 15px. Three soft, wide shadows
 *   follow it.
 *
 * Controls inside it take {@link DIALOG_COMPACT_CONTROLS}.
 *
 * `dialog-surface` is a marker, not a utility: the console's shared shadow
 * for floating surfaces (menus, popovers, drawers) skips an element that
 * carries it, because this card draws its own.
 */
export const DIALOG_CONTENT_SURFACE = [
  'dialog-surface',
  'bg-card text-card-foreground',
  'border-black/[0.07] dark:border-white/[0.09]',
  'sm:rounded-[12px]',
  'shadow-[0_0_0_3px_rgb(255_255_255/0.6),0_1px_2px_rgb(16_16_32/0.04),0_6px_16px_-4px_rgb(16_16_32/0.08),0_24px_48px_-12px_rgb(16_16_32/0.14)]',
  'dark:shadow-[0_0_0_3px_rgb(255_255_255/0.07),0_1px_2px_rgb(0_0_0/0.3),0_8px_24px_-6px_rgb(0_0_0/0.45),0_24px_48px_-12px_rgb(0_0_0/0.55)]',
  DIALOG_COMPACT_CONTROLS,
].join(' ');
