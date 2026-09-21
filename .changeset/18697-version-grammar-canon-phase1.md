---
'@objectstack/spec': minor
'@objectstack/core': patch
'@objectstack/runtime': patch
---

feat(spec): one declaration per version grammar — nine carriers of "the version of a package or plugin" now reference three exported constants

Clause-②: no

**No accept set moves, and that is the whole point of this change.** Nine sites
spelled a version regex out as a literal of their own. Three of those spellings
were byte-identical to each other, two more were byte-identical to each other,
and the ninth stood alone — three accept sets written nine times, growing on
their own: three of the nine were published schema declarations with no parse
caller at all, added by authors who copied a neighbour's literal. Each site now
references the constant carrying the pattern it already enforced, byte for byte.

`@objectstack/spec/kernel` gains three exported patterns:

- `MAJOR_MINOR_PATCH_VERSION_PATTERN` — three numeric segments and nothing
  else. Referenced by `ManifestSchema.version`,
  `MetadataPluginManifestSchema.version`, `PluginRegistryEntrySchema.version`,
  `PluginMetadataSchema.version`, and the `PATCH /api/v1/packages/:id` door in
  `@objectstack/runtime`.
- `SEMVER_SHAPED_VERSION_PATTERN` — `major.minor.patch` with an optional
  `-prerelease` and an optional `+build` suffix, identifiers in either ASCII
  case. Referenced by `PluginSchema.version` and by
  `PluginLoader.isSemverShapedVersion` in `@objectstack/core`. Those two
  converged on one spelling under the widen-never-narrow ruling and were held
  equal by hand until now; they reference one declaration and can no longer
  drift apart.
- `SEMVER_SHAPED_LOWERCASE_VERSION_PATTERN` — the same with the suffix
  identifiers restricted to lowercase ASCII. Referenced by
  `PackageVersionSchema.version`.

⛔ **The three are not interchangeable** — they are three different accept sets,
and referencing the wrong one moves a published accept set. None of the three is
a SemVer 2.0.0 conformance check and none is named as one: two accept forms
SemVer forbids (leading zeroes in the numeric core, empty and leading-zero
identifiers), one refuses forms it requires. For ordering or precedence,
`dependency-resolver.ts` in `@objectstack/core` is still the module to extend.

**Nothing an author can write changes.** Every regex is byte-identical to the
literal it replaces — verified per carrier by sha256 over the extracted literal
— so every verdict on every version string is what it was. `PackageManifestSchema.version`
keeps its bare `z.string()`; it is deliberately untouched here. No `.describe()`
text, refusal message or JSON Schema `pattern` moves, and the generated
`authorable-surface/`, `declaration-map/`, `json-schema.manifest/` and
`dropped-refinements` artifacts all come back byte-unchanged. The existing
suites pass unedited — that is the neutrality proof — and a new pin,
`src/kernel/version-grammar.test.ts`, records each grammar's verdict on twelve
witness strings so the next deliberate move to any of them is one visible edit
to one matrix.
