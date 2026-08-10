// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'driver-sql-distinct-bare-filter-typed',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span already, and a nested backtick would close it.
  surface: 'SqlDriver.distinct() third argument — any value',
  replacement:
    'a bare FilterCondition (@objectstack/spec/data) — the same value find() carries '
    + 'under query.where, never a query envelope',
  reason:
    'This entry records a TYPE being added, not a surface being withdrawn, and it says '
    + 'so up front because the distinction decides who has to do anything. `distinct` is '
    + 'not declared on `IDataDriver`, so #5181 / #6075 never reached it and it kept '
    + '`filters?: any` while its body said something far more specific — '
    + '`applyFilters(builder, filters)` is handed the ARGUMENT ITSELF, never a `.where` '
    + 'off it. ⚠️ RUNTIME BEHAVIOUR IS UNCHANGED by this entry\'s change: not one '
    + 'statement moved, so no upgrade breaks at run time and nothing that answered '
    + 'correctly stops. What the annotation removes is a compile-time hole, measured '
    + 'rather than assumed: a truthy NON-OBJECT third argument — '
    + '`distinct(\'orders\', \'product\', \'completed\')` — used to type-check and resolve '
    + 'the UNFILTERED set, because `applyFilters` emits no predicate at all for a truthy '
    + 'non-object, non-array filter. A call meaning "which products among completed '
    + 'orders" answered with EVERY product, silently. That spelling is now TS2345 at the '
    + 'call site. This is a driver CALL ARGUMENT — code, never stack metadata — so there '
    + 'is no source for the D2 chain to rewrite and deliberately no schema tombstone, the '
    + 'disposition `data-driver-find-stream-retired` (#4484), `storage-service-list-retired` '
    + '(#5540), `actor-user-roles-to-positions` (#6011) and '
    + '`driver-aggregate-undeclared-key-aliases-removed` (#6321) already carry. ⚠️ It '
    + 'differs from those four in ONE measured way a reader should not have to infer: '
    + 'because nothing changed at run time, an untyped JS caller is not affected BY THE '
    + 'UPGRADE at all. The entry is here for a different reason — such a caller is exactly '
    + 'the one tsc can never reach, and the silent widening above is a defect they may '
    + 'ALREADY be sitting on, before and after this major. The generated upgrade guide is '
    + 'the only channel that reaches them, which is why the fix is written down rather '
    + 'than left to the compiler. ⛔ The reverse mismatch is NOT closed and no type can '
    + 'close it: `FilterCondition` is an open map (`[key: string]: any`) because a filter '
    + 'key IS a field name, so a query envelope `{ object, where }` is structurally a '
    + 'valid filter — one constraining columns named `object` and `where` — and so is a '
    + 'FilterArray. Both reach `distinct` type-checked and are refused at run time, '
    + 'loudly, with INVALID_FILTER / 400. `driver-memory`\'s opposite half — where the '
    + 'BARE spelling returns the unfiltered set in silence — stays open under the #5499 '
    + 'freeze (#6320). ADR-0087, #6320.',
  acceptanceCriteria:
    'No caller passes a non-object to `distinct()`\'s third argument. A scalar there is '
    + 'now a compile error (`TS2345: Argument of type \'string\' is not assignable to '
    + 'parameter of type \'FilterCondition\'`); rewrite it as the bare filter it was '
    + 'always meant to be — `\'completed\'` becomes `{ status: \'completed\' }`. ⚠️ That '
    + 'is NOT an equivalent rewrite: the old spelling returned the UNFILTERED set, so the '
    + 'answer changes once fixed, and the changed answer is the one the call always meant. '
    + 'An untyped JS caller gets no compile error and no behaviour change — for them this '
    + 'entry is the only notice that the spelling never filtered anything. A query '
    + 'envelope or a FilterArray in that slot still compiles and is rejected at run time '
    + 'with INVALID_FILTER / 400.',
};
