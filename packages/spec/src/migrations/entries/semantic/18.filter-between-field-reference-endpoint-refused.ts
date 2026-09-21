// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The ledger's FIRST record of the 2026-08-11 removal, registered when the
// RUNTIME door finally enforced it. The schema-door half shipped without an
// entry, so this one covers both doors rather than only the second.
export const entry: SemanticMigration = {
  id: 'filter-between-field-reference-endpoint-refused',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface:
    'either endpoint of a $between range, authored as a { $field } column reference, on any '
    + 'carrier of FieldOperatorsSchema / RangeOperatorSchema: a view or dashboard widget filter, '
    + 'a dataset filter, a report runtimeFilter, a page or component filter, a rollup filter, and '
    + 'the NormalizedFilter AST the query faces validate against. ARITY is not what changed: a '
    + 'reference endpoint is a well-formed TWO-element range one of whose elements no backend '
    + 'resolves',
  replacement:
    'a literal bound — the value the range was meant to stop at, written out. If the range was '
    + 'genuinely meant to be COLUMN-TO-COLUMN, that is not a $between at all: write the two '
    + 'bounds separately as scalar comparisons, {"$gte": {"$field": "a"}} for the lower bound and '
    + '{"$lte": {"$field": "b"}} for the upper one, which is the position #5222 compiles on every '
    + 'face. ⛔ There is no replacement that can be DERIVED from what was written: the literal a '
    + 'reference stood for is not recoverable, and dropping the operator would delete a '
    + 'constraint the author wrote and WIDEN the result set silently. A reference remains legal, '
    + 'unchanged, as the WHOLE comparand of $eq / $ne / $gt / $gte / $lt / $lte',
  reason:
    'Maintainer ruling of 2026-08-11 on #7596, ADR-0049 enforce-or-remove: REMOVE. Both $between '
    + 'endpoint unions carried FieldReferenceSchema and no backend ever resolved one in a list '
    + 'position — matches-filter.ts leaves the list unresolved and orders against the raw '
    + 'reference OBJECT, so the range silently matches nothing, and both SQL faces refuse the '
    + 'position with INVALID_FILTER / 400. The published endpoint contract has stated the rule '
    + 'verbatim since that day: "A { $field } reference is NOT an endpoint shape" '
    + '(RANGE_ENDPOINT_DESCRIPTION, packages/spec/src/data/filter.zod.ts). '
    + '⚠️ That ruling shipped at the AUTHORING SCHEMA door alone, and no ledger entry was written '
    + 'for it — measured before this change: no semantic entry, no retired key, no spec-changes '
    + 'row and no upgrade-guide line named the shape. The runtime lowering door disagreed with '
    + 'the declaration for the whole of that window: parseFilterAST({ f: { $between: [{ $field: '
    + '"a" }, "M"] } }) returned the filter unchanged, same object reference, measured on '
    + 'origin/main immediately before the change and re-measured after. One published sentence, '
    + 'two truth values, decided by which door a caller came through — and the door that passed '
    + 'it is the one an embedder reaches by handing a lowered filter straight to a driver. This '
    + 'entry therefore registers the transition for BOTH doors, not only the second, which is '
    + 'why it is filed under #19377 rather than as an already-registered rider. '
    + '⚠️ No D2 conversion and no stored-metadata rewrite, and the load path was MEASURED rather '
    + 'than assumed: applyConversionsToStoredItem — the one primitive every stored-row '
    + 'rehydration seam calls — never throws and never validates, and replays only the '
    + 'positively-recognised lossless transforms in the conversion registry; measured on this '
    + 'branch, a stored view carrying { close_date: { $between: [{ $field: "contract.start" }, '
    + '"2026-12-31" ] } } comes back as the SAME object reference. Rewriting is not available in '
    + 'principle here, not merely declined: the literal the author meant is not recoverable from '
    + 'a reference, and the column-to-column reading has a different OPERATOR SHAPE (two scalar '
    + 'bounds), so producing it would be the platform rewriting one filter into another. That is '
    + 'the same ground the two nearest narrowings of this surface set stand on — '
    + 'filter-between-blank-endpoint-refused and filter-preset-ordering-comparand-refused. The '
    + 'read path does not re-validate stored rows, so no stored view becomes unreadable; what '
    + 'changes is that RE-SAVING one is refused, at the endpoint\'s own path, with the side '
    + 'named. Ships at once, no grace window and no dual spelling (2026-08-27 maintainer ruling '
    + '「短期不考虑渐进」). ADR-0049 / ADR-0087 / ADR-0112.',
  acceptanceCriteria:
    'Grep every authored $between array — view and dashboard widget filters, dataset filters, '
    + 'report runtimeFilters, page and component filters, rollup filters, saved AST filters, SDK '
    + 'and MCP callers — and read BOTH of its elements for a { $field } key. A range with two '
    + 'literal endpoints parses byte-identically to before, numbers, Dates, ISO days, UTC '
    + 'instants, clock times and non-temporal text included; nothing is trimmed, defaulted or '
    + 'copied from its neighbour, so an accepted range arrives byte-identical to what was '
    + 'written. A reference endpoint now answers one prescriptive issue at that endpoint\'s own '
    + 'path ($between.0 / $between.1) naming MIN or MAX, so FieldOperatorsSchema.safeParse and '
    + 're-saving the document both make the sweep mechanical; a range whose BOTH endpoints are '
    + 'references reports both positions. ⚠️ Do not assume such a range was showing the window it '
    + 'named: at every backend it either matched NOTHING (the in-memory matchers) or was refused '
    + '(both SQL faces), so a surface carrying one was never answering the query its filter '
    + 'claimed — decide the window from what the surface was SUPPOSED to show. If the intent was '
    + 'column-to-column, the replacement is the two-bound spelling and it needs testing as a NEW '
    + 'filter, because nothing was ever evaluating the old one. Endpoints that are null, blank or '
    + 'of the wrong type keep their own refusals and their own entries. $in / $nin MEMBERS '
    + 'carrying a reference are ruled out by the same 2026-08-11 decision and refused at the '
    + 'authoring schema door (SET_MEMBER_DESCRIPTION); they are outside THIS entry\'s transition '
    + 'and are worth sweeping in the same pass.',
};
