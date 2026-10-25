// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * consoleTopBar — the console top bar's frame, spelled once (objectui#12639).
 *
 * Every console frame draws the same sticky bar above its page: Home, the two
 * organization layouts, the full-page assistant, and, outside this package,
 * `AppShell` inside every app (`@object-ui/layout`) and the `/studio` landing
 * (`apps/console`). The bar is 48 px (`h-12`), the height both approved
 * artboards draw (`Home.html` and `AppBar.html`), and it is ONE height, so the
 * bar does not move on the way from Home into an app or onto an organization
 * page.
 *
 * The frames in this package read `CONSOLE_TOP_BAR` instead of restating the
 * class. The two outside it cannot import this module without a new public
 * export, so each keeps the class as a literal, and
 * `__tests__/consoleTopBar.height-12639.test.ts` holds both literals equal to
 * this constant, holds every frame that mounts `AppHeader` to one of these
 * spellings, and fails on any other bar that copies the class.
 *
 * Literal class strings: Tailwind finds a class by scanning source.
 */

/** The bar: sticky at the top of its frame, 48 px, the console's background, a bottom border. */
export const CONSOLE_TOP_BAR =
  'sticky top-0 z-30 flex h-12 w-full shrink-0 items-center gap-2 border-b bg-background px-2 sm:px-4';

/**
 * What sits under the bar at the viewport's edge: the app sidebar, a `fixed`
 * column whose own top and height are the viewport's. It starts where the bar
 * ends (`top-12`) and is the viewport less the bar (`3rem`), so a change to the
 * bar's height changes both numbers here, in the same file.
 */
export const CONSOLE_BELOW_TOP_BAR = '!top-12 !h-[calc(100svh-3rem)]';
