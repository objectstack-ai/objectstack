---
"@objectstack/objectql": patch
---

`GET /packages` reports every function a package declares. A bare callable `functions` entry is normalised to the declared form at the assembly boundary, so the registry record no longer drops it (#17518).

`SchemaRegistry.installPackage` stores `toRecordManifest(manifest)`, a structural JSON projection whose rule is "a live object reached the record" and deliberately ⛔ not a key denylist. That rule treated the two authored `functions` spellings unequally through no fault of its own: a DECLARED entry (`{ handler, effect: 'writes' }`) is a plain object, so it survived with its callable dropped, while a BARE callable entry IS the callable, so the whole key vanished. `examples/app-showcase` ships one of each, so a package declaring two functions was reported as declaring one — a machine-readable read door under-reporting by construction.

- **The repair is at the assembly boundary, ⛔ not in the projection.** `installPackage` makes the two spellings structurally equal before projecting, so the structural rule is untouched and no key name is special-cased. The projection then leaves `{ effect }` for both.
- **⛔ No ref is minted.** `objectstack build` mints refs with `uniqueName(base, taken)` and dedupes by function identity, so a ref minted in the registry is not guaranteed to be the one `build` mints — a record could assert a handler that resolves in no sibling module. An absent `handler` is the honest statement "declared here, not serialisable", which is exactly what `@objectstack/spec`'s new `RecordStagePackageBodySchema` declares.
- **⛔ No entry is dropped**, either: under-reporting by design was the other arm, and it also throws away the `effect` declaration, the one half that survived.
- The caller's manifest is never mutated — `ObjectQL.registerApp` and the hook binder read the live callables off that object — and a copy is made only when an entry really needed rewriting. The ARRAY form is untouched: its entries are objects carrying their own `name`, so the projection already kept them.
