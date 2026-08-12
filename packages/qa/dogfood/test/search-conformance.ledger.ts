// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ConformanceRow } from '@objectstack/verify';
//
// ADR-0061 §Conformance — Record-Search Conformance ledger (ADR-0060 pattern).
//
// The ADR's own landing bar: `$search` is "landed" iff a driver-reachable
// executor runs it AND a dogfood proof asserts a MULTI-FIELD match over the
// real HTTP API (e.g. searching "retail" returns an account matched by
// `industry`, not `name`). This ledger is the durable encoding of that bar:
// every search-related declarable surface sits in exactly one honest state
// (ADR-0049), names its executor site, and the enforced rows reference the
// HTTP-level proof (`showcase-search.dogfood.test.ts`).
//
// Tier 2 (FTS / relevance / external engines) is deliberately ABSENT from this
// ledger rather than carried as an aspirational row — per ADR-0049 a surface
// that does not exist in the spec cannot be "declared but unenforced". When a
// driver grows `fullTextSearch: true`, add its row here with a proof.

export const SEARCH_SURFACE: ConformanceRow[] = [
  {
    id: 'search-executor',
    // [#7641] "case-insensitive `$contains`" was self-contradictory under
    // #4706 Q2 = A, which rules `$contains` case-SENSITIVE. The executor now
    // emits `$icontains` — the operator that actually folds — so the row names
    // it. Neither operator's own semantics moved; only what `$search` compiles
    // to did.
    summary: '`$search` server-resolved cross-field executor (terms AND-ed, fields OR-ed, case-insensitive via `$icontains`)',
    surface: 'spec/api/query.zod.ts:$search (QueryParams `search`)',
    state: 'enforced',
    enforcement: 'objectql/src/engine.ts (find AST expansion) → objectql/src/search-filter.ts expandSearchToFilter',
    proof: 'showcase-search.dogfood.test.ts',
  },
  {
    id: 'searchable-fields-object',
    summary: '`object.searchableFields` — canonical allowed-search-field set; auto-default (name/title + short text, secret/PII/json excluded) when unset',
    surface: 'spec/data/object.zod.ts:searchableFields',
    state: 'enforced',
    enforcement: 'spec/data/search-fields.ts resolveSearchFieldResolution (consumed by objectql/src/search-filter.ts)',
    proof: 'showcase-search.dogfood.test.ts',
  },
  {
    id: 'search-fields-override',
    summary: '`$searchFields` per-query narrowing — validated against the allowed set, can never widen it; a name outside the set is 400 INVALID_FIELD at the REST ingress (#4254), not silently dropped',
    surface: 'spec/api/query.zod.ts:$searchFields',
    state: 'enforced',
    enforcement: 'spec/data/search-fields.ts resolveSearchFields (intersection) + metadata-protocol/src/protocol.ts assertSearchFieldsAreSearchable (ingress gate)',
    proof: 'showcase-search.dogfood.test.ts',
  },
  {
    id: 'search-select-label-mapping',
    summary: 'select/status label→value mapping — a human label in the query matches option values',
    surface: 'spec/data/field.zod.ts:options (select) × $search',
    state: 'enforced',
    enforcement: 'objectql/src/search-filter.ts optionValuesMatching / fieldClausesForTerm',
    proof: 'showcase-search.dogfood.test.ts',
  },
];
