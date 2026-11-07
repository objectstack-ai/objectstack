// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0049 enforce-or-remove on `objectstack.manifest.json`: one family, one
// entry. Five `TemplateManifest` keys are in `RETIRED_KEYS_BY_MAJOR[18]`.
// `publisher` and `isStarter` are NOT in this family: they were retired as
// their own, `marketplace-template-manifest-platform-decided-keys-retired`.
export const entry: SemanticMigration = {
  id: 'marketplace-template-manifest-inert-keys-retired',
  surface:
    'TemplateManifest.name / TemplateManifest.specVersion / TemplateManifest.skills / '
    + 'TemplateManifest.scaffold / TemplateManifest.visibility (objectstack.manifest.json)',
  replacement:
    'delete the five keys from objectstack.manifest.json. The project slug is `package.json` `name`, and the '
    + 'published package id is `manifestId` (or the one `os package publish` derives from the compiled '
    + 'artifact). The protocol a package needs is `manifest.engines.protocol` in `objectstack.config.ts`, and '
    + 'the spec release it builds against is its `@objectstack/spec` dependency. create-objectstack installs '
    + 'the whole skills catalog, so there is nothing to list. Pass `--visibility` to `os package publish` to '
    + 'set a package\'s visibility',
  reason:
    'Each key looked like configuration and configured nothing. No reader of the file\'s `name`, '
    + '`specVersion`, `skills` or `scaffold` existed in `os package publish`, create-objectstack or anywhere '
    + 'else: create-objectstack wrote `name` and never read it back, never prompted for `scaffold.variables` '
    + 'nor ran `scaffold.postInstall`, and installs every skill whatever `skills` lists; the protocol check '
    + 'reads the artifact\'s `engines.protocol`, never `specVersion`. `os package publish` read `visibility` '
    + 'only to warn that it ignores it. Why D3 semantic and not a D2 conversion: this file is not a stack '
    + 'collection member, so a conversion would be a transform with no seam that ever runs. Moving a '
    + '`visibility` value onto the publish command line is a judgement about the publish, not a mechanical '
    + 'edit of the file.',
  acceptanceCriteria:
    'No objectstack.manifest.json writes `name`, `specVersion`, `skills`, `scaffold` or `visibility`: a '
    + 'TypeScript author fails `tsc` (each key is typed as the retired mark), a parse of TemplateManifestSchema '
    + 'refuses each with its prescription, and `os package publish` refuses a manifest carrying `visibility` '
    + 'before any network call, naming `--visibility`. Every shipped manifest omits the five keys and passes '
    + '`check:template-manifests`, and create-objectstack no longer writes `name` into a scaffolded '
    + 'project\'s manifest.',
};
