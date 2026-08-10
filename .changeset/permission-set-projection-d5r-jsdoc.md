---
"@objectstack/plugin-security": patch
---

Docs: bring the second ADR-0094 copy in `permission-set-projection.ts` up to D5-R.

PR #6962 retired the 2026-07-14 "customize packaged permission sets through an ADR-0005
env overlay" direction and corrected this file's **header**. A second copy survived in
the function-level JSDoc of `upsertEnvPermissionSet` — an exported symbol, so the stale
text ships in the published `.d.ts` and reads as fact to the next author. It stated both
halves D5-R retired: that an env-scope overlay is the platform's standard customization
of a packaged definition, and that deleting the overlay resets the row to the shipped
declaration.

Both are now stated as current: `#6483` (PR #6608) rolled `permission` back to
`allowOrgOverride: false`, so a metadata write against a code-declared (artifact-backed)
set is refused by the producer with 403 `NOT_OVERRIDABLE` and the supported channel is
ADR-0086's (edit the package, re-publish); and `#6960` measures the ordinary delete path
refusing to lift even a legacy pre-rollback overlay, leaving `OS_METADATA_WRITABLE` as
the only documented removal — so "delete = reset" is recorded as retired rather than
restated. The retirement itself is kept in the text, not deleted, so a reader arriving
at this function does not have to reconstruct the history.

Prose only — no behaviour change. The same retired direction was also corrected in three
neighbouring comments in this package (the `readDeclaredBody` JSDoc, and the two
`security-plugin.ts` package-managed write-gate comments) plus their two test rationales,
so the package no longer states the direction in two voices.
