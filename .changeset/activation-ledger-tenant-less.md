---
"@objectstack/platform-objects": patch
"@objectstack/core": patch
"@objectstack/objectql": patch
"@objectstack/service-automation": patch
---

fix(platform-objects,core): `sys_metadata_activation` ships tenant-less — drop the reserved organization column (#15024)

The ADR-0126 activation ledger records that **this environment** switched a
packaged artifact off. That is deployment-level state, owned by no
organization — so the table ships with no tenant column at all.

It briefly declared one: an `organization_id` marked "RESERVED", nullable, and
written by nobody, held for a per-organization dimension ADR-0126 §5
pre-charted. A reserved nullable tenant column is exactly the shape the
total-organization-ownership record proposed in PR #14976 rules out, and this
one had no reader either. **This is a plain removal, not a migration:** the
table landed after the 17.2.0 tag, so no released version ever carried the
column and no deployment has data in it. Should a per-organization dimension
ever be wanted, it returns as a separate org-owned object — never as a column
on this ledger.

What changed:

- **`sys_metadata_activation` declares `systemFields: { tenant: false }`** and
  no longer declares the column. Both halves are needed: the tenant anchor is
  INJECTED at registration, so deleting the field alone would have left the
  column exactly where it was. ⚠️ Deliberately NOT `tenancy: { enabled: false }`
  — that key is the ADR-0066 D2 platform-global *posture*, which the sibling
  `sys_sso_provider` uses for the opposite shape (a table that KEEPS its tenant
  column and needs the wall over it stood down). Here there is no column to
  wall. Both spellings reach `plugin-security`'s `tenancyDisabled`, which is
  required rather than incidental: a Layer 0 wall composing an equality on a
  column the table does not have denies every row.
- **The declared unique index states `unique: 'global'`** over
  `(metadata_type, name)` instead of `'organization'`. ⚠️ The materialized DDL
  is unchanged: `normalizeDeclaredIndex` prepends the NULL-safe tenant key part
  only when the table HAS a tenant column, so `'organization'` already degraded
  to exactly these two columns. What changes is that the declaration now states
  the boundary it actually gets, rather than claiming a per-organization one
  that does not exist. Still explicit rather than bare `unique: true`, which
  lint `unique/unscoped-declared-index` warns on and protocol 18 rejects.
- **`ObjectStoreMetadataActivationStore` drops its NULL filter and its
  org-row skip.** `list()` is now every activation row of its type, scoped by
  the `metadata_type` discriminator alone, and `setActive` takes the single row
  its keyed read returns instead of picking the NULL-organization one out of
  the result. Both guarded a column that no longer exists; the declared unique
  index over the two columns the lookup keys on is what makes that read
  single-valued. `ObjectStoreFlowActivationStore` and
  `ObjectStoreActionActivationStore` inherit the change.

Unchanged, and pinned: the operator gate on activation writes under walled
postures (ADR-0126 D3), the `execute()`-time flow consult and the dispatch-time
action consult, "absence of a row means ACTIVE", re-enabling UPDATES the row
rather than deleting it, and a driver `0` reading as false. The pins that
asserted the reserved column and the org-row skip are rewritten to pin the
column's ABSENCE rather than deleted — including at the injection authority
(`resolveInjectedSystemColumns`, which decides whether the column exists) and
in a real booted stack, where the row's key set is a reading of the physical
table.
