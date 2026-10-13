---
'@objectstack/metadata-protocol': minor
'@objectstack/service-analytics': minor
---

fix(metadata-protocol,service-analytics)!: a read that follows a lookup asks the TARGET object its declared exposure — the data door's `$expand` at every level, and the dataset door's dimension-label passes (#22661)

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is two runtime read doors: each stops serving a lookup's target object whose existing `enable` declaration already refuses the read on every data route, and the remedy is the declaration the author already wrote. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The data routes judge the ADDRESSED object's `enable` block through the spec's one exposure decision (`apiExposureDenialReason` / `canServeApiOperation`): `enable.apiEnabled: false` answers `404 OBJECT_API_DISABLED`, and an `enable.apiMethods` whitelist that does not grant the verb answers `405 OBJECT_API_METHOD_NOT_ALLOWED`. A read that FOLLOWS a lookup reaches a second object nobody addressed, and two such reads never asked it.

**FROM.** For an administrator and a member alike:

- **`$expand`** — `GET /api/v1/data/:object?$expand=`, `GET /api/v1/data/:object/:id?expand=`, the relation map on `POST /api/v1/data/:object/query` (every level of the tree), and the export door (which expands every lookup to name it) served the row fields of a lookup's target whose declaration refuses it on every data route.
- **Dataset dimension labels** — `POST /api/v1/analytics/dataset/query` rendered a reference-class dimension's grouped id as the target record's display name, and sorted an `order` on that dimension by those names, for the same targets.

**TO.** Each read asks the spec's one decision of the TARGET object, for `get` — the read both perform is "turn an id the caller holds into the record it names", the read `GET /api/v1/data/:target/:id` performs:

- An `$expand` entry whose target the decision does not serve is withheld at the generic data door (`@objectstack/metadata-protocol`), at every level: the field answers as an UNEXPANDED lookup, its stored id — the answer the door already gives for a related record the caller may not read. Nothing below a withheld entry is read.
- A dimension label is not read for such a target (`@objectstack/service-analytics`): the stored id renders, and an `order` on the dimension sorts by it — the answer a target the reader's row scope hides already gets. A declaration that cannot be read withholds the labels too (fail-closed, at `warn`); the query itself still answers.

Concretely, a target declaring `apiEnabled: false`, the deny-all `apiMethods: []`, or a whitelist without `get` (for example `['list']` or `['create']`) is withheld from both; a target with no `enable` block, or a whitelist that grants `get`, is served exactly as before.

**Bindings.**

- **Every caller.** The decision takes no user, so an administrator, a member and a system context get the same tree and the same labels.
- **The engine's privileged callers are untouched.** A flow's `config.expand` and a hook's own reads call the engine directly and never pass the generic data door, the same split the write results and the `internal: true` evaluate positions keep.
- **No new error code.** Both reads withhold rather than refuse, so no response status changes.

**Measured producers.** Read on `origin/main` `eae3368a` over every `.ts` source under `packages/` and `examples/`: ten objects refuse `get` by declaration, and exactly one lookup points into any of them, from an object that is itself `apiEnabled: false`. No example declares `enable.apiEnabled` or `enable.apiMethods`. So no shipped object's served answer changes. Deployed and cloud-held object definitions were NOT MEASURED.
