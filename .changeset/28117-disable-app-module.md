---
'@objectstack/runtime': patch
'@objectstack/objectql': patch
'@objectstack/trigger-record-change': patch
---

feat(runtime): an admin can disable a `type: 'module'` package of an installed app, and a disabled package's navigation contributions and record-change flows stop (#28117)

Clause-②: yes (widening) — `PATCH /api/v1/packages/:id/disable` now accepts a module of an installed app, which it refused `422 WRITABLE_PACKAGE_REQUIRED` before. Nothing is narrowed.
Metadata-protocol: none

A suite ships one artifact: its `type: 'app'` package and several `type: 'module'` packages. A customer who does not use a module can now switch it off in their environment, and "disabled" keeps its one meaning: hidden, refused on the data plane, data kept.

- **The disable door** (`@objectstack/runtime`). An admin with `manage_metadata` may disable a package whose `manifest.type` is `'module'` and whose `manifest.dependencies` directly name an installed package of `manifest.type` `'app'`, unless its own `manifest.scope` is `system` or `cloud`. This holds for a suite booted from code and for one installed from the marketplace: both leave the same row. Every other read-only package answers the disable door `422 WRITABLE_PACKAGE_REQUIRED` as before: the app itself, a plugin, a platform package, a module that declares no app or whose app is not installed. The exemption is for disable only. The module stays read-only for authoring, so edit, publish, revert, delete and overwrite still refuse it, and its served row still says `writable: false`.
- **Navigation** (`@objectstack/objectql`). `SchemaRegistry.applyNavContributions` drops the contributions of a disabled package, so `getApp`, `getAllApps` and the protocol's `app` reads (`GET /api/v1/meta/app`, `GET /api/v1/meta/app/:name`) no longer list a disabled module's menu entries. They come back on enable. A disabled package's contribution into a missing group is not relocated and raises no `nav_contribution_group_missing` diagnostic.
- **Record-change flows** (`@objectstack/trigger-record-change`). A flow bound to an object whose owning package is disabled is not run for a write made in-process (an app hook's `ctx.api.object(...)`, another flow, a service), which the engine still accepts. The record is written; the flow runs again once the package is enabled. Writes through the data plane were already refused.
- **Already in place**, and now pinned on the module path: the data plane's `404 OBJECT_PACKAGE_DISABLED` for the module's objects, and the per-environment state file that replays a disable at boot.

An app hook that reads a disabled module's object through `ctx.api.object(name)` is served the kept records: the in-process read is not refused, and this release does not change that. The marketplace handbook says so under "Disabling a module".
