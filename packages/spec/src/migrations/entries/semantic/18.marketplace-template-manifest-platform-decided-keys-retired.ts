// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0049 enforce-or-remove on `objectstack.manifest.json`, the second half
// of the file's retirement: the two keys only the platform decides. Two
// `TemplateManifest` keys are in `RETIRED_KEYS_BY_MAJOR[18]` for this family;
// the five inert keys are `marketplace-template-manifest-inert-keys-retired`.
export const entry: SemanticMigration = {
  id: 'marketplace-template-manifest-platform-decided-keys-retired',
  surface: 'TemplateManifest.publisher / TemplateManifest.isStarter (objectstack.manifest.json)',
  replacement:
    'delete both keys from objectstack.manifest.json. The hosted control plane assigns a package\'s '
    + 'publisher trust tier from the publisher\'s credentials and decides which packages are starters; '
    + 'neither is something a package states about itself. A first-party publish script that seeds a '
    + 'starter in service mode carries the flag in the script, not in the manifest',
  reason:
    'Both keys read as configuration and configured nothing. `os package publish` never sent either: '
    + '`publisher` is the trust tier that gates listing privileges, and the platform never honours an '
    + 'author\'s self-declared value, so a trust claim does not belong in an author-editable file; the '
    + 'hosted side honours a starter flag only on a first-party service-mode seed. Why D3 semantic and not a '
    + 'D2 conversion: this file is not a stack collection member, so a conversion would be a transform with '
    + 'no seam that ever runs. Where a first-party script read the values off its manifest, moving them into '
    + 'the script is a judgement about that script, not a mechanical edit of the file.',
  acceptanceCriteria:
    'No objectstack.manifest.json writes `publisher` or `isStarter`: a TypeScript author fails `tsc` (each '
    + 'key is typed as the retired mark), a parse of TemplateManifestSchema refuses each with its '
    + 'prescription, and `os package publish` refuses a manifest carrying `publisher` before any network '
    + 'call. Every shipped manifest omits both keys and passes `check:template-manifests`, the bundled blank '
    + 'template no longer writes `isStarter`, and create-objectstack strips both from a scaffolded '
    + 'project\'s manifest.',
};
