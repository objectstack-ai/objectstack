---
'@objectstack/metadata-protocol': patch
---

Seed loader: the pass-2 deferred-reference diagnostics now say which moment they describe

`SeedLoaderService` runs inside `AppPlugin.start()`, which the kernel completes for every
plugin before it fires `kernel:ready` — where the first-admin handoff
(`claimSeedOwnership`) re-owns every `owner_id IS NULL` row of every user-authored object.
That handoff is the designed completion of a NULL owner column, so two of the loader's
pass-2 lines — `Deferred reference UNRESOLVED after pass 2` and
`Deferred reference back-fill FAILED` — were making a bare present-tense claim
(`x.owner_id stays NULL`) that the same boot then made false, with nothing in either the
log or the table to tell an operator that the other reading existed.

Both lines now read `is NULL at the end of pass 2` and carry a scope sentence naming the
boot step that can supersede them and stating that a non-NULL value found later is not
evidence the reference resolved. Level, error count and remedy are unchanged — this is a
scope declaration, not a silencing. The two `Deferred reference DROPPED` lines are
deliberately untouched: they report a row that never landed, so no later boot step can
write a column of it and their claim survives to the end of boot as written.

Nothing an author writes changes. Anything that greps the loader's output for the literal
`stays NULL` on these two lines should grep for `is NULL at the end of pass 2` instead.
