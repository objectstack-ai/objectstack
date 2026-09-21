// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Version grammars for "the version of a package or plugin" — one declaration
 * per accept set, referenced by every carrier that constrains the string
 * instead of restated at each one.
 *
 * Eight in-repo carriers used to spell one of these three patterns out as a
 * regex literal of their own. Three accept sets written eight times is three
 * accept sets that drift eight ways, and the count was still growing: three of
 * the eight were published schema declarations with no parse caller at all,
 * added by authors who copied a neighbour's literal. Each now references the
 * pattern it already enforced.
 *
 * A ninth in-repo carrier of the same concept spelled no regex at all:
 * `PackageManifestSchema.version` (`marketplace/package-version.zod.ts`) is a
 * bare `z.string()`, and it is deliberately left that way here.
 *
 * ⚠️ These three are NOT interchangeable — they are three different accept
 * sets, and the names say which. Referencing the wrong one moves a published
 * accept set. Pick by what the carrier judges today, never by which name reads
 * best:
 *
 * | pattern | `1.2.3` | `2.0.0-beta.1` | `1.0.0-Beta.1` | `1.0.0+20230101` |
 * |:--|:--|:--|:--|:--|
 * | {@link MAJOR_MINOR_PATCH_VERSION_PATTERN}        | ✅ | ❌ | ❌ | ❌ |
 * | {@link SEMVER_SHAPED_VERSION_PATTERN}            | ✅ | ✅ | ✅ | ✅ |
 * | {@link SEMVER_SHAPED_LOWERCASE_VERSION_PATTERN}  | ✅ | ✅ | ❌ | ✅ |
 *
 * ⛔ **None of the three is a SemVer 2.0.0 conformance check**, and none is
 * named as one. Two of them accept forms SemVer 2.0.0 forbids (leading zeroes
 * in the numeric core, empty and leading-zero identifiers) and one refuses
 * forms it requires. Need ordering, precedence or a standards-compliant
 * verdict? None of these is that predicate — `dependency-resolver.ts` in
 * `@objectstack/core` parses and COMPARES versions and is the module to extend.
 *
 * ⚠️ A `RegExp` is a shared mutable object. None of these carries the `g` or
 * `y` flag, so `.test()` is stateless and the sharing is safe; ⛔ do not add
 * one of those flags to a pattern on this page.
 */

/**
 * Three numeric segments and nothing else — `major.minor.patch`, no
 * prerelease suffix and no build suffix.
 *
 * Accepts `1.2.3`; refuses `2.0.0-beta.1`, `1.0.0+20230101`, `v1.0.0`, `1.0`.
 * Accepts `01.1.1`: `\d+` has always admitted a leading zero here.
 *
 * Carriers: `ManifestSchema.version` (`kernel/manifest.zod.ts`),
 * `MetadataPluginManifestSchema.version` (`kernel/metadata-plugin.zod.ts`),
 * `PluginRegistryEntrySchema.version` (`kernel/plugin-registry.zod.ts`),
 * `PluginMetadataSchema.version` (`kernel/plugin-validator.zod.ts`), and the
 * `PATCH /api/v1/packages/:id` door in `@objectstack/runtime`.
 */
export const MAJOR_MINOR_PATCH_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * `major.minor.patch` with an optional `-prerelease` and an optional `+build`
 * suffix, identifiers in either ASCII case.
 *
 * A strict SUPERSET of SemVer 2.0.0: it accepts every SemVer-valid string, and
 * additionally accepts forms SemVer 2.0.0 forbids — leading zeroes in the
 * numeric core (`01.1.1`), leading-zero and empty prerelease identifiers
 * (`1.0.0-0123`, `1.0.0-alpha..1`), and degenerate build metadata (`1.0.0+.`).
 * Those are accepted DELIBERATELY; `plugin.test.ts` and
 * `plugin-loader.test.ts` pin them as accepted.
 *
 * Carriers: `PluginSchema.version` (`kernel/plugin.zod.ts`) and
 * `PluginLoader.isSemverShapedVersion` (`@objectstack/core`,
 * `plugin-loader.ts`) — the boot path. Those two converged on one spelling
 * under #16365 and now reference one declaration, so they cannot drift apart
 * again. The comment block above `PluginSchema.version` is the record of why
 * this accept set is what it is; read it before changing this line.
 */
export const SEMVER_SHAPED_VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;

/**
 * {@link SEMVER_SHAPED_VERSION_PATTERN} with the suffix identifiers restricted
 * to LOWERCASE ASCII — `1.0.0-beta.1` is accepted, `1.0.0-Beta.1` is not.
 *
 * Strictly inside {@link SEMVER_SHAPED_VERSION_PATTERN}: nothing that passes
 * this pattern can fail the boot path's.
 *
 * Carrier: `PackageVersionSchema.version`
 * (`marketplace/package-version.zod.ts`), the published release row.
 */
export const SEMVER_SHAPED_LOWERCASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?(\+[a-z0-9.-]+)?$/;
