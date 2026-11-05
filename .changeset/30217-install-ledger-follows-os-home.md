---
'@objectstack/cloud-connection': patch
'@objectstack/cli': patch
---

fix(cloud-connection,cli): the install-local ledger follows `OS_HOME`, so `os dev --fresh` and a second instance under another `OS_HOME` start without an earlier run's installs

Clause-②: yes (widening)
Metadata-protocol: none

- **Now.** With no `storageDir`, the install-local ledger (`LocalManifestSource`, and so `MarketplaceInstallLocalPlugin`) lives at `<OS_HOME>/installed-packages` when `OS_HOME` is set, and at `<cwd>/.objectstack/installed-packages` when it is not. Before, it was always the working directory, so `os dev --fresh` (a fresh `OS_HOME` and database) rehydrated a package an earlier run installed, and so did a second instance under another `OS_HOME`.
- **Unchanged.** `os dev` without `OS_HOME` keeps the ledger in the project, beside its database. `os start` in project mode sets `OS_HOME` to `<cwd>/.objectstack`, which is the same directory as before. An explicit `storageDir` is used as given.
- **Existing installs.** When the ledger moved (an `OS_HOME` other than `<cwd>/.objectstack`) and its new directory does not exist yet, the boot copies the `.json` files of the working-directory ledger into it once, and logs a warning naming both directories. The old files are left in place and are not read again; remove them. A copy that fails is logged as an error, and the next boot tries again. Under `os dev --fresh` nothing is copied.
- **`os doctor`** reads the same directory the runtime does, `OS_HOME` included.
- **The widening.** `@objectstack/cloud-connection` exports `resolveInstalledPackagesDir({ env?, cwd? })` (returns `{ dir, legacyDir }`), `INSTALLED_PACKAGES_HOME_SUBDIR`, and `LocalManifestSource.legacyDir` / `adoptLegacyEntries()`. `os doctor` takes the ledger directory from `resolveInstalledPackagesDir`; a `@objectstack/cloud-connection` without it is reported as a reader that does not declare the ledger directory. Align the two packages' versions.
