---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): an activity summary names a referenced record by a title the writer may read, else by its id

Clause-②: no
Metadata-protocol: none

An activity row's summary can name a record another field points at: a tracked lookup change (`Account: Acme → Globex`) or a fired milestone's `{token}` (`Deal won by {owner}`). That title is now read in the writer's scope, the scope the row's own record label is already read in. When the writer may not read the referenced record, or may read it without its title column, the summary names it by its stored id, as it does for a record that no longer exists. The rule holds per id, so one change can title the side the writer may read and keep the id of the side it may not.

A writer who may read the referenced record, and every system write, gets the same summary as before. Rows already written keep the summary they were written with.
