// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * dataTabsFold — where the Data pillar's five power panels sit: flat in the
 * object's tab row, or folded into "Advanced ▾" (objectui#12450, decision B of
 * epic objectui#12446).
 *
 * The maintainer's ruling: seven flat tabs — Records, Form, Validations,
 * Hooks, Actions, API, Settings — when the content column is at least
 * {@link DATA_TABS_FOLD_WIDTH} px wide; narrower than that, the last five fold
 * back into "Advanced ▾", whose trigger keeps its own name whichever panel is
 * open (objectui#11794).
 *
 * The rule is a CSS container query on the pillar's content column, not a JS
 * width read: the column narrows when the field inspector opens beside it or
 * the copilot dock expands, and a container query answers those moves with no
 * resize observer and no re-render. Both forms are in the DOM and exactly one
 * of them is displayed at any width, so the folded form keeps its pins
 * (`DataPillar.advancedKeepsName-11794.test.tsx`) and the flat form has its
 * own (`DataPillar.flatTabs-12450.test.tsx`).
 *
 * The class strings are literals, not built from the number: Tailwind finds a
 * class by scanning source text, so a template literal would generate no CSS.
 * The flat-tab pin checks that both strings name {@link DATA_TABS_FOLD_WIDTH}.
 */

/** The content-column width (px) at and above which the five panels are flat tabs. */
export const DATA_TABS_FOLD_WIDTH = 1000;

/** On the pillar's content column: the container the two classes below measure. */
export const DATA_CONTENT_CONTAINER = '@container';

/** On each of the five flat tabs: not displayed below the fold width, an inline flex at and above it. */
export const DATA_TAB_FLAT_ONLY = 'hidden @min-[1000px]:inline-flex';

/** On the "Advanced ▾" trigger: displayed below the fold width, not displayed at and above it. */
export const DATA_TAB_FOLDED_ONLY = '@min-[1000px]:hidden';
