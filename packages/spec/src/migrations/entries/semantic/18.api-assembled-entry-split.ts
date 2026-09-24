// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'api-assembled-entry-split',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span.
  surface:
    'api.AssembledInstalledPackageSchema / api.InstalledPackageAtEitherStageSchema / '
    + 'api.ListInstalledPackagesResponseSchema / api.GetInstalledPackageResponseSchema / '
    + 'api.PackageApiContracts, with the types AssembledInstalledPackage, InstalledPackageAtEitherStage, '
    + 'ListInstalledPackagesResponse, GetInstalledPackageResponse and their Parsed twins — imported from '
    + '@objectstack/spec/api',
  replacement:
    'the same names, unchanged, imported from `@objectstack/spec/api-assembled` — change the import '
    + 'path and nothing else. Every schema parses and refuses exactly what it did, the route map has the '
    + 'same four entries, and the JSON Schema ids are unchanged (`json-schema/api/AssembledInstalledPackage.json` '
    + 'and its three siblings are still published under `api/`). Every OTHER Package API declaration — '
    + 'the request schemas of both read doors, the install / uninstall / upgrade / rollback shapes, '
    + '`PackageApiErrorCode` — stays on `@objectstack/spec/api`.',
  reason:
    'Maintainer ruling on #18576 (batch #145 item 1, letter B, 「同意,其他也同意」): split the API entry '
    + 'so its browser-facing half no longer carries the assembled-package declarations. Those five embed '
    + 'the ASSEMBLED package body, which reaches the whole metadata vocabulary and, behind it, the '
    + 'datasource declaration and the driver-config validators; declared inside `@objectstack/spec/api`, '
    + 'that tree was part of every bundle of the entry, and a browser module importing two string '
    + 'constants from it paid for all of it. Measured on the splitting PR: that module (objectui '
    + '`@object-ui/core` column-sortability) bundles to 166,529 bytes gzipped instead of 311,124. The '
    + 'split moves an import path, which is TypeScript source rather than metadata — nothing authors, '
    + 'stores or parses it — so there is no source a D2 conversion could rewrite, and the move is '
    + 'recorded here.',
  acceptanceCriteria:
    'No code imports any of the five names, their types or their Parsed twins from '
    + '`@objectstack/spec/api` — each such import is a TS2305 "has no exported member" error after '
    + 'upgrade, and at runtime the binding is undefined. The same names import cleanly from '
    + '`@objectstack/spec/api-assembled`. No metadata document, stored row or JSON Schema reference '
    + 'needs editing: the schemas and their published ids did not change.',
};
