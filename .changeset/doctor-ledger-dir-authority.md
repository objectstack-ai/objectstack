---
"@objectstack/cli": patch
---

fix(cli): `os doctor` stops guessing the installed-package ledger directory when the authority export is missing (#5996)

Hardens a diagnosis boundary; not a live defect. `DEFAULT_INSTALLED_PACKAGES_DIR` — `@objectstack/cloud-connection`'s export, the single authority on what the ledger directory is called — exists in every version ever shipped, so the consumer-side `??` fallback this change deletes had never fired. It sat two lines above the #5413 comment forbidding exactly that tolerant read (Prime Directive #12), and it answered the wrong state: a reader that LOADS without declaring the export would have doctor silently reading a hard-coded path while the runtime keeps reading wherever the package decides — two reports, potentially two directories, no line saying so.

Three changes, one authority:

- The `??` fallback is gone. The export is type-checked before `path.join()` ever sees it, which also retires the old misreport where a non-string export was absorbed by the config `catch` and surfaced as "Could not load config for analysis".
- A reader that loads without declaring the directory (as a string) is now its own named report row — "The installed-package ledger reader does not declare the ledger directory (installed packages NOT checked)" — the last cell of the edge #5644 carved: that issue split "present but unloadable" out of absence's silence; this row is "loaded but unrecognizable". While it shows, doctor reads no directory at all — guessed or otherwise — and the ADR-0120 D5e advisory withholds its `✓ Unique scope` line, because its ledger half never ran.
- `installedPackageLedgerSkippedEntriesCheck`'s fix now quotes the directory doctor actually read — resolved from the real export and carried on the reading — instead of re-hardcoding the ``Under `.objectstack/installed-packages/`:`` literal, which was the same guess in prose.
