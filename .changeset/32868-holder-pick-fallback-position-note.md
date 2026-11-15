---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): Assigned users shows the position note beside a direct grant read with no id

Clause-②: no
Metadata-protocol: none

**A direct grant with no id, beside a position.** A person who holds a permission set through a position, and also has a direct grant read with no `id` (a field-trimmed read, a host's fake), was listed with neither a Remove nor the "Held via a position" note. The row now shows the note whenever a position holds the set and the row has no removable grant, whatever the direct grant's shape. FROM: no Remove, no note. TO: no Remove, the note. A position-only row, an id-less direct-only row, and a removable direct grant are unchanged.

**The environment's button on the Add pick.** No change in behaviour; the section's documentation now says what the server answers on each catalog path. Where the registry serves the name, the environment's own set answers the name alone and the re-sent grant is stored. Where the registry holds the name nowhere and the catalog falls back to the metadata service, a name two packages hold is refused by the name alone even beside the environment's own row, naming the packages only, and that refusal is shown as the next pick with the users still to grant. Both paths are pinned.
