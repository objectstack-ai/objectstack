// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The version grammar for "the version of a package or plugin" — ONE
 * declaration, referenced by every carrier that constrains the string instead
 * of restated at each one.
 *
 * ## One concept, one accept set, one name
 *
 * Ten carriers of this concept across two repositories once judged the same
 * string by four different rules, and the strictest of them refused
 * `2.0.0-beta.1` — the very string a sibling declaration documented as an
 * example of itself. An author met a different verdict at every door: refused
 * at `os plugin build`, accepted at publish, refused again in the Studio form,
 * accepted with no check at all at install.
 *
 * Collapsing those literals onto three exported constants removed the drift but
 * not the disagreement: three accept sets is still three answers to one
 * question, and two of the three names described accept sets no standard
 * defines. The canon is now the standard the repository had been claiming all
 * along — SemVer 2.0.0 — and {@link SEMVER_2_0_0_VERSION_PATTERN} is the whole
 * of it.
 *
 * ## What that costs, in both directions
 *
 * The move widens most carriers and narrows a fringe on all of them, and both
 * halves are deliberate:
 *
 * - Carriers that refused every prerelease and all build metadata now accept
 *   them — `2.0.0-beta.1`, `17.0.0-rc.5`, `1.0.0+20230101`,
 *   `1.0.0-rc.1+exp.sha.5114f85`. That is what the key's own prose has said
 *   since it was written, and what this repository's own releases need: it cuts
 *   prereleases of its own packages, while the key that describes a package
 *   could not express one.
 * - Identifiers stay case-PRESERVING. SemVer 2.0.0 admits either ASCII case, so
 *   `1.0.0-Beta.1` is valid here and the one carrier that used to refuse it no
 *   longer does.
 * - Every carrier now refuses the forms SemVer 2.0.0 forbids: leading zeroes in
 *   the numeric core (§2 — `01.1.1`), empty or leading-zero prerelease
 *   identifiers (§9 — `1.0.0-0123`, `1.0.0-alpha..1`), and empty build-metadata
 *   identifiers (§10 — `1.0.0+.`).
 *
 * ⭐ The narrowing is bounded, and the bound is the load-bearing property:
 * **no valid prerelease the plugin boot path accepts today is refused.** What
 * it stops accepting is exactly the set of strings no ordering exists for —
 * `dependency-resolver.ts` in `@objectstack/core` can place none of them in a
 * precedence order, so admitting them produced versions that could be published
 * and never compared.
 *
 * ## Using it
 *
 * ⭐ Unlike the three constants it replaces, this pattern IS a SemVer 2.0.0
 * conformance check — it is semver.org's own published expression, and it is
 * named for what it decides. It still decides SHAPE and nothing else: ordering
 * and precedence are a different question, and `dependency-resolver.ts` in
 * `@objectstack/core` is the module that parses and COMPARES versions.
 *
 * ⚠️ A `RegExp` is a shared mutable object. This one carries neither the `g`
 * nor the `y` flag, so `.test()` is stateless and the sharing is safe; ⛔ do
 * not add either flag to it.
 *
 * ⛔ A version RANGE is not a version and is not judged here. `engines.platform`
 * (`kernel/manifest.zod.ts`) and `versionRange`
 * (`marketplace/package-version.zod.ts`) admit a leading range operator and
 * carry their own declarations.
 */

/**
 * SemVer 2.0.0, exactly — semver.org's published regular expression, in its
 * form without named capture groups.
 *
 * `major.minor.patch`, each a numeric identifier carrying no leading zero, plus
 * an optional `-prerelease` of dot-separated non-empty identifiers (numeric ones
 * carrying no leading zero) and an optional `+build` of dot-separated non-empty
 * identifiers. Identifiers are case-PRESERVING: `1.0.0-Beta.1` is valid.
 *
 * | string | verdict |
 * |:--|:--|
 * | `1.2.3`, `2.0.0-beta.1`, `1.0.0-Beta.1`, `1.0.0+20230101` | accepted |
 * | `01.1.1` (§2), `1.0.0-0123` and `1.0.0-alpha..1` (§9), `1.0.0+.` (§10) | refused |
 * | `v1.0.0`, `1.0`, `latest`, the empty string | refused |
 *
 * Carriers: `ManifestSchema.version` (`kernel/manifest.zod.ts`),
 * `MetadataPluginManifestSchema.version` (`kernel/metadata-plugin.zod.ts`),
 * `PluginRegistryEntrySchema.version` (`kernel/plugin-registry.zod.ts`),
 * `PluginMetadataSchema.version` (`kernel/plugin-validator.zod.ts`),
 * `PluginSchema.version` (`kernel/plugin.zod.ts`),
 * `PackageVersionSchema.version` and `PackageManifestSchema.version`
 * (`marketplace/package-version.zod.ts`), `PluginLoader.isSemverVersion`
 * (`@objectstack/core`, the boot path) and the `PATCH /api/v1/packages/:id`
 * door (`@objectstack/runtime`).
 *
 * The accept set is pinned witness by witness in `version-grammar.test.ts`;
 * move a cell there and you have moved a published accept set on every carrier
 * above, in one visible edit.
 */
export const SEMVER_2_0_0_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
