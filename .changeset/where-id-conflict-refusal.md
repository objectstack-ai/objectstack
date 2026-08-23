---
"@objectstack/metadata-core": minor
"@objectstack/objectql": minor
"@objectstack/spec": minor
---

**BREAKING (accept-set tightening)**: a by-id `update` whose truthy scalar `options.where.id` names a DIFFERENT row than the truthy scalar payload `data.id` is now refused loudly — `UPDATE_ID_MISMATCH`, HTTP 400 — instead of silently binding the payload row and discarding the `where.id` predicate (#11142).

`update(obj, { id: 'rec_1', title: 'x' }, { where: { id: 'rec_2' } })` used to write `rec_1` with no diagnostic: the caller declared "update rec_1 where id = rec_2" — a condition that can never hold — and the by-id path dropped the losing spelling exactly the way #11009's extra `where` keys were dropped. This was the one unhonoured-predicate shape #11009's refusal deliberately left standing, because refusing it partially reverses the #5748-pinned verdict (`a SCALAR data.id still wins over a scalar where.id`). The maintainer ruling on #11142 (2026-08-23) authorizes that reversal for the UNEQUAL truthy scalar shape only.

What changes, per call shape (`resolveEngineUpdateDispatch`, so every pinned test double inherits the same verdict):

- `data.id === where.id` (both truthy scalars) is **unchanged** — by-id. This is the normal REST spelling: the ingress folds the path id into the payload, so redundant-but-agreeing pairs are routine.
- `data.id` and `where.id` both truthy scalars and **different** — including differing only in type, e.g. `42` beside `'42'` — now **throws** `UPDATE_ID_MISMATCH` with `status: 400`, naming both ids. A declared `multi: true` does not rescue the call (the payload id outranks `multi` per #5748, so the contradiction stands). Previously the write landed on the payload row with the condition silently ignored.
- A **falsy** scalar `where.id` (`0`, `''`) beside a payload id is unchanged (a falsy id identifies no row on this ladder, so there is no second row address to conflict with), and a **non-scalar** `where.id` (`{ $in: [...] }`, an array, `null`) beside a payload id keeps its #5748 by-id verdict — widening over either is a separate decision, deliberately not taken here.

A caller hitting the new refusal wrote two row addresses and meant one of them; each fix is a one-line edit at the call site: make the two ids equal (or drop `where.id`) to keep addressing the row by the payload id, or remove `id` from the payload to address the row by `where.id`. The refusal is decorated with `code: 'UPDATE_ID_MISMATCH'` and `status: 400` on the thrown error (registered in the ADR-0112 error-code ledger; the spec's `ErrorCode` union gains the member), so REST callers get a located 400 instead of a sanitised 500, and doubles pinned to `assertEngineUpdateDispatch` throw the identical envelope.

<!-- adr-0087: not-required (no-migration-prescription) No authorable surface is removed or renamed — no spec key, no export, no config field changes spelling, so `objectstack migrate meta` has nothing to rewrite and no ledger entry could serve an upgrader. The newly-refused call shape was a self-contradictory input whose declared condition was never evaluated; deciding which of the two ids the caller meant is a per-site intent decision a mechanical rewrite must not make, and the refusal text itself names both call-site fixes. -->
