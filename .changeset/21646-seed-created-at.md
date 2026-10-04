---
"@objectstack/objectql": patch
---

A seed row's authored `created_at` is kept when the row is first inserted, the same as when a later boot replays it (#21646).

Clause-②: no

- **Before.** The built-in audit stamp (`sys_stamp_audit_insert`) replaced a seed row's authored `created_at` with the boot instant on insert. A later boot's upsert update then wrote the authored value, so a fresh or reset database showed every seeded record as created at boot until the next restart. This held for a literal instant and for a `cel` value such as ``cel`daysAgo(5)` ``.
- **After.** Under the seed write context (`ExecutionContext.seedReplay`, set by `SEED_WRITE_EXECUTION_CONTEXT`), the insert stamp keeps an authored `created_at` and stamps the boot instant only when the row has none. Both paths now store the authored value. The update stamp is unchanged, so `updated_at` still moves on a replay. All three seed writers pass that context: `SeedLoaderService`, `AppPlugin`'s replay of a stack's `data[]`, and `@objectstack/verify`'s `seed()`.
- **Unchanged.** A REST create, a create from a bare `isSystem` context and every other caller still have `created_at` stamped now. `preserveAudit` is unchanged, and the seed context does not gain it. A non-system create that requests `preserveAudit` gets the same warning as before. `created_by` is not stamped on a seed write, because the seed context has no user. An authored value is kept on insert and on replay, as it was before this change.
- ⛔ No schema, key, export or error code is added or removed.
