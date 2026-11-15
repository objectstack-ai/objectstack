---
'@objectstack/plugin-security': patch
---

fix(plugin-security): the catalog reference boot report names a refused grant's candidates and the reviewed bind, and a refused audience-binding suggestion's fix follows its package column

Clause-②: no
Metadata-protocol: none

The catalog reference boot report listed a grant naming no package, of a permission-set name two packages hold, as a grant naming a set the catalog does not resolve, with no candidates and the fix "declare the permission set again", which changes nothing. Such a grant is now listed on the same line with the resolver's refusal (`refusals` in the line's meta: the grant, the package its column names, the reason and every candidate), and the line's fix names `os migrate stored-references bind --table sys_user_permission_set --id ID --package PACKAGE` for a refused grant naming no package, and, for one that already names a package, to grant the candidate meant again naming its package and then remove the listed grant. The position half of the report already named its refusals and candidates.

A suggestion refused for a `permission_set_package` column that already names a package (a package that no longer serves the set) no longer offers `os migrate stored-references bind`, which writes only a column naming no package. Its refusal now names the package and the fix that applies: install or enable that package again if its set is the one meant, or dismiss the suggestion. A suggestion whose column names no package keeps the bind.

No grant or suggestion confers more or less: only the report's lines and the refusal's text move.
