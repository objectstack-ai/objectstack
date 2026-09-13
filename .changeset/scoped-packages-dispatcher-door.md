---
"@objectstack/runtime": minor
---

fix(runtime): mount the scoped `/api/v1/environments/:id/packages*` door, and reconcile the package read/delete responses to their declared schemas (#16781)

**The door.** `mountPackagesRoute` mounted `/packages*` at the unscoped prefix only, while automation / actions / ai each registered a scoped variant twenty lines away. On a host composed as `@objectstack/plugin-hono-server` + this plugin with `enableProjectScoping: true` and **without** `@objectstack/hono`'s `createHonoApp`, that left `GET /api/v1/environments/:id/packages`, `GET …/packages/:id` and `DELETE …/packages/:id` answered by the transport's own `notFound` — a bare 404 on routes `content/docs/api/environment-routing.mdx` documents. The domain has resolved scoped package paths since #15859; nothing mounted one.

`mountPackagesRoute` is now wrapped in a `base`-taking `registerPackageRoutes(base)`, exactly like its three siblings, and called a second time with the scoped base. **The same handler, no second implementation.** The unscoped mounts keep their registration position and their unconditional mounting, so the change is purely additive: no route that answered before stops answering.

**The wire.** Two responses gained the key their own declared schema requires (contract review of #16628, finding F2). Both additions are **additive** — no key left either payload:

- `GET /packages` now sends **`hasMore`** (`ListInstalledPackagesResponseSchema`). It is `false`: this door applies its `status` / `type` filters and returns every remaining row, reading no `limit` and no `cursor`, so there is no next page to announce.
- `DELETE /packages/:id` now sends **`packageId`** (`UninstallPackageApiResponseSchema`). `registryRemoved` and `persisted` stay on the wire unchanged.

A client that reads only the keys it read before is unaffected; a client parsing either payload against the published schema stops being refused.

The `DELETE /packages/:id` route-ledger row now carries `responseSchema: 'UninstallPackageApiResponseSchema'`, backed by new conformance coverage that drives the real handler. `GET /packages` is deliberately left blank: its rows are the ASSEMBLED package body, while `InstalledPackageSchema` wraps the AUTHORING-stage `ManifestSchema` — the #14242 stage mismatch, which no `@objectstack/spec/api` export declares yet. Both directions of that boundary are pinned, so the row becomes fillable against a red test rather than a guess.
