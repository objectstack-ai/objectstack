<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->

# `plugins/plugin-hono-server` — tenant-audit census shard (generated)

The write call sites in `packages/plugins/plugin-hono-server/`, as `scripts/tenant-audit-census.mjs`
derives them from the tree: this package's totals and every one of its sites.
One file per package, and no total across packages is committed anywhere —
`node scripts/check-tenant-audit-census.mjs` prints the census totals. The
method is in [the ledger index](../../2026-08-tenant-audit-write-call-sites.counts.md). ⛔ Never hand-patch
a row or a number here — fix the code, or the census, and regenerate.

## Totals in this package

| Measure | Value |
|---|---:|
| Write call sites | 0 |
| Object name statically decidable | 0 |
| Object name chosen at run time | 0 |
| Object name spelled inline | 0 |
| Object name spelled through a `const` | 0 |
| Object name is an `object: string` parameter | 0 |
| Object name is some other run-time expression | 0 |
| Against a tenancy-enabled object | 0 |
| Against an object declaring tenancy off | 0 |
| Threading a tenant context | 0 |
| Provably carrying none (options read, no context key) | 0 |
| …and decidably tenancy-enabled | 0 |
| Options argument unreadable | 0 |
| …and decidably tenancy-enabled | 0 |
| Threading a decidably elevated (`isSystem`) context | 0 |
| Threading a decidably non-elevated context | 0 |
| Threading a context of undecidable elevation | 0 |
| Receiver carried a readable engine type | 0 |
| Receiver erased, placed by the object NAME | 0 |
| Receiver erased, placed by an `object: string` PARAMETER | 0 |
| Receiver erased, placed by an `UNTYPED_RECEIVERS` row | 0 |

## Subtractions the census could NOT defend — enforced

| what | count |
|---|---:|
| Write calls subtracted with no defensible reason | 1 |
| …whose declared type text states an engine door anyway | 0 |

| file | receiver | verb | why | declared type | door | n |
|---|---|---|---|---|---|---:|
| `packages/plugins/plugin-hono-server/src/adapter.ts` | `this.app` | `delete` | type-not-in-corpus | `Hono` | no | 1 |

## Every site

None: this package holds no write call site, only the subtraction above.
