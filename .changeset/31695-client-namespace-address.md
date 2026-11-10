---
'@objectstack/client': patch
---

feat(client): `automation.*`, `actions.invoke` and `meta.getItem` take an optional `namespace` and send the qualified address (ADR-0150 D5)

Clause-②: yes (widening) — the by-name calls of `@objectstack/client` gain an optional `namespace` (the holding package's manifest `namespace`, or `'_env'` for an item authored in the environment) and build the qualified path the server's doors already read: `/automation/:ns/:name[/…]`, `/automation/trigger/:ns/:name`, `/actions/:ns/:object/:action` and `/meta/:type/:ns/:name`. The package entry exports the `QualifiedAddressOptions` and `ActionInvokeResult` types. Without a namespace every call sends exactly the request it sent before.
Metadata-protocol: none

**Addressing an item by its package.** When two installed packages ship a flow, an action or a metadata item under the same name, the bare call is refused by the server, and these calls can now name the package that holds it:

- `automation.trigger`, `get`, `update`, `delete`, `toggle`, `clone`, `runs.get`, `getFlow`, `execute`, `getRun`, `resume` and `getScreen` take a trailing `{ namespace }`; `runs.list` and `listRuns` take `namespace` beside `limit`.
- `actions.invoke` and `actions.invokeGlobal` take `namespace` beside `recordId` and `params`.
- `meta.getItem` takes `namespace` beside `packageId`.
- The twins on `client.environment(id)` (`meta.getItem`, `automation.getFlow`, `execute`, `listRuns`, `getRun`, `resume`, `getScreen`) take the same.

**A `409` keeps its candidates.** The server picks no holder: a name it cannot resolve to one item is answered `409 RESOURCE_CONFLICT`. The `automation.*` and `meta.getItem` calls reject with it, and on `/automation` the error's `details.candidates` lists every holder (`{ kind: 'package', packageId }`). `actions.invoke` and `invokeGlobal`, which return their failures instead of throwing, now carry those candidates on the result as `candidates`. The `/meta` door names the holders in its message only, so a `meta.getItem` rejection carries no `details.candidates`.

**Addresses with no qualified path are refused before sending.** The server reads the segment after each door in a fixed order (the door's literals, then `_env`, then an installed namespace, else the bare address), so some pairs would be read as another request: a namespace outside the package-namespace grammar, a namespace that spells a door literal (`trigger` on `/automation`, `global` on `/actions`), a flow named like a flow sub-resource (`runs`, `toggle`, `clone`, `trigger`) under a package namespace, a flow named like a door literal under any namespace, and a metadata item named like a `/meta` sub-resource (`history`, `tree`, …). Each is refused with `code: 'VALIDATION_ERROR'` and `httpStatus: 400` (on `actions.*`, as `success: false`) and nothing is sent. Call such a flow bare, and read such a metadata item with `packageId`.

`meta.getHistory`, `getReferences`, `getAudit` and `diffItem` take no `namespace`: their server routes read no package.
