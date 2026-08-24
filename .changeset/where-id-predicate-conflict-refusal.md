---
"@objectstack/metadata-core": minor
"@objectstack/objectql": minor
---

**BREAKING (accept-set tightening)**: a by-id `update` whose bound truthy scalar payload `data.id` stands beside a DECLARED but non-scalar `options.where.id` — `{ $in: [...] }`, an array, `null` — is now refused loudly (`UPDATE_ID_MISMATCH`, HTTP 400) instead of silently binding the payload row and discarding both the id predicate and any declared `multi: true` (#11230).

`update(obj, { id: 'rec_1', title: 'x' }, { where: { id: { $in: ['a', 'b'] } }, multi: true })` used to write exactly one row — `rec_1` — with no diagnostic: the payload id outranked `where` and `multi` alike (#5748), so the declared row SET and the declared bulk intent were both dropped, and `rec_1` need not even have been a member of the set. This was the LAST silent member of the dropped-declaration family (#5748 payload operator-objects, #11009 extra `where` keys, #11142 unequal scalar `where.id`); closing it reverses the remaining half of the #5748-pinned verdict `a SCALAR data.id still outranks where and multi`, which the maintainer ruling on #11230 (2026-08-23) authorizes.

What changes, per call shape (`resolveEngineUpdateDispatch`, so every pinned test double inherits the same verdict):

- A truthy scalar `data.id` beside a **non-scalar** `where.id` — an operator object, an array, `null`, or an explicitly-`undefined` `id` key — now **throws** `UPDATE_ID_MISMATCH` with `status: 400`, naming the payload id and the KIND of predicate the caller wrote. `multi: true` does not rescue the call (the payload id outranks `multi` per #5748, so the contradiction stands). Previously the write landed on the payload row with both declarations silently ignored.
- Boundaries that do **not** move: a **falsy** scalar `where.id` (`0`, `''`) is a scalar and keeps its #11142 verdict (by-id); a `where` that declares **no** `id` key at all (`{}`, or no `where`) is untouched; and with **no** scalar payload id the ladder is exactly as #5748 left it (`multi` when declared, otherwise `reject`) — the refusal lives only on the payload-sourced by-id arm.
- The refusal shares the #11142 error code deliberately — one ADR-0112 ledger member for one defect class, two messages. No new code is registered.

A caller hitting the new refusal declared a row address and a row-set predicate in one call and meant one of them; each fix is a one-line edit at the call site: drop `id` from the payload to write EVERY row the predicate selects (`update(object, fields, { where: { id: { $in: [...] } }, multi: true })`), or drop `where.id` to write the single row the payload names (`update(object, { id, ...fields })`). The refusal text names both. Measured before shipping: **no in-repo call site constructs the pair** — every production `where.id` predicate (the outbox sweeps) carries a payload with no `id` — so the in-repo blast radius is nil; an external SDK caller can still write it, and today that silently drops both declarations.

<!-- adr-0087: not-required (no-migration-prescription) No authorable surface is removed or renamed — no spec key, no export, no config field changes spelling, so `objectstack migrate meta` has nothing to rewrite and no ledger entry could serve an upgrader. The newly-refused call shape is a self-contradictory input whose declared condition was never evaluated; deciding whether the caller meant the payload row or the predicate's row set is a per-site intent decision a mechanical rewrite must not make, and the refusal text itself names both call-site fixes. -->
