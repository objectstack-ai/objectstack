---
"@objectstack/objectql": patch
---

fix(objectql): the tenant-scope index follows the WALL's derivation, so an object that opts out with `systemFields: false` while declaring its own `organization_id` stops running the wall predicate unindexed (#8608)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is
added, renamed, retired or tombstoned. One internal predicate in
`packages/objectql/src/registry.ts` is rebound from the spec's injection plan to
the two clauses plugin-security already derives `tenancyDisabled` from, so the
index the platform declares now covers the same objects the wall filters. -->

Two places answered *"is this object tenant-scoped?"* and read different
declarations. The platform's tenant-scope index was gated on the spec's
**injection plan** (`resolveInjectedSystemColumns(...).tenant`), while
plugin-security's Layer 0 wall derives `tenancyDisabled` from exactly two
clauses:

```ts
tenancy.enabled === false || systemFields.tenant === false
```

`systemFields: false` — the hard object-level opt-out — is in the plan and in
neither of those clauses. So an object using that opt-out **while declaring its
own `organization_id`** had `organization_id = <org>` AND-composed onto
essentially every read, with no index behind it: the deployment's hottest
predicate, unindexed. Not a security hole — isolation still held; it was slow,
not wrong, which is why nothing surfaced it.

**Both halves were measured end to end** rather than read off the source. On the
pre-fix tree, for one such object, the registry answered `indexes: null` while
`SecurityPlugin#getReadFilter` answered `{ organization_id: 'org-1' }` for an
ordinary member.

The wall's derivation is authoritative and the index now follows it: the index
is declared when tenancy is not disabled by the wall's two clauses **and** the
object carries `organization_id` — whether the platform provisions the column or
the author declared it. `managedBy: 'better-auth'` is deliberately not re-added
as a third clause, because the wall does not read it either; the one shipped
platform object whose answer changes is `sys_member`, which is walled on
`organization_id` and whose only tenant-leading index was the composite
`['organization_id', 'user_id']`.

Unchanged, and pinned beside the fix: `systemFields.tenant: false` and
`tenancy.enabled: false` still declare no index (the wall composes no predicate
there, so an index would serve nothing), a single-tenant deployment still
declares none at all, an author's own tenant index still suppresses the
platform's, and the hard opt-out still injects no platform columns — only the
index decision was ever owed at that exit.
