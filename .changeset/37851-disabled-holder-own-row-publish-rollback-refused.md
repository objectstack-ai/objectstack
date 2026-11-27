---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': minor
---

fix(metadata-protocol)!: refuse the per-item publish and rollback naming no package of a name only disabled packages hold, with or without a package-less row stored

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no page under `skills/**` or `content/docs/**` teaches a per-item publish or rollback naming no package over a name only disabled packages hold; the refusal's own sentence names the fix

<!-- adr-0087: not-required (already-registered disabled-holder-package-less-row-bare-write-refused) the entry the six other writes of this narrowing registered now names these three cells too -->

**BREAKING** for a deployment that publishes or rolls back one metadata item, with no package named, at a name whose every holder is disabled and no package-less row is stored for it: the write is now refused where it answered `200`. Fix: send the same publish or rollback naming the package (`?package=ID`, in process `packageId`) where the refusal says "Name the package this publish is for" or "Name the package this rollback is for"; enable a package that holds the name (`PATCH /api/v1/packages/:id/enable`) where it says "Enable the package that holds …".

The bare save of such an item already answers `409 RESOURCE_CONFLICT` and writes nothing (a disabled package holds no name). The per-item publish and rollback naming no package asked that judgment only where a package-less row or draft was stored, so they still wrote the disabled package's own row, or stored the package-less row again from its history, and enabling the package again served a body no read had shown.

Every moved answer, before → after, for a type the registry reads by package, while every holder of the name is disabled, where the ADR-0146 D11 close leaves the write open:

- `POST /api/v1/meta/:type/:name/publish` whose draft address is the disabled package's own draft (beside a package-less row or with none stored): `200` (the draft promoted into that package's active row) → `409 RESOURCE_CONFLICT`, "Name the package this publish is for, then send it again …", nothing written. The publish naming the package still promotes it.
- `POST /api/v1/meta/:type/:name/rollback` that restores the disabled package's own row: `200` (that row rewritten to the version's body) → `409 RESOURCE_CONFLICT`, "Name the package this rollback is for, then send it again …", nothing written. The rollback naming the package still restores it.
- `POST /api/v1/meta/:type/:name/rollback` with the package-less row's history but no package-less row stored: `200` (a package-less row inserted with the version's body) → `409 RESOURCE_CONFLICT`, "Enable the package that holds …", nothing written.
- The same three through the in-process `publishMetaItem` / `rollbackMetaItem` with no `packageId`.

Once a holder is enabled again the same publish or rollback answers as before the disable.

Not moved: a publish or rollback naming a package, with the package enabled or disabled; a publish with no draft at its address, which keeps its `404 NO_DRAFT`; an item the ADR-0146 D11 close covers, which keeps that close's `403 NOT_OVERRIDABLE`; a name no package holds; a name an enabled package holds; every read. Correction to the note `37608-disabled-holder-publish-rollback-refused`, released in `19.0.0-next.1` and left as released: its "Not moved" list says that a rollback of a package-bound row is not moved, and that two writes on an item only disabled packages hold still land, left open for a separate decision (#37851): a publish whose draft address is the disabled package's own draft, and a rollback with no package-less row stored. From this release on, all three are refused as listed above, while the same publish or rollback naming the package, or sent once a holder is enabled again, answers as before. Migration entry `disabled-holder-package-less-row-bare-write-refused` (`@objectstack/spec`) now carries them for the upgrade guide.
