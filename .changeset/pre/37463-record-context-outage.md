---
'@objectstack/service-record-context': patch
---

fix(record-context): a related object's read that fails is answered as a failure, not as "no access"

Clause-②: no
Metadata-protocol: none

`get_record_context` reads each related object of a pack before it answers: the object's API exposure, its definition as the caller is served it, its published definition, and the related list itself. When one of the first three reads failed for a reason that is not a refusal (the database or the metadata store down, a bug), the call was refused `PERMISSION_DENIED` (403), as if the caller could not read the object. Such a failure now fails the call `INTERNAL_ERROR` (500), and the thrown error carries the original on `cause`. At the related-list read, the raw error left the executor and the MCP doors classified it. That is still so for every throw the `/data` door answers with a code or sentence of its own. `INTERNAL_ERROR` (500) applies there to an uncoded failure only, one the doors answered `INTERNAL_ERROR` (500) before, which now fails the call the same way and carries the original on `cause`.

What an MCP caller sees for an uncoded failure, on either door: `{ code: 'INTERNAL_ERROR', status: 500 }` with the message `Internal server error`. The doors withhold a 5xx's own sentence, so the executor's sentence (which names the pack and the root record's object only) is read in-process only, for example by the host of `verifyRecordCitations`. Nothing names the related object, a field, a package or what the failed read said. Each door logs the failure at `error` on every call, with the thrown error and its `cause`.

A refusal at the same reads is answered as before. At the first three reads a coded refusal (a string `code` with a declared 4xx status, a disabled package's included) refuses `PERMISSION_DENIED` (403). At the related-list read, a throw the `/data` door answers itself is left to the door as before, with its own code and sentence. A refusal: a sandboxed `beforeFind` hook's plain throw still answers `400 HOOK_ABORTED`, and a `PERMISSION_DENIED` with no status still answers 403. A coded fault: an unavailable datasource still answers `ERR_DATASOURCE_UNAVAILABLE` (503) with its sentence, a driver error the door recognises `DATABASE_ERROR` (500), a driver's declared `NOT_IMPLEMENTED` (501) and a declared 5xx their own code, with the sentence the producer declared for the caller.

`verifyRecordCitations` therefore reports such a failure through `onError` (its citations are still dropped), where at the first three reads it used to drop them without a report. A host that retries or logs on `onError` now sees outages behind a pack with related lists.

The package gains one dependency, `@objectstack/types` (already a dependency of `@objectstack/core`), for the `/data` door's classifier the related-list read asks.
