// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { SqlDriver } from './sql-driver.js';

export { SqlDriver };
export type {
  SqlDriverConfig,
  SqliteJournalMode,
  IntrospectedSchema,
  IntrospectedTable,
  IntrospectedColumn,
  IntrospectedForeignKey,
} from './sql-driver.js';

// Managed-schema drift / reconcile (#2186), incl. the index dimension (#3728)
export {
  applyIndexKeyParts,
  classifyIndexKeyPart,
  diffManagedTable,
  driftKey,
  fieldHasColumn,
  BUILTIN_COLUMNS,
  buildIndexName,
  diffManagedIndexes,
  expectedIndexes,
  isIndexDriftOp,
  isInPlaceSchemaWork,
  isManagedIndexName,
  isRuntimeManagedIndex,
  isSyncReproducibleIndex,
  legacyUniqueIndexNames,
  legacyUniqueReplacements,
  normalizeDeclaredIndex,
  parseIndexDdl,
  uniqueIndexesFromFields,
  INDEX_DRIFT_OPS,
  // Unique-scope vocabulary + NULL-safe organization key part (ADR-0120 D1/D3)
  GLOBAL_TENANT,
  isUniqueScopeDeclared,
  isOrganizationScopedUnique,
  organizationKeyPartSql,
} from './schema-drift.js';
export type {
  DeclaredIndexInput,
  ManagedDriftEntry,
  DriftOp,
  DriftCategory,
  SqlDialectName,
  IndexKeyPart,
  ParsedIndexDdl,
  PhysicalColumn,
  PhysicalIndex,
  ExpectedIndex,
  LegacyUniqueReplacement,
  PendingSchemaWork,
  PendingSchemaWorkKind,
  FieldDef as DriftFieldDef,
} from './schema-drift.js';

export default {
  id: 'com.objectstack.driver.sql',
  version: '1.0.0',

  onEnable: async (context: any) => {
    const { logger, config, drivers } = context;
    logger.info('[SQL Driver] Initializing...');

    if (drivers) {
      const driver = new SqlDriver(config);
      drivers.register(driver);
      logger.info(`[SQL Driver] Registered driver: ${driver.name}`);
    } else {
      logger.warn('[SQL Driver] No driver registry found in context.');
    }
  },
};
