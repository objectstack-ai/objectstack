// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A flow condition's record.FIELD / previous.FIELD read of a date or datetime
// field now takes the date-arithmetic verdict its bare name already took
// (#34946). A structured TODO, not a D2 conversion: which span or shift the
// author meant (days between, a shifted date, inclusive or not) is not
// recorded, and the platform does not guess.
export const entry: SemanticMigration = {
  id: 'flow-condition-record-date-arithmetic-refused',
  surface:
    'automation.Flow conditions (a start node config.condition, edges[].condition, a decision node\'s '
    + 'config.conditions[].expression): arithmetic against a number on a date or datetime field of the object the '
    + 'flow is typed against, read through record.FIELD or previous.FIELD (record.due_date + 1 > 5, '
    + 'previous.due_date - 7 < 0). The bare field name (due_date + 1 > 5) was refused already. Not the shape: '
    + 'an ordering or equality of the field (record.due_date < today()), daysBetween / addDays / addMonths over '
    + 'it, or a field record-scoped sites (formula fields, validation rules) read, which were refused already',
  replacement:
    'daysBetween(a, b) for the span in whole days (daysBetween(record.due_date, today()) > 5 for more than five '
    + 'days past due), and addDays(d, n) / addMonths(d, n) / daysFromNow(n) to shift a date '
    + '(addDays(record.due_date, 1) < today())',
  reason:
    'A flow run binds the trigger record twice: its fields flattened to bare names, and the row itself as record, '
    + 'with the row before the write as previous. A date field reaches the run as its YYYY-MM-DD text and a '
    + 'datetime field as its ISO-8601 instant text, so record.due_date + 1 faults the evaluator on every run, and a '
    + 'flow condition that faults fails the run (ADR-0032 section 1c): the flow stops there and the work it exists '
    + 'to do is not done. The authoring type check refused the arithmetic on the bare name (date-arithmetic, with '
    + 'the run-fails / run-may-fail outcome arms) and passed the record. / previous. read with no finding. It now '
    + 'refuses the read with the same code, the same outcome arm (the row\'s: a root read keeps run-fails where '
    + 'bare names are unproven) and the same words, naming the read as written. There is no mechanical rewrite: '
    + 'whether the author meant a span in days or a shifted date is a judgement about the condition. '
    + 'ADR-0032 / ADR-0087.',
  acceptanceCriteria:
    'os validate and os build report no date-arithmetic-run-fails or date-arithmetic-run-may-fail finding on a '
    + 'flow condition that reads a date field through record or previous; POST /api/v1/packages/PKG/publish-drafts '
    + 'publishes the flow; a write that should start it runs past the condition instead of failing there. A stored '
    + 'flow carrying the shape still registers (registerFlow logs it as an advisory) and keeps failing at that '
    + 'condition on every run until it is rewritten and published.',
};
