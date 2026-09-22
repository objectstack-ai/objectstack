// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The boot path's half of the version canon, and the one whose BOUND is the
// load-bearing fact: a widen-never-narrow ruling governs this key, and this
// entry narrows it on eight strings and nothing else. Registered as a D3
// semantic TODO rather than a D2 conversion because every one of the eight has
// more than one defensible repair and the chain can pick none of them: is
// `1.0.0-alpha..1` meant to be `1.0.0-alpha.1`, or `1.0.0-alpha`?
export const entry: SemanticMigration = {
  id: 'plugin-version-semver-2-0-0',
  surface: 'plugin.version — `PluginSchema.version` (`kernel/plugin.zod.ts`), the key a '
    + 'plugin object carries into `kernel.use()`, and the boot-path predicate that judges '
    + 'the same string in `@objectstack/core` (`plugin-loader.ts`)',
  replacement: 'a SemVer 2.0.0 string matching `SEMVER_2_0_0_VERSION_PATTERN` '
    + '(`kernel/version-grammar.ts`). ⭐ Only EIGHT strings stop loading, all of them forms '
    + 'the standard forbids: `01.1.1`, `1.01.1`, `1.1.01` (§2, a leading zero in a numeric '
    + 'identifier — drop it); `1.0.0-0123`, `1.0.0-alpha..1`, `1.0.0-alpha..`, `1.0.0-.` '
    + '(§9, a prerelease identifier that is empty or carries a leading zero — name it, or '
    + 'remove the empty segment); `1.0.0+.` (§10, an empty build identifier — name it or '
    + 'drop the `+` suffix). ⛔ Nothing else moves: every valid prerelease and build form '
    + 'this key accepts today it still accepts, `1.0.0-alpha.1` and '
    + '`1.0.0-rc.1+exp.sha.5114f85` included.',
  reason:
    'The canon ruling made one grammar serve every carrier of "the version of a package or '
    + 'plugin", and named it after the standard: SemVer 2.0.0. This key had the widest of '
    + 'the four accept sets, which is why it is the only one that narrows without also '
    + 'widening. The narrowing is bounded deliberately, and the bound is what keeps the '
    + 'earlier widen-never-narrow ruling on this path honoured rather than reversed: that '
    + 'ruling\'s subject is what LOADS, and none of the eight is a valid prerelease. What '
    + 'they have in common is that no precedence order exists for any of them — '
    + '`dependency-resolver.ts` in `@objectstack/core` can place none of them in an order — '
    + 'so a plugin versioned this way could be published and never compared against its own '
    + 'successor, which is a worse outcome than the refusal. Why it is a D3 semantic TODO '
    + 'and not a D2 conversion: each of the eight has several defensible repairs and the '
    + 'metadata does not say which was meant, and a version is how a release is addressed — '
    + 'rewriting one silently re-points whatever already resolved the old string.',
  acceptanceCriteria:
    'Every plugin you ship boots: `kernel.use(plugin)` resolves for each of them, on both '
    + '`ObjectKernel` and `LiteKernel`. The only versions needing an edit are the eight '
    + 'forms above — a `git grep` for a leading zero in a numeric segment and for a doubled '
    + 'or trailing dot in a suffix finds them all, and the in-repo authoring corpus measured '
    + 'ZERO producers of any of them. For each one you change, confirm nothing still '
    + 'resolves the old string: no `dependencies` range in another manifest, no installed '
    + 'row, no lockfile pin. ⛔ Do not repair one by widening the check back — the grammar '
    + 'is the contract now, on nine carriers at once.',
};
