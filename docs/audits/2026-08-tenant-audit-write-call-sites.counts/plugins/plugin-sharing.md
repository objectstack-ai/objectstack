<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->

# `plugins/plugin-sharing` — tenant-audit census shard (generated)

The write call sites in `packages/plugins/plugin-sharing/`, as `scripts/tenant-audit-census.mjs`
derives them from the tree: this package's totals and every one of its sites.
One file per package, and no total across packages is committed anywhere —
`node scripts/check-tenant-audit-census.mjs` prints the census totals. The
method is in [the ledger index](../../2026-08-tenant-audit-write-call-sites.counts.md). ⛔ Never hand-patch
a row or a number here — fix the code, or the census, and regenerate.

## Totals in this package

| Measure | Value |
|---|---:|
| Write call sites | 21 |
| Object name statically decidable | 17 |
| Object name chosen at run time | 4 |
| Object name spelled inline | 16 |
| Object name spelled through a `const` | 1 |
| Object name is an `object: string` parameter | 1 |
| Object name is some other run-time expression | 3 |
| Against a tenancy-enabled object | 17 |
| Against an object declaring tenancy off | 0 |
| Threading a tenant context | 15 |
| Provably carrying none (options read, no context key) | 0 |
| …and decidably tenancy-enabled | 0 |
| Options argument unreadable | 6 |
| …and decidably tenancy-enabled | 4 |
| Threading a decidably elevated (`isSystem`) context | 15 |
| Threading a decidably non-elevated context | 0 |
| Threading a context of undecidable elevation | 6 |
| Receiver carried a readable engine type | 21 |
| Receiver erased, placed by the object NAME | 0 |
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
| `packages/plugins/plugin-sharing/src/backfill-sys-record-share-organizations.ts` | `update` | `sys_record_share` | enabled | elevated | 1 |
| `packages/plugins/plugin-sharing/src/primary-bu-projection.ts` | `update` | `sys_user` | enabled | elevated | 2 |
| `packages/plugins/plugin-sharing/src/record-orphan-cleanup.ts` | `delete` | `table` | undecidable | options unreadable | 2 |
| `packages/plugins/plugin-sharing/src/share-link-service.ts` | `insert` | `sys_share_link` | enabled | elevated | 1 |
| `packages/plugins/plugin-sharing/src/share-link-service.ts` | `update` | `sys_share_link` | enabled | elevated | 3 |
| `packages/plugins/plugin-sharing/src/sharing-plugin.ts` | `update` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-sharing/src/sharing-rule-service.ts` | `delete` | `sys_record_share` | enabled | options unreadable | 3 |
| `packages/plugins/plugin-sharing/src/sharing-rule-service.ts` | `delete` | `sys_sharing_rule` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-sharing/src/sharing-rule-service.ts` | `insert` | `sys_sharing_rule` | enabled | elevated | 1 |
| `packages/plugins/plugin-sharing/src/sharing-rule-service.ts` | `update` | `sys_sharing_rule` | enabled | elevated | 1 |
| `packages/plugins/plugin-sharing/src/sharing-service.ts` | `delete` | `sys_record_share` | enabled | elevated | 2 |
| `packages/plugins/plugin-sharing/src/sharing-service.ts` | `insert` | `sys_record_share` | enabled | elevated | 1 |
| `packages/plugins/plugin-sharing/src/sharing-service.ts` | `update` | `sys_record_share` | enabled | elevated | 1 |
| `packages/plugins/plugin-sharing/src/stored-declaration-package-backfill.ts` | `update` | `object` | undecidable | elevated | 1 |
