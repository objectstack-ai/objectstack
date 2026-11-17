// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'formula-date-subtraction-refused',
  surface:
    'data.Field.expression of a formula field (and any CEL predicate judged with the object\'s field types: '
    + 'validation conditions, flow conditions) — a date or datetime field subtracted from another '
    + '(record.end_date - record.start_date), or arithmetic on one with a duration '
    + '(record.start_date - duration("24h")); and, as a formula value, an expression that computes a '
    + 'duration (today() - record.start_date, now() - record.start_at)'
    + '. The first two shapes (a field subtracted from another, a field in arithmetic with a duration; '
    + 'not the formula-only duration value) are refused in a flow VALUE envelope too: an assignment node\'s '
    + 'assignments value, a create_record / update_record node\'s fields.* value, reading the field '
    + 'through record (or previous), in a record-triggered flow or a time-relative sweep of the typed '
    + 'object that rebinds neither record nor previous itself (no assignment target, output, iterator, '
    + 'index or error variable or node id of either name, and no declared variable named record); '
    + 'os validate and the engine\'s registerFlow '
    + 'refuse the same set. A stored flow carrying one fails to register at boot on an engine with the '
    + 'object-schema resolver wired (the automation service bridged to ObjectQL) until it is rewritten '
    + 'with the same rewrite',
  replacement:
    'daysBetween(a, b) for the span in whole days: daysBetween(record.start_date, record.end_date) for end '
    + 'minus start, daysBetween(record.start_date, today()) for the days since a date. addDays(d, n) / '
    + 'addMonths(d, n) / daysFromNow(n) to shift a date. A predicate may still compare a duration, '
    + 'today() - record.start_date > duration("72h")',
  reason:
    'The authoring type-soundness gate declared a date or datetime field a CEL Timestamp, so the '
    + 'subtraction of two of them checked as a legal Duration and every door passed it: os validate, '
    + 'os build, os lint and the object save door. The runtime never holds a Timestamp there: every read '
    + 'door hands a date field out as its YYYY-MM-DD text and a datetime field as its ISO-8601 instant '
    + 'text, so the evaluator faulted on the subtraction and the field read null for every record, with '
    + 'a server WARN as the only trace; a timestamp minus a date field evaluated to a Duration, which a '
    + 'field serialises as {}. The gate now re-checks what the Timestamp typing passes with the field '
    + 'declared as that text, and refuses both shapes (date-text-arithmetic, and date-duration-value for a '
    + 'formula). The (record.end_date - record.start_date) + 1 shape keeps its existing date-arithmetic '
    + 'refusal and words. There is no mechanical rewrite: which span the author meant (the days between, '
    + 'inclusive or not, or hours) is a judgement about the field, and a stored formula of the refused '
    + 'shape read null or {} for every record, so no stored value depends on it.',
  acceptanceCriteria:
    'os validate and os build report no date-text-arithmetic or date-duration-value finding; each '
    + 'rewritten formula field reads a number on GET /api/v1/data/OBJECT/ID where it read null or {} '
    + 'before; no stored sys_metadata object row reports either finding in its _diagnostics.'
    + ' For a stored flow: the boot log carries no "[Automation] failed to register flow" (or '
    + '"cold-boot flow bind: failed to register flow") warning naming it, and POST '
    + '/api/v1/meta/_migrate-stored on the running server lists no registerFlow TODO at its assignments '
    + 'or fields slots. The CLI\'s os migrate meta --stored cannot show this: it boots the automation '
    + 'plugin inert (armRuntime: false), which returns before the object-schema resolver is wired, so '
    + 'its stored pass types no value envelope and lists no such TODO whether or not the flow carries one.',
};
