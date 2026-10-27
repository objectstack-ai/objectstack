---
'@object-ui/app-shell': patch
---

fix(app-shell): the Setup position page shows, read-only, what each permission set the position names grants

Clause-②: no
Metadata-protocol: none

A position grants access only through the permission sets its definition names in `permissionSets`. The position page in Setup → Positions listed those names but showed nothing of what they grant, so an admin had to open every set to see its objects, capabilities and record scopes.

- **One preview per named set.** Under the position's definition, beside its holders, the page now shows each named set's permission preview: the object × capability grid with each object's read and write scope, field-level overrides, row-level policies, system permissions and tabs. The previews follow the order the position names the sets. Each is headed by the set's name, which links to the set's own page.
- **No merge, no editing.** Each preview shows one set as stored. The page does not compute what the sets add up to, and nothing in the previews is editable. A set is changed on its own page.
- **A set that does not load.** A named set the server does not serve shows one line, `Permission set "NAME" was not found.`, for that set only; the other previews still show. A read the server refuses says that, with the server's sentence, instead of "not found".
- **No sets.** A position that names no permission sets says so.

The permission-set page itself is unchanged: its matrix already shows each object's read and write scope.

What to do: nothing. No spec key, stored shape or API changes.
