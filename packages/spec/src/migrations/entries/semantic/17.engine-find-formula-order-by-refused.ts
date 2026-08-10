// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'engine-find-formula-order-by-refused',
  surface:
    'engine.find(object, { orderBy }) and engine.findOne(object, { orderBy }) naming a '
    + '`formula` field — the direct engine path, not the REST ingress',
  replacement:
    'denormalise the value onto the object (a stored field, written when the source '
    + 'changes) and sort by that — the same remedy the REST ingress has prescribed since '
    + '#6924 / #6994; a `summary` field is unaffected and still sorts, because it gets a '
    + 'real maintained column',
  reason:
    '#4226 / #4256 / #6994 closed the SORT axis at the REST ingress '
    + '(`assertSortFieldsExist`, `400 INVALID_SORT`), which covers everything reaching '
    + '`findData`: the list route, `POST /data/:object/query`, the export route and the '
    + 'RPC dispatcher. A caller reaching `engine.find()` / `engine.findOne()` DIRECTLY '
    + 'passed through none of it, and a `formula` ORDER BY there was dropped in silence. '
    + 'Measured on a real driver: `asc` and `desc` came back BYTE-IDENTICAL, in insertion '
    + 'order, under a success, with the rows carrying the very values they were asked to '
    + 'be ordered by. No column exists to order by (a formula is computed on read, so no '
    + 'driver materialises one), so the ORDER BY reached the driver, found nothing, and '
    + 'the unknown-column backstop returned the rows unordered.\n\n'
    + 'Ruled 2026-08-10 on #7095: an ORDER BY the engine cannot apply is a 4xx with '
    + 'guidance prose at the public boundary, never a silent drop — the same direction as '
    + 'the analytics dataset refusal envelope and the #6924 sort-hint prescription. The '
    + "engine's documented internal-caller tolerance (`assertProjectionFieldsExist`'s "
    + 'docblock) was to survive only behind a pinned internal path, and only if a MEASURED '
    + 'internal call site relied on it. The #7095 sweep of every in-tree `orderBy` reaching '
    + 'the engine directly — hooks, flows, reports, queue/job adapters, sharing, metadata '
    + 'loaders, expand sub-reads — found NONE: every hardcoded internal sort names a real '
    + 'stored column (`created_at`, `updated_at`, `version`, `priority`, `scheduled_for`, '
    + '`started_at`, `next_run_at`, `recorded_at`, `id`), and no shipped object in the repo '
    + 'declares a `formula` field at all. So no internal path shipped, and there is no flag '
    + 'to opt back into the drop.\n\n'
    + 'This is a CODE-path API, not stored metadata, so — like '
    + '`hook-register-empty-object-target-refused` at this step — there is no `sys_metadata` '
    + 'row for the D2 chain to rewrite and the ledger entry is the notification channel. '
    + 'No mechanical rewrite exists in either direction: the platform cannot invent the '
    + 'stored column the remedy prescribes, and it must not sort post-hoc instead — '
    + '`driver.find` has already applied `limit` / `offset`, so re-sorting after the '
    + 'formulas are evaluated would reorder an ARBITRARY PAGE, which looks correct on small '
    + 'result sets and is wrong the moment pagination is involved.\n\n'
    + 'ONE AUTHOR-REACHABLE SURFACE reaches this indirectly and is why it is not purely a '
    + "code-side note: a saved report's `query.orderBy` (`sys_saved_report`) is forwarded "
    + 'verbatim into `engine.find` by `plugin-reports`, bypassing the ingress gate. A '
    + 'report authored to sort by a formula field used to run and return rows in an '
    + 'arbitrary order; it now fails loudly, with the remedy in the message. One further '
    + 'path is deliberately NOT a refusal: a nested `expand` sort raises this refusal '
    + 'inside `expandRelatedRecords`, whose pre-existing graceful-degradation `catch` '
    + 'swallows every expand failure and retains the raw foreign keys — so that path moves '
    + 'from silent to OBSERVABLE (a warning naming the field and the fix) rather than '
    + 'refusing. Reversing that backstop is a separate decision on all expand failure '
    + 'modes. #7095, #6994, #6924, #4226, #4256, #3821, ADR-0112.',
  acceptanceCriteria:
    'No `engine.find` / `engine.findOne` call site sorts by a `formula` field, and no saved '
    + "report's `query.orderBy` names one — grep your report definitions for an `orderBy` "
    + 'field whose object declares it as a `formula`, and denormalise it onto a stored '
    + 'column written when the source changes. A `summary` / rollup field needs no action: '
    + 'it has a real maintained column and sorts correctly. Reads complete with no '
    + '`INVALID_SORT` naming a formula field, and no "Failed to expand relationship field" '
    + 'warning whose error text names one.',
};
