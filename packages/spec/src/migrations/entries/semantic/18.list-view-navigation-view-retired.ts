// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'list-view-navigation-view-retired',
  surface: 'view.list.navigation.view',
  replacement:
    'page assignment — assign a `record` page to the object and let `isDefault` pick the one '
    + 'that opens. That is the machinery that resolves a detail layout by name; a list view\'s '
    + '`navigation` block decides only HOW the detail is surfaced (`mode`, `size`, '
    + '`preventNavigation`, `openNewTab`, `width`), and every one of those keys is unchanged',
  reason:
    'DECLARED, CONSUMED, AND WRONG — which is why this is a semantic TODO rather than a '
    + 'mechanical strip. The key\'s describe promised "the form view to use for details" and '
    + 'no layer from spec to console ever resolved a view by name. Its only read in the '
    + 'shipped console put the value in the SECOND argument of `onNavigate`, the slot that '
    + 'otherwise carries the navigation-MODE token: an authored `view` did not select a view, '
    + 'it SUBSTITUTED for the mode. At least one consumer in the same bundle reads that '
    + 'argument against a closed two-value vocabulary (`edit` / `view`), so any other authored '
    + 'value matched neither branch — invisible on grids whose handler takes one argument, a '
    + 'dead row click on the ones that do not. The enumeration behind the removal was '
    + 'exhaustive rather than sampled: every `.view` property read in the bundle (three) and '
    + 'every `formViews` read, and NO read anywhere is keyed by an authored view name, so '
    + 'there is no path by which this key or any sibling could have resolved one. '
    + 'ADR-0049 enforce-or-remove; zero authored instances in this repo and the one external '
    + 'author removed its occurrence, so the pull that would justify ENFORCE is zero. '
    + 'A mechanical D2 strip was weighed and declined with the direction: deleting the key '
    + 'silently discards the author\'s actual intent — "open the detail in THIS layout" — and '
    + 'leaves no record of which list view carried it, which is exactly the judgement a '
    + 'semantic TODO exists to hand back. Should "open the detail in a chosen view" ever be '
    + 'pulled, it belongs to the page-assignment machinery (`record` pages, `isDefault`), not '
    + 'to a string on a list view.',
  acceptanceCriteria:
    'For EACH list view that declared `navigation.view` — the TODO names the surface, you name '
    + 'the view: delete the key from that view\'s `navigation` block, then decide whether the '
    + 'detail layout it asked for was ever actually delivered. It was not, so nothing regresses '
    + 'by deleting it: confirm the record detail opens exactly as it did before (the surviving '
    + '`mode` and `size` decide that, and both are untouched). If the named layout is one you '
    + 'still want, publish it as a `record` page on that object and mark the one that should '
    + 'open `isDefault`. Done when no `navigation` block in your sources carries `view`; a block '
    + 'that still does fails to parse with the removal prescription, at `ListViewSchema`, at '
    + '`ObjectListViewSchema` and at the `PUT /api/v1/meta/view` overlay door, and authoring it '
    + 'is a `tsc` error at the call site. ⚠️ Nothing else in the block moves — a `navigation` '
    + 'that carries only live keys (`{ mode: \'drawer\', size: \'lg\' }`) parses byte-for-byte '
    + 'as it did before.',
};
