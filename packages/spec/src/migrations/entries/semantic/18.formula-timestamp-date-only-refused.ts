// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'formula-timestamp-date-only-refused',
  surface:
    'data.Field.expression of a formula field (and any CEL predicate judged with the object\'s field types: '
    + 'validation conditions, field rule predicates, flow conditions) — a date-only (date) field handed to '
    + 'timestamp(), alone or inside duration arithmetic: timestamp(record.borrow_date), '
    + 'isoDate(timestamp(record.borrow_date) + duration(\'168h\'))',
  replacement:
    'Shift a date by whole days with addDays and keep it a date with isoDate: '
    + 'isoDate(addDays(record.borrow_date, 7)). Where a timestamp is wanted, parse the field with date(…) in place '
    + 'of timestamp(…): date(record.borrow_date). timestamp() over a datetime field needs no rewrite',
  reason:
    'timestamp(s) is CEL\'s string overload, so the authoring type-soundness gate checked it clean with the '
    + 'field declared as the text the runtime holds, and every door passed it: os validate, os build, os lint '
    + 'and the object save door. The runtime holds a date field as its YYYY-MM-DD text, and timestamp() parses '
    + 'only a full ISO-8601 instant: the evaluator answers "timestamp() requires a string in ISO 8601 format" on '
    + 'every record with a value, and finds no overload for timestamp(null) on every record without one. A '
    + 'formula read null; a flow condition failed the run; a fail-closed rule refused the write. A datetime '
    + 'field\'s text is an instant, which timestamp() parses, so it is not refused. The gate now refuses the '
    + 'call under the existing date-text-call codes (with the outcome arm in the code for a predicate), naming '
    + 'the call, the field, date(…) as the parse and isoDate(addDays(field, N)) as the whole-day shift. There '
    + 'is no mechanical rewrite applied to stored rows: the shift in days is the author\'s, and the refused '
    + 'expression never produced a value to preserve.',
  acceptanceCriteria:
    'os validate and os build report no date-text-call finding naming timestamp(…); each rewritten formula '
    + 'field reads the date plus N days on GET /api/v1/data/OBJECT/ID where it read null before; no stored '
    + 'sys_metadata object row reports the finding in its _diagnostics.',
};
