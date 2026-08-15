---
"@objectstack/metadata-protocol": patch
"@objectstack/runtime": patch
---

Stamp seeded rows with the install's organization so one object runs one autonumber scope (#8686)

Seed writes and API writes disagreed about tenancy. Seed data is loaded during
app start, before any human user exists, so the seed loader had no organization
to stamp and its rows landed `organization_id = NULL`; API writes carried the
signed-in user's organization. The SQL driver keys its autonumber counter by
exactly that column (`__global__` when NULL), so a single object ran two
independent counters — and the uniqueness index is partitioned by the same key
(`COALESCE(organization_id, '__global__'), <field>`), so the duplicates the
second counter minted were invisible to the constraint. On a single-tenant
install seeded with `CASE-00001..38`, the first four API creates returned
`CASE-00001..4` again: four duplicated values on a field declared `unique`, with
201s and no warning.

Seed writes now carry the organization the same way API writes do. The moment an
install's organization first exists, untenanted seed rows are adopted into it and
the `__global__` counter is merged into the organization-scoped one, so the
`__global__` pseudo-tenant stops acting as a peer of a real organization. Existing
installs are repaired by a one-shot boot-time backfill, guarded to single-tenant
installs; a multi-tenant install where a split is detected is never guessed at —
the backfill skips and logs the condition and the remedy. Business identifiers
that were already minted twice are reported for the operator, never silently
renumbered. Platform namespaces (`sys_`/`cloud_`/`ai_`) stay global, exactly as
the seed loader already treats them.
