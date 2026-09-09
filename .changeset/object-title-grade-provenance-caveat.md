---
"@objectstack/spec": patch
---

`ObjectTitleCompleteness.status` now documents which INPUT each grade describes. No predicate, no grade computation and no accept set moves — the classification is unchanged and correct; what changes is what the declaration tells the reader it means.

`explicit` was documented as "an explicit pointer (`nameField`/`displayNameField`) is set". That is accurate about the predicate, and that is what made it dangerous: on a body served by a `/meta` read exit a pointer is present whether or not the author wrote one, because the exit replays the registry's object-materialization seam (`materializeServedObjectOnto`, which runs `provisionPrimary` in designate-only mode). So `explicit` there means "a pointer is present", never "the author designated this" — and the old wording invited the second reading at every call site.

The corrected declaration says three things the old one left to inference:

- **Provenance decides the grade.** On a served body `explicit` carries no authorship information, and `derived` is unreachable except where that replay withheld the designation. On a body captured before the write seam — an authored definition as written, which is what `os build` / `os lint` hand this predicate through `@objectstack/lint`'s `validateRecordTitle` — `explicit` really does mean the author wrote a pointer.
- **Authorship is not recoverable afterwards, deliberately.** The write-side inverse `stripProvisionedPrimaryFrom` removes the pointer exactly when it is byte-identical to what the derivation would produce, and says so in its own words: the two are indistinguishable by construction, the same bytes. Neither the served document nor the stored row can answer "did the author designate this?".
- **The consequence for callers.** Never build a check on `explicit` that needs the authored answer without first proving the input is a pre-write body.

`objectTitleCompleteness` itself carries the one-sentence form of the same warning, because a caller hovering the function is on a different path from a caller hovering the grade.

The correct words already existed in this repo — on the WRITE seam, where nobody reading the grade goes. This moves their substance to the grade.
