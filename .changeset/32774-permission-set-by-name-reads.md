---
'@object-ui/app-shell': patch
---

fix(app-shell): the permission-set pages read the confirm label, clone source, ledger row and Add refusal by the holder they show

Clause-②: no
Metadata-protocol: none

A follow-up of the holder-package fix (objectstack#32537). Where a page lists more than one holder of a permission-set name (objectstack ADR-0150 D3/D5/D8), these readings no longer go by the name alone:

- **Deactivation confirm and toast.** The label is the switched holder's, never the first row of the name, and the confirm names the holder's package (or the environment's own set).
- **Clone.** The permission-set editor's "Clone to customize" and Studio's "New similar" clone the holder the editor shows: `?package=` names it where the name alone addresses another holder's set.
- **A grant no holder reaches.** A grant naming no package (or a package that holds no set of the name), under a name two packages hold, grants nothing on the server. The Assigned users section now lists it apart, as unresolved, with Remove; it is never listed or counted as either holder's.
- **Ledger after a pick.** A switch written for a holder records that holder's `(package, name)` row, also after a pick from a refusal that named one holder.
- **Add refused with candidates.** A grant the `/data` door refuses with `409 RESOURCE_CONFLICT` and `details.candidates` (either body shape, flat since objectstack#32740) opens the same holder pick as the other doors; the chosen holder's package goes in `permission_set_package`.
- **Editor's holder read.** The published list the editor reads its holder from is read again with the set (a publish, a reload), so a holder that arrives while the editor is open is counted.
- **What the section counts.** Where a listed position may be another holder's set on the server, the Assigned users section says that it may count more people, never fewer.

A name with one holder, and the environment's own set, are read and written by the name as before. No server behaviour, permission or security check changes.
