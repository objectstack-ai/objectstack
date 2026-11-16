---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: an exact `?package=X` read of a doc, view or other type the exact qualifier does not judge answers X's own item or 404, never another package's; a bare doc read of a name two enabled packages ship, beside a package-less entry the layers decline, is refused 409 naming both (ADR-0150 D3/D5, red line 2)

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill teaches a moved answer: `skills/**` teaches `?package=` reads of a holder or of its pair (objectstack-platform SKILL.md, "Customizing an installed package"), which do not move, and never the read of a package that holds no item of the name or the bare doc read beside a package-less entry

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are by-name reads and one save's code-layer read: no stored row, registry slot or package binding changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller that reads `?package=X` of a name X ships no item of, for the types the exact qualifier does not judge (`doc`, `view`, `translation`, `field`, `seed`, `datasource`, `external_catalog`, `object_extension`). Measured on the composed artifact rig (the `MetadataPlugin` artifact door plus `AppPlugin`), on the dispatcher and on `RestServer`, in both registration orders:

- `GET /meta/TYPE/NAME?package=X`, where X ships no item of NAME (installed or not) and another package does: was 200 with that package's item (the registry's first composite, or the metadata service's copy). It is now 404.
- `GET /meta/TYPE/NAME/layers?package=X`, same address: was 200 with another package's `code` and `effective`. It is now 404.
- `GET /meta/TYPE/NAME/layers?package=X`, where X and Y ship NAME and Y registered last: was 200 with Y's `code` and `effective` (the metadata service keeps such a type by name alone). It is now X's, as the plain read answers since #34040.
- `GET /meta/doc/NAME` and its `/layers` and `/published`, where two enabled packages ship NAME and the registry's bare slot holds a package-less entry (a stamp-less registration, or a hydrated or saved package-less row): was 200 with the doc of the package the metadata service registered last. It is now 409 `RESOURCE_CONFLICT` naming both, as with no such entry. A doc a package ships is sealed, so the layers decline that row; it is no servable environment item.
- A save naming package X of a `datasource` with no stored row at X (the credential carry-forward reads the code layer, `readCodeLayerForCarryForward`): carried forward the credential of the package the metadata service kept, or of the first registered holder. It now carries X's own credential, or none when X ships no datasource of the name (the incoming body is kept as sent). Of this family only `datasource` carries a credential, so no other save moves. Path: a save door naming the package (`PUT /meta/datasource/NAME?package=X`), its draft save, and any carry-forward of a body whose credentials the read redacted.

**Not moved.** A holder's own address, a customization pair's address of its base's item, an item bound to no package (the environment's entry), any read naming no package other than the bare doc case above, `object`, and the covered types (`action`, `hook`, `job`, `sharing_rule`, `queue`, `assignment_rule`), whose exact qualifier already refuses 409 `not-held-by-qualifier`.

**No migration.** No schema key, stored row or registry slot changes; nothing is rewritten.

The fix for a caller: address a package that ships the name (or its pair), or read with no package. For the bare doc read, address the holder with `?package=`.
