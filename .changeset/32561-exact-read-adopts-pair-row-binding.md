---
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
---

fix(metadata-protocol)!: the exact read (`?package=X`) no longer serves an undeclared App-pair row the registry binds to no package (ADR-0150 D4, red line 2)

Clause-②: yes (narrowing) — two exact reads that served a row of an App's customization pair now answer the address's own shipped item: `?package=X` for an undeclared pair row of the very bundle member a bundle addition of another package of the App ships, and a package's address for an undeclared pair row while another App's shared pair stores an undeclared row of the name. In both the registry binds the row to no package. First-party packages in either position: 0.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is which exact address serves a stored pair row; the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for two exact reads, both of an undeclared row of an App's customization pair (`<app>.custom`, a row with no `overrides.package`). An undeclared row that could customize either of two packages' members is not attributed to one of them (red line 2). To keep the row on one package's address, save it with `overrides.package` naming that package; `?package=<app>.custom` serves it as before.

The exact read's owner check (`pairRowOnAddress`) counted the holders after the registry had bound the row, so a bundle addition was no holder there, and it never read another App's pair. The registry (`SchemaRegistry#pairRowBinding`, since #32408) counts an addition that ships the row's member as a second owner, and binds a row whose count would read another shared pair's undeclared row to no package. The exact read now adopts the registry's binding: `SchemaRegistry#overlayRowBinding(type, name, item)`, a new read-only method, answers the binding every overlay-slot reader asks, and `pairRowOnAddress` treats an undeclared pair row as no member of an address whose one owner it does not bind the row to. It adds no count of its own.

What moves (each line FROM → TO):

- `?package=X` (and the list scoped to X), App A with X holding an email template's name and Z (a package of A depending on X) shipping only `fr-FR` as a bundle addition, `A.custom` storing an undeclared `fr-FR` row: FROM the row TO X's own `fr-FR` (none). Either install order. `?package=Z` keeps Z's own `fr-FR`; `?package=A.custom` keeps the row.
- `?package=Y` / `?package=P` when App A's pair and App B's pair each store an undeclared row of the name (the registry binds neither): FROM the pair's row TO the package's own item of that member (none). Each pair's own address keeps its row.

Unchanged: a row declaring its base (`overrides.package`) binds and serves as declared; the App's own address keeps an undeclared row of its own pair (#28390 ruling A); two holders that could own a row still refuse `409` naming both; a row whose one owner the registry binds it to is served there as before; a registry without `overlayRowBinding` keeps the exact read's own count.
