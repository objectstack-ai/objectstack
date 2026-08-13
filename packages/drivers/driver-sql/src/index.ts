// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { SqlDriver } from './sql-driver.js';

export { SqlDriver };
// The absent-file open decision (#6743). Exported as a VALUE because the
// service layer's native→wasm step-down resolves the same answer for its
// fallback rung — one judgement, two call sites, no second `existsSync`.
export { resolveSqliteAbsentFileTarget } from './sql-driver.js';
// [#7929] The read half of the cross-field refusal's withhold: the full,
// operand-naming diagnostic a redacted `INVALID_FILTER` carries under a symbol
// key, for a host that maps driver errors itself and wants the same text in its
// own log. `SqlDriver` writes it to `this.logger` already — this export is what
// stops an embedder from re-deriving the seam (or, worse, putting the text back
// on the wire by spreading the error, which the symbol key exists to prevent).
export { withheldFilterDiagnosticOf } from './sql-driver.js';
export type {
  SqlDriverConfig,
  SqliteJournalMode,
  SqliteAbsentFileMode,
  IntrospectedSchema,
  IntrospectedTable,
  IntrospectedColumn,
  IntrospectedForeignKey,
  // The window-function door's driver-private input shape (#6212). Exported so
  // an embedder calling `findWithWindowFunctions` — the migration prescription
  // #4286 published for the retired `query.windowFunctions` — can name the type
  // it must build, instead of reaching for `as any` and losing `where`/`orderBy`
  // checking with it.
  SqlWindowFunctionSpec,
  SqlWindowFunctionQuery,
} from './sql-driver.js';

// [#5222] The cross-field `{ $field }` push-down conformance corpus: one
// filter, run through the in-memory evaluator AND through a SQL driver, must
// return the same rows.
//
// Exported rather than kept module-private for two reasons. `driver-sqlite-wasm`
// inherits this driver's compiler but executes through its own sql.js dialect,
// so it runs the same corpus from its own package — and a relative import
// across the package boundary is not available to it (`rootDir`), so a shared
// corpus has to be a real export or a second copy. And a third-party driver
// author extending `SqlDriver` can check a new backend against the same table,
// which is the argument `@objectstack/spec/data` makes for exporting its own
// conformance corpora. Test-only DATA — no runtime path in this package reads it.
export {
  CROSS_FIELD_AUTHORED_CASES,
  CROSS_FIELD_CASES,
  CROSS_FIELD_OBJECT_FIELDS,
  CROSS_FIELD_OPERAND_NAMES,
  CROSS_FIELD_REFUSALS,
  CROSS_FIELD_ROWS,
} from './cross-field-conformance-cases.js';
export type {
  CrossFieldAuthoredCase,
  CrossFieldCase,
  CrossFieldRefusalCase,
  CrossFieldRow,
} from './cross-field-conformance-cases.js';

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
