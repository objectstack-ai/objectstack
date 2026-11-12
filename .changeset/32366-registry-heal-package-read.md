---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the registry heal after a metadata delete reads the baseline for the deleted row's package, and a heal that stops is logged

Clause-②: no
Metadata-protocol: none

After a delete, a revert, or a move of a row out of a package-less overlay, the protocol heals the in-memory registry. Its baseline read from the metadata service now names the package of the row it removed. For the types the service stores per `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES` in `@objectstack/metadata`), a read naming no package of a name two packages hold is refused (ADR-0150 D3). The heal read bare, so a reset of one package's row on such a name restored nothing to the registry. It now restores that package's baseline, never another package's.

A row bound to a package that holds no item of the name is a customization of the name, such as an App's pair row holding a declared override of a holder's item (ADR-0146). Its heal reads the row's own package first. On a settled miss there, it reads with no package, as before this change. On a name one package holds, that read restores the one holder's baseline, so a name one package holds heals as it did. On a name two or more packages hold, that read is refused. The base the pair row overrides is then chosen by the pair relation from the holders the refusal lists, and its baseline is restored. When no single base is found, the refusal is logged and nothing is picked or retired. When no package holds the name, the row was the item and its registry entry is retired, as before.

The heal is still best-effort: the delete has already committed and is never failed by it. It is no longer silent. When the walk stops on a throw, one `error` line names the item and the reason, and says that the registry entry may serve the removed row while every read looks normal. It also gives the fix: the next reload or restart re-hydrates the registry from the stored rows. A package-scoped refusal (a package-less row's bare read, a non-holder row's read on a name two packages hold with no single base, or a peer converging on the cluster signal, which carries no binding) is named as one, with the holders it lists. A package the store reads as none is printed as no package.

For a package-less row, a refused baseline read also retires the removed row's entry from the registry's bare slot and registers no baseline, so the next read naming no package answers the store's refusal, which names every holder.
