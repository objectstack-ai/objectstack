// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #25792 item 6 — ADR-0141 D8 items 2 and 3: the stated fates for the two
// dependency spellings that sat declared beside the record the install check
// reads. One family, one entry; both keys are in `RETIRED_KEYS_BY_MAJOR[18]`.
export const entry: SemanticMigration = {
  id: 'dependency-unread-spellings-retired',
  surface:
    'PackageDependency.optional (an entry of the marketplace snapshot manifestJson.dependencies[]) '
    + '/ AppManifest.dependencies (the bare-id list on the app install manifest)',
  replacement:
    'delete both keys. A dependency is declared once, with its range, in the package\'s own '
    + '`manifest.dependencies` record (`{ \'com.acme.core\': \'^1.0.0\' }`); the ADR-0141 D2 '
    + 'pre-install check enforces every entry as required, and the marketplace snapshot array is a '
    + 'projection of that record carrying `packageId` and `versionRange` only',
  reason:
    'ADR-0049 enforce-or-remove, deciding ADR-0141 D8 items 2 and 3 on a measured reader count. '
    + 'Measured at origin/main 6390fe52ce: no reader and no writer of either key outside '
    + 'packages/spec, across packages/, ui/, examples/ and apps/, and none in HotCRM at 9464673, '
    + 'whose three modules declare their dependency in the record (the live control). '
    + '`optional` promised "missing dep is a warning, not an error" and the record it projects '
    + 'from has no optional arm, so no install path could honour it; `AppManifest.dependencies` '
    + 'restated the record without its range and nothing consulted it. Why D3 semantic and not a '
    + 'D2 conversion: neither shape is a stack collection member, so a conversion would be a '
    + 'transform with no seam that ever runs (the kernel/Manifest:capabilities precedent).',
  acceptanceCriteria:
    'No source, snapshot or app manifest writes either key: a TypeScript author fails `tsc` (each '
    + 'key is typed as the retired mark), and a parse of PackageDependencySchema, '
    + 'PackageManifestSchema or AppManifestSchema refuses the key with its prescription, the old '
    + 'default included. The live neighbour is untouched and must be verified as such: '
    + '`manifest.dependencies` keeps driving the pre-install check, the namespace co-owners and '
    + 'the hydrate order. Runtime behaviour is deliberately UNCHANGED: nothing ever read either '
    + 'key, so removing them removes no behaviour.',
};
