<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->

# `services/service-storage` — tenant-audit census shard (generated)

The write call sites in `packages/services/service-storage/`, as `scripts/tenant-audit-census.mjs`
derives them from the tree: this package's totals and every one of its sites.
One file per package, and no total across packages is committed anywhere —
`node scripts/check-tenant-audit-census.mjs` prints the census totals. The
method is in [the ledger index](../../2026-08-tenant-audit-write-call-sites.counts.md). ⛔ Never hand-patch
a row or a number here — fix the code, or the census, and regenerate.

## Totals in this package

| Measure | Value |
|---|---:|
| Write call sites | 25 |
| Object name statically decidable | 22 |
| Object name chosen at run time | 3 |
| Object name spelled inline | 20 |
| Object name spelled through a `const` | 2 |
| Object name is an `object: string` parameter | 0 |
| Object name is some other run-time expression | 3 |
| Against a tenancy-enabled object | 22 |
| Against an object declaring tenancy off | 0 |
| Threading a tenant context | 16 |
| Provably carrying none (options read, no context key) | 0 |
| …and decidably tenancy-enabled | 0 |
| Options argument unreadable | 9 |
| …and decidably tenancy-enabled | 8 |
| Threading a decidably elevated (`isSystem`) context | 8 |
| Threading a decidably non-elevated context | 0 |
| Threading a context of undecidable elevation | 17 |
| Receiver carried a readable engine type | 15 |
| Receiver erased, placed by the object NAME | 10 |
| Receiver erased, placed by an `object: string` PARAMETER | 0 |
| Receiver erased, placed by an `UNTYPED_RECEIVERS` row | 0 |

## Subtractions the census could NOT defend — enforced

| what | count |
|---|---:|
| Write calls subtracted with no defensible reason | 0 |
| …whose declared type text states an engine door anyway | 0 |

## Every site

| file | verb | object | tenancy | tenant context | n |
|---|---|---|---|---|---:|
| `packages/services/service-storage/src/attachment-lifecycle.ts` | `update` | `sys_file` | enabled | elevated | 4 |
| `packages/services/service-storage/src/backfill-file-references.ts` | `update` | `object` | undecidable | options unreadable | 1 |
| `packages/services/service-storage/src/backfill-file-references.ts` | `update` | `object` | undecidable | elevated | 1 |
| `packages/services/service-storage/src/backfill-file-references.ts` | `insert` | `sys_file` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-storage/src/backfill-sys-file-organizations.ts` | `update` | `sys_file` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-storage/src/backfill-sys-file-public-scope.ts` | `update` | `sys_file` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-storage/src/file-attachment-service.ts` | `delete` | `sys_attachment` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-storage/src/file-attachment-service.ts` | `insert` | `sys_attachment` | enabled | context, elevation undecidable | 2 |
| `packages/services/service-storage/src/file-reference-lifecycle.ts` | `insert` | `sys_file` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-storage/src/file-reference-lifecycle.ts` | `update` | `sys_file` | enabled | elevated | 3 |
| `packages/services/service-storage/src/metadata-store.ts` | `delete` | `sys_file` | enabled | options unreadable | 1 |
| `packages/services/service-storage/src/metadata-store.ts` | `insert` | `sys_file` | enabled | options unreadable | 1 |
| `packages/services/service-storage/src/metadata-store.ts` | `update` | `sys_file` | enabled | options unreadable | 2 |
| `packages/services/service-storage/src/metadata-store.ts` | `delete` | `sys_upload_session` | enabled | options unreadable | 1 |
| `packages/services/service-storage/src/metadata-store.ts` | `insert` | `sys_upload_session` | enabled | options unreadable | 1 |
| `packages/services/service-storage/src/metadata-store.ts` | `update` | `sys_upload_session` | enabled | options unreadable | 2 |
| `packages/services/service-storage/src/record-file-access.ts` | `update` | `state.object` | undecidable | context, elevation undecidable | 1 |
