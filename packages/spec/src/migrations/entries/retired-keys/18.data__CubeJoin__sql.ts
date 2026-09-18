// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #18612 — ADR-0049 enforce-or-remove (maintainer ruling 2026-09-18, director
// batch #154 item 4, letter 2). `CubeJoin.sql` was REQUIRED and described itself
// as the `ON` clause, and nothing ever read it: both analytics strategies
// SYNTHESISE the join, so an authored condition was not ignored but REPLACED by
// a foreign-key equality, returned under a 200 with a plausible number attached
// (the #10298 shape). Measured with a positive control — zero reads of a join's
// `sql` in any non-test source, against eight reads of the neighbouring
// `cube.joins?.[alias]?.name` in native-sql-strategy.ts, objectql-strategy.ts
// and analytics-service.ts.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the `data/Metric:filters`
// precedent, one shape over in the same file). `CubeJoinSchema` is a
// `strictObject`, so the route is strict deletion plus a `guidance` entry
// carrying the prescription — no `retiredKey()` tombstone, the key is out of
// the walked shape entirely, and its liveness-ledger row left with it.
//
// A D2 conversion DOES cover this surface: `cube-join-sql-and-relationship-removed`
// (`toMajor: 18`, `retiredFromLoadPath: true`) strips the key wherever the chain
// is replayed. It is owed because the key was REQUIRED, so every cube artifact
// ever written from the old schema's parse output carries it and would meet the
// boot door's refusal with no remedy short of hand-editing JSON. The guidance
// prescription therefore closes with the house `os migrate meta --from 17`
// sentence, and the D3 semantic entry `cube-join-sql-and-relationship-retired`
// carries the judgement the strip cannot: an author who wrote a non-FK
// condition wanted a join this runtime does not perform.
export const entry = 'data/CubeJoin:sql';
