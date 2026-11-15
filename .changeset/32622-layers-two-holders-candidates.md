---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

fix(metadata-protocol, rest)!: the layered read of a name two packages hold refuses as the plain read does, naming the holders as `details.candidates` (ADR-0150 D3/D5)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are reads of a name two packages hold, which now refuse as the plain read of that name already did: no stored row, layer, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a reader of the layers, or of the REST published view, of a name two or more served packages register in code, naming no package. Such a name has no one holder (ADR-0150 D3/D5), and the plain read already refused it. Three answers move, measured in both registration orders:

- FROM: on a host that wires no engine for the REST door chain, `GET /meta/:type/:name/layers` (and `?layers=true`) answered 200 with the layers of the holder that registered first. TO: it answers `409 RESOURCE_CONFLICT` naming both holders as `details.candidates`.
- FROM: in process, the protocol's `getMetaItemLayered({ type, name })` with no `packageId` resolved the holder that registered first. TO: it throws `PackageScopedNameRefusedError` (`RESOURCE_CONFLICT`, 409) naming both, as `getMetaItem` does.
- FROM: on a REST host with no `objectQLProvider`, `GET /meta/:type/:name/published` went on past its overlay read to the published exit: what the host's metadata service `getPublished` answers, or `501 NOT_IMPLEMENTED` when the host resolves no metadata service. TO: it answers `409 RESOURCE_CONFLICT`, without `details.candidates`. The dispatcher's `/published` swallows the same refusal and still serves its snapshot.

**Not moved.** A name one package holds, and every read naming the package (`?package=`, `packageId`), answer as before. On a host whose door chain has an engine, `/layers` already refused 409; it now also names the holders. The save and delete doors do not move.

The fix for a caller: name the package whose layers it means.

`GET /meta/:type/:name/layers` (and the deprecated `?layers=true`) of a name two or more packages hold, read naming no package, now answers like the plain read on every exit and on both transports: `409 RESOURCE_CONFLICT` with the holders as `details.candidates` (`[{ kind: 'package', packageId }, …]`), never one holder's layers.

- A name two served packages register in code: the protocol's layered read (`getMetaItemLayered`) asks the registry's package-scoped resolver before it reads any layer, as `getMetaItem` does, so it throws the same `PackageScopedNameRefusedError` naming both, in process too, whatever the metadata service holds. It used to answer the holder that registered first, and so did the REST door on a host that wires no engine for its door chain. `?package=` still reads each holder's layers; a name one package holds is unchanged.
- The REST `/layers` route's catch carries the candidates of a package-scoped refusal, as the plain read's catch does. Before, it answered the refusal by its sentence alone (the dispatcher already carried them).
- A name whose active rows two packages hold keeps the package-less writes' refusal (its sentence, code, status and `?package=` remedy) and gains the same `details.candidates`. The save and delete doors' answer does not move.
- Stored-row holders beside a disabled package keep their in-process answer: the protocol's layered read still serves its in-process readers there, and the door refuses.
