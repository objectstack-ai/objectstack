---
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

fix(objectql,runtime)!: a package-less action is kept on its own owner key, and a route serves the one on its key, so the declaration it judges and the handler it runs are one item's (ADR-0150 D4)

Clause-②: no (narrowing) — `/actions/OBJECT/NAME` answers with the declaration of the package-less action bound to `OBJECT` (its `requiredPermissions` and every other gate) wherever the platform binds `NAME` to `OBJECT` beside the environment's object-less `NAME`, in either registration order; a caller those requirements refuse is refused `403 PERMISSION_DENIED`. Widened beside it: the environment's object-less `NAME` answers every other route in both registration orders, where one order answered no declaration there. No export is removed; `SchemaRegistry.getEnvironmentScopedActions` is added.
Metadata-protocol: none
Skills-docs: none — `skills/**` and `content/docs/**` already teach that an action is keyed by its package, its object and its name, and that the router reaches an action bound to the object before an object-less one; no authored key, value or meaning changes.

<!-- adr-0087: not-required (no-migration-prescription) No key of any authorable schema is added, removed, renamed or re-shaped and no stored row changes: what moves is which of two registered items a route reads, so there is nothing for `objectstack migrate meta` to rewrite. -->

**The rule.** An action is identified by `(owner, owning object, name)` (ADR-0150 D4). The platform's package-less action bound to `lead` and the environment's object-less action of the same name are two items under two keys, never one contested name:

- The metadata registry keeps both, in either registration order. One owner key keeps one item: the later registration of that key stays, as before. A stored row saved again bound to another object replaces the name's stored row, since the environment's store holds one row of a name.
- Binding first, then owner: `/actions/lead/NAME` serves the platform's item bound to `lead`, and the environment's object-less item serves every other route. ADR-0150 D3's environment-first applies within one key: to change `lead`, the environment authors `NAME` bound to `lead`.
- On every route, the declaration the gates judge and the handler the dispatch runs are one item's.

`@objectstack/objectql`: `SchemaRegistry` keeps a package-less action of another owner key than the bare slot's in that key's own slot; `getEnvironmentScopedActions(name)` lists the environment-scoped action items of a name, one per owner key, and the owner-key view of the package resolver (`actionOwnerScopedRegistry`) reads the item on its own key. The removal of a stored row retires that row, never the platform's item of another key. `@objectstack/runtime`: the action route reads the package-less action on its own key.

**BREAKING** — who moves: a caller of `/actions/OBJECT/NAME` on a deployment where host code or a plugin registers a package-less `NAME` bound to `OBJECT` and the environment stores an object-less `NAME`. That route now always answers with the platform item's declaration, so a caller must hold that item's `requiredPermissions`. No first-party composition registers such a pair, so no answer changes in this repository.

The fix, for an environment that meant its object-less `NAME` to answer `OBJECT` too:

- FROM an object-less `NAME` expected to answer `/actions/OBJECT/NAME` beside the platform's `NAME` bound to `OBJECT`, TO the environment's `NAME` saved bound to `OBJECT` (`objectName: 'OBJECT'`), which answers that route as the environment's own item. The environment stores one row of a name, so that row then answers `OBJECT` alone; an environment action meant for every other route as well takes a second name.
