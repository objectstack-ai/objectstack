// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The published release row's half of the version canon. It moves in BOTH
// directions at once — gaining uppercase identifiers, losing the degenerate
// forms — which is why the prescription below has to state each separately
// rather than reading as one tightening.
export const entry: SemanticMigration = {
  id: 'package-version-row-semver-2-0-0',
  surface: 'PackageVersionSchema.version (`marketplace/package-version.zod.ts`) — the '
    + '`version` column of a `sys_package_version` row, and through '
    + '`CreatePackageVersionRequestSchema.version`, which references it, the version a '
    + 'draft release is created with',
  replacement: 'a SemVer 2.0.0 string matching `SEMVER_2_0_0_VERSION_PATTERN` '
    + '(`kernel/version-grammar.ts`). Two changes, opposite in direction. ⭐ WIDER: suffix '
    + 'identifiers may now carry either ASCII case, because SemVer 2.0.0 is '
    + 'case-preserving — `1.0.0-Beta.1` and `1.0.0+Build.5` are accepted where this key '
    + 'used to demand lowercase, and the plugin boot path has always accepted them. ⛔ '
    + 'NARROWER: the forms the standard forbids are refused — `01.1.1` (§2), `1.0.0-0123` '
    + 'and `1.0.0-alpha..1` (§9), `1.0.0+.` (§10).',
  reason:
    "This key's own docstring advertised `2.0.0-beta.1` as an example of itself while a "
    + 'sibling carrier of the same concept refused that exact string — the contradiction '
    + 'the canon card was filed over. The lowercase restriction was the narrowest published '
    + 'accept set of the four and had no standard behind it: it made a release row refuse a '
    + 'version the runtime that loads the release accepts, so a publisher could be turned '
    + 'away for a capitalisation the loader would never have noticed. Why the narrowing is '
    + 'a D3 semantic TODO rather than a mechanical rewrite: a published version row is '
    + 'immutable by contract — `manifestJson` and `checksum` freeze on transition to '
    + '`published` — so a stored degenerate version is not edited in place at all. It is '
    + 'republished under a version that sorts, and whether the old row should be deprecated '
    + 'or left standing is a release decision the chain cannot make.',
  acceptanceCriteria:
    'Publishing and installing every release you have works unchanged. The widening needs '
    + 'no action and can be confirmed cheaply: a mixed-case prerelease that used to be '
    + 'refused at publish now creates a draft. For the narrowing, list your '
    + '`sys_package_version` rows and check each `version` against the grammar — a leading '
    + 'zero in a numeric segment, or a doubled or trailing dot in a suffix, are the only '
    + 'shapes affected. Any row that fails stays readable and installable; what it can no '
    + 'longer do is receive a NEW draft at that spelling, so cut the next release at a '
    + 'version that sorts.',
};
