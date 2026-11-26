---
'@objectstack/service-record-context': patch
---

fix(record-context): a related object's read that fails is answered as a failure, not as "no access"

Clause-②: no
Metadata-protocol: none

`get_record_context` reads each related object of a pack before it answers: the object's API exposure, its definition as the caller is served it, its published definition, and the related list itself. When one of those reads failed for a reason that is not a refusal (the database or the metadata store down, a bug), the call was refused `PERMISSION_DENIED` (403), as if the caller could not read the object. Such a failure now fails the call `SERVICE_UNAVAILABLE` (503). Its sentence names the pack and the root record's object only, never the related object, a field, a package or what the failed read said; the original error is on the thrown error's `cause` for the host. A coded refusal at the same reads, a disabled package's included, is refused `PERMISSION_DENIED` (403) as before.

`verifyRecordCitations` therefore reports such a failure through `onError` (its citations are still dropped), where it used to drop them without a report. It reads the line between a refusal and a failure with the same rule as the executor: a refusal is a throw with a string `code` and a declared 4xx status. A host that retries or logs on `onError` now sees outages behind a pack with related lists.
