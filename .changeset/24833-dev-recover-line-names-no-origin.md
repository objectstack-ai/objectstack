---
'@objectstack/cli': patch
---

fix(cli): `os dev`'s in-place upgrade line no longer says every refused database is "still in the v17 organization-ownership shape"

Clause-②: no (printed text of `os dev` only: no exit code, refusal, recovered boot or IPC message moves)

When the organization-ownership boot guard refuses the server `os dev` starts, `os dev` copies the development database and upgrades it in place. The line it printed first said the database was "still in the v17 organization-ownership shape", for every refusal. That was wrong for a database an 18.0 pre-release created, and for every refusal that is not about the database's origin at all: a marker that is unverified, unreadable or from an older shape generation, or a read or write the guard could not make.

The line now names no origin. It points at the guard's own refusal, printed just above it, which says what the guard found, and it says that `os dev` upgrades the database in place, keeping a copy first. The verdict line printed after the upgrade still gives the copy's path. Which databases `os dev` upgrades, how it upgrades them, and what a bare `os serve` prints are unchanged.
