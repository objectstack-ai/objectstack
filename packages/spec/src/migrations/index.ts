// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata migration chain + change manifest (ADR-0087 D3/D4) — public surface.
 *
 * The permanent, replayable chain that carries any past major's metadata to
 * current in one command (`objectstack migrate meta --from N`), and the
 * machine-readable `spec-changes.json` manifest every other release artifact is
 * a projection of. See {@link ./types} and {@link ./spec-changes} for rationale.
 */

export type {
  MigrationApplication,
  MigrationChainResult,
  MigrationHopResult,
  MigrationStep,
  MigrationTodo,
  SemanticMigration,
} from './types.js';
export {
  MIGRATIONS_BY_MAJOR,
  MIGRATION_MAJORS,
  MIGRATION_SUPPORT_FLOOR,
} from './registry.js';
export {
  applyMetaMigrations,
  composeMigrationChain,
  MigrationFloorError,
} from './chain.js';
export {
  composeSpecChanges,
  SpecChangesSchema,
  SpecConvertedSchema,
  SpecMigratedSchema,
  SpecSurfaceAddSchema,
  SpecSurfaceRemoveSchema,
  type SpecChanges,
  type SpecConverted,
  type SpecMigrated,
  type SpecSurfaceAdd,
  type SpecSurfaceRemove,
  type SurfaceDiff,
} from './spec-changes.js';
