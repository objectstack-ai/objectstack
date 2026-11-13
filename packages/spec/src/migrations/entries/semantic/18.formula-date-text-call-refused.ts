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
    + 'the object save door. The SQL driver\'s read doors (ADR-0053 D-F1) and a write that hands the '
    + 'value as text (a JSON body can carry nothing else; measured through the engine) give the evaluator '
    + 'a date field as its YYYY-MM-DD text and a datetime field as its ISO-8601 instant text, and the '
    + 'evaluator finds no overload for the call there, on every record whose value reaches it. A formula read null with a server WARN as the only trace; a fail-closed validation rule or '
    + 'flow condition refused the write (a guarded call, such as record.d != null && isoDate(record.d) '
    + '== "2026-11-01", faulted on every record with a value), and a fail-open one never fired. A '
    + 'datetime that reaches the expression as a JS Date (a server-side writer handing one, measured '
    + 'through the engine; a MongoDB read, whose storage form is a BSON Date, not measured end to end) '
    + 'evaluates, and the refusal applies there too. The gate now re-checks a call on a date field with '
    + 'the field declared as its text and refuses it (date-text-call, with the outcome arm in the code '
    + 'for a predicate), naming the call, the field and the rewrite, which it checks clean before '
    + 'prescribing it. There is no mechanical rewrite applied to stored rows: the rewrite is shown per '
    + 'call in the refusal, and it reads the same value on the text and on a JS Date, so rewriting '
    + 'changes no value an expression read before.',
  acceptanceCriteria:
    'os validate and os build report no date-text-call finding; each rewritten formula field reads a '
    + 'value on GET /api/v1/data/OBJECT/ID where it read null before (and the same value where it read '
    + 'one), and each rewritten validation rule admits a write it refused as unevaluable before; no '
    + 'stored sys_metadata object row reports the finding in its _diagnostics.',
};
