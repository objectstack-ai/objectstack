---
'@objectstack/cli': patch
---

Make the `os migrate` occupancy check actually fire, and extend it to
`files-to-references` (#3917 follow-up).

The check shipped in #3924 relied on a SQL lock probe
(`PRAGMA locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE`), which is correct on a
WAL database — and blind on the journal mode the platform actually uses.
ObjectStack's sqlite driver runs `journal_mode = delete`, where an idle
connection holds no lock at all, so dogfooding against a real `os serve`
holding a real project database showed `os migrate apply` reporting the
database idle and running the migration unannounced: exactly the scenario the
check was added to prevent. The unit tests missed it because they built their
fixtures in WAL mode.

The probe now leads with the signal that survives every journal mode: which
processes hold the file open (`/proc` on Linux, `lsof` on macOS). It also names
them — `is in use — it is open in pid 12367 (node)` — which is the actionable
part. The SQL probe is kept as a second signal for WAL databases on platforms
where process inspection is unavailable or the holder belongs to another user;
either signal firing counts as busy.

`os migrate files-to-references --apply` now takes the same gate (and the same
`--force` escape hatch). It rewrites rows rather than schema, so a concurrent
writer on the same file is at least as dangerous there; a dry run only warns,
since its counts shift under a live writer but it writes nothing itself.
