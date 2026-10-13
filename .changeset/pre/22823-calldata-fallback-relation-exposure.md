---
'@objectstack/runtime': minor
---

fix(runtime)!: `callData` asks each nested-relation condition's related object its declared exposure before the engine reads it, on the query fallback and the aggregate arm (#22823)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime read position at two arms of one door: the runtime dispatcher's `callData` stops handing the engine a filter condition on a lookup's target object whose existing `enable` declaration already refuses a query of it on every data door, and the remedy is a filter the caller can already write. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only): `callData` is not on this package's export surface and its signature is unchanged. -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A nested-relation filter condition, `{ <lookup>: { <field of the related object>: … } }`, is evaluated on the RELATED object: the engine queries that object for the matching records and keeps the source rows that point at one.

**FROM.** The runtime dispatcher's data bridge, `callData`, judged only the object a call addresses against its `enable` block, and then handed the caller's `where` to the ObjectQL engine at two positions:

- the `query` / `find` fallback, which serves when no protocol service resolves (an assembly that composes the engine plugin with `registerProtocol: false` and no `MetadataProtocolPlugin`);
- the `aggregate` arm, which never takes the protocol service, so on every assembly (the MCP `aggregate_records` tool over HTTP reaches it).

At both, such a condition was evaluated whatever the related object's `enable` block declared, including a related object every data door refuses when it is addressed.

**TO.** `callData` asks each condition's related object the exposure gate it applies to an addressed object, for `list` (the operation a query of that object is judged as), before the engine is called. A related object the gate does not serve refuses the call with the data door's own exposure answer, the one the protocol path gives the same condition:

- `enable.apiEnabled: false` → `404 OBJECT_API_DISABLED`.
- an `enable.apiMethods` whitelist without `list` (for example `['get']`, `['create']` or the deny-all `[]`) → `405 OBJECT_API_METHOD_NOT_ALLOWED`, with the effective operation set in `allowed`.

The refusal names the related object (`object`) and the condition's position (`param`, `where.<lookup>`), with the remedy. It applies at the top level and under `$and` / `$or` / `$not`. A related object with no `enable` block, or a whitelist that grants `list`, is served exactly as before. With the protocol service present the `query` arm is unchanged: the data door judges the condition, as it has since #22737.

**Migration.** Filter on the lookup's stored id (`{ <lookup>: '<id>' }` or `{ <lookup>: { $in: [...] } }`), which is the source object's own column, or remove the condition. To keep the condition, declare `list` on the related object's `enable.apiMethods`.

**Bindings.**

- **Refused, not withheld.** Dropping a condition would widen the result.
- **One gate, one walk.** The gate is the one `callData` already applies to an addressed object, and the conditions are found by `relationConditionSites` from `@objectstack/core`, the walk the data door and the MCP stdio bridge use.
- **A system context is not asked**, as it is not asked for the addressed object: these flags govern API exposure, not the engine's own reads. A flow's or a hook's own query calls the engine directly and never passes `callData`.
- **No new error code.** `@objectstack/runtime` now stamps the two existing exposure codes, and the error-code ledger lists them under that package too.

**Measured producers.** Read on `origin/main` `75b6d6a048`: no shipped composition reaches the `query` fallback. Every non-test `ObjectQLPlugin` construction under `packages/` and `examples/` keeps the built-in protocol (`os serve`, the standalone stack, the dev plugin, the verify harness, the kernel factory), and `registerProtocol: false` appears only in tests. The `aggregate` arm is reached on every assembly that serves the MCP route over HTTP. Deployed compositions were NOT MEASURED.
