---
'@objectstack/cli': patch
---

`os dev --fresh` states the isolation it actually delivers (#5594)

The `--fresh` block promised its tempdir "owns ALL persistent state for this
run". After #4968 that is true of everything the CLI itself places — the dev
SQLite DB (`OS_HOME` → `<home>/data/dev.db`, published as `OS_DATABASE_URL`),
the uploads root (published on the settings service's own name
`OS_STORAGE_LOCAL_ROOT`), and any plugin state keyed off `OS_HOME` — but it was
never true of state an **app** reaches by a relative path it declares itself.
Such a path is resolved by its own consumer against the process working
directory, which `--fresh` does not move, so the file lands in the project tree
and is still there after the run exits.

The live specimen is deliberate authoring, not a bug: the showcase's
`showcase-external` datasource declares
`filename: '.objectstack/data/showcase_external.db'` and documents that the path
resolves against the project cwd — so a `--fresh` showcase run leaves that file
(plus `-wal`/`-shm`) behind.

No behaviour changed. The `--fresh` flag help, the source comments, and the
`os dev` flag table in the CLI docs now name the covered surface
(`OS_HOME`-keyed state plus the env channels the CLI publishes) and state
plainly what falls outside it, with a docs note on declaring an absolute path
when a datasource should follow `--fresh`.

Re-anchoring app-declared relative paths on `OS_HOME` is a behaviour change
resting on an open contract question ("relative to cwd" vs "relative to this
run's home") and is deliberately not taken here.
