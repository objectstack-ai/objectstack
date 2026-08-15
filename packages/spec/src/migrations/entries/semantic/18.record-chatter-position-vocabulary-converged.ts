// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'record-chatter-position-vocabulary-converged',
  surface:
    '`record:chatter` / `record:discussion` component props (one shared schema object): '
    + '`position` vocabulary, and the schema defaults on `position` / `collapsible` / '
    + '`defaultCollapsed` (DROPPED)',
  replacement:
    "`position: 'bottom' | 'right' | 'left'` — the renderer's own vocabulary "
    + "(`right`/`left` dock a side panel, `bottom` renders in flow). 'sidebar' → 'right', "
    + "'inline' → 'bottom', 'drawer' → 'right' (no overlay drawer ever existed). "
    + 'No key replaces the dropped schema defaults: an unset key now stays unset and the '
    + "renderer's own fallbacks apply (position 'bottom', collapsible off, defaultCollapsed off)",
  reason:
    'The schema declared a `position` vocabulary no read point ever compared '
    + '(`sidebar`/`inline`/`drawer`), while the renderer chain — panel branches, designer '
    + 'registration, merge fallback, three sites in agreement, measured at objectui pin '
    + '`665661ab0932` — speaks exactly `bottom`/`right`/`left`. So the spec-valid `sidebar` '
    + '(the schema\'s own DEFAULT, materialized onto every parsed node that said nothing) '
    + 'silently fell through to the in-flow render, and the value that actually docks the '
    + 'panel (`right`) was refused at publish — declared ≠ enforced in both directions on the '
    + 'same key. The maintainer ruling (2026-08-15, #8762) converged the row on the '
    + 'renderer\'s vocabulary with no mapping layer, and dropped all three schema defaults per '
    + 'the `maxVisible` principle (renderer fallbacks stay the renderer\'s facts): the old '
    + '`collapsible` default (`true`) additionally INVERTED the renderer merge\'s own fallback '
    + '(`false`), so "the author said nothing" parsed into "the author asked for collapsible". '
    + 'The mechanical rewrite is the ADR-0087 D2 conversion '
    + '`record-chatter-position-vocabulary` (retired from the load path — the enum refuses '
    + 'the old spellings at parse with a per-value prescription; stored rows replay clean '
    + 'via the rehydration seam). This semantic entry exists for the two judgements the '
    + 'chain cannot make: whether `drawer` → `right` (a docked panel standing in for a '
    + 'never-implemented overlay) is the presentation the author wants, and whether a page '
    + 'that relied on the old materialized `collapsible: true` default should now author it '
    + 'explicitly. ADR-0087, maintainer ruling 2026-08-15, #8762.',
  acceptanceCriteria:
    'No authored `record:chatter` / `record:discussion` component carries `position: '
    + "'sidebar' | 'inline' | 'drawer'`; `objectstack validate` passes. Review the rewritten "
    + "values against intent: 'sidebar' and 'drawer' became 'right' (a docked side panel — "
    + 'what both spellings meant, but NOT what they did: both used to fall through to the '
    + "in-flow render, so the page's visible layout changes to the docked panel the author "
    + "originally asked for). Where the in-flow presentation was actually wanted, write "
    + "'bottom'. If a panel relied on the old schema default `collapsible: true`, author "
    + '`collapsible: true` explicitly — an unset key now defers to the renderer, which does '
    + 'not collapse.',
};
