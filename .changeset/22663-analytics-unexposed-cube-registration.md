---
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: a configured cube, or a dataset `registerDataset` registers, over an object the API does not serve is refused at registration, and `GET /analytics/meta` no longer lists it (#22663)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the analytics registry's accept set: a cube or dataset whose base object or declared join the spec's exposure decision already denies is no longer registered, and every query of such a cube was already refused. The remedy is to point the definition at an object the API serves or remove it, never a rewrite of anyone's code or metadata. `CubeRegistry` gains one optional constructor parameter, which is additive; nothing on the type surface narrows. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

Since the analytics door started judging an object's `enable` block, every query over an object whose `enable` the spec's `apiExposureDenialReason` denies for the `aggregate` operation is refused: `404 OBJECT_API_DISABLED` for `apiEnabled: false`, `405 OBJECT_API_METHOD_NOT_ALLOWED` for an `apiMethods` whitelist that does not grant it. The registration doors did not ask the same question.

**FROM.** A configured cube (`analyticsCubes`, or `AnalyticsServicePlugin({ cubes })`), or a dataset registered through `registerDataset` (or the service's `datasets` option), whose base object or declared join is such an object registered silently. `GET /analytics/meta` listed it, and every query of it then answered 404 or 405. Nothing told the author at registration time.

**TO.** Registration asks the same decision, for the same operation, over the same objects the query door's first check reads: the base object and the declared joins.

- **A configured cube** over such an object is not registered. The service logs one warning per cube that names the cube, the object and the declaration (`enable.apiEnabled: false`, or the `enable.apiMethods` whitelist and the operations it grants). Every other cube still registers, and the boot continues. This is the channel a pre-registered dataset that cannot compile already takes.
- **`registerDataset`** throws, registering nothing. The error names the dataset, the object and the declaration, and carries the query door's code and status for that declaration (`OBJECT_API_DISABLED` / 404 or `OBJECT_API_METHOD_NOT_ALLOWED` / 405) with the object.
- **A cube written straight to the service's public `cubeRegistry`** is refused by the registry's own admission in the same words.
- **`GET /analytics/meta`** never lists a refused definition.

**Unchanged.**

- A cube or dataset over an exposed object registers and lists exactly as before.
- A host that wires no `getObjectDeclaration` hook registers every definition as before. `AnalyticsServicePlugin` always wires it.
- Registration judges only what is known when it runs, and does not block otherwise. An object that is not registered yet when the analytics plugin's `init()` registers the configured cubes is not refused, and neither is one whose lookup throws. Objects declared by a plugin that inits later, or in a `start()`, fall in this class. Such a cube registers and lists as before, and the query door still refuses every query of it.
- A relationship hop that one member walks is judged at query time, per member, and does not refuse the whole cube.

**Measured producers.** On `origin/main` `ee3ae0360d`, this repository has one authored cube, `showcase_delivery` (`showcase_task` joined to `showcase_project`), and no `registerDataset` producer outside tests. Neither object declares an `enable` block. The eleven example and platform datasets (six in `examples/**`, five in `platform-objects`) are queried through the request-scoped dataset door and never enter the registry. Deployed and cloud-held definitions were NOT MEASURED.
