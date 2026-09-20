// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #18612 — ADR-0049 enforce-or-remove (maintainer ruling 2026-09-18, director
// batch #154 item 4, letter 2; the same day's addendum then ordered the D2
// conversion this entry sits beside).
//
// Both ship, and they answer different questions. The D2 conversion
// `cube-join-sql-and-relationship-removed` STRIPS the two keys wherever the
// chain is replayed — the artifact and stored-row rehydration seams, which is
// what keeps a cube written by 17.4-or-earlier tooling booting — and emits one
// notice per stripped site naming the cube that lost it. This SEMANTIC entry is
// the human-facing record the strip cannot be: an author who wrote a non-FK
// `sql` wanted a join this runtime does not perform, and a mechanical delete
// does not tell them that their numbers were never the ones they declared.
import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'cube-join-sql-and-relationship-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface:
    'analyticsCubes[].joins.<alias>.sql / analyticsCubes[].joins.<alias>.relationship — the '
    + 'authored ON clause and the declared cardinality on a cube join',
  replacement:
    'analyticsCubes[].joins.<alias>.name alone. The ON clause is DERIVED from the declared '
    + 'relationship between the two cubes\' objects, as a foreign-key equality: NativeSQLStrategy '
    + 'emits the LEFT JOIN and its ON from the dotted member path, and ObjectQLStrategy lowers the '
    + 'same alias to a relationship traversal with no ON clause at all. The record KEY is the '
    + 'foreign-key FIELD on the base object, never a second spelling of the object the join '
    + 'reaches.',
  reason:
    'The KEYS convert mechanically and do: the paired D2 conversion '
    + '`cube-join-sql-and-relationship-removed` deletes both from every join, which is lossless '
    + 'because neither ever had an effect to lose, and names the cube in each notice. What does '
    + 'NOT convert is the INTENT. `sql` was REQUIRED and documented as the ON clause, and no '
    + 'reader ever consulted it: an authored condition was REPLACED by the synthesised '
    + 'foreign-key equality and the aggregate came back under a 200, joined on something the '
    + 'author had not asked for. `relationship` carried a `.default(\'many_to_one\')` that nothing '
    + 'dispatched on, so `one_to_many` parsed, changed no SQL, and kept the many-to-one '
    + 'arithmetic. Deleting the keys restores honesty but does not give an author who wanted a '
    + 'non-FK join the thing they wanted, and it does not re-check the numbers the replaced join '
    + 'already produced. That is why this entry is a TODO addressed to them rather than a claim '
    + 'that the strip finished the job. A custom join condition is a capability card with its '
    + 'injection / allow-list boundary decided first, which the ruling deferred deliberately.',
  acceptanceCriteria:
    'Delete `sql` and `relationship` from every entry of every cube `joins` map; keep `name`. '
    + 'The paired D2 conversion `cube-join-sql-and-relationship-removed` performs that same '
    + 'strip mechanically wherever the chain is replayed — including over metadata already at '
    + 'rest, so a deployed artifact keeps booting while you do. Then check three things. (1) Did any deleted `sql` express something OTHER than the foreign-key '
    + 'equality between the two objects — a filtered join, a non-key column, a literal predicate? '
    + 'If so, the query you were getting was already the FK-equality answer and not the one you '
    + 'wrote, so re-read the numbers that join produced before assuming this change moved them; the '
    + 'fix is to model the relationship on the object, or to open a capability request for an '
    + 'authorable join condition. (2) Did any deleted `relationship` say anything but '
    + '`many_to_one`? If so, the aggregate was already computed as many-to-one and still is — this '
    + 'change alters no result, it only stops the declaration from claiming otherwise. (3) Is each '
    + 'join KEYED by a foreign-key field of the cube\'s own base object? The key is the column the '
    + 'derived ON clause reads, so a join keyed after the object it REACHES never resolved at all. '
    + 'Nothing else regresses: `joins.<alias>.name` is unchanged, and it is what both the joined '
    + 'table and the per-object RLS/tenant read scope are resolved from.',
};
