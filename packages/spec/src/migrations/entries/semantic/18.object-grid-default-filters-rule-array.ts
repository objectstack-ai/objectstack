// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The key the one-filter-orthography convergence did not name. Its sibling
// entry element-data-source-and-object-block-filter-rule-array says so in as
// many words — 「object-grid.defaultFilters is a different key and is not named
// by the ruling this entry records」 — so this is the entry that names it.
export const entry: SemanticMigration = {
  id: 'object-grid-default-filters-rule-array',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'the object-grid page block\'s defaultFilters property — the legacy base-filter fallback '
    + 'in ComponentPropsMap, which was z.unknown and therefore accepted a bare string, a '
    + 'number, a MongoDB-style record, an ObjectQL AST tuple array and a list of malformed '
    + 'rules alike',
  replacement:
    'the same ViewFilterRule array form its sibling filter takes — '
    + '[{ field, operator, value }, ...]. A record-form fallback { status: "active" } becomes '
    + '[{ field: "status", operator: "equals", value: "active" }] and several record keys '
    + 'become several rules, which AND; an operator object { amount: { $gt: 100 } } lifts the '
    + 'operator into the rule, becoming '
    + '[{ field: "amount", operator: "greater_than", value: 100 }]; an AST tuple array '
    + '[["owner_id", "=", "{current_user_id}"]] becomes '
    + '[{ field: "owner_id", operator: "equals", value: "{current_user_id}" }], value '
    + 'placeholders and date macros unchanged. Legacy operator shorthands are accepted and '
    + 'normalized on parse. Better still, write the rules on filter and delete this key: it '
    + 'is read only when filter is absent, and its own description has prescribed filter all '
    + 'along',
  reason:
    '#19514, out of objectui#9050 ruling C-prime (maintainer 2026-09-20, verbatim, '
    + 'untranslated): 「the differences are the protocol\'s to close」. This is the SAME value '
    + 'in the SAME role as filter — the key\'s own description says it is read only when '
    + 'filter is absent — and the consumer reads it through the SAME lowering sink, so every '
    + 'refusal that sink can give was reachable from a document the protocol had just '
    + 'accepted. filter converged on the rule array with the rest of its family; this key was '
    + 'not named by that ruling and kept the pre-convergence read-point shape, which left the '
    + 'block with one declared door and one undeclared door onto one seam. An author who put '
    + 'the record form on the fallback got a silent success receipt and a 400 at render, with '
    + 'nothing in between to tell them which of the two keys was the problem. '
    + '⛔ This entry is a NARROWING and deliberately not a retirement. Refusing the key '
    + 'outright — the other arm the finding offered — removes an accepted shape and needs its '
    + 'own ruling; the deprecation already stated in the description is unchanged and still '
    + 'says to prefer filter. '
    + 'Metadata AT REST is deliberately NOT rewritten and this entry adds no D2 conversion, '
    + 'for the reason its sibling gives at length: a SemanticMigration converts nothing by '
    + 'its own type, the stored-row pass replays D2 conversions only, and the read path does '
    + 'not re-validate stored rows — so a stored page carrying the record form keeps loading '
    + 'and keeps rendering as it does today. What changes is that RE-SAVING it is refused at '
    + 'the defaultFilters path, with the same conversion table the filter door gives, '
    + 'computed from the author\'s own keys. ADR-0049 / ADR-0087.',
  acceptanceCriteria:
    'Every object-grid node in your pages either omits defaultFilters or carries a '
    + 'ViewFilterRule array on it. The parse of an object-grid node whose defaultFilters is '
    + 'that array raises no issue at the key; a record form is refused AT defaultFilters with '
    + 'the conversion table and a worked rewrite built from the keys that were written, and '
    + 'an AST tuple array is refused one level in, at the first element. A grid that has been '
    + 'relying on a record-form defaultFilters was not being filtered by it — the lowering '
    + 'refused the shape — so re-check which rows the grid is supposed to show rather than '
    + 'assuming the displayed set was correct. Where both keys were authored, only filter was '
    + 'ever read: deleting defaultFilters is the whole migration.',
};
