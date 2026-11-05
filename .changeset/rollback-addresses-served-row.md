---
'@objectstack/metadata-protocol': patch
---

Clause-②: no
Metadata-protocol: none

fix(metadata-protocol): the per-item rollback (`POST /api/v1/meta/:type/:name/rollback`) restores into the row the by-name read naming no package serves. A `.custom` pair's declared override stored beside a row bound to its read-only base (a row saved before the named-base close and not yet moved) is now rolled back in place, and the base row is left untouched; before, the door read a package-agnostic binding, addressed the base row, and was refused `403 NOT_OVERRIDABLE` naming a row the caller never meant. The door takes no new parameter. A rollback whose served row is the base's own is still refused by the named-base close.
