---
'@objectstack/driver-sql': minor
---

feat(driver-sql): tenant-isolated auto_number sequences backed by a persistent counter table

**Breaking nothing; new behaviour is opt-in via object schema.**

The SQL driver now generates auto_number / autonumber field values via a
dedicated `_objectstack_sequences` table keyed by
`(object, tenant_id, field)` instead of scanning the data table for the
current MAX on every insert.

Highlights:

- **Tenant isolation.** Objects with an `organization_id` field get a
  separate counter per organization. Two tenants creating contracts at
  the same time both legitimately observe `CTR-0001`, `CTR-0002`, … in
  their own namespaces — they no longer interleave or skip numbers.
- **Tenant resolution.** Source order: `row[organization_id]` →
  `DriverOptions.tenantId` → `__global__` sentinel for org-less objects
  (e.g. setup-side singletons share one counter).
- **Bootstrap from existing data.** On the first reservation in a new
  `(object, tenant, field)` tuple, the driver seeds `last_value` from the
  current per-tenant MAX so legacy/seeded records keep their position
  and downstream inserts pick up monotonically (gaps are tolerated).
- **Atomic increment.** Each reservation runs in a transaction with
  `SELECT … FOR UPDATE` (where the dialect supports it) and a single
  `UPDATE` of `last_value`. Tested with 25 concurrent inserts in one
  tenant producing 25 distinct sequence values.
- **Caller overrides honoured.** A row that already has an explicit
  value for the auto_number field is left untouched, and the sequence
  bootstrap respects that value so future reservations advance past it.
- **Dual spelling.** Both `type: 'auto_number'` (snake) and
  `type: 'autonumber'` (the spec factory output) are recognised.

Migration notes:

- The first time the driver handles an auto_number insert, it creates
  the `_objectstack_sequences` table automatically — no manual DDL.
- Pre-existing data is not renumbered. Gaps introduced by older
  cross-tenant logic (where a tenant's number could "jump" because it
  inherited another tenant's MAX) remain in place; subsequent inserts
  continue from `MAX + 1` in the affected tenant.
