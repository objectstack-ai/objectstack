---
'@objectstack/cloud-connection': patch
'@objectstack/metadata-protocol': patch
---

feat(cloud-connection,metadata-protocol): an unmanaged install can copy the package's sample data, when asked (`seedSampleData: true`), owned by the installer and purged by its seed receipt

Clause-②: yes (widening)
Metadata-protocol: none

- **`POST /marketplace/install-local` accepts `seedSampleData`** beside `installMode: 'unmanaged'`. It is off by default: without it an unmanaged copy loads no row, as before, and answers the same `seeded: { mode: 'skipped' }`. With `true`, the copy loads the package's `data` datasets once, inline, and answers `seeded: { mode: 'inline', inserted, updated, skipped, errors }` beside `copied`. Every row is owned by the person who installed it (`owner_id` and `created_by`); rows the package wrote under several personas all land under that one owner. Lookups between the copied rows resolve in load order, exactly as on a managed install, and a dataset's `files` map is loaded as on a managed install too (each row's `sys_file` is minted). `seedSampleData` that is not a boolean, or one sent with a managed install (which always loads its data), answers 400 `INVALID_REQUEST` before anything is written.
- **The seed receipt.** The copy writes each dataset as a `seed` item of the new base (`<object>_seed`, then `<object>_seed_2` for a second dataset of the same object), in the environment's own metadata. Under `targetNamespace` only the dataset's `object` follows the rename; its records and `externalId` are copied verbatim, so the values a lookup or a purge matches never change. A dataset the copy cannot write (no `object`, no `records` array) is refused with 400 before any write, and a `seed` item the save door refuses rolls the whole copy back, as every other copied item does. A re-run is still refused with 409.
- **`POST /marketplace/install-local/:id/purge-sample-data` on a copy** reads that receipt and deletes exactly the rows it names, matched by `externalId` (a row the person wrote survives). A receipt that cannot be read answers 503 and deletes nothing. Purge before uninstalling the copy: an uninstall removes the receipt with the base, and leaves the rows.
- **`importUnmanagedPackage`** (metadata-protocol) takes the door-stated `seedData: true`, read off before the request is parsed, like `actor`. The published `ImportUnmanagedPackageRequestSchema` is unchanged.

A boot never applies the receipt, so a restart after the copy or after the purge inserts no row; a copied `seed` item saved or published later behaves as every environment `seed` item does (create-only, matched by `externalId`).
