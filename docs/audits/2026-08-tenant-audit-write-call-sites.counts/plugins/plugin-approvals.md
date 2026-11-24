<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->

# `plugins/plugin-approvals` — tenant-audit census shard (generated)

The write call sites in `packages/plugins/plugin-approvals/`, as `scripts/tenant-audit-census.mjs`
derives them from the tree: this package's totals and every one of its sites.
One file per package, and no total across packages is committed anywhere —
`node scripts/check-tenant-audit-census.mjs` prints the census totals. The
method is in [the ledger index](../../2026-08-tenant-audit-write-call-sites.counts.md). ⛔ Never hand-patch
a row or a number here — fix the code, or the census, and regenerate.

## Totals in this package

| Measure | Value |
|---|---:|
| Write call sites | 41 |
| Object name statically decidable | 39 |
| Object name chosen at run time | 2 |
| Object name spelled inline | 38 |
| Object name spelled through a `const` | 1 |
| Object name is an `object: string` parameter | 1 |
| Object name is some other run-time expression | 1 |
| Against a tenancy-enabled object | 39 |
| Against an object declaring tenancy off | 0 |
| Threading a tenant context | 41 |
| Provably carrying none (options read, no context key) | 0 |
| …and decidably tenancy-enabled | 0 |
| Options argument unreadable | 0 |
| …and decidably tenancy-enabled | 0 |
| Threading a decidably elevated (`isSystem`) context | 39 |
| Threading a decidably non-elevated context | 0 |
| Threading a context of undecidable elevation | 2 |
| Receiver carried a readable engine type | 41 |
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
| `packages/plugins/plugin-approvals/src/action-slot-backfill.ts` | `update` | `sys_approval_action` | enabled | elevated | 2 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `update` | `object` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `insert` | `sys_approval_action` | enabled | elevated | 17 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `delete` | `sys_approval_approver` | enabled | elevated | 2 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `insert` | `sys_approval_approver` | enabled | elevated | 2 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `insert` | `sys_approval_request` | enabled | elevated | 1 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `update` | `sys_approval_request` | enabled | elevated | 10 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `insert` | `sys_approval_token` | enabled | elevated | 1 |
| `packages/plugins/plugin-approvals/src/approval-service.ts` | `update` | `sys_approval_token` | enabled | elevated | 1 |
| `packages/plugins/plugin-approvals/src/backfill-platform-row-organizations.ts` | `update` | `objectPlan.object` | undecidable | context, elevation undecidable | 1 |
| `packages/plugins/plugin-approvals/src/display-label-backfill.ts` | `update` | `sys_approval_action` | enabled | elevated | 1 |
| `packages/plugins/plugin-approvals/src/display-label-backfill.ts` | `update` | `sys_approval_request` | enabled | elevated | 1 |
| `packages/plugins/plugin-approvals/src/stored-process-package-backfill.ts` | `update` | `sys_approval_request` | enabled | elevated | 1 |
