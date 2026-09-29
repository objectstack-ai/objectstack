// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The display page size a view gets when it declares none moved from 25 to 50
// (maintainer ruling on objectui#9853). A default move reaches every silent
// document with no parse error and nothing in the author's diff, so the
// upgrade path carries it as a TODO: only the deployment can say whether a
// view that never declared a page size was relying on 25.
export const entry: SemanticMigration = {
  id: 'view-pagination-page-size-default-50',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface: 'ui.PaginationConfig.pageSize — an OMITTED page size on a view',
  replacement: 'nothing, to take the platform display page size of 50. To keep the old 25 rows '
    + 'per page on a view, write it: `pagination: { pageSize: 25 }`',
  reason:
    'A RULED behaviour change on a default, so there is nothing to rewrite and nothing to '
    + 'refuse: the maintainer\'s ruling of 2026-09-24 set the platform display page size to 50, '
    + 'declared once in the protocol, and the declared default of `PaginationConfigSchema.pageSize` moved '
    + 'from 25 to 50. A `pagination` block that omits `pageSize` now parses to 50 — 50 rows '
    + 'per page on a paged view, and a fetch ceiling of 50 on a view with no pager (kanban, '
    + 'gallery, timeline). A view with no `pagination` block at all parses with none on either '
    + 'side; its page size reaches it through the renderer, which is ruled to read the spec '
    + 'default rather than keep its own number (an earlier ruling on the grid\'s page size, which '
    + 'the page-size ruling restated). Not losslessly '
    + 'convertible because the question is intent, not text: a mechanical pass that wrote '
    + '`pageSize: 25` into every silent view would preserve the old number and defeat the '
    + 'ruling, and one that wrote 50 would add nothing the default does not already do. Only '
    + 'the deployment knows which silent views were relying on 25. The accept set is unchanged '
    + '— a positive integer — and every authored `pageSize` parses exactly as before.',
  acceptanceCriteria:
    'An empty pagination configuration parses to a page size of 50, and a list view carrying '
    + '`pagination: {}` parses to `pagination.pageSize` 50; an authored '
    + '`pagination: { pageSize: 25 }` still parses to 25; `pageSize: 0`, a negative and a '
    + 'fraction are still refused. A view that must keep 25 rows per page declares '
    + '`pagination: { pageSize: 25 }` and shows 25 rows on its first page.',
};
