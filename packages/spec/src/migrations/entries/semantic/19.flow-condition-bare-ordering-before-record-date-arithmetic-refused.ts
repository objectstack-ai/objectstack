// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A flow condition that orders a date field's BARE name against a text literal
// before it does arithmetic on the field's record.FIELD / previous.FIELD read
// now takes the date-text-arithmetic verdict its all-bare and all-root
// spellings already took (#36377). A structured TODO, not a D2 conversion:
// which span or shift the author meant is not recorded, and the platform does
// not guess.
export const entry: SemanticMigration = {
  id: 'flow-condition-bare-ordering-before-record-date-arithmetic-refused',
  surface:
    'automation.Flow conditions (a start node config.condition, edges[].condition, a decision node\'s '
    + 'config.conditions[].expression) that order a date or datetime field of the object the flow is typed against, '
    + 'read by its bare name, against a text literal before they do arithmetic against a number on the same or another '
    + 'such field read through record.FIELD or previous.FIELD (due_date > "2026-01-01" && record.due_date + 1 > 5). '
    + 'The all-bare (due_date > "2026-01-01" && due_date + 1 > 5) and all-root '
    + '(record.due_date > "2026-01-01" && record.due_date + 1 > 5) spellings were refused already. Not the shape: '
    + 'the arithmetic written first (refused already as date-arithmetic), an ordering or equality of the root read '
    + '(record.due_date < today()), or daysBetween / addDays / addMonths over it',
  replacement:
    'keep the ordering and replace the arithmetic: daysBetween(a, b) for the span in whole days '
    + '(due_date > "2026-01-01" && daysBetween(record.due_date, today()) > 5), and addDays(d, n) / addMonths(d, n) / '
    + 'daysFromNow(n) to shift a date (addDays(previous.due_date, -7) < today())',
  reason:
    'A flow run binds the trigger record twice: its fields flattened to bare names, and the row itself as record, '
    + 'with the row before the write as previous. A date field reaches the run as its YYYY-MM-DD text and a datetime '
    + 'field as its ISO-8601 instant text, so record.due_date + 1 faults the evaluator on every run, and a flow '
    + 'condition that faults fails the run (ADR-0032 section 1c). The authoring type check met the bare ordering '
    + 'against the text literal first, which the runtime answers, and set the whole condition aside; the record-root '
    + 'date-text check then read the root arithmetic as answered by the first check, which had answered nothing, so '
    + 'no finding was given. It now refuses the condition with the code, outcome arm and words the all-root '
    + 'spelling takes (date-text-arithmetic-run-fails / date-text-arithmetic-run-may-fail), naming the read as '
    + 'written. There is no mechanical rewrite: whether the author meant a span in days or a shifted date is a '
    + 'judgement about the condition. ADR-0032 / ADR-0087.',
  acceptanceCriteria:
    'os validate and os build report no date-text-arithmetic-run-fails or date-text-arithmetic-run-may-fail finding '
    + 'on a flow condition that orders a bare date name and does arithmetic on a record or previous read of a date '
    + 'field; POST /api/v1/packages/PKG/publish-drafts publishes the flow; a write that should start it runs past '
    + 'the condition instead of failing there. A stored flow carrying the shape still registers (registerFlow logs it '
    + 'as an advisory) and keeps failing at that condition on every run until it is rewritten and published.',
};
