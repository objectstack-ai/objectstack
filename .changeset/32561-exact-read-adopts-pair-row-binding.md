---
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
---

fix(metadata-protocol)!: the exact read (`?package=X`) no longer serves an undeclared App-pair row the registry binds to no package (ADR-0150 D4, red line 2)

Clause-②: yes (narrowing) — two exact reads that served a row of an App's customization pair now answer the address's own shipped item: `?package=X` for an undeclared pair row of the very bundle member a bundle addition of another package of the App ships, and a package's address for an undeclared pair row while another App's shared pair stores an undeclared row of the name. In both the registry binds the row to no package. First-party packages in either position: 0. The widening is one public method: `SchemaRegistry#overlayRowBinding(type, name, item)`, the registry's binding of a stored row, read-only, which the exact read asks.
Metadata-protocol: narrowed

<!-- adr-0087: registered pair-row-exact-read-no-owner -->

**BREAKING** for two exact reads, both of an undeclared row of an App's customization pair (`<app>.custom`, a row with no `overrides.package`). An undeclared row that could customize either of two packages' members is not attributed to one of them (red line 2). To keep such a row on the package whose locale it customizes, save it with `overrides.package` naming that package, the package of the App that ships the locale: the save door accepts it (it already prescribes it, refusing `403 NOT_OVERRIDABLE` a new undeclared row of a locale an installed package ships), and `?package=<that package>` then serves the row. A row of a locale no package ships stays readable at `?package=<app>.custom`.

The exact read's owner check (`pairRowOnAddress`) counted the holders after the registry had bound the row, so a bundle addition was no holder there, and it never read another App's pair. The registry (`SchemaRegistry#pairRowBinding`, since #32408) counts an addition that ships the row's member as a second owner, and binds a row whose count would read another shared pair's undeclared row to no package. The exact read now adopts that binding: `SchemaRegistry#overlayRowBinding(type, name, item)`, a new read-only method, answers it over the holders the exact read serves (a disabled package holds no name, ADR-0150 D3), and `pairRowOnAddress` treats an undeclared pair row as no member of an address whose one owner it does not bind the row to. It adds no count of its own.

What moves (each line FROM → TO), with App A, X a package of A holding an email template's name, Z a package of A depending on X that ships only `fr-FR` of it (a bundle addition), and `A.custom` storing an undeclared `fr-FR` row:

- `?package=X&member=fr-FR`: FROM the row TO X's own `fr-FR` (none, `404`). X's list and execution list: FROM carrying the row TO leaving it out. Either order: Z installed before the row (reached by a hydrated row; the save door refuses that write `403 NOT_OVERRIDABLE`, prescribing the declaration) or after it (the row saved and published while X alone held the name, then Z installed). `?package=Z` keeps Z's own `fr-FR`; `?package=A.custom` keeps the row.
- `?package=Y` / `?package=P` when App A's pair and App B's pair each store an undeclared row of the name (the registry binds neither): FROM the pair's row TO the package's own item of that member (none). Each pair's own address keeps its row.

Unchanged: a row declaring its base (`overrides.package`) binds and serves as declared; the App's own address keeps an undeclared row of its own pair (#28390 ruling A); two holders that could own a row still refuse `409` naming both; a row whose one owner the registry binds it to is served there as before; a registry without `overlayRowBinding` keeps the exact read's own count. With one of two holders of the name disabled, the enabled holder's address, list and execution list keep an undeclared row of the pair (#32183, epic ruling R4-A): the adoption counts the served holders, as the exact read does, while the registry's own readers keep counting every holder, so a disable never moves their binding.
