---
'@objectstack/metadata': patch
---

fix(metadata): on a host with a `DatabaseLoader`, the boot priming pass registers a file's body over the stale row it once seeded, and binds a row's empty `package_id` column only when the loader wrote that row

Clause-②: no — nothing is refused and nothing an author can write changes. Two boot answers move, each declared below.
Metadata-protocol: none

- The boot priming pass (`MetadataPlugin`'s file-system pass over `MetadataManager.loadMany`) keys each item it registers after the host's package stamp. Of two loaders' items of one `(package, name, member)` — a file item the host stamps and the row of the host's package it seeded at an earlier boot — the earlier loader's item keeps the registry entry. So after a file edit, the next boot's registry entry (and `get`) moves FROM the stored row's previous body (the file's body returned one boot later) TO the file's body, as before the email template joined the per-package store. The row is updated from the file at the same boot, as before. One loader's own items never shadow each other. New: `MetadataManager.sourceLoaderOf(item)`, the name of the loader `loadMany` read an item from.
- The column bind the pass still makes into the loader a row came from (`DatabaseLoader.bindReadRowPackage`) takes only the loader's own rows (`source = 'database'`), as `migrateDatabaseLoaderRowPackages` does. A row another writer stored with an empty `package_id` column and a `_packageId` copied into its body moves FROM bound to that package at boot TO left package-less, as the column readers already read it (a body stamp binds nothing).
