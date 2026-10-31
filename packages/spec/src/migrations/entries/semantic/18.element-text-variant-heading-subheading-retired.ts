// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21015 — release 2 of objectui#7450's ruling B: `element:text` `variant`
// refuses the pre-convergence spellings `heading` and `subheading` by name
// (`enumWithRetiredValues`). The family's one D3 entry; the D2 half is
// `element-text-variant-heading-levels`, which rewrites each to the heading
// element it always rendered. This entry carries the judgement the chain
// cannot make — whether that level is the one the page means, now that it
// draws in that level's style.
export const entry: SemanticMigration = {
  id: 'element-text-variant-heading-subheading-retired',
  surface:
    'page components of type element:text — properties.variant authored as heading or subheading '
    + '(ElementTextPropsSchema.variant)',
  replacement:
    "one of the nine values `ui:text` publishes: `h1`-`h6`, `body`, `caption` or `overline`. 'heading' "
    + "→ 'h2' and 'subheading' → 'h3' (the heading element each one always rendered), or the level the "
    + 'page outline means',
  reason:
    'The ruling converged `element:text` on the vocabulary `ui:text` already publishes, because a '
    + 'heading is a document level, not a text style: `heading` and `subheading` named a style and '
    + 'left the renderer to pick a level. It landed in two releases so authors outside this repository '
    + 'could move first — 17.5.0 added the nine and refused nothing, and 17.6.0 was a full release in '
    + 'which both vocabularies parsed. The D2 conversion `element-text-variant-heading-levels` makes '
    + 'the ruled edit: `heading` → `h2`, `subheading` → `h3`. That keeps the heading element (the '
    + 'renderer drew `heading` as an h2 element and `subheading` as an h3 element), so the document '
    + 'outline a screen reader walks is unchanged, but not the size: `heading` drew in the `h3` style '
    + 'and `subheading` in a medium-weight small heading style, and `h2` / `h3` draw their own, larger '
    + 'styles. Whether the page wanted that level is the author\'s call — a heading placed for its '
    + 'size rather than its place in the outline may want a deeper level. Nothing is dropped at rest: '
    + 'a stored page replays the rewrite at rehydration and still loads, because a page component\'s '
    + '`properties` is not parsed on the metadata load path, and the next save of the page meets the '
    + 'component-props gate at the metadata save door. The gate reports an old spelling as a '
    + '`component-props-invalid` error, carrying the prescription, on `os validate`, `os build` and '
    + '`os lint` and at that save door. ADR-0087',
  acceptanceCriteria:
    'No `element:text` page component carries `variant` `heading` or `subheading`; `os validate` '
    + 'reports no `component-props-invalid` finding under `properties.variant` for these blocks. For '
    + 'each rewritten block, open the page and check the heading: it renders the same heading element '
    + 'as before, in its level\'s style. Where the old, smaller look mattered more than the level, '
    + 'pick the level whose style you want and confirm the outline still reads in order. A block that '
    + 'omits `variant` still renders as `body`.',
  conversionIds: ['element-text-variant-heading-levels'],
};
