---
'@objectstack/core': minor
---

fix(core)!: an import's reference resolution asks the lookup TARGET its declared exposure before matching a cell (#22739)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime read: the import's reference resolution stops matching cells against a lookup's target object whose existing `enable` declaration already refuses that read on every data route, and the remedy is the declaration the author already wrote. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed — `ImportProtocolLike` gains one optional member (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`POST /api/v1/data/:object/import` and the async `POST /api/v1/data/:object/import/jobs` judge the ADDRESSED object's `enable` block. A lookup cell is resolved by matching its text against the lookup's TARGET object — an object nobody addressed.

**FROM.** For an administrator and a member alike, a cell was matched against a target whose declaration refuses the read on every data route (`enable.apiEnabled: false`, the deny-all `apiMethods: []`, or a whitelist without `list`): a cell naming an existing record stored its id, and a cell naming none answered `reference_not_found` — so the row report told the two apart.

**TO.** The runner asks the spec's one decision (`canServeApiOperation`) of the TARGET's `enable` block, for `list` — matching a cell is a predicate read over the target, the runtime `find` the spec maps to `list`. A target the decision does not serve answers every cell, naming a record or not (a pasted id included), `reference_not_found` — the answer a target the caller cannot read (no read permission, or a record its row scope hides) already gets. Nothing of the target is read. A target with no `enable` block, or a whitelist that grants `list`, resolves exactly as before. A declaration that cannot be read withholds the target too (fail-closed).

**Bindings.**

- **Every caller of `runImport` whose protocol reads object declarations.** The decision takes no user, so an administrator, a member and a system context (the connector pull) are answered the same. The target's declaration is read through the protocol's `getMetaItem`, a new optional member of `ImportProtocolLike`; a protocol without it (plugin-auth's identity import, whose reads run under the system identity) is not judged.
- **No new error code, no status change.** The refusal is the per-row `reference_not_found` the resolver already answers.
- **The target is read through `referenceTargetOf`.** `buildFieldMetaMap` now takes a reference field's target from the spec's arbiter instead of the raw `reference` key, so a `user` field written without `reference` (fully specified: the type fixes the target) targets `sys_user` on the import, export and import-template doors, as it already did on the data door's `$expand`. Measured on the import door: a cell holding a user's email used to fail `reference_not_found` (the raw text reached the write as an id); it now resolves to that user. A non-string `reference` carrier, which `ObjectSchema` refuses, now throws there instead of reading as "no target".

**Fix, if an import relied on the old answer:** the target's own declaration decides — grant `list` in its `enable.apiMethods`, or drop `enable.apiEnabled: false`, if the object is meant to be matched by import.

**Measured producers.** Read on `origin/main` `bf515e724d` over every non-test `.ts` source under `packages/` (spec and qa excluded) and `examples/`: twelve objects refuse `list` by declaration, and exactly one lookup points into any of them, from an object that is itself `apiEnabled: false` (its own import door already answers 404); the control count of lookups into `sys_user` is 75. So no shipped object's import answer changes. Deployed and cloud-held object definitions were NOT MEASURED.
