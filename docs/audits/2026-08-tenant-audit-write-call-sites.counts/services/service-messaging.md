<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->

# `services/service-messaging` — tenant-audit census shard (generated)

The write call sites in `packages/services/service-messaging/`, as `scripts/tenant-audit-census.mjs`
derives them from the tree: this package's totals and every one of its sites.
One file per package, and no total across packages is committed anywhere —
`node scripts/check-tenant-audit-census.mjs` prints the census totals. The
method is in [the ledger index](../../2026-08-tenant-audit-write-call-sites.counts.md). ⛔ Never hand-patch
a row or a number here — fix the code, or the census, and regenerate.

## Totals in this package

| Measure | Value |
|---|---:|
| Write call sites | 22 |
| Object name statically decidable | 7 |
| Object name chosen at run time | 15 |
| Object name spelled inline | 0 |
| Object name spelled through a `const` | 7 |
| Object name is an `object: string` parameter | 0 |
| Object name is some other run-time expression | 15 |
| Against a tenancy-enabled object | 2 |
| Against an object declaring tenancy off | 5 |
| Threading a tenant context | 15 |
| Provably carrying none (options read, no context key) | 0 |
| …and decidably tenancy-enabled | 0 |
| Options argument unreadable | 7 |
| …and decidably tenancy-enabled | 0 |
| Threading a decidably elevated (`isSystem`) context | 1 |
| Threading a decidably non-elevated context | 0 |
| Threading a context of undecidable elevation | 21 |
| Receiver carried a readable engine type | 22 |
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
| `packages/services/service-messaging/src/device-registry.ts` | `delete` | `sys_user_device` | disabled | options unreadable | 2 |
| `packages/services/service-messaging/src/device-registry.ts` | `insert` | `sys_user_device` | disabled | context, elevation undecidable | 1 |
| `packages/services/service-messaging/src/device-registry.ts` | `update` | `sys_user_device` | disabled | options unreadable | 2 |
| `packages/services/service-messaging/src/inbox-channel.ts` | `insert` | `objectName` | undecidable | context, elevation undecidable | 1 |
| `packages/services/service-messaging/src/inbox-channel.ts` | `insert` | `receiptObject` | undecidable | context, elevation undecidable | 1 |
| `packages/services/service-messaging/src/messaging-service.ts` | `insert` | `RECEIPT_OBJECT` | undecidable | context, elevation undecidable | 1 |
| `packages/services/service-messaging/src/messaging-service.ts` | `update` | `RECEIPT_OBJECT` | undecidable | options unreadable | 1 |
| `packages/services/service-messaging/src/messaging-service.ts` | `insert` | `sys_notification` | enabled | context, elevation undecidable | 1 |
| `packages/services/service-messaging/src/preference-user-conversion.ts` | `update` | `sys_notification_preference` | enabled | elevated | 1 |
| `packages/services/service-messaging/src/sql-http-outbox.ts` | `insert` | `this.objectName` | undecidable | context, elevation undecidable | 1 |
| `packages/services/service-messaging/src/sql-http-outbox.ts` | `update` | `this.objectName` | undecidable | context, elevation undecidable | 4 |
| `packages/services/service-messaging/src/sql-http-outbox.ts` | `update` | `this.objectName` | undecidable | options unreadable | 1 |
| `packages/services/service-messaging/src/sql-outbox.ts` | `insert` | `this.objectName` | undecidable | context, elevation undecidable | 1 |
| `packages/services/service-messaging/src/sql-outbox.ts` | `update` | `this.objectName` | undecidable | context, elevation undecidable | 3 |
| `packages/services/service-messaging/src/sql-outbox.ts` | `update` | `this.objectName` | undecidable | options unreadable | 1 |
