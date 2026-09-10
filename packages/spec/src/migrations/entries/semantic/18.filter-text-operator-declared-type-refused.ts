// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'filter-text-operator-declared-type-refused',
  surface: 'a STORED filter body the engine executes, where a text operator names a '
    + 'field whose declared type can never store a string. Measured carriers: '
    + '`sys_saved_report.query_json.filter` (executed verbatim as `engine.find(object, '
    + '{ where: q.filter })`, and reached again by every `sys_report_schedule` row '
    + 'through its `report_id`), `FieldSchema.summaryOperations[].filter` (ANDed with '
    + 'the parent-FK match and handed to `engine.aggregate`), `ListView.filter` and tab '
    + 'filters (`ViewFilterRuleSchema`, whose `contains` / `not_contains` / `icontains` '
    + '/ `starts_with` / `ends_with` spellings lower to the same operators through '
    + '`AST_OPERATOR_MAP`), and the `FilterConditionSchema` carriers on dashboards '
    + '(widget `filter`, `GlobalFilter`), datasets and reports (`runtimeFilter`), plus '
    + '`FieldSchema.relatedListFilter`. NOT this surface: an RLS / sharing / tenant '
    + 'predicate, which the platform composes onto the AST AFTER this door and which '
    + 'the door therefore never judges.',
  replacement: 'compare the field with an operator its declared type can answer — `$eq` '
    + '/ `$ne` / `$in`, or a range (`$gte` / `$lt`) for a temporal or numeric field — or '
    + 'aim the text operator at a text-valued field instead. A dotted path into a '
    + 'structured-JSON field (`address.city`) stays legal and is deliberately unjudged. '
    + 'NO rewrite is mechanical: the author\'s intent is not recoverable from the stored '
    + 'condition — `{ amount: { $contains: \'5\' } }` may have meant `$eq: 5`, a range, '
    + 'or a filter on a different column altogether — so the loader must not choose one.',
  reason:
    'objectstack#15661, ruled 2026-09-05 (decision batch #43, option C-deny), landed at '
    + 'the engine seam as objectstack#15773. A text operator (`$contains` / '
    + '`$notContains` / `$startsWith` / `$endsWith` / `$icontains` / `$like` / `$ilike`) '
    + 'over a field whose DECLARED type can never store a string — `NUMERIC_VALUE_TYPES` '
    + '∪ `BOOLEAN_VALUE_TYPES` ∪ `CALENDAR_DATE_TYPES` ∪ `INSTANT_TYPES` ∪ '
    + '`CLOCK_TIME_TYPES` ∪ `STRUCTURED_JSON_TYPES` — is refused at the engine\'s '
    + 'field-aware door with `INVALID_FILTER` 400 instead of reaching a driver. It is a '
    + 'RUNTIME narrowing over an AUTHORED surface, which is why it is registered here '
    + 'rather than disposed of as needing no prescription: NO schema changed, so a '
    + 'stored filter carrying the refused shape still parses and still loads — '
    + '`FilterConditionSchema` constrains no field type, and `ViewFilterRuleSchema` '
    + 'takes `field: z.string()` with `contains` in its operator enum — and the first '
    + 'sign of it is a 400 on the read that executes it. Before the door those reads '
    + 'answered `[]` (or every row for `$notContains`, or a SQLite coercion accident) '
    + 'with no diagnostic, which is the silent cell the ruling closed. `objectstack '
    + 'migrate meta` cannot repair the stored bodies for the reason `replacement` '
    + 'records, so this is a structured TODO rather than a graduated conversion.',
  acceptanceCriteria:
    'Every stored filter body listed under `surface` executes without an '
    + '`INVALID_FILTER` 400 naming a declared type: run each saved report, list view, '
    + 'dashboard widget, dataset and roll-up once after the upgrade and read the '
    + 'refusals — each message names the filter key, the field\'s declared type and the '
    + 'operator, which is the whole repair list. A filter re-authored onto a typed '
    + 'operator returns the rows its author meant; one left as written keeps answering '
    + '400, and NOTHING silently rewrites it. Filters over text-valued fields — '
    + 'including `select` / `radio` codes, `multiselect` / `checkboxes` / `tags`, lookup '
    + 'and `user` ids, `autonumber` and the file classes — are unaffected and must keep '
    + 'answering exactly as before; that is the control which proves a repair pass did '
    + 'not over-reach. A DIRECT driver call bypasses this door entirely and keeps '
    + 'answering the `FILTER_TEXT_CASES` stored-value row (objectstack#14079), so a '
    + 'driver-level test is not evidence about this migration in either direction.',
};
