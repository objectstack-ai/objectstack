---
'@objectstack/service-record-context': patch
---

fix(record-context): a related object's read that fails is answered as a failure, not as "no access"

Clause-②: no
Metadata-protocol: none

`get_record_context` reads each related object of a pack before it answers: the object's API exposure, its definition as the caller is served it, its published definition, and the related list itself. When one of the first three reads failed for a reason that is not a refusal (the database or the metadata store down, a bug), the call was refused `PERMISSION_DENIED` (403), as if the caller could not read the object. When the related-list read failed that way, the raw error left the executor and the MCP doors answered it `INTERNAL_ERROR` (500). Such a failure now fails the call `INTERNAL_ERROR` (500) at all four reads, and the thrown error carries the original on `cause`.

What an MCP caller sees for it, on either door: `{ code: 'INTERNAL_ERROR', status: 500 }` with the message `Internal server error`. The doors withhold a 5xx's own sentence, so the executor's sentence (which names the pack and the root record's object only) is read in-process only, for example by the host of `verifyRecordCitations`. Nothing names the related object, a field, a package or what the failed read said. Each door logs the failure at `error` on every call, with the thrown error and its `cause`.

A refusal at the same reads is answered as before. At the first three reads a coded refusal (a string `code` with a declared 4xx status, a disabled package's included) refuses `PERMISSION_DENIED` (403). At the related-list read, a throw the `/data` door answers below 500 is left to the door as before: a sandboxed `beforeFind` hook's plain throw still answers `400 HOOK_ABORTED`, and a `PERMISSION_DENIED` with no status still answers 403.

`verifyRecordCitations` therefore reports such a failure through `onError` (its citations are still dropped), where at the first three reads it used to drop them without a report. A host that retries or logs on `onError` now sees outages behind a pack with related lists.

The package gains one dependency, `@objectstack/types` (already a dependency of `@objectstack/core`), for the `/data` door's classifier the related-list read asks.
