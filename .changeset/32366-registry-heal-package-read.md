---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the registry heal after a metadata delete reads the baseline for the deleted row's package, and a heal that stops is logged

Clause-②: no
Metadata-protocol: none

After a delete, a revert, or a move of a row out of a package-less overlay, the protocol heals the in-memory registry. Its baseline read from the metadata service now names the package of the row it removed. For a type the service stores per `(package, name)` (`action`, `api`, `agent`, `skill`, `permission`), a read naming no package of a name two packages hold is refused (ADR-0150 D3). The heal read bare, so a reset of one package's row on such a name restored nothing to the registry. It now restores that package's baseline, never another package's. A name one package holds heals as it did.

The heal is still best-effort: the delete has already committed and is never failed by it. It is no longer silent. When the walk stops on a throw, one `warn` line names the item and the reason, and says that the registry entry may serve the removed row until the next reload. A package-scoped refusal (a package-less row's bare read, or a peer converging on the cluster signal, which carries no binding) is named as one, with the holders it lists.
