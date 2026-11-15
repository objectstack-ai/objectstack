// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #34009 — `lookupFilters[].value` was `z.any()`, so a `{ $record }` object
// parsed in any shape before the comparand was declared. Declaring it refuses
// the shapes outside the declaration: a path of two or more hops or of
// non-snake_case names, a key beside `$record`, a `$record` value under
// `in`, `notIn` or `contains`, and a `$record` object as a member of a list
// value; `orEmpty` (a new key) on those three operators
// is refused too, but no such entry parsed before. Semantic-only — no D2
// conversion: which field the author meant, or which operator, is theirs.
export const entry: SemanticMigration = {
  id: 'lookup-filter-record-reference-shape-refused',
  surface:
    'objects[].fields.<name>.lookupFilters[].value of any field that carries lookupFilters (a lookup, master_detail '
    + 'or user field renders the picker that reads them) — a value written as an object carrying a $record key whose '
    + 'path has more than one dot or is not snake_case names, that carries any other key beside $record, or that sits '
    + 'under operator in, notIn or contains; or a list value with such an object among its members. Reachable wherever an object is '
    + 'authored or stored: defineStack objects sources, an exported stack passed to objectstack validate or '
    + 'objectstack compile, a field saved from the Studio object designer, and an object row already in sys_metadata',
  replacement:
    'a { $record: "field" } or { $record: "lookup_field.field" } value (a field of the record being edited, or one '
    + 'lookup hop from it) under eq, ne, gt, lt, gte or lte, with no other key — e.g. { field: "cb_market", '
    + 'operator: "eq", value: { $record: "account.cb_market" }, orEmpty: true }. A list cannot hold a { $record }: '
    + 'give each referenced value an entry of its own. A value two hops away is not '
    + 'reachable from a picker filter: copy it onto the record being edited, or onto the record one hop away, as a '
    + 'field of its own, and reference that. For a date relative to today write the "{today}" placeholder or a '
    + '{ "$now": true, "addDays": N } value instead of an offset beside $record',
  reason:
    'Until this release a lookupFilters value was any JSON at all, and an object carrying $record meant nothing: '
    + 'the console picker sent it to the server as written, and the server refused the query (INVALID_FILTER, a '
    + 'plain object where a comparison value belongs) or met $record as an operator it does not know, so the picker '
    + 'showed an error instead of candidates. The value is now declared: { $record: "path" } reads the record being '
    + 'edited, at most one lookup hop away, and pairs only with the six scalar comparisons, because it stands for one '
    + 'value. A value outside that declaration is refused where it is written, naming the entry and the rule, instead '
    + 'of being stored as a shape no reader will ever resolve. The declared shape is the one the console picker will '
    + 'resolve; in this release the picker does not resolve it yet, so rewriting fixes the declaration, not the '
    + 'picker\'s INVALID_FILTER. No D2 conversion exists: which field, which hop or which '
    + 'operator the author meant is theirs to choose. Where such an entry already sits, the object that holds it is '
    + 'refused where an object is: a stack source throws StackSchemaInvalidError for the whole stack, and a stored '
    + 'object row loads with its diagnostics. ADR-0087.',
  acceptanceCriteria:
    'Run objectstack validate over every stack authored in config files. Each refusal names the field and the entry, '
    + 'fields.NAME.lookupFilters.N.value (or .value.$record, or .value.I for a list member), and the rule broken. '
    + 'Rewrite the entry to the declared shape; then objectstack validate is clean for that entry. In this release the console picker still answers '
    + 'INVALID_FILTER for an entry that uses { $record }, exactly as before the rewrite: that is expected until the '
    + 'picker change that resolves { $record } ships, and is not a failed migration.',
};
