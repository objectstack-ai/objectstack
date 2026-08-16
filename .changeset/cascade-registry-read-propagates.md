---
"@objectstack/objectql": patch
---

fix(objectql): the delete-cascade path's two registry reads propagate instead of answering "no relations" (#9002)

`ObjectQL.delete()`'s by-id branch reads `registry.getAllObjects()` twice, and
both reads sat behind a swallow that invented an answer for a read that never
happened:

- `planCascadeAtomicity()` — `catch { return 'none' }`. `'none'` is the verdict
  that asserts *nothing references this object*, so #7413's cascade atomicity
  was silently switched off on a registry nobody could read.
- `cascadeDeleteRelations()`, its first statement — `catch { return }`. That
  skips the cascade entirely: no `restrict` refusal, no `set_null`, no
  `cascade`, nothing logged, and the caller told the delete succeeded.

This is the #8895 shape one layer up, with a strictly larger blast radius:
#8895's `catch` invented "no dependents" for one relation whose probe could not
run; this one invented "no relations" for every relation at once, before the
per-relation probe was ever reached.

#8895 ruled the family *discriminate or propagate*. Discrimination needs a
benign failure class — there, an unprovisioned child table, which genuinely
cannot hold a referencing row. Here there is none: an unreadable registry is
never truthfully "no relations". So both `catch`es are removed and the read's
own failure reaches the caller, envelope intact — no new error code, no new
response field, and the second seam is decided in the same direction as the
first because its own argument rested on the first one firing.

**No shipped behaviour changes.** `SchemaRegistry.getAllObjects()` is a walk
over in-memory `Map`s (`resolveObject()` returns `undefined` on every failure
branch it models) with no I/O and no `throw` on the measured path, so nothing in
a running deployment can reach either seam today. This is a structural close of
a fail-open shape, pinned by tests, so that the day the registry read grows a
throwing path it fails loudly instead of disabling every referential guard at
once.
