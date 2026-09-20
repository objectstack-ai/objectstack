---
'@objectstack/runtime': minor
---

fix(runtime): `POST /api/v1/packages` parses the manifest's `version` leg instead of installing anything it is handed (#19120)

Clause-②: no (narrowing)

**BREAKING for callers of the install door** — a manifest with no `version`, or
one whose `version` does not match the declared semantic grammar, is now refused
`400` / `VALIDATION_ERROR`. It used to install and answer `201`.

The accept set only shrinks back to what the published declaration has always
said. `PackageInstallRequestSchema` binds `manifest: ManifestSchema`, and
`ManifestSchema` declares `version` required with a semantic grammar. The door
parsed nothing at all: `const manifest = body.manifest || body` went straight to
`installPackage`, with an id check as the only gate on the way. That is
«declared ≠ enforced» on a published API contract — and because the install
landed silently, an author could install metadata the platform's own CLI build
step (`os plugin build`) would have refused outright.

The gate asks the declaration **by reference** — `ManifestSchema.shape.version`
— rather than keeping a copy of the grammar. The version-grammar canon is an
open question on its own card; whichever way it is settled, this door follows it
with no further edit.

**What is not affected.** Boot-time and in-process installs reach
`SchemaRegistry.installPackage` / `ObjectQL.registerApp` directly and never pass
through this branch, so nothing about how a package is loaded from disk or
registered by a plugin changes. A well-formed manifest installs exactly as
before, on both body forms (wrapped and bare) and on both install limbs (the
protocol primitive and the bare-registry fallback).

**Scope — the `version` leg alone.** The declaration's own docblock records five
classes this door answers `201` to while the schema refuses them. This change
closes one: `version`. A missing `type`, unknown keys on either body form, a
string-typed `enableOnInstall` / `overwrite`, and install options spelled on the
bare form are each left exactly as they were — measured after the change, all
four still answer `201`. Each is its own reading and its own card.

**If you are refused.** Give the manifest the `version` the schema has always
required — `version: "1.0.0"`, three dot-separated numbers. The refusal names
the key and shows the shape, so the prescription arrives with the `400` rather
than in a changelog.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row. `objectstack migrate meta` has nothing to reach, because there is no old spelling that maps to a new one — a caller supplies a key the declaration already required. The refusal itself carries the remedy. -->
