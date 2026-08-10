---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/driver-sql': patch
---

refactor(spec,objectql,driver-sql): the autonumber counter readback is one shared pure function, beside the renderer it inverses (#6560)

`packages/spec` gains `readAutonumberCounter(value, prefix, suffix)`, the declared
inverse of `renderAutonumber`, and both consumers call it instead of holding their
own copy.

**Why the inverse belongs where the composition already lives.** `renderAutonumber`
composes `prefix + zero-padded(seq) + suffix` and its file header states it is
"shared by the ObjectQL engine and the SQL driver so both paths render identical
record numbers". PR #6553 (#6468) had to teach both seeding paths to read a counter
back out of a stored value — and landed that reading as two hand-written copies of
the same four lines, one in `packages/objectql`, one in
`packages/drivers/driver-sql`. That is the exact shape of the defect those copies
were fixing: two independent readings of one composition rule had already drifted
into two *different* wrong answers over one dataset (`001-2026` read as `2026` by
the engine and `12026` by the driver), so the record-number band a tenant received
depended on which driver happened to run, and numbers burned that way cannot be
reclaimed. A cross-package `runtime` parity test caught the drift once; it does not
force a future single-side edit to run it.

**What moved and what did not.** Only the ANCHORED rule — the one both sides must
apply identically — is now spec's: the counter is the digit run at the start of
what follows the rendered `prefix`, after stripping the rendered `suffix` when the
value carries it (stripped when it matches, never required to match, since one
counter spans the years a dynamic suffix renders). Out-of-scope values read as
`undefined`, which also gives the SQL driver back its JS-side re-check of a `LIKE`
that matched looser than `startsWith` under a case-insensitive collation.

The UNANCHORED case (neither affix declared) stays per-side, because the two sides
deliberately differ there and #6553 preserved both byte-for-byte: the engine reads
the last digit run, the driver concatenates every digit. Spec returns `undefined`
rather than pick one — a shared contract that claimed an agreement which does not
exist would be worse than no shared contract. Each side documents its own fallback
at its own call site.

**Zero behaviour change.** Every call site keeps its existing guards and its
existing result for every input; the `packages/runtime` cross-side parity suite that
pins the two seeding paths against each other is unmodified and passes as-is, which
is the evidence the semantics moved without changing. Per the maintainer's ruling on
#6560 (2026-08-08, twice, re-confirmed 2026-08-10): a non-authorable export — no
Zod, no new vocabulary, no acceptance-face change — so this is api-surface
bookkeeping plus two call-site swaps.
