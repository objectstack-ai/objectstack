---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': minor
---

fix(metadata-protocol)!: refuse a write naming no package over the package-less row of a name only disabled packages hold

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no page under `skills/**` or `content/docs/**` teaches a save, draft save, delete or draft discard naming no package over a name only disabled packages hold; the refusal's own sentence names the fix

<!-- adr-0087: registered disabled-holder-package-less-row-bare-write-refused -->

**BREAKING** for a deployment that writes, with no package named, to a metadata name whose every holder is disabled while a package-less row or draft is stored for it: the write is now refused where it answered `200`. Fix: enable a package that holds the name (`PATCH /api/v1/packages/:id/enable`; `GET /api/v1/packages` shows which are disabled), then send the same write again. Naming the package (`?package=`) is not the fix: it addresses that package's own row and leaves the hidden row where it is.

A package-less row stored at a name a package holds is that package's customization, and a disabled package's items are hidden from every read naming no package (ADR-0150 D3, its 2026-11-26 note). The writes naming no package still reached the row: an admin could edit, draft, discard or delete an item no read showed, and a delete lost the customization for good, so enabling the package again served its item without it.

Every moved answer, before → after, for a type the registry reads by package, while every holder of the name is disabled, where the ADR-0146 D11 close leaves the package-less write open (a base with no pair, a member the package never ships, a holder that is not a read-only code package, among the cells that close lists):

- `PUT /api/v1/meta/:type/:name` over a stored package-less row: `200` (the hidden row edited) → `409 RESOURCE_CONFLICT`, nothing written.
- `PUT /api/v1/meta/:type/:name?mode=draft` over a stored package-less row or draft: `200` (a draft stored that the draft read answered `404` for) → `409 RESOURCE_CONFLICT`, nothing written.
- `DELETE /api/v1/meta/:type/:name` over a stored package-less row: `200` (the row removed) → `409 RESOURCE_CONFLICT`, nothing deleted.
- `DELETE /api/v1/meta/:type/:name?state=draft` over a stored package-less draft: `200` (the draft removed) → `409 RESOURCE_CONFLICT`, nothing deleted. With a package-less row stored and no draft, the discard answers the same refusal, where it answered the `?package=` refusal or a no-op receipt.
- The same four through the in-process `saveMetaItem` / `deleteMetaItem` with no `packageId`.

The refusal's message starts with the fix ("Enable the package that holds …") and names no package. Once a holder is enabled again the read naming no package serves the package-less row as it was stored, and the same writes answer as before the disable.

Not moved: an item the ADR-0146 D11 close covers (one read-only code package ships it, with a pair, and `os migrate packageless-overlays` would move its package-less row) keeps that close's answer for the save, the draft save and the delete naming no package, `403 NOT_OVERRIDABLE` with that close's own remedy, with the package enabled or disabled; there only the draft discard moves: over a stored package-less draft from `200` to the `409` above, and over a stored package-less row with no draft from the `409` with the `?package=` sentence to the same `409` with the enable sentence. Also not moved: a name no package holds (the environment's own item) saves, drafts, discards and deletes as before beside a disabled package; a package-less row at a name an enabled package holds; a name only disabled packages hold with no package-less row or draft stored, which keeps its `409` with the `?package=` remedy; the sealed types (`doc`, `action`), which answer `403 NOT_OVERRIDABLE` as before; every read. Migration entry `disabled-holder-package-less-row-bare-write-refused` (`@objectstack/spec`) carries the same fix for the upgrade guide.
