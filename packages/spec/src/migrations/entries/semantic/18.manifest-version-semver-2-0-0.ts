// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A D3 semantic TODO, not a D2 conversion, and the reason is the widening half.
// The mechanical part of this move is trivial in one direction — `01.1.1`
// becomes `1.1.1` — but the chain cannot know whether an author who wrote a
// leading zero meant the padded spelling of that version or a different one,
// and a version IS how a release is addressed: rewriting it would re-point
// whatever already installed the old string. The widening half needs no edit at
// all, which is why this entry prescribes a check rather than a rewrite.
export const entry: SemanticMigration = {
  id: 'manifest-version-semver-2-0-0',
  surface: 'manifest.version — `ObjectStackManifest.version`, i.e. the `version:` key of '
    + '`defineStack({ manifest })` and of a package manifest — and its three sibling '
    + 'declarations `MetadataPluginManifestSchema.version` (`kernel/metadata-plugin.zod.ts`), '
    + '`PluginRegistryEntrySchema.version` (`kernel/plugin-registry.zod.ts`) and '
    + '`PluginMetadataSchema.version` (`kernel/plugin-validator.zod.ts`), plus the '
    + '`PATCH /api/v1/packages/:id` door in `@objectstack/runtime`',
  replacement: 'a SemVer 2.0.0 string matching `SEMVER_2_0_0_VERSION_PATTERN` '
    + '(`kernel/version-grammar.ts`). ⭐ This is a WIDENING for almost every author: '
    + 'prerelease and build suffixes are accepted for the first time, so `2.0.0-beta.1`, '
    + '`17.0.0-rc.5`, `1.0.0+20230101` and `1.0.0-rc.1+exp.sha.5114f85` now pass a key that '
    + 'refused all of them, and identifiers may carry either ASCII case. ⛔ The one thing '
    + 'that stops being accepted is a leading zero in the numeric core: `01.1.1` becomes '
    + '`1.1.1` — or a different version, if the padded form was standing in for one.',
  reason:
    'One concept — "the version of a package or plugin" — was judged by four different '
    + 'grammars across ten carriers in two repositories, and the strictest of them, this '
    + 'one, refused `2.0.0-beta.1`: the exact string a sibling declaration documented as an '
    + 'example of itself. The contradiction was observable between doors on the same '
    + 'resource, not merely between schema files — the build step refused a prerelease the '
    + 'publish door accepted, while the install door parsed nothing at all. The maintainer '
    + 'ruled one canon, and named it after the standard the repository already claimed in '
    + "this key's own `.describe()`, in the generated reference docs, in the Studio help "
    + 'text and in two ADRs: SemVer 2.0.0. Why the narrowing is not losslessly convertible: '
    + 'a version is an identity. `01.1.1` and `1.1.1` are the same release to a reader and '
    + 'different strings to every registry row, dependency declaration and installed '
    + 'artifact that stored one of them, and which of the two an author meant is not '
    + 'derivable from the metadata.',
  acceptanceCriteria:
    'Every `manifest.version` you author is a SemVer 2.0.0 string, and `defineStack` / '
    + '`objectstack validate` / `os plugin build` report no `version` finding. The only '
    + 'values that need touching are those with a leading zero in a numeric segment — the '
    + 'in-repo authoring corpus measured ZERO of them, so most consumers have nothing to '
    + 'change. For each one you do change, confirm nothing still addresses the old string: '
    + 'no installed row, no `dependencies` range in another manifest, no registry listing. '
    + 'Prove the widening separately and cheaply: a prerelease version that used to be '
    + 'refused at build time now builds.',
};
