---
"@objectstack/objectql": minor
---

ADR-0048: cross-package metadata collision detection. Bare-named generic metadata (`page`, `dashboard`, `flow`, `app`, `action`, `doc`, …) carries no package coordinate in the registry key (`org/type/name`), so two installed packages defining the same `(type, name)` would silently shadow each other at read time (`getItem` returns whichever the registry iterates first). The kernel only prefix-validates object names, leaving these types unguarded.

`SchemaRegistry.registerItem` now refuses a cross-package base-layer collision — a real `packageId` registering a `(type, name)` already owned by a *different* real package — with a `MetadataCollisionError` naming both packages and the type/name. `ObjectQL.registerApp` and the nested-plugin loop delegate to it, so manifest and plugin metadata are both covered.

Legitimate same-key writes are unaffected: same-package reloads, runtime/DB overlays (ADR-0005, bare-key or `sys_metadata`-sentinel rows), object ownership/extension, and nav contributions all pass through. Policy is `error` by default; set `collisionPolicy: 'warn'` (or `OS_METADATA_COLLISION=warn`) to downgrade during a deliberate migration.
