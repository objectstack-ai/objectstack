---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
'@objectstack/rest': patch
'@object-ui/console': patch
---

fix(metadata-protocol)!: an exact `?package=X` read of a doc, view or other type the exact qualifier does not judge answers X's own item, never another package's: where another package holds the name it is refused 409 `not-held-by-qualifier` naming the holders (ruling 6917064203 on #34398), and a name nothing holds stays 404; a bare doc read of a name two enabled packages ship, beside the environment's own package-less entry, serves that entry, never the package registered last (ADR-0150 D3/D5, red line 2, ruling 6893582352)

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — no skill teaches a moved answer: `skills/**` teaches `?package=` reads of a holder or of its pair (objectstack-platform SKILL.md, "Customizing an installed package"), which do not move, and never the read of a package that holds no item of the name or the bare doc read beside a package-less entry

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are by-name reads and one save's code-layer read: no stored row, registry slot or package binding changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a caller that reads `?package=X` of a name X ships no item of, for the types the exact qualifier does not judge (`doc`, `view`, `translation`, `field`, `seed`, `datasource`, `external_catalog`, `object_extension`). Measured on the composed artifact rig (the `MetadataPlugin` artifact door plus `AppPlugin`), on the dispatcher and on `RestServer`, in both registration orders:

- `GET /meta/TYPE/NAME?package=X`, where X ships no item of NAME and another package does: was 200 with that package's item (the registry's first composite, or the metadata service's copy). It is now `409 RESOURCE_CONFLICT`, reason `not-held-by-qualifier`, with `details.candidates` naming each package that holds NAME (ruling 6917064203 on #34398), the refusal the covered types already answer. X need not be an installed package: a qualifier that names none (the Console's app-name segment) gets the same answer. A name no package holds stays the read's own 404. The read gate answers before the `not-held-by-qualifier` refusal names any holder: for a `doc`, a caller the ADR-0046 §6.7 docs audience refuses is answered the gate's `401 UNAUTHENTICATED` or `403 PERMISSION_DENIED`; for a `view`, a member the list view audience (`requiredPermissions`) refuses is answered the gate's `403 PERMISSION_DENIED`, as the holder's own address answers them. A caller the gate admits is answered the 409.
- `GET /meta/TYPE/NAME/layers?package=X`, same address: was 200 with another package's `code` and `effective`. It is now the same 409.
- `GET /meta/TYPE/NAME/layers?package=X`, where X and Y ship NAME and Y registered last: was 200 with Y's `code` and `effective` (the metadata service keeps such a type by name alone). It is now X's, as the plain read answers since #34040.
- `GET /meta/doc/NAME` and its `/layers` and `/published`, where two enabled packages ship NAME and the registry's bare slot holds a package-less entry: was 200 with the doc of the package the metadata service registered last. It is now 200 with the environment's own item, as the registry and `MetadataFacade.get` already served it. Without such an entry the read stays refused 409 naming both (#34036). Per entry:
  - A stamp-less runtime registration: the plain read and `/published` serve its body; `/layers` reports it as `code` and `effective`.
  - The same registration beside a different package-less stored row: all three doors serve the registration; `/layers` reports it as `code` and `effective` and the row as `overlay`.
  - A stored package-less row the hydrator registered before any package shipped the name (its entry is tenant-authored, `_provenance: 'org'`, so it is no code layer): the plain read and `/published` serve the row; `/layers` reports `code: null` and the row as `overlay` and `effective`.
  - Both `/published` doors (the dispatcher's and `RestServer`'s) serve that item in place of the metadata service's package copy.
- The same stored row hydrated after the packages' artifacts registered wears the first registered holder's envelope (the hydrator grafts it), so no package-less entry exists: the bare doors stay refused 409 naming both, as before.
- A save naming package X of a `datasource` with no stored row at X (the credential carry-forward reads the code layer, `readCodeLayerForCarryForward`): carried forward the credential of the package the metadata service kept, or of the first registered holder. It now carries X's own credential, or none when X ships no datasource of the name (the incoming body is kept as sent; the carry-forward is no read answer, so it does not refuse). Of this family only `datasource` carries a credential, so no other save moves. Path: a save door naming the package (`PUT /meta/datasource/NAME?package=X`), its draft save, and any carry-forward of a body whose credentials the read redacted.

**Console.** The doc page under an app (`/apps/X/docs/...`) and the flat permalink every cross-reference is rewritten to (`/apps/X/docs/NAME`, whose single-item read tells a refused name from an absent one) read with X as ADR-0048 prefer-local context. When that read answers the `not-held-by-qualifier` 409 (X not among the candidates) or a 404, each now reads the name again by name. A cross-reference from X's docs to another package's doc, and the app-name segment of a package that ships several apps (which names no package), keep rendering the doc's one holder, or its holder's audience refusal on the flat permalink; a name two other packages ship lists them (the 409 candidate list), where it showed one of them by registration order.

**Not moved.**
- A holder's own address, a customization pair's address of its base's item, and an item bound to no package (the environment's entry).
- Any read naming no package other than the bare doc case above.
- `object`, and the covered types (`action`, `hook`, `job`, `sharing_rule`, `queue`, `assignment_rule`), whose exact qualifier already refuses 409 `not-held-by-qualifier`.
- The security catalog types `position` and `capability`: the registry keeps one package holder of such a name, so `?package=` of another package keeps the code layers' answer (that holder's item).
- One enabled holder beside a stamp-less bare entry: the bare doors serve the holder's doc while the registry and `MetadataFacade.get` serve the entry (measured, unresolved here; the entry answers first beside two or more holders only). Follow-up card #34452 carries this cell; it needs a ruling first on whether the environment's entry answers first beside one holder, before any reader moves.

**No migration.** No schema key, stored row or registry slot changes; nothing is rewritten.

The fix for a caller: address a package the refusal names (or its pair), or read with no package. For the bare doc read beside the environment's own entry, address a holder with `?package=` to read that holder's doc.
