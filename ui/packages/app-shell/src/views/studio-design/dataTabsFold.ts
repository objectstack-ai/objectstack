// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * dataTabsFold — where the object designer's five power panels sit: flat in
 * the object's tab row, or folded into "Advanced ▾" (objectui#12450, decision
 * B of epic objectui#12446).
 *
 * The tab order is #36513's (section 一, kept by epic objectstack#36890):
 * Records, Field layout, Validations, Actions, Settings, Hooks, API, business
 * first and the technical two last. Records and Field layout are always flat.
 * The other five fold in two steps, the technical two first:
 *
 *  - at {@link DATA_TABS_FOLD_FIRST_WIDTH} px and wider, all five are flat;
 *  - below it, Hooks and API fold into "Advanced ▾"
 *    ({@link DATA_TAB_FOLDED_FIRST_ONLY});
 *  - below {@link DATA_TABS_FOLD_WIDTH} px, all five do ({@link DATA_TAB_FOLDED_ONLY}).
 *
 * The trigger keeps its own name whichever panel is open (objectui#11794).
 *
 * The rule is a CSS container query on the designer's content column, not a
 * JS width read: the column narrows when the field inspector opens beside it
 * or the copilot dock expands, and a container query answers those moves with
 * no resize observer and no re-render. Every form is in the DOM and exactly
 * one of each is displayed at any width; each "Advanced ▾" trigger carries its
 * own menu, so a menu lists only what is folded at that width.
 *
 * The class strings are literals, not built from the numbers: Tailwind finds a
 * class by scanning source text, so a template literal would generate no CSS.
 * The flat-tab pin checks that the strings name the two widths.
 */

/** The content-column width (px) at and above which Validations, Actions and Settings are flat tabs. */
export const DATA_TABS_FOLD_WIDTH = 1000;

/** The content-column width (px) at and above which Hooks and API are flat tabs too. */
export const DATA_TABS_FOLD_FIRST_WIDTH = 1200;

/** On the designer's content column: the container the classes below measure. */
export const DATA_CONTENT_CONTAINER = '@container';

/** On Validations, Actions and Settings: not displayed below the fold width, an inline flex at and above it. */
export const DATA_TAB_FLAT_ONLY = 'hidden @min-[1000px]:inline-flex';

/** On Hooks and API: not displayed below the first fold width, an inline flex at and above it. */
export const DATA_TAB_FLAT_WIDE_ONLY = 'hidden @min-[1200px]:inline-flex';

/** On the "Advanced ▾" trigger that holds all five: displayed below the fold width only. */
export const DATA_TAB_FOLDED_ONLY = '@min-[1000px]:hidden';

/** On the "Advanced ▾" trigger that holds Hooks and API: displayed between the two widths only. */
export const DATA_TAB_FOLDED_FIRST_ONLY = 'hidden @min-[1000px]:inline-flex @min-[1200px]:hidden';
