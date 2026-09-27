// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The carrier nobody had named: a bare `z.string()` on a published schema,
// constraining nothing while its own siblings enforced a grammar. Its narrowing
// is the widest of the four by accept-set area and the least likely to be felt,
// because what it starts refusing is not a version at all.
export const entry: SemanticMigration = {
  id: 'package-manifest-version-grammar-enforced',
  surface: 'PackageManifestSchema.version (`marketplace/package-version.zod.ts`) — the '
    + '`version` key inside the manifest snapshot frozen into '
    + '`sys_package_version.manifest_json` at publish time',
  replacement: 'a SemVer 2.0.0 string matching `SEMVER_2_0_0_VERSION_PATTERN` '
    + '(`kernel/version-grammar.ts`). This key was a bare `z.string()`, so it is the one '
    + 'carrier where the grammar is entirely new: `latest`, `v1.0.0`, `1.0`, the empty '
    + 'string, a trailing space and `2.0.0-beta.1extra!` were all accepted and sealed into '
    + 'a published snapshot, and each is refused now. A dist-tag becomes the version it '
    + 'pointed at (`latest` → `1.4.2`); a `v`-prefixed string drops the prefix (`v1.0.0` → '
    + '`1.0.0`); a two-segment string gains its patch (`1.0` → `1.0.0`).',
  reason:
    'A downstream told "the spec validated it" got no validation at all from this carrier. '
    + 'The sibling key it belongs to — `PackageVersionSchema.version`, the row this manifest '
    + 'hangs off — enforced a grammar the whole time, so the SAME release was judged by a '
    + 'rule in one field and by nothing in the adjacent one, and the unjudged value is the '
    + 'one that got frozen and shipped. That is the shape Prime Directive #10 refuses: a '
    + 'declaration advertising a constraint the runtime never applies. The canon ruling gave '
    + 'every carrier of this concept one grammar, and a carrier with no grammar could not be '
    + 'left out of it without keeping the hole open under a new name. Why a D3 semantic TODO '
    + 'rather than a D2 conversion: the repairs above are one-directional guesses. `latest` '
    + 'names whichever release was current when the snapshot was sealed, which is not '
    + 'recoverable from the snapshot, and `1.0` may mean `1.0.0` or the newest `1.0.x` — a '
    + 'transform that picked either would seal a different release under the same checksum.',
  acceptanceCriteria:
    'Every package your registry serves still installs, and `manifestJson.version` parses '
    + 'for each one. The check is cheap and exhaustive: read `manifest_json` on each '
    + '`sys_package_version` row and test its `version` against the grammar. A row that '
    + 'fails was already carrying a value no other carrier would have accepted — confirm '
    + 'what release it was meant to name before choosing the replacement, because the '
    + 'snapshot cannot tell you, and republish rather than editing a frozen snapshot in '
    + 'place. In this repository the measured count of such rows is zero.',
};
