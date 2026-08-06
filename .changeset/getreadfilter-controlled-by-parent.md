---
"@objectstack/plugin-security": patch
---

fix(plugin-security): `getReadFilter` applies the `controlled_by_parent` derivation — the analytics read scope was missing the master half entirely

`getReadFilter` is the read-scope provider bound by the analytics / raw-SQL
path: the one read surface that bypasses the engine and therefore has no other
source of scope. Its contract is that it returns **the same filter the engine
middleware ANDs into every find**. That middleware injects three things — the
RLS filter, the ADR-0055 `controlled_by_parent` derivation (`masterFK IN
(accessible master ids)`), and plugin-sharing's OWD / record-share filter.
`getReadFilter` composed only the first and third; `computeControlledByParentFilter`
was never called on that path at all.

For an object whose `sharingModel` is `controlled_by_parent` that is not a
partial gap but a total one, because the two layers it *did* compose both stand
down on exactly that object by design: such an object carries no authored RLS
(the whole point of the model is that access is derived rather than authored),
and it maps to `public` in plugin-sharing's `effectiveSharingModel`, so
`buildReadFilter` returns `null`. Both halves returned `null`, the composition
returned `undefined`, and the analytics path ran with **no predicate**. A caller
who could not read a single master row through `/data` could still `COUNT(*)`
and `GROUP BY` its detail rows through `/analytics` — and line-item objects are
the usual shape here, so the grouped values are per-line prices and discounts.

The derivation is now composed into the same AND on that path, resolved from the
permission sets `getReadFilter` had already resolved (no second resolution), so
the two read surfaces enforce identical scoping — which is why
`computeControlledByParentFilter` was extracted and shared in the first place.
Failures deny: the derivation is internally fail-closed, and a throw propagates
to the method's existing fail-closed handler rather than widening the read. The
delegated (`onBehalfOf`) branch already denied outright on this path (#2852) and
is unchanged.

This is the same failure shape #4467 fixed for the OWD/sharing layer of this
method, one layer over; #5386 fixed *which inputs* the derivation folds in, not
*whether it runs* on this surface.

**Impact.** A deployment with `controlled_by_parent` objects and an analytics /
raw-SQL consumer will see those queries return fewer rows — the rows the caller
was never entitled to aggregate. No authoring change is required.
