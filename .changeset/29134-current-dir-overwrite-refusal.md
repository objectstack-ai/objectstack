---
'create-objectstack': patch
---

fix(create-objectstack)!: a scaffold into the current directory refuses, writing nothing, when a template file would overwrite one already there (#29134)

Clause-②: no (narrowing) — `create-objectstack` with no name (or an empty one) in a current directory holding a file the template writes (`README.md`, `package.json`, …) refuses with exit 1 and leaves the directory untouched, where it overwrote those files and exited 0 before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema, no export of a published entry and no stored shape changes: the scaffolder's command line refuses one more case before it writes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a script that runs `create-objectstack` with no name inside a directory that already holds files the template writes.

- **Before.** A named directory that was not empty was refused (`Directory already exists and is not empty`, exit 1), but the current directory was not checked at all: the template was copied over whatever was there, so an existing project's `README.md` and `package.json` were replaced without a word and the run exited 0.
- **Now.** Before anything is written, the run compares the template's files with what the current directory holds. If any template file would replace an existing file (or a file stands where the template needs a directory), it refuses with exit 1, names each of those paths, and writes nothing.
- **Unchanged.** A current directory that holds only files the template does not write (a `.git/`, a notes file) still scaffolds, and those files are left as they were; the closing summary still says the directory already had contents. An empty current directory and a named directory behave as before.

**The remedy.** Move the named files aside and re-run, or scaffold into a new directory: `create-objectstack my-app`.
