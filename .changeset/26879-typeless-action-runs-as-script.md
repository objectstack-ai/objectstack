---
'@object-ui/core': patch
---

fix(core): the console runs a stored action that leaves `type` to its default as a script action

Clause-②: no
Metadata-protocol: none

`ActionSchema.type` defaults to `script`, but the console runs a stored action row as it was stored, not as the spec parses it. An action saved without `type`, such as the blank New skeleton in Studio or a row an older Studio build wrote, had its route resolved to its own name, matched no executor and was refused as "not executable".

- **The action runner now reads a missing `type` as the spec's default** at the one place it picks the dispatch route. A typeless `{ name, body }` action and a typeless `{ name, operation: 'update', patch }` action both reach the registered `script` dispatch, which posts the platform action route.
- **Unchanged:** an unknown `type` and a completely empty schema are still refused; a handler registered under the action's name still runs first; a typeless action that declares a runner key of its own (`navigate`, `api`, `endpoint`, `onClick`, `redirect`, an explicit `reload` or `close`) still runs on that key.
- No writer adds `type`, and no stored row changes.
