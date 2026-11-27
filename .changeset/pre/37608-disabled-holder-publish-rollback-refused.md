---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': minor
---

fix(metadata-protocol)!: refuse the per-item publish and rollback naming no package over the package-less row of a name only disabled packages hold

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no page under `skills/**` or `content/docs/**` teaches a per-item publish or rollback naming no package over a name only disabled packages hold; the refusal's own sentence names the fix

<!-- adr-0087: not-required (already-registered disabled-holder-package-less-row-bare-write-refused) the entry the four other writes of this narrowing registered now names the per-item publish and rollback too -->

**BREAKING** for a deployment that publishes or rolls back one metadata item, with no package named, at a name whose every holder is disabled while a package-less row or draft is stored for it: the write is now refused where it answered `200`. Fix: enable a package that holds the name (`PATCH /api/v1/packages/:id/enable`; `GET /api/v1/packages` shows which are disabled), then send the same publish or rollback again. Naming the package (`?package=`) is not the fix: it addresses that package's own row and leaves the hidden row where it is.

The save, the draft save, the delete and the draft discard naming no package already refuse there (ADR-0150 D3, its 2026-11-26 note): a package-less row stored at a name a package holds is that package's customization, hidden with it. The per-item publish and the per-item rollback did not ask that judgment, so a publish promoted a package-less draft into the hidden row and a rollback rewrote it, and enabling the package again served a body no read had shown.

Every moved answer, before → after, for a type the registry reads by package, while every holder of the name is disabled, where the ADR-0146 D11 close leaves the package-less write open (a base with no pair, a member the package never ships, a holder that is not a read-only code package, among the cells that close lists):

- `POST /api/v1/meta/:type/:name/publish` whose draft address is the package-less draft (beside a package-less row or with none stored): `200` (the package-less draft promoted into the hidden package-less row, or, beside the disabled package's own active row, adopted into that row) → `409 RESOURCE_CONFLICT`, nothing written.
- `POST /api/v1/meta/:type/:name/rollback` with a package-less row stored: `200` (the hidden row rewritten to the version's body) → `409 RESOURCE_CONFLICT`, nothing written.
- The same two through the in-process `publishMetaItem` / `rollbackMetaItem` with no `packageId`.

The refusal's message is the one the save and the delete answer there: it starts with the fix ("Enable the package that holds …"), names no package, and says "send this publish again" or "send this rollback again". Once a holder is enabled again the read naming no package serves the package-less row as it was stored, and the same publish or rollback answers as before the disable.

Not moved: an item the ADR-0146 D11 close covers keeps that close's `403 NOT_OVERRIDABLE` for the publish and the rollback naming no package, with the package enabled or disabled; a publish or rollback naming a package; a publish with no draft at its address, which keeps its `404 NO_DRAFT`; a rollback of a package-bound row; two writes that still land on an item only disabled packages hold, left open for a separate decision (#37851): a publish whose draft address is the disabled package's own draft, promoted into that package's own row (beside a package-less row or not), and a rollback with no package-less row stored, which stores the package-less row again from its history; a name no package holds; a name an enabled package holds; every read. Migration entry `disabled-holder-package-less-row-bare-write-refused` (`@objectstack/spec`), which already carried the four other writes, now carries these two for the upgrade guide.
