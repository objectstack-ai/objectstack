---
'@objectstack/metadata': patch
---

fix(metadata): two packages' same-named `agent` or `skill` items are both kept in the metadata service, and a read naming one package gets that package's own (ADR-0150 D3/D4)

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: none — `skills/**` and `content/docs/**` teach no in-process `get('agent' | 'skill', …)` and no `/layers?package=` read of an agent or skill; the refusal names every holder to address.

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is that the metadata service's in-memory store keeps each package's agent and skill item under its own (package, name) slot, and which item a by-name read of it answers; the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

The metadata service kept its in-memory `agent` and `skill` items by bare name. Since #31701 two packages of two namespaces may each install the same agent or skill name, and on the artifact boot (`os dev`, `os start`), where every package body's items are registered with the metadata service, the package registered last overwrote the other. The metadata service then answered every read of that name with the survivor, and `GET /api/v1/meta/agent/<name>/layers?package=<the first package>` answered `200` with the other package's code and effective layer, stamped with the other package's id. Each package's agent and skill item now has its own `(package, name)` slot, as `api` already has (#32092): a read naming a package answers that package's item, never another's, both items are listed, and removing one package's items leaves the other's. With one package holding a name, every read answers exactly as before.

Fixed: `GET /meta/agent/<name>/layers?package=<id>` and `GET /meta/skill/<name>/layers?package=<id>`, for a name two packages hold, on an artifact boot: FROM the other package's body (code and effective layer, `packageId` the other package) TO that package's own body.

**BREAKING** for one in-process answer (first-party count: 0 — no example app declares an agent or skill, and no HTTP or MCP door moves from served to refused):

1. The metadata service's own `get('agent' | 'skill', name)` and `getDiagnosed(…)` naming no package, for a name two packages hold: FROM the item of the package registered last TO a `409 RESOURCE_CONFLICT` refusal (`PackageScopedNameRefusedError`, reason `ambiguous-in-environment`) naming both holders, the shape `get('api', name)` took in #32092. `/meta`, `/layers`, `/published` and MCP `prompts/get` already refused that read.

The fix: FROM `get(type, name)` of a two-holder name TO `get(type, name, '<package id>')`, the package the refusal names.
