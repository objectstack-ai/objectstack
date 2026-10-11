---
'@objectstack/core': minor
---

fix(core)!: an import's reference resolution asks the lookup TARGET its declared exposure before matching a cell (#22739)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime read, in two places: the import's reference resolution stops matching cells against a lookup's target object whose existing `enable` declaration already refuses that read on every data route (the remedy is the declaration the author already wrote), and a field of the legacy, schema-refused type spelling `'reference'` no longer takes a target from its raw `reference` key, since the spec's arbiter gives it none (no shipped producer declares one). The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed — `ImportProtocolLike` gains one optional member (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`POST /api/v1/data/:object/import` and the async `POST /api/v1/data/:object/import/jobs` judge the ADDRESSED object's `enable` block. A lookup cell is resolved by matching its text against the lookup's TARGET object — an object nobody addressed.

**FROM.**

- For an administrator and a member alike, a cell was matched against a target whose declaration refuses the read on every data route (`enable.apiEnabled: false`, the deny-all `apiMethods: []`, or a whitelist without `list`): a cell naming an existing record stored its id, and a cell naming none answered `reference_not_found` — so the row report told the two apart.
- A field of the legacy type spelling `'reference'` (not a `FieldType`, so `ObjectSchema` refuses it, but still listed in the import, export and import-template doors' own type tables) took its target from the raw `reference` key: import matched its cells against that object and export expanded it.

**TO.**

- The runner asks the spec's one decision (`canServeApiOperation`) of the TARGET's `enable` block, for `list` — matching a cell is a predicate read over the target, the runtime `find` the spec maps to `list`. A target the decision does not serve answers every cell, naming a record or not (a pasted id included), `reference_not_found` — the answer a target the caller cannot read (no read permission, or a record its row scope hides) already gets. Nothing of the target is read. A target with no `enable` block, or a whitelist that grants `list`, resolves exactly as before. A declaration that cannot be read withholds the target too (fail-closed).
- A field is a reference on those doors exactly when it declares a `reference` string, as before, and its target is read through the spec's arbiter `referenceTargetOf`, which names none for a type outside `lookup` / `master_detail` / `user` / `tree`: such a `'reference'`-typed field's cell is stored as written, and export leaves its stored id. Every other non-reference type was never resolved by these doors and is unchanged. Measured over every git-tracked non-test source under `packages/` and `examples/` (`.ts`, `.js`, `.json`; fixtures excluded) at `0d326bfb12`: no shipped field declares `reference` on a non-reference type (0 object literals, 0 `Field.*` helper calls; the one literal pairing `type` with `reference` is a key-classification table, not a field), against a control of 30 reference-typed literals and 80 `Field.lookup` / `masterDetail` / `user` / `tree` calls; a planted literal and a planted helper call were both found.

**Bindings.**

- **Every caller of `runImport` whose protocol reads object declarations.** The decision takes no user, so an administrator, a member and a system context (the connector pull) are answered the same. The target's declaration is read through the protocol's `getMetaItem`, a new optional member of `ImportProtocolLike`; a protocol without it (plugin-auth's identity import, whose reads run under the system identity) is not judged.
- **No new error code, no status change.** The refusal is the per-row `reference_not_found` the resolver already answers.
- **Which fields count as references does not widen.** A `user` field written without `reference` still has no target on these doors (its cell reaches the write as written), although the arbiter gives it `sys_user`; adopting that target would widen what the import accepts and is not this change.

**Fix, if an import relied on the old answer:** the target's own declaration decides — grant `list` in its `enable.apiMethods`, or drop `enable.apiEnabled: false`, if the object is meant to be matched by import.

**Measured producers.** Read on `origin/main` `bf515e724d` over every non-test `.ts` source under `packages/` (spec and qa excluded) and `examples/`: twelve objects refuse `list` by declaration, and exactly one lookup points into any of them, from an object that is itself `apiEnabled: false` (its own import door already answers 404); the control count of lookups into `sys_user` is 75. So no shipped object's import answer changes. Deployed and cloud-held object definitions were NOT MEASURED.
