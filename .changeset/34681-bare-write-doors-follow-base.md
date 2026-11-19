---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the save, delete, publish, draft, history, diff and rollback doors naming no package write and read the base's row where the read naming no package serves it

Clause-②: yes (widening)
Metadata-protocol: none

A bundled item (an email template's locale, for example) that no package ships in code can be stored as a row by a base package and, at the same member, by a package that declares that base. The read naming no package already serves the base's row there. The write doors naming no package now resolve the same address: the save (publish and draft mode), the per-item publish, the delete and the draft discard act on the base's row or draft, and the history, the diff and the rollback read and restore the base's own versions, exactly as the same request naming the base (`?package=` on the REST door, `packageId` in process) does. Before, each was refused `409 RESOURCE_CONFLICT` naming both packages, so an item that opened fine could not be saved.

The dependent package's row stays where it is and is still read and written at its own `?package=`. Where the base is read-only, the save now answers what naming the base answers (`422 WRITABLE_PACKAGE_REQUIRED` naming the base) instead of the `409`. After a delete naming no package removes the base's row, the read naming no package serves the dependent's row, and the delete's receipt names it as still stored.

Unchanged: two packages holding the member with neither declaring the other, a package-less row beside the holders, and a type with no members are still refused `409` naming every holder.
