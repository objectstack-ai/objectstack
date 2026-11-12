// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'formula-date-text-call-refused',
  surface:
    'data.Field.expression of a formula field (and any CEL predicate judged with the object\'s field types: '
    + 'validation conditions, flow conditions) — a date or datetime field handed straight to a call that '
    + 'takes a timestamp: isoDate(record.start_at), isoDatetime(record.start_at), '
    + 'startsWith(isoDate(record.start_at), "2026"), record.start_date.getFullYear()',
  replacement:
    'Parse the field\'s text into a timestamp first with date(…): isoDate(date(record.start_at)), '
    + 'isoDatetime(date(record.start_at)), date(record.start_date).getFullYear(). date(…) keeps a '
    + 'datetime\'s instant, so isoDatetime and getHours() read the same value they were written to read. '
    + 'Comparing a date field against a literal (record.start_date < "2026-12-01") and concatenating it '
    + 'with text ("Due: " + record.end_date) need no rewrite',
  reason:
    'The authoring type-soundness gate declared a date or datetime field a CEL Timestamp, so a call '
    + 'that takes a timestamp checked clean and every door passed it: os validate, os build, os lint and '
    + 'the object save door. The runtime never holds a Timestamp there: every read door hands a date '
    + 'field out as its YYYY-MM-DD text and a datetime field as its ISO-8601 instant text, so the '
    + 'evaluator found no overload for the call on every record. A formula read null with a server WARN '
    + 'as the only trace; a validation rule or flow condition met the fault on every write, so a '
    + 'fail-closed rule refused every write and a fail-open one never fired. The gate now re-checks a '
    + 'call on a date field with the field declared as its text and refuses it (date-text-call, with '
    + 'the outcome arm in the code for a predicate), naming the call, the field and the rewrite, which '
    + 'it checks clean before prescribing it. There is no mechanical rewrite applied to stored rows: the '
    + 'refused shape faulted on every record, so no stored value depends on it, and the rewrite is shown '
    + 'per call in the refusal.',
  acceptanceCriteria:
    'os validate and os build report no date-text-call finding; each rewritten formula field reads a '
    + 'value on GET /api/v1/data/OBJECT/ID where it read null before, and each rewritten validation rule '
    + 'admits a write it refused before; no stored sys_metadata object row reports the finding in its '
    + '_diagnostics.',
};
