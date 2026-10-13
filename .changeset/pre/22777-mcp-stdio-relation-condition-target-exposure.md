---
'@objectstack/mcp': minor
---

fix(mcp)!: on the stdio transport, a nested-relation filter condition asks the related object its declared exposure, and is refused when that object does not serve `list` (#22777)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime read position on one transport: the MCP stdio data bridge stops evaluating a filter condition on a lookup's target object whose existing `enable` declaration already refuses a query of it on every data door, and the remedy is a filter the caller can already write. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A nested-relation filter condition, `{ <lookup>: { <field of the related object>: … } }`, is evaluated on the RELATED object: the engine queries that object for the matching records and keeps the source rows that point at one.

**FROM.** On the MCP stdio transport (`OS_MCP_STDIO_API_KEY`), the `query_records` and `aggregate_records` tools judged only the object they address against its `enable` block, so such a condition in `where` was evaluated whatever the related object's `enable` block declared — including a related object those same tools refuse when it is addressed.

**TO.** The stdio data bridge asks each condition's related object the same exposure gate it applies to an addressed object, for `list` (the operation a query of that object is judged as), before the engine is asked. A related object the gate does not serve refuses the call with the bridge's existing exposure refusal, the one an addressed object gets:

- `enable.apiEnabled: false` → `OBJECT_API_DISABLED` (404).
- an `enable.apiMethods` whitelist without `list` (for example `['get']`, `['create']` or the deny-all `[]`) → `OBJECT_API_METHOD_NOT_ALLOWED` (405), with the effective operation set.

The tool's error text names the related object and the condition's position (`where.<lookup>`), with the remedy. It applies at the top level and under `$and` / `$or` / `$not`. The generic data door has given the same answer for the same condition since #22737.

**Migration.** Filter on the lookup's stored id (`{ <lookup>: '<id>' }` or `{ <lookup>: { $in: [...] } }`), which is the source object's own column, or remove the condition. To keep the condition, declare `list` on the related object's `enable.apiMethods`.

**Bindings.**

- **Refused, not withheld.** Dropping a condition would widen the result.
- **One decision, one walk.** The gate is the one the bridge already applies to an addressed object, and the conditions are found by `relationConditionSites` from `@objectstack/core`, the walk the data door uses.
- **The engine is untouched.** A flow's or a hook's own query calls the engine directly and never passes this bridge.
- **No new error code.**
