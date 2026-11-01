---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(meta)!: the layered view naming no package refuses a name two packages hold with the package-less writes' own `409 RESOURCE_CONFLICT`, instead of serving one holder's stack picked silently (#28337)

Clause-②: no (narrowing) — `GET /meta/:type/:name/layers` and the deprecated `?layers=true` refuse a request with no `?package=` for a name whose active rows two or more packages hold, which they answered `200` before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no stored metadata changes: a read door now answers the refusal the package-less save and delete already answer for the same rows, with the same code, status and holder list. The remedy is the request's (name the package with ?package=), so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** read narrowing at the layered view (`@objectstack/rest`'s shared layered chain, served by `RestServer` and the runtime dispatcher, both spellings).

- **Before.** A `sys_metadata` row is keyed by type, name and package, so two installed packages can each hold an item of one name. For such a name, a save or a delete naming no package was refused `409 RESOURCE_CONFLICT` ("Name the package this save is for…", naming the holders), while the layered view naming no package answered `200` with whichever holder's row a package-agnostic lookup met first. The Studio editor and an agent read one holder's layers with no sign that a second holder existed, and the save that followed was refused.
- **Now.** The layered view naming no package answers that same refusal, worded for the read: `409 RESOURCE_CONFLICT`, "Name the package this layered read is for, then send it again: on the REST door add ?package= with the package id…", naming every holder. Each transport answers it in the envelope its own save door answers the writes' refusal in.
- **Unchanged.** `?package=` with any holder's id reads that holder's stack. A name one package holds, a name only the package-unbound row holds, and a package's row with the package-unbound row beside it answer as before. Every type the writes refuse on is refused here, and no other. The plain item read, `/published` and the protocol's in-process `getMetaItemLayered` (read by the security catalog echo and the packaged-permission-set lock gate) still serve a name two packages hold as they did.
- **New export.** `ObjectStackProtocolImplementation.packagelessLayeredReadRefusal(request)` (`@objectstack/metadata-protocol`) answers the refusal or `undefined`; `RestProtocol` and `MetaItemReadGateSources` gain it as an optional member, and `MetaLayeredRequest` gains an optional `member`.
- **Who sees it.** A client that reads `/layers` with no `?package=` for a name two installed packages both hold.

**The remedy.** Send the read with `?package=` naming the package whose stack you want, as the writes already require.
