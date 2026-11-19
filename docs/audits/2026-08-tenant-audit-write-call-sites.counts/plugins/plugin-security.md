<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->

# `plugins/plugin-security` — tenant-audit census shard (generated)

The write call sites in `packages/plugins/plugin-security/`, as `scripts/tenant-audit-census.mjs`
derives them from the tree: this package's totals and every one of its sites.
One file per package, and no total across packages is committed anywhere —
`node scripts/check-tenant-audit-census.mjs` prints the census totals. The
method is in [the ledger index](../../2026-08-tenant-audit-write-call-sites.counts.md). ⛔ Never hand-patch
a row or a number here — fix the code, or the census, and regenerate.

## Totals in this package

| Measure | Value |
|---|---:|
| Write call sites | 14 |
| Object name statically decidable | 8 |
| Object name chosen at run time | 6 |
| Object name spelled inline | 2 |
| Object name spelled through a `const` | 6 |
| Object name is an `object: string` parameter | 5 |
| Object name is some other run-time expression | 1 |
| Against a tenancy-enabled object | 8 |
| Against an object declaring tenancy off | 0 |
| Threading a tenant context | 14 |
| Provably carrying none (options read, no context key) | 0 |
| …and decidably tenancy-enabled | 0 |
| Options argument unreadable | 0 |
| …and decidably tenancy-enabled | 0 |
| Threading a decidably elevated (`isSystem`) context | 8 |
| Threading a decidably non-elevated context | 0 |
| Threading a context of undecidable elevation | 6 |
| Receiver carried a readable engine type | 2 |
| Receiver erased, placed by the object NAME | 7 |
| Receiver erased, placed by an `object: string` PARAMETER | 4 |
| Receiver erased, placed by an `UNTYPED_RECEIVERS` row | 1 |

## Subtractions the census could NOT defend — enforced

| what | count |
|---|---:|
| Write calls subtracted with no defensible reason | 0 |
| …whose declared type text states an engine door anyway | 0 |

## Every site

| file | verb | object | tenancy | tenant context | n |
|---|---|---|---|---|---:|
| `packages/plugins/plugin-security/src/auto-org-admin-grant.ts` | `delete` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/auto-org-admin-grant.ts` | `insert` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/bootstrap-platform-admin.ts` | `insert` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/claim-seed-ownership.ts` | `update` | `schema.name` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/cleanup-package-permissions.ts` | `delete` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/invitation-placement.ts` | `insert` | `sys_user_position` | enabled | elevated | 1 |
| `packages/plugins/plugin-security/src/position-renamed-holder-carry.ts` | `update` | `sys_user_position` | enabled | elevated | 1 |
| `packages/plugins/plugin-security/src/stored-permission-set-package-backfill.ts` | `update` | `object` | undecidable | elevated | 1 |
| `packages/plugins/plugin-security/src/suggested-audience-bindings.ts` | `delete` | `sys_audience_binding_suggestion` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-security/src/suggested-audience-bindings.ts` | `insert` | `sys_audience_binding_suggestion` | enabled | context, elevation undecidable | 1 |
| `packages/plugins/plugin-security/src/suggested-audience-bindings.ts` | `update` | `sys_audience_binding_suggestion` | enabled | context, elevation undecidable | 4 |
