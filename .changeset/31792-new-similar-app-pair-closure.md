---
'@objectstack/runtime': patch
---

fix(runtime): cloning a flow or permission set shipped by a member of an installed App lands in the App's customization package instead of being refused by the door that created it

Clause-②: yes (widening) — widened: `POST /api/v1/automation/:name/clone` with no `package`, for a flow a member of an installed App ships, and `POST /api/v1/automation/:name/clone` / `POST /api/v1/security/permission-sets/:name/clone` naming that App's customization package (`<app>.custom`) in `package`, now land the copy there (200) where they answered `409 RESOURCE_CONFLICT [new_similar_target_outside_closure]`. The "new similar" target rule now judges a target against the same declared closure the metadata save judges the copy's save against, which counts an App's members as reachable from the App's customization package. A target that is not the source's pair keeps its own declared dependencies, so every other explicit `package` is judged exactly as before.
Metadata-protocol: none

- **Before.** A member's customization package is its App's (`<app>.custom`). The flow clone door's default landing ensured that package and then refused it, because the target rule asked the App's package to declare a dependency on the member, which it never does. The refusal said nothing was written, but the empty customization package had already been created. Naming `<app>.custom` explicitly was refused the same way on both clone doors, including for a permission set granting on an object the member owns.
- **Now.** The copy lands in `<app>.custom`, by default or when named. The flow door also judges an already-installed customization package before it asks for one to be ensured, so a landing it refuses creates nothing.
- **Unchanged.** A writable package that declares only the App (not the member), or any other package outside the source's closure, is still refused `409` with nothing written. Flows and permission sets of packages that belong to no App land as before.
- **Who sees it.** An administrator who copies, in Studio or through the API, a flow or permission set that a module of an installed App ships.
