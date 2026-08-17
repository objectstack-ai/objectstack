// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Approvals · Review Queue — the human side of the approval / review flows.
 * The showcase has ~20 approval & review flows but no UI where a reviewer
 * sees what is waiting on them; this is that surface.
 *
 * An interface (list) page over tasks currently `in_review` — the work
 * awaiting a decision — with a drawer to inspect each item. "Mark Done" is
 * deliberately NOT wired as a page-level `buttons:` toolbar entry: that
 * surface has no bound record, so `MarkDoneAction`'s `visible` predicate
 * (`has(record.done) && record.done != true`, #8990) has nothing to evaluate
 * against and the button would render
 * regardless of state. `MarkDoneAction.locations` already includes
 * `list_item`, so it correctly appears per-row (with that row's record bound)
 * instead. Tabs let the reviewer pivot to urgent or blocked work.
 */
export const ReviewQueuePage = definePage({
  name: 'showcase_review_queue',
  label: 'Approvals',
  type: 'list',
  object: 'showcase_task',
  kind: 'full',
  template: 'default',
  isDefault: false,
  regions: [],
  interfaceConfig: {
    source: 'showcase_task',
    columns: ['title', 'project', 'assignee', 'priority', 'due_date'],
    // Always-on base filter: only items awaiting review reach this queue.
    filterBy: [{ field: 'status', operator: 'equals', value: 'in_review' }],
    sort: [{ field: 'due_date', order: 'asc' }],
    appearance: { showDescription: true, allowedVisualizations: ['grid'] },
    userActions: { sort: true, search: true, filter: false, rowHeight: false, addRecordForm: false },
    // No `buttons:` entry here — see file header comment: "Mark Done" is a
    // record-scoped action and belongs per-row (`list_item`), not as an
    // unbound page-toolbar button.
    // Click a row → drawer with the full record to review before deciding.
    recordAction: 'drawer',
    showRecordCount: true,
  },
});
