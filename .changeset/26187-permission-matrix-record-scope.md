---
'@object-ui/app-shell': patch
---

fix(app-shell): the permission matrix sets and shows each object's read and write record scope

Clause-②: no
Metadata-protocol: none

ADR-0084 declares a record-scope column for the permission matrix, but Setup → Permission Sets and Studio → Access had no control for an object permission's `readScope` / `writeScope`. The only way to set them was `PUT /api/v1/meta/permission/:name`.

- **Pickers.** Every object row, in both the Setup table and the Studio Access matrix, now has a **Read scope** and a **Write scope** picker. Each lists "Not set" and the five `ObjectAccessScopeSchema` values: own, own and reports, my unit, my unit and below, whole org. A picked value saves and reloads unchanged. This holds at the environment door and at the package door, where the slice merge keeps it. "Not set" removes the key.
- **Hierarchy values.** "Own and reports", "My unit" and "My unit and below" carry the hint "requires enterprise; otherwise owner-only" and stay selectable. The open runtime resolves them to the owner alone. No hierarchy resolver is installed there.
- **View All / Modify All.** The spec refuses `readScope` beside View All or Modify All, and `writeScope` beside Modify All, because those bits already grant org-wide access. Ticking View All now disables the read-scope picker and removes `readScope`. Ticking Modify All disables both pickers and removes both scopes. The **All** bulk button does the same. Before this change, both paths saved a row the server refuses. Effective access does not change, because the resolvers answer `org` on those bits before they read a scope. "CRUD", "R" and "None" are unchanged.

What to do: nothing. No spec key, stored shape or API changes.
