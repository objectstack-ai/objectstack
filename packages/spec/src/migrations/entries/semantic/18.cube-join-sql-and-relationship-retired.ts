// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #18612 — ADR-0049 enforce-or-remove (maintainer ruling 2026-09-18, director
// batch #154 item 4, letter 2). A SEMANTIC entry rather than a D2 conversion,
// for the reason the `list-view-navigation-view-retired` entry states one
// surface over: a mechanical strip would delete the key without recording which
// cube lost it, and an author who wrote a non-FK `sql` wanted a join the runtime
// does not perform — that want needs a decision (model the relationship, or
// open the capability card the ruling defers), and a stripped key does not
// record it. The ruling's census found zero authored cube joins outside this
// repository, so there is also no consumer source for a conversion to rewrite.
// The `guidance` prescriptions therefore carry no `os migrate meta` sentence:
// that sentence is owed only where a conversion covers the surface.
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
    + 'same alias to a relationship traversal with no ON clause at all.',
  reason:
    'Not losslessly convertible, because the two keys never had an effect and a mechanical strip '
    + 'would hide which cube was affected. `sql` was REQUIRED and documented as the ON clause, and '
    + 'no reader ever consulted it: an authored condition was REPLACED by the synthesised '
    + 'foreign-key equality and the aggregate came back under a 200, joined on something the '
    + 'author had not asked for. `relationship` carried a `.default(\'many_to_one\')` that nothing '
    + 'dispatched on, so `one_to_many` parsed, changed no SQL, and kept the many-to-one arithmetic. '
    + 'Deleting the keys restores honesty but does not give an author who wanted a non-FK join the '
    + 'thing they wanted, which is why this is a TODO addressed to them rather than a rewrite '
    + 'applied on their behalf. A custom join condition is a capability card with its injection / '
    + 'allow-list boundary decided first, which the ruling deferred deliberately.',
  acceptanceCriteria:
    'Delete `sql` and `relationship` from every entry of every cube `joins` map; keep `name`. Then '
    + 'check two things. (1) Did any deleted `sql` express something OTHER than the foreign-key '
    + 'equality between the two objects — a filtered join, a non-key column, a literal predicate? '
    + 'If so, the query you were getting was already the FK-equality answer and not the one you '
    + 'wrote, so re-read the numbers that join produced before assuming this change moved them; the '
    + 'fix is to model the relationship on the object, or to open a capability request for an '
    + 'authorable join condition. (2) Did any deleted `relationship` say anything but '
    + '`many_to_one`? If so, the aggregate was already computed as many-to-one and still is — this '
    + 'change alters no result, it only stops the declaration from claiming otherwise. Nothing else '
    + 'regresses: `joins.<alias>.name` is unchanged, and it is what both the joined table and the '
    + 'per-object RLS/tenant read scope are resolved from.',
};
