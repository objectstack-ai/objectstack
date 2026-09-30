// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The ADR-0087 D3/D4 surface leaves the package root for its own subpath, so the
// migration registry's text stops riding in every bundle of the root entry. The
// conversion layer (D2) stays on the root: the authoring funnel reads it at run time.
//
// Form D: no tracker number anywhere in the author-shown text; the decision is
// stated in words.
//
// No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
// span already, and a nested backtick would close it.
export const entry: SemanticMigration = {
  id: 'migrations-entry-split',
  surface:
    'The ADR-0087 migration chain and change manifest, imported from the package root '
    + '@objectstack/spec: MIGRATIONS_BY_MAJOR, MIGRATION_MAJORS, MIGRATION_SUPPORT_FLOOR, '
    + 'RETIRED_KEYS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR, applyMetaMigrations, composeMigrationChain, '
    + 'MigrationFloorError, composeSpecChanges, composeReleaseChanges, the seven change-manifest '
    + 'schemas (SpecChangesSchema, SpecConvertedSchema, SpecMigratedSchema, SpecSurfaceAddSchema, '
    + 'SpecSurfaceRemoveSchema, SpecReleaseChangesSchema, SpecReleaseSurfaceSchema), and the types '
    + 'MigrationStep, MigrationApplication, MigrationChainResult, MigrationHopResult, MigrationTodo, '
    + 'SemanticMigration, SpecChanges, SpecConverted, SpecMigrated, SpecSurfaceAdd, SpecSurfaceRemove, '
    + 'SpecReleaseChanges, SpecReleaseSurface, SurfaceDiff, ReleaseSurfaceDiff and '
    + 'PreviousReleaseRegistries',
  replacement:
    'the same names, unchanged, imported from `@objectstack/spec/migrations` — change the import '
    + 'path and nothing else. The chain, its steps and semantic entries, the retired-key and '
    + 'retired-def tables and the change-manifest schemas are the same objects, and '
    + '`objectstack migrate meta` replays the same chain. The ADR-0087 conversion layer stays on the '
    + 'package root: `ALL_CONVERSIONS`, `CONVERSIONS_BY_MAJOR`, `applyConversions`, '
    + '`applyConversionsToFlow`, `applyConversionsToStoredItem`, `collectConversionNotices`, the '
    + 'three `CONVERSION_*_CODE` constants and their types still import from `@objectstack/spec`.',
  reason:
    'The maintainer ruled that the console first-screen size ceiling is raised now and paid back at '
    + 'the source; this split is that payback. The migration registry is mostly the guidance text '
    + '`objectstack migrate meta` prints, and the package root re-exported it. The registry does work '
    + 'when its module loads (the list of majors and each step\'s rationale are computed then), so no '
    + 'bundler could prove it unused, and all of that text rode in every bundle of the root, whatever '
    + 'the consumer imported: 1,761,987 of the root ESM bundle\'s 3,766,221 bytes. With the chain on '
    + 'its own subpath the CommonJS root is 2,009,810 bytes instead of 3,780,033, and a browser bundle '
    + 'of the ten names the Studio console imports from the root drops from 700,884 to 301,287 bytes '
    + 'gzipped. The conversion layer does not move: `defineStack` and `normalizeStackInput` read it '
    + 'at run time, so moving its names would narrow the root and shrink it by under two kilobytes. The split '
    + 'moves an import path, which is TypeScript source rather than metadata — nothing authors, '
    + 'stores or parses it — so there is no source a D2 conversion could rewrite, and the move is '
    + 'recorded here.',
  acceptanceCriteria:
    'No code imports any of these names from the package root `@objectstack/spec` — each such '
    + 'import is a TS2305 "has no exported member" error after upgrade, and at run time the binding '
    + 'is undefined. The same names import cleanly from `@objectstack/spec/migrations`. No metadata '
    + 'document, stored row or JSON Schema reference needs editing: the chain, its tables and the '
    + 'schemas did not change, and `objectstack migrate meta` rewrites the same documents it did '
    + 'before.',
};
