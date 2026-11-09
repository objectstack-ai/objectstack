---
'@object-ui/app-shell': patch
---

fix(drill): "Open in list" and a related list's "View all" open the exact list again for a yes/no bucket, an `$in` / `$nin` set, `$ne` and the text operators

Clause-②: yes (widening)
Metadata-protocol: none

The object list route (`/apps/APP/OBJECT/data?filter[...]`) gains six spellings, each read back as the very comparison the drill drawer queries, comparand type included:

- `filter[FIELD][bool]=true|false` is equality to the boolean. `filter[FIELD]=true` still means the text "true".
- `filter[FIELD][ne|contains|notcontains|startswith|endswith|icontains]=VALUE` is `$ne` and the five text operators.
- `filter[FIELD][in]=A&filter[FIELD][in]=B` (and `[nin]`) is a set, one repeated param per member.

A drill or "View all" whose filter uses only these and the earlier spellings now offers its list destination; anything the route still cannot say exactly (`$or`, `$between`, an empty set, a boolean under `$ne`) still offers none rather than a wider list. The list page shows each new condition as a chip with the filter builder's own operator label, removes it with the chip, and keeps it through "Save as view".
