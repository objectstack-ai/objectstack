---
"@objectstack/metadata-protocol": patch
"@objectstack/runtime": patch
---

fix(seed): replaying seeds no longer corrupts lookup natural keys on the upsert update path

Every dev-server restart replayed package seeds in upsert mode, and any record whose
lookup/master_detail was authored as a natural key could have that reference overwritten
with NULL on the update path (`NOT NULL constraint failed` on required columns; silent
link loss on nullable ones). Four fixes:

- An unresolved reference now leaves the column untouched (deferred to pass 2) or drops
  the record loudly — it is never written as NULL over an existing row.
- DB-side reference resolution probes the target dataset's declared `externalId` (e.g.
  `email`) before falling back to `name` and `id`, matching how in-memory resolution
  already keyed records.
- A rejected update (e.g. a `state_machine` rule vetoing the replay) no longer severs
  natural-key resolution for downstream child datasets.
- Replays are idempotent: an upsert/update whose declared fields already match the
  existing row is skipped instead of rewritten (no more `updated_at` churn or lifecycle
  re-validation on every boot).
