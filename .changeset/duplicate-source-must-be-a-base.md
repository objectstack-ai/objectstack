---
"@objectstack/runtime": minor
"@objectstack/spec": minor
---

`POST /packages/:id/duplicate` now refuses a source that is not a writable base, instead of answering `200` with an empty copy.

Duplicating a **running code package** answered `HTTP 200` with `{"success":false,"copiedCount":0,"failedCount":0,"copied":[],"failed":[]}` — and still created the target package record, leaving a real, listed, empty package behind. The source package had one object, four flows, views, dashboards and reports; none of it was copied, and nothing said why.

`copiedCount: 0` there was **by construction**, not a copy that failed. `duplicatePackage` clones the rows `sys_metadata` holds for the source, and a code package's metadata is delivered as code — it has no such rows — so the scan could never have found anything. A caller could not tell that from a base that really is empty, which is the ambiguity the platform already refuses to ship elsewhere: *a read that could not happen must not be reported as a read that found nothing.*

- **The refusal.** A code-loaded, platform- or marketplace-scoped source is now refused `422` with the new error code `DUPLICATE_SOURCE_NOT_A_BASE` (registered under `@objectstack/runtime`), naming the package and prescribing the remedy that exists for it — duplicate a base you own, or customise the code package in place with an ADR-0005 org overlay. The refusal runs **before** the protocol call, so the empty target record is no longer created; the writability verdict is the same `isWritablePackage` predicate the authoring and lifecycle gates already use.
- **The read-only lifecycle refusal stops prescribing a dead end.** `WRITABLE_PACKAGE_REQUIRED` (from `DELETE /packages/:id` and `PATCH /packages/:id/disable`) used to tell callers to "duplicate this one into a writable base (`POST /packages/:id/duplicate`) and change that" — a route which, for exactly the packages that refusal fires on, cannot help. It now points at the ADR-0005 overlay instead.

⚠️ Behaviour change for API callers: duplicating a code, platform or marketplace package was `200`, and is now `422`. Duplicating a **writable base** is untouched in every respect — including a base that owns no active rows, which still answers `200` with `copiedCount: 0`, because that read happened and found nothing.

Not changed: duplicate still does not clone a code package's items. ADR-0070 D4 duplicates a *base*, and is itself declared-and-not-built; teaching it to fork code packages would extend the decision rather than implement it, and the ADR still carries that as an open question.
