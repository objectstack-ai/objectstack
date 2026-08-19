---
"@objectstack/spec": minor
"@objectstack/service-storage": patch
"@objectstack/runtime": patch
"@objectstack/metadata-protocol": patch
"@objectstack/cli": patch
"@objectstack/plugin-email": patch
"@objectstack/plugin-dev": patch
---

feat(spec): `storage` becomes the canonical `CoreServiceName` slot; `file-storage` stays a deprecated v17 alias (#9683)

<!-- adr-0087: not-required (no-migration-prescription) A service-registry slot
name is not authorable metadata — nothing in a stack definition spells it — so
there is no conversion-layer entry to register. Compatibility is carried by the
enum keeping the old member and by @objectstack/service-storage registering the
same instance under both names; the alias retires through the standard
retirement flow at the next major. -->

Maintainer ruling, 2026-08-18, verbatim: 「9683 file-storage 可以叫 storage」.
The `file-storage` slot was the only `CoreServiceName` member whose spelling
diverged from its documented accessor (`services.storage`), with no recorded
reason anywhere in the tree.

- `CoreServiceName` gains `storage` as the canonical member; `file-storage`
  stays an accepted, deprecated alias within v17 (it is a published enum
  member — existing `getService('file-storage')` callers keep working).
  `CORE_SERVICE_PROVIDER` and `ServiceRequirementDef` carry both.
- `@objectstack/service-storage` registers the **same instance** under both
  names (the `http.server` / `http-server` pattern), pinned by an
  alias-equivalence test.
- Every internal consumer resolves `storage`: the HTTP dispatcher, the email
  plugin's attachment store, and `os migrate files-to-references`. Discovery
  reports the service under the canonical `storage` key and mirrors the row
  verbatim under the `file-storage` key for the alias's v17 lifetime, so
  existing discovery readers (e.g. the console endpoint catalog) keep
  working.
- Docs (`kernel/runtime-services`, `kernel/contracts`) now document the
  canonical slot; a custom v17 provider for this slot should register both
  names.
