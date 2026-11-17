<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->

# `services/service-automation` — tenant-audit census shard (generated)

The write call sites in `packages/services/service-automation/`, as `scripts/tenant-audit-census.mjs`
derives them from the tree: this package's totals and every one of its sites.
One file per package, and no total across packages is committed anywhere —
`node scripts/check-tenant-audit-census.mjs` prints the census totals. The
method is in [the ledger index](../../2026-08-tenant-audit-write-call-sites.counts.md). ⛔ Never hand-patch
a row or a number here — fix the code, or the census, and regenerate.

## Totals in this package

| Measure | Value |
|---|---:|
| Write call sites | 40 |
| Object name statically decidable | 34 |
| Object name chosen at run time | 6 |
| Object name spelled inline | 0 |
| Object name spelled through a `const` | 34 |
| Object name is an `object: string` parameter | 1 |
| Object name is some other run-time expression | 5 |
| Against a tenancy-enabled object | 34 |
| Against an object declaring tenancy off | 0 |
| Threading a tenant context | 40 |
| Provably carrying none (options read, no context key) | 0 |
| …and decidably tenancy-enabled | 0 |
| Options argument unreadable | 0 |
| …and decidably tenancy-enabled | 0 |
| Threading a decidably elevated (`isSystem`) context | 31 |
| Threading a decidably non-elevated context | 0 |
| Threading a context of undecidable elevation | 9 |
| Receiver carried a readable engine type | 30 |
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
| `packages/services/service-automation/src/builtin/crud-nodes.ts` | `delete` | `objectName` | undecidable | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/builtin/crud-nodes.ts` | `insert` | `objectName` | undecidable | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/builtin/crud-nodes.ts` | `update` | `objectName` | undecidable | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/connector-connections.ts` | `delete` | `sys_connector_connection` | enabled | elevated | 1 |
| `packages/services/service-automation/src/connector-connections.ts` | `delete` | `sys_connector_connection` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/connector-connections.ts` | `insert` | `sys_connector_connection` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/connector-connections.ts` | `update` | `sys_connector_connection` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/connector-credentials.ts` | `delete` | `sys_connector_credential` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/connector-credentials.ts` | `insert` | `sys_connector_credential` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/connector-credentials.ts` | `update` | `sys_connector_credential` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-automation/src/connector-credentials.ts` | `update` | `sys_connector_credential` | enabled | elevated | 3 |
| `packages/services/service-automation/src/flow-credential-channel.ts` | `delete` | `sys_flow_credential` | enabled | elevated | 5 |
| `packages/services/service-automation/src/flow-credential-channel.ts` | `insert` | `sys_flow_credential` | enabled | elevated | 1 |
| `packages/services/service-automation/src/flow-credential-channel.ts` | `update` | `sys_flow_credential` | enabled | elevated | 2 |
| `packages/services/service-automation/src/flow-credential-migration.ts` | `insert` | `DATA_MIGRATION_FLAG_OBJECT` | undecidable | elevated | 1 |
| `packages/services/service-automation/src/flow-credential-migration.ts` | `update` | `DATA_MIGRATION_FLAG_OBJECT` | undecidable | elevated | 1 |
| `packages/services/service-automation/src/flow-dispatch-key-package-backfill.ts` | `insert` | `sys_flow_dispatch` | enabled | elevated | 1 |
| `packages/services/service-automation/src/flow-dispatch-store.ts` | `insert` | `sys_flow_dispatch` | enabled | elevated | 1 |
| `packages/services/service-automation/src/flow-dispatch-store.ts` | `update` | `sys_flow_dispatch` | enabled | elevated | 1 |
| `packages/services/service-automation/src/stored-reference-package-backfill.ts` | `update` | `object` | undecidable | elevated | 1 |
| `packages/services/service-automation/src/suspended-run-store.ts` | `delete` | `sys_automation_run` | enabled | elevated | 3 |
| `packages/services/service-automation/src/suspended-run-store.ts` | `insert` | `sys_automation_run` | enabled | elevated | 2 |
| `packages/services/service-automation/src/suspended-run-store.ts` | `update` | `sys_automation_run` | enabled | elevated | 2 |
| `packages/services/service-automation/src/sync-run-ledger.ts` | `insert` | `sys_sync_run` | enabled | elevated | 1 |
| `packages/services/service-automation/src/sync-run-ledger.ts` | `update` | `sys_sync_run` | enabled | elevated | 5 |
