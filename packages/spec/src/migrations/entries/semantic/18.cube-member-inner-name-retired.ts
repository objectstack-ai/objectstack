// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20300 — ADR-0049 enforce-or-remove (triage verdict RETIRE) — the D3 entry of
// the `cube-member-inner-name-removed` family (one D3 entry per retirement
// family, even when D2 is lossless). Registered keys: `data/Metric:name` and
// `data/Dimension:name`. The strip changes no query and no discovery answer;
// what it cannot decide is which of two DISAGREEING names an author meant.
export const entry: SemanticMigration = {
  id: 'cube-member-inner-name-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface:
    'analyticsCubes[].measures.<metric>.name / analyticsCubes[].dimensions.<dimension>.name — the '
    + 'inner name a cube member used to require',
  replacement:
    'The record key. `measures` and `dimensions` are records, and the key a member is declared under '
    + 'IS its name: the analytics API publishes it as `<cube>.<key>` and a query names it that way. To '
    + 'rename a member, rename its key.',
  reason:
    'The D2 conversion `cube-member-inner-name-removed` deletes the inner `name` from every metric and '
    + 'dimension of every cube, and the delete is lossless in behaviour: every consumer — discovery, both '
    + 'query strategies, the in-memory driver — resolves a member by its record key, so the inner value '
    + 'was never read. Where it EQUALED its key there is nothing left to decide. Where it DISAGREED, the '
    + 'key was already the name every query, dashboard and report used, and the inner value was a spelling '
    + 'nothing read; the conversion notice prints both. Only the author can say whether the disagreeing '
    + 'spelling was the one they meant — in which case the member must be re-keyed, and every consumer '
    + 'that names `<cube>.<old key>` changes with it — or a stale copy to drop.',
  acceptanceCriteria:
    'No metric or dimension of any cube carries `name`; the parse refuses it with the prescription. '
    + 'For every conversion notice whose `from` shows a name that differed from its record key, the '
    + 'author has either kept the key (nothing else changes) or re-keyed the member to the intended '
    + 'name and updated every query, dashboard and report that names `<cube>.<old key>`. '
    + '`GET /api/v1/analytics/meta` lists each member as `<cube>.<key>` exactly as before the upgrade.',
};
