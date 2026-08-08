---
"@objectstack/cli": patch
---

fix(cli): `os doctor`'s ledger-failure row names the directory it actually read (#6643)

Removes divergence surface; not a live defect. `DEFAULT_INSTALLED_PACKAGES_DIR` — `@objectstack/cloud-connection`'s export, the single authority on what the installed-package ledger directory is called — exists in every version ever shipped and has never changed value, so the literal this change deletes currently agrees with it. What it buys is that the agreement stops being a coincidence nobody would notice breaking.

The residue of #5996, which fixed the same restatement one row over (`installedPackageLedgerSkippedEntriesCheck`) and enumerated the rest rather than widening in place:

- `installedPackageLedgerFailureCheck` takes the resolved `dir` — already carried on the reading since #5996 — and quotes it. Its `fix` used to open with a re-hardcoded ``.objectstack/installed-packages/`` "under the project root", which was the consumer restating a value only the producer decides, and a vaguer answer than the one doctor was holding: the reading's `dir` is `cwd`-joined and absolute. Under `--verbose` the row now reads ``The ledger is `/srv/app/.objectstack/installed-packages`;`` and drops the now-redundant project-root hedge. The parameter is required, so the row cannot quietly fall back to a guess.
- `os package install`'s post-install hint keeps its literal, now with the reasons written down. That sentence describes the **remote** runtime host's directory: the CLI never touches that disk, the host's directory is configurable (`MarketplaceInstallLocalPlugin` builds `new LocalManifestSource(config.storageDir)`, so the export is only its default), and the install response carries no `storageDir` to quote. Resolving it locally would state this machine's default as an observed fact about another one — so the literal stays, marked as the description of a convention rather than a consumer read.
