---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

fix(metadata-protocol, rest): the layered read of a name two packages hold refuses as the plain read does, naming the holders as `details.candidates` (ADR-0150 D3/D5)

Clause-②: no
Metadata-protocol: none

`GET /meta/:type/:name/layers` (and the deprecated `?layers=true`) of a name two or more packages hold, read naming no package, now answers like the plain read on every exit and on both transports: `409 RESOURCE_CONFLICT` with the holders as `details.candidates` (`[{ kind: 'package', packageId }, …]`), never one holder's layers.

- A name two served packages register in code: the protocol's layered read (`getMetaItemLayered`) asks the registry's package-scoped resolver before it reads any layer, as `getMetaItem` does, so it throws the same `PackageScopedNameRefusedError` naming both, in process too, whatever the metadata service holds. It used to answer the holder that registered first, and so did the REST door on a host that wires no engine for its door chain. `?package=` still reads each holder's layers; a name one package holds is unchanged.
- The REST `/layers` route's catch carries the candidates of a package-scoped refusal, as the plain read's catch does. Before, it answered the refusal by its sentence alone (the dispatcher already carried them).
- A name whose active rows two packages hold keeps the package-less writes' refusal (its sentence, code, status and `?package=` remedy) and gains the same `details.candidates`. The save and delete doors' answer does not move.
- Stored-row holders beside a disabled package keep their in-process answer: the protocol's layered read still serves its in-process readers there, and the door refuses.
