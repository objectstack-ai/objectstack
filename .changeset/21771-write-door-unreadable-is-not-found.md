---
'@objectstack/plugin-security': minor
"@objectstack/spec": patch
---

fix(plugin-security)!: on the write doors, a row the caller cannot read answers what a nonexistent id answers

Clause-②: no (narrowing)

<!-- adr-0087: registered by-id-write-unreadable-row-not-found -->

**BREAKING**: a by-id update or delete of a row the caller cannot read now answers `404 RECORD_NOT_FOUND`, with exactly the body an id that names no row gets, for every principal class. On the write doors, "hidden" and "gone" are now one answer to a caller who cannot read the row. It ships as `minor` under the launch-window convention for accept-set narrowings. No export is added or removed, and no error code is new.

**What changed.** The answer used to depend on which gate saw the row first. Where a write-class row filter binds the caller, the by-id write pre-image check answered `403 PERMISSION_DENIED`. Where none binds it, a later gate answered with its own 403: `FORBIDDEN` from record sharing, or a parent-derived gate's code on attachments and comments. Meanwhile a nonexistent id answered `404`. So the write door could tell a hidden row apart from a missing one. The pre-image check now asks the read door's own question first, for the by-id write the caller addressed: a by-id read in the caller's context, every data middleware's visibility included. A row that read does not return gets the read door's not-found producer. A store fault propagates as raised, and a read-time policy refusal is not treated as absence.

**What is refused now that was not.** A principal that no write-class row filter binds could have its by-id write admitted on a row the read door hides from it. One example is the uploader of an attachment, or the author of a comment, whose parent record they can no longer read. That write is now refused with the not-found answer, as it already was for every principal a row filter binds.

**FROM → TO.** A by-id update or delete of a row hidden from the caller: FROM a `403` (`PERMISSION_DENIED`, `FORBIDDEN`, or a parent-derived gate's code) → TO `404 RECORD_NOT_FOUND`, the body a nonexistent id gets.

**If you are affected.** A client that read a by-id write's `403` as "the row exists, but you may not change it" should read `404 RECORD_NOT_FOUND` the way the read door means it: no row you can see has this id.

**Unchanged.**
- A caller who can read the row but may not write it keeps its 403. They already see the row.
- By-id writes the platform issues under the caller's context keep their previous answer, because the caller never named their target: the engine's cascade delete of a dependent row, a hook's write, and the referential clear of a lookup.
- Writes that are not routed by id are unchanged.

`security/explain` follows enforcement. Its record verdict for an update or delete of a record the principal cannot read is now the missing-record shape: `visible: false`, with no decider.
