---
"@objectstack/rest": minor
---

`GET /api/v1/packages`, `GET /api/v1/packages/:id` and `DELETE /api/v1/packages/:id` have one implementation: the runtime dispatcher's `/packages` domain. `@objectstack/rest`'s `registerPackageRoutes` no longer mounts its own copies of those three routes; it mounts `POST /api/v1/packages/publish` and nothing else.

The two copies had already diverged, and a comment in the REST registrar claimed its copies shadowed the dispatcher's while on a stock boot they were never mounted at all (the registrar decided at registration time, before the `package` service had registered). One URL, one body, ruled on #14503.

What changes on the wire, for a deployment whose composition really did reach the REST copies:

- `GET /packages/:id` answers `{ success: true, data: <row> }` — the installed-package row directly under `data`. FROM `data.package` TO `data`. There is no `{ package }` wrapper.
- The rows on `GET /packages` and the row on `GET /packages/:id` carry no `source: 'registry' | 'database' | 'both'` key. **Deliberately removed**, not ported: it had no reader outside the REST registrar's own tests — none in this repo's production code, the Console, the docs or the OpenAPI document, and the SDK declined to declare it twice on purpose.
- `?version=` is not read on `GET /packages/:id` or `DELETE /packages/:id`, so its repeated-parameter refusal (`400 VALIDATION_ERROR` on `?version=a&version=b`) is gone with it. **Deliberately removed**: the single implementation reads the installed package from the registry, and a version-scoped durable lookup was a behaviour only the REST copy had. The one in-tree sender is the SDK's `ScopedEnvironmentClient.packages.get(id, version?)`, whose binding is tracked on #12034.
- A missing package answers `404 RESOURCE_NOT_FOUND` with the message `Package '<id>' not found` (the dispatcher's spelling) instead of `Package "<id>" was not found.`.
- `DELETE /packages/:id` uninstalls the package (registry plus persisted metadata rows, `?keepData=true` to keep the object tables); the REST copy's version-scoped delete of a published artifact is gone.

`POST /api/v1/packages/publish` is unchanged.

`GET /discovery` on the REST server now advertises `routes.packages` on every boot — the family base under which its publish route is mounted — instead of only when its own copy of the list route had been mounted at start. On a stock `objectstack serve` boot that copy never was (the `package` service registers after the REST plugin starts), so discovery omitted `routes.packages` while the dispatcher served the family; the SDK's convention fallback covered it.

The three removed REST rows are gone from `REST_ROUTE_LEDGER`; the runtime route ledger carries the surviving routes. The environment-scoped mount (`/environments/:environmentId/packages…`) is served by the same dispatcher domain through the `@objectstack/hono` catch-all.
