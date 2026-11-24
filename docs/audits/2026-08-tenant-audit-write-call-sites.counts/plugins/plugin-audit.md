<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->

# `plugins/plugin-audit` — tenant-audit census shard (generated)

The write call sites in `packages/plugins/plugin-audit/`, as `scripts/tenant-audit-census.mjs`
derives them from the tree: this package's totals and every one of its sites.
One file per package, and no total across packages is committed anywhere —
`node scripts/check-tenant-audit-census.mjs` prints the census totals. The
method is in [the ledger index](../../2026-08-tenant-audit-write-call-sites.counts.md). ⛔ Never hand-patch
a row or a number here — fix the code, or the census, and regenerate.

## Totals in this package

| Measure | Value |
|---|---:|
| Write call sites | 21 |
| Object name statically decidable | 15 |
| Object name chosen at run time | 6 |
| Object name spelled inline | 11 |
| Object name spelled through a `const` | 4 |
| Object name is an `object: string` parameter | 0 |
| Object name is some other run-time expression | 6 |
| Against a tenancy-enabled object | 15 |
| Against an object declaring tenancy off | 0 |
| Threading a tenant context | 16 |
| Provably carrying none (options read, no context key) | 0 |
| …and decidably tenancy-enabled | 0 |
| Options argument unreadable | 5 |
| …and decidably tenancy-enabled | 4 |
| Threading a decidably elevated (`isSystem`) context | 16 |
| Threading a decidably non-elevated context | 0 |
| Threading a context of undecidable elevation | 5 |
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
| `packages/plugins/plugin-audit/src/action-invocation-audit.ts` | `insert` | `sys_audit_log` | enabled | elevated | 1 |
| `packages/plugins/plugin-audit/src/activity-changed-fields-backfill.ts` | `update` | `sys_activity` | enabled | elevated | 1 |
| `packages/plugins/plugin-audit/src/app-activity-door.ts` | `insert` | `sys_activity` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-audit/src/audit-seal/amendment-writer.ts` | `insert` | `AUDIT_AMENDMENT_OBJECT` | undecidable | elevated | 1 |
| `packages/plugins/plugin-audit/src/audit-seal/sealer.ts` | `insert` | `AUDIT_CHECKPOINT_OBJECT` | undecidable | elevated | 1 |
| `packages/plugins/plugin-audit/src/audit-seal/signer.ts` | `insert` | `AUDIT_SIGNING_KEY_OBJECT` | undecidable | elevated | 1 |
| `packages/plugins/plugin-audit/src/audit-seal/signer.ts` | `delete` | `sys_secret` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-audit/src/audit-signing-key-audit.ts` | `insert` | `sys_audit_log` | enabled | elevated | 1 |
| `packages/plugins/plugin-audit/src/auth-event-audit.ts` | `insert` | `sys_audit_log` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-audit/src/comment-parent-pair-backfill.ts` | `update` | `sys_comment` | enabled | elevated | 1 |
| `packages/plugins/plugin-audit/src/comment-resolution.ts` | `update` | `sys_comment` | enabled | elevated | 1 |
| `packages/plugins/plugin-audit/src/comment-routes.ts` | `update` | `sys_comment` | enabled | elevated | 1 |
| `packages/plugins/plugin-audit/src/credential-use-audit.ts` | `insert` | `sys_audit_log` | enabled | elevated | 1 |
| `packages/plugins/plugin-audit/src/data-export-audit.ts` | `insert` | `sys_audit_log` | enabled | elevated | 1 |
| `packages/plugins/plugin-audit/src/dataset-query-audit.ts` | `insert` | `sys_audit_log` | enabled | elevated | 1 |
| `packages/plugins/plugin-audit/src/mail-log-body-migration.ts` | `update` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-audit/src/mail-log-body-migration.ts` | `update` | `object` | undecidable | options unreadable | 1 |
| `packages/plugins/plugin-audit/src/package-lifecycle-audit.ts` | `insert` | `sys_audit_log` | enabled | elevated | 1 |
| `packages/plugins/plugin-audit/src/read-audit.ts` | `insert` | `sys_audit_log` | enabled | options unreadable | 1 |
| `packages/plugins/plugin-audit/src/scim-refusal-audit.ts` | `insert` | `sys_audit_log` | enabled | elevated | 1 |
| `packages/plugins/plugin-audit/src/stored-metadata-body-migration.ts` | `update` | `object` | undecidable | elevated | 1 |
