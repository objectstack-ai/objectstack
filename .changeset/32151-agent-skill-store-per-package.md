---
'@objectstack/metadata': patch
---

fix(metadata): two packages' same-named `agent` or `skill` items are both kept in the metadata service, and a read naming one package gets that package's own (ADR-0150 D3/D4)

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `skills/**` and `content/docs/**` teach no in-process `get('agent' | 'skill', …)` and no `/layers?package=` read of an agent or skill; the refusal names every holder to address.

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is that the metadata service's in-memory store keeps each package's agent and skill item under its own (package, name) slot, and which item a by-name read of it answers; the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

The metadata service kept its in-memory `agent` and `skill` items by bare name. Since #31701 two packages of two namespaces may each install the same agent or skill name, and on the artifact boot (`os dev`, `os start`), where every package body's items are registered with the metadata service, the package registered last overwrote the other. The metadata service then answered every read of that name with the survivor, and `GET /api/v1/meta/agent/NAME/layers?package=FIRST` (the first package's id) answered `200` with the other package's code and effective layer, stamped with the other package's id. Each package's agent and skill item now has its own `(package, name)` slot, as `api` already has (#32092): a read naming a package answers that package's item and never another's, and both items are listed. For items that carry `packageId`, removing one package's items leaves the other's. With one package holding a name, every read naming no package or naming the holder answers exactly as before; a read naming another package is item 2 below.

Fixed: `GET /meta/agent/NAME/layers?package=PKG` and `GET /meta/skill/NAME/layers?package=PKG`, for a name two packages hold, on an artifact boot: FROM the other package's body (code and effective layer, `packageId` the other package) TO that package's own body.

**BREAKING** for two in-process answers of the metadata service (first-party count: 0, since no example app declares an agent or skill):

1. `get('agent' | 'skill', name)` and `getDiagnosed(…)` naming no package, for a name two packages hold: FROM the item of the package registered last TO a `409 RESOURCE_CONFLICT` refusal (`PackageScopedNameRefusedError`, reason `ambiguous-in-environment`) naming both holders, the shape `get('api', name)` took in #32092.
2. `get('agent' | 'skill', name, PKG)` and `getDiagnosed(…, PKG)`, where `PKG` holds no slot of the name and another package does (one holder or more): FROM the stored item (the one holder's, or the survivor of two) TO `undefined`, and `{ data: undefined, degraded: false, errors: [] }` from `getDiagnosed`; no loader is asked in its place.

On a booted stack no HTTP or MCP door moves from served to refused: `/meta`, `/layers`, `/published` and MCP `prompts/get` read through the protocol, which already refused the bare read of a two-holder name on all four, and a `/meta` or `/layers` read naming a package that does not hold the name (`409`, ADR-0150 D5; measured byte-identical before and after). A host with no merged protocol read, where the MCP agent and skill reads fall back to the metadata service, now gets item 1's refusal where it was served the survivor.

The fix for each:

- FROM `get(type, name)` of a two-holder name TO `get(type, name, PKG)`, a package the refusal names.
- FROM `get(type, name, PKG)` for a package that does not hold the name TO `get(type, name, HOLDER)`, the holding package (the bare read's refusal, or `list`, names it).

Also visible: `list('agent' | 'skill')` and `GET /meta/agent` (and `skill`) list a two-holder name's items in registration order where they listed the survivor alone (the service) or the survivor first (REST). The realtime event of the second holder's first register is `metadata.TYPE.created`, where it was `metadata.TYPE.updated` (the overwrite).
