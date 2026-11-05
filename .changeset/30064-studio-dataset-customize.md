---
'@object-ui/app-shell': patch
'@object-ui/data-objectstack': patch
'@object-ui/i18n': patch
---

feat(studio): customize a read-only package's dataset in the All metadata area, see what uses it before publishing, and read a refused publish at the dataset

Clause-②: no
Metadata-protocol: none

- **Customize a dataset.** On a read-only base package, Studio's All metadata area opens a dataset in its form editor with the dataset designer and live preview, and offers Customize. The first saved edit copies the whole dataset into the base's paired `<base>.custom` package, declaring `overrides: { package, basedOn }`; the header's Publish applies it, and "Restore package original" on the override mark deletes the copy. On a writable package a dataset still opens the generic item page.
- **What uses it.** While a dataset is customized, the editor lists the dashboards, reports and other items that name it, read from the References read, so the person sees what a published change reaches. A failed read says it failed and offers to read again; it never reads as "nothing uses it".
- **A refused publish at the item.** A publish the server refuses for a dataset is placed on its measure or dimension and the designer's input (`Not published. Check Aggregate of the measure "Total Amount"`), in the Console's language, and shown at the dataset's editor as well as on its Pending changes entry. The server's own text stays under Details.
- **References read fixed.** `MetadataClient.references()` now reads the route's declared answer (`{ references: [{ type, name, label, path, kind }] }`) and maps each element to `MetadataReference` (`fromType`, `fromName`, new optional `fromLabel` and `kind`). It used to read a key the route never serves, so Setup's References tab and Studio's item tools showed "Nothing in the metadata graph points at this item. Safe to delete." for every item. An answer the declaration refuses is now a failed read.
