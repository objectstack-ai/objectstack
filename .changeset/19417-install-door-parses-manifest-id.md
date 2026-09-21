---
'@objectstack/runtime': minor
---

fix(runtime): `POST /api/v1/packages` parses the manifest's `id` leg instead of reading it positionally (#19417)

Clause-②: no (narrowing)

**BREAKING for callers of the install door** — a manifest whose `id` is not
reverse-domain notation is now refused `400` / `VALIDATION_ERROR`. It used to
install and answer `201`.

The accept set only shrinks back to what the published declaration has always
said. `MANIFEST_ID_PATTERN` is declared once in
`packages/spec/src/kernel/manifest.zod.ts` and referenced by both faces of one
identity — `ManifestSchema.id`, what an author writes, and
`PackageSchema.manifestId`, what the registry stores and publishes by. The door
read `manifest.id` POSITIONALLY (`typeof manifest?.id === 'string' ?
manifest.id.trim() : ''`) and parsed nothing, so `id: 'pkg-a'` installed and
answered `201` while `defineStack()`, `os build`, `os validate` and the publish
face all refused the same id. The author was handed a package that could never
be rebuilt or published. That is «declared ≠ enforced» on a published API
contract — and nothing in `packages/spec` moves for it: the declaration was
already right.

The gate asks the declaration **by reference** — `ManifestSchema.shape.id` —
rather than keeping a copy of the grammar, exactly as the `version` leg beside
it does, so a future move of the reverse-domain rule reaches this door with no
further edit. The sentence the caller reads is the declaration's own
(`manifestIdRefusal`), **surfaced rather than reworded**: it names the key,
echoes the value, lists the two examples, and carries a suggestion arm that
verifies its candidate against the pattern before offering it. Posting
`id: 'pkg-a'` now answers, in the response envelope's `error.message`:

```text
Invalid package id 'pkg-a' on `manifest.id`. Expected reverse-domain notation
('com.steedos.crm', 'org.apache.superset') — lowercase dot-separated segments;
hyphens allowed inside a segment, underscores are not. Did you mean
'com.example.pkg-a'?
```

**What is not affected.** Boot-time and in-process installs reach
`SchemaRegistry.installPackage` / `ObjectQL.registerApp` directly and never pass
through this branch, so nothing about how a package is loaded from disk or
registered by a plugin changes. A conforming manifest installs exactly as
before, on both body forms (wrapped and bare) and on both install limbs (the
protocol primitive and the bare-registry fallback).

**The `Package id is required` sentence does NOT move.** `''` fails
`MANIFEST_ID_PATTERN` too, so where this gate sits decides whether a published
message changes or only the accept set does. It is ordered AFTER the existing
`!pkgId` check: an absent, empty, whitespace-only or non-string `id` still
answers `400 Package id is required`, never the schema's sentence — which on
that input is the one case where the suggestion arm has nothing to offer.
Measured both directions. It is ordered BEFORE the `version` gate for the
mirror-image reason: that refusal's sentence names the id it prescribes for, and
prescribing a `version` repair for an id that can never be legal sends the
author round twice.

**Scope — the `id` leg alone.** The declaration's residual docblock records the
classes this door answers `201` to while `PackageInstallBodySchema` refuses
them. This change closes one: `id`. A missing `type`, unknown keys on either
body form, a string-typed `enableOnInstall` / `overwrite`, and install options
spelled on the bare form are each left exactly as they were — measured after the
change, all seven spellings of those four classes still answer `201`, against a
`pkg-a` control that answers `400` and a conforming control that answers `201`.
Each is its own reading and its own card. Closing them is the one call this
handler still pointedly does not make, `PackageInstallBodySchema.safeParse(body)`.

**If you are refused.** Give the manifest an id in reverse-domain notation —
lowercase dot-separated segments, hyphens allowed inside a segment, underscores
not. The refusal names the key, echoes what you wrote and, where a mechanical
repair exists, offers one it has already checked against the rule, so the
prescription arrives with the `400` rather than in a changelog.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row. `objectstack migrate meta` has nothing to reach, because there is no old spelling that maps to a new one — a caller supplies an id the declaration already required, and an id's repair changes the package's identity, so no mechanical mapping could be prescribed even in principle. The refusal itself carries the remedy. -->
