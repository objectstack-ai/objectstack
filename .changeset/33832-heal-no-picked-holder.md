---
'@objectstack/metadata-protocol': patch
---

Clause-②: no
Metadata-protocol: none

The registry heal after a metadata delete no longer registers a picked holder's item in the bare slot. A `dashboard`, `report` or other type addressed by `(package, name)` that the metadata service stores by name alone keeps only the item registered last, and answers it to a read naming any package. When two or more packages held the name in the registry, the heal's baseline read took that answer and registered it in the bare slot, so every bare registry lookup answered the last-registered holder's item and the registry listed it twice (ADR-0150 D3: a bare read never picks between holders). The heal now reads no baseline there: the bare slot stays empty and a read naming no package answers the refusal naming every holder, as the boot leaves it. A name one package holds heals as before.
