---
'@objectstack/cloud-connection': minor
'@objectstack/cli': patch
---

`LocalManifestSource.list()` now reports the ledger entries it could NOT read

A truncated, unreadable or unparseable file under
`.objectstack/installed-packages/` was skipped in an un-bound per-file `catch`
and `list()` returned a bare array, so a short list was indistinguishable from a
complete one — no difference in the return value, no log, no count. Three
consumers gave a confidently wrong answer: the installed app was never
registered at boot (gone from the app switcher, its objects nonexistent) with
nothing in the log, the console's installed-apps list came back short with
`success: true`, and `os doctor` printed `✓ Unique scope` over manifests it had
never parsed.

Skipping a corrupt file stays correct — one bad manifest must not stop a runtime
booting the packages that are fine. Skipping it *silently* was the defect.

**Breaking (`@objectstack/cloud-connection`):** `LocalManifestSource.list()`
returns `{ entries, skipped }` instead of `InstalledManifestEntry[]`.

- FROM: `const entries = source.list();`
- TO:   `const { entries, skipped } = source.list();`

`skipped` is `Array< { file: string; cause: unknown } >` — the file's basename
and the object reading or parsing it threw, unwrapped. Callers that only want
the old behaviour read `.entries`; the point of the shape is that dropping
`skipped` is now something a caller has to do on purpose. Two new exported
types, `InstalledManifestListing` and `SkippedManifestEntry`.

Enumerating the ledger DIRECTORY still throws out of `list()` — unchanged, and a
different fact from "some files in it would not parse".

`os doctor` reports unparseable entries as a `Unique scope` warning row naming
each file with its cause, and withholds the `✓` success line, alongside the
directory-level row it already had.
