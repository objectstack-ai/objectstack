---
"@objectstack/core": patch
---

`resolveLocalizationContext` now memoizes its result per `(ql, tenantId, userId)` for 30s (#10221).

On a fresh environment whose `sys_setting` table hasn't been created/migrated yet, every authenticated request re-ran the same `sys_setting` localization read, and every one of those reads failed the same way ("no such table"). The `#2409` batching had already collapsed the three per-key reads a single request used to issue into one query, but that one query still repeated on every subsequent request, and `driver-sql`'s `backendStatementFault` logs a `[sql-driver] DATABASE_ERROR` warning on every failed read — so the identical warning printed once per request and buried real errors in between.

The fallback to the built-in `UTC` / `en-US` defaults on a failed read is unchanged; this only stops the (failing, or successful-but-rarely-changing) query from re-running every request. It mirrors the TTL memoization `packages/plugins/plugin-audit/src/audit-writers.ts` (`resolveWriteLocale`) already applies to this same read for the identical reason, extended here to the other direct callers (`@objectstack/rest`, `@objectstack/runtime`) that call `resolveLocalizationContext` per request with no cache of their own. The cache is keyed on the `ql` engine instance first, so two environments/tenants sharing one process never see each other's cached locale, and self-heals within one TTL window once `sys_setting` exists or carries a value.
