---
"@objectstack/objectql": patch
---

**Waste removed:** the lifecycle dangling-reference audit no longer asks a federated (ADR-0015 `external`) remote for platform anchor columns that were never provisioned on it (#8414).

`applySystemFields` injects `organization_id`, `owner_id`, `owning_business_unit_id` and the audit `*_by` lookups into every registered object, federated ones included — that is deliberate (#7865, direction B). `Engine.syncObjectSchema` then issues no DDL for a federated object, because the remote database owns its schema. So those five reference columns existed in the registered schema and nowhere else, and `auditDanglingReferences` — which enumerated reference fields off `fields` alone — projected all of them onto the remote table. Measured on a real boot of `examples/app-showcase`, against a `customers` table whose real columns are `id, name, email, region, lifetime_value`:

```
select `id`, `organization_id`, `created_by`, `updated_by`, `owner_id`, `owning_business_unit_id` from `customers` limit ?
select * from `customers` limit ?
```

The first statement cannot compile (`no such column` — a backtick-quoted identifier does not take SQLite's double-quote literal fallback, and Postgres/MySQL raise their own error); `SqlDriver.find`'s unknown-column recovery caught it and retried `select *`, fetching up to 500 whole rows to audit columns that cannot exist — once per federated object, every lifecycle sweep interval, each pass also emitting a #4363 non-deterministic-paging warning. **No answer was ever wrong**; the pass was pure waste, and it was being absorbed by a safety net rather than by a design.

The enumerator now consults `unprovisionedInjectedColumns` (`@objectstack/spec/data`, the #7865 provenance derivation) and skips columns that are the platform's own injected anchor on an object the platform provisions no storage for.

**This reads provenance, not `external != null`.** A federated object that declares a real remote `organization_id` — or any other anchor name — keeps its audit on that column: the author's definition is not byte-identical to the shipped one, so provenance answers `'author'` and nothing is withheld. Objects the platform provisions storage for are untouched: the derivation returns an empty set for them, so an ordinary object is still swept with its full column set.

Two consequences worth knowing:

- A federated object left with **no real reference column** is no longer read at all, and is deliberately not filed in `unscannedObjects` — a column that was never provisioned stores no reference, so its absence from `dangling` is proven, not assumed. A federated object that declares a real reference column is still opened and audited on it.
- `AuditableObject` now carries an index signature. The port was already being handed the whole registered document (the engine passes `SchemaRegistry.getAllObjects()` straight through); the type now says so, because the provenance derivation reads the injection plan's inputs off it. Hand-written doubles carrying only `name`/`fields` still satisfy the type and behave exactly as before.

The card also named `backfillSearchCompanion` (`@objectstack/plugin-pinyin-search`) for `select `id`, `name`, `__search` from `customers``. **That statement is already gone and this release changes no code for it:** #9469 stopped `provisionSearchCompanion` from declaring `__search` on a federated object, so the backfill's existing `if (!schema.fields[SEARCH_COMPANION_FIELD]) continue` early-out drops those objects before enumerating anything. A second federation-aware guard inside the backfill would have been redundant, and — spelled as "skip external objects" — would have wrongly withheld the companion from a federated object whose author declares a real remote `__search`. The precondition is now pinned on a real boot instead.
