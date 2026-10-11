---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a nested-relation filter condition asks the related object its declared exposure, and is refused when that object does not serve `list` (#22737)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime read position: the generic data door stops evaluating a filter condition on a lookup's target object whose existing `enable` declaration already refuses a query of it on every data route, and the remedy is a filter the caller can already write. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A nested-relation filter condition, `{ <lookup>: { <field of the related object>: … } }`, is evaluated on the RELATED object: the engine queries that object for the matching records and keeps the source rows that point at one.

**FROM.** On `GET /api/v1/data/:object?filter=…` and `POST /api/v1/data/:object/query`, for an administrator and a member alike, such a condition was evaluated whatever the related object's `enable` block declared. A source row came back only when the related value matched, even for a related object every data route refuses.

**TO.** The generic data door asks the spec's one exposure decision (`apiExposureDenialReason`) of the related object, for `list`, the operation `GET /api/v1/data/:target?filter=…` is judged as. A condition is a query of the related object, not a read of a record whose id the caller holds, so a `get`-only whitelist does not serve it. A related object the decision does not serve is refused, with the data door's own exposure answer:

- `enable.apiEnabled: false` → `404 OBJECT_API_DISABLED`.
- an `enable.apiMethods` whitelist without `list` (for example `['get']`, `['create']` or the deny-all `[]`) → `405 OBJECT_API_METHOD_NOT_ALLOWED`, with the effective operation set in `allowed`.

The refusal names the related object and the condition's position. It applies wherever the door walks a filter: `where`, each aggregation's `filter`, and an `expand` entry's own `where` at every level.

**Migration.** Filter on the lookup's stored id (`{ <lookup>: '<id>' }` or `{ <lookup>: { $in: [...] } }`), which is the source object's own column, or remove the condition. To keep the condition, declare `list` on the related object's `enable.apiMethods`.

**Bindings.**

- **Every caller.** The decision takes no user, so an administrator, a member and a system context get the same answer.
- **Refused, not withheld.** Dropping a condition would widen the result. A related object the caller may not read already answers this position with a refusal (`403`).
- **The engine's privileged callers are untouched.** A flow's or a hook's own query calls the engine directly and never passes the generic data door.
- **No new error code.** `@objectstack/metadata-protocol` now stamps the two existing exposure codes, and the error-code ledger lists them under that package too.
