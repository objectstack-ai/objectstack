---
"@objectstack/objectql": minor
---

feat(objectql): `engine.isFileReferencesMigrationVerified()` is public — one memoized flag read for both in-process consumers (#3459 PR-5b)

The memoized per-deployment read of the `adr-0104-file-references` migration
flag was private to the engine's media value-shape enforcement. The storage
service's release path now asks the same question — may a released field file
be tombstoned? — so the method is public and the release hooks reach it as an
optional duck-typed member (an older engine or a test fake reads as "not
verified", failing closed). One read, one invalidation
(`invalidateDataMigrationFlags()`), no way for the two consumers to see
different answers.
