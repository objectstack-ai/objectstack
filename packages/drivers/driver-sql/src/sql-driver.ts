// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SQL Driver for ObjectStack
 *
 * Implements the standard IDataDriver from @objectstack/spec via Knex.js.
 * Supports PostgreSQL, MySQL, SQLite, and other SQL databases.
 */

import type { DateGranularityValue, DriverOptions, FilterCondition, SchemaMode } from '@objectstack/spec/data';
// The ONE introspection contract (ADR-0015 / `ISchemaDiffService`). This
// driver's introspection types are DERIVED from these rather than
// re-declared next to them — see the `Introspection Types` region below.
import type {
  IntrospectedColumn as SpecIntrospectedColumn,
  IntrospectedSchema as SpecIntrospectedSchema,
  IntrospectedTable as SpecIntrospectedTable,
} from '@objectstack/spec/contracts';
import { parseAutonumberFormat, resolveAutonumberFormat, isTenancyDisabled, type AutonumberToken } from '@objectstack/spec/data';
// The DECLARED aggregate vocabulary (#5907). Read from the spec so this driver's
// "the protocol has no such function" refusal cannot drift from what
// `AggregationNodeSchema.function` actually admits.
import { AggregationFunction, emptyGroupValueFor } from '@objectstack/spec/data';
// [#20335, #20889] What each aggregate function ANSWERS, and the `'number'`
// presenter its counts and totals take — defined once in core, for this
// driver's `aggregate()` and the analytics native-SQL face alike.
import { AGGREGATE_ANSWER_KIND, presentAsNumber } from '@objectstack/core';
// [#20387, #11635, #21042] What each aggregate function's operand ACCUMULATES
// IN, the boolean-aggregand cast, and the one column-class predicate both read
// — defined once in core too, for the same two faces.
import { aggregandColumnClass, aggregandOperandSql, type AggregandColumnClass } from '@objectstack/core';
import { STRUCTURED_JSON_TYPES, FILE_REFERENCE_TYPES, MULTI_OPTION_TYPES, NUMERIC_VALUE_TYPES, isMultiValueField } from '@objectstack/spec/data';
// [#16318] The per-field-type physical representation of the NUMERIC family.
// `os generate migration` reads the SAME table, in both of its formats — that
// shared table IS the repair, so ⛔ never restate one of its numbers here.
import { numericColumnFor } from '@objectstack/spec/data';
// [#20444] The `$empty` operator's ONE expansion (ruling A on #20399, record
// 5865693155): the field's declared row of the ruled 「is empty」 table, asked
// of the spec at compile time by {@link SqlDriver.applyEmptyOperator} against
// the declaration {@link SqlDriver.valueShapeFields} recorded. This driver keeps
// no copy of the table.
import { expandEmptyOperator, type ValueShapeFieldDef } from '@objectstack/spec/data';
// [#5659] The Filter Protocol's boolean identity reduction — `$and: []` is TRUE,
// `$or: []` is FALSE, `{}` is a TRUE disjunct, `$not: {}` is FALSE. One
// implementation for all four consumers, proven against the same
// `FILTER_LOGIC_CASES` table this driver's conformance suite runs; this file
// supplies only its own refusals. See `reduceFilterNode` below.
import {
  reduceFilterVerdict,
  reduceFilterKeyVerdict,
  type FilterVerdict as SharedFilterVerdict,
  type FilterVerdictHooks,
} from '@objectstack/spec/data';
// `defaultValue` runtime tokens (#4560). The DDL below asks the SPEC — not a
// list of its own — which `defaultValue`s are instructions rather than literals,
// so the engine and this driver can never disagree about what may become a
// physical column DEFAULT.
import { isNowDefaultToken } from '@objectstack/spec/data';
// [#5702] The retired filter operators and the prescription each refusal
// prints. Read from the spec rather than restated here for the reason the
// #5701 table itself gives: five refusal sites that each write their own
// sentence about `$regex` are five sentences that drift apart. This driver
// prints `why` VERBATIM.
import { RETIRED_FILTER_OPERATORS } from '@objectstack/spec/data';
// [#8220] The read-scope provenance mark's consumer half: where a cross-field
// refusal decides whether its full diagnostic may reach the caller.
import { resolveFilterSubtreeProvenance } from '@objectstack/spec/data';
// [#7872] The shared comparand-type door: the accepted six-type SET (this
// driver's own allowlists delegate their membership to it) and the sentence
// its refusals quote, so the set has one home instead of a copy per driver.
import {
  isAcceptedFilterComparand,
  ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE,
} from '@objectstack/spec/data';
// [#29611] The operator split's list half (`$in` / `$nin` / `$between`): the
// operators whose comparand is a LIST, so each member is bind-tested on its own
// (see {@link assertCompilableComparand}). Asked of the spec, the one source the
// comparand faces read, so this driver keeps no copy to drift from it.
import { isListComparandOperator } from '@objectstack/spec/data';
// [#7536] `$like`/`$ilike`'s pattern language, defined once in the spec: the
// dangling-escape gate every face refuses on, and the LIKE→GLOB translation the
// SQLite dialects need because GLOB is the only case-exact pattern operator
// SQLite has and it does not speak `%`/`_`. `driver-turso`'s remote transport
// compiles the same operator independently and calls the same two functions.
// [#20041] And the U+0000 gate beside the dangling-escape one, for the same reason.
import { hasDanglingLikeEscape, hasNulInLikePattern } from '@objectstack/spec/data';
import type { DriverQuery, IDataDriver } from '@objectstack/spec/contracts';
import { StandardErrorCode } from '@objectstack/spec/api';
import { StorageNameMapping, SystemObjectName } from '@objectstack/spec/system';
import { ExternalSchemaModeViolationError } from '@objectstack/spec/shared';
import { UnsupportedDialectEmissionError } from './dialect-emission-refusal.js';
import { OrganizationlessCounterRefusal } from './organizationless-counter-refusal.js';
import {
  isUnbackedConflictTargetError,
  resolveTenancyPosture,
} from '@objectstack/types';
import { postureEnforcesWall } from '@objectstack/spec/security';
import { temporalStorageForm } from '@objectstack/core';
import {
  buildIndexName,
  diffManagedIndexes,
  type fieldHasColumn,
  GLOBAL_TENANT,
  canonicalIndexKey,
  hashShadowColumnFor,
  parseHashShadowKeyParts,
  indexedKeyColumns,
  isUniqueScopeDeclared,
  normalizeDeclaredIndex,
  organizationKeyPartSql,
  uniqueIndexesFromFields,
  type DeclaredIndexInput,
  type HashShadowKeyPart,
  type ManagedDriftEntry,
  type DriftOp,
  type PhysicalIndex,
  type SqlDialectName,
  type PendingSchemaWork,
} from './schema-drift.js';
// [#15989] The ADR-0104 column step's per-dialect statements. Built here, run
// by `os migrate files-to-references --apply` — see {@link SqlDriver.planMediaColumnMove}.
import {
  type MediaColumnMoveScan,
} from './media-column-move.js';
import { type undeliveredStorageAttributes } from './builtin-column-collision.js';
import { withUpsertConflictClause } from './upsert-conflict-clause.js';
// [#25521 cut 1] The catalog-introspection helpers (`introspectColumnOrder`,
// `introspectColumns` and the foreign-key, primary-key and unique-constraint reads),
// [cut 4] `introspectSchema`, the whole-schema read built on them, and [cut 5]
// `introspectIndexes`, the per-table index read schema sync is built on, and [cut 7]
// `resolveHashShadowKeys`, its MySQL hash-shadow enrichment; the methods of the
// same names below hand each body the members it reads (`IntrospectionHost`).
import {
  introspectColumnOrder,
  introspectColumns,
  introspectForeignKeys,
  introspectIndexes,
  introspectPrimaryKeys,
  introspectSchema,
  introspectUniqueConstraints,
  resolveHashShadowKeys,
} from './sql-driver-introspection.js';
// [#25521 cut 2] The raw-execution path (`execute`, its refusal terminal
// `rawStatementFault`, and `noteRuntimeIndexDdl`, which keeps the ledger of the
// index DDL `execute` ran); the methods of the same names below hand each body
// the members it reads (`RawExecutionHost`).
import { execute, noteRuntimeIndexDdl, rawStatementFault } from './sql-driver-raw-execution.js';
// [#25521 cut 3] The transaction doors (`beginTransaction`, `commit`, `rollback`,
// their deprecated aliases, and the SQLite single-connection guard
// `assertBareKnexSafe`); the methods of the same names below hand each body the
// members it reads (`TransactionHost`).
import {
  assertBareKnexSafe,
  beginTransaction,
  commit,
  commitTransaction,
  rollback,
  rollbackTransaction,
} from './sql-driver-transactions.js';
// [#25521 cut 6] The two in-place drift reconcilers of schema sync
// (`applyDriftOpInPlace` and the SQLite table rebuild `rebuildSqliteTablePatched`);
// the methods of the same names below hand each body the members it reads
// (`SchemaSyncHost`). [#25521 cut 8] The index drift op and its failed-tighten
// restore (`applyIndexDriftOp`, `restoreBareIndexAfterFailedTighten`) beside them.
// [#25521 cut 9] The unique pre-flight and the declared-index sync too
// (`applyNullSafeUniquePreflight`, `syncDeclaredIndexes`, `createNullSafeUniqueIndex`).
// [#25521 cut 10] And the drift pipeline that drives them (`detectTableDrift`, `detectTableIndexDrift`,
// `detectManagedDrift`, `planMediaColumnMove`, `reconcileAndWarnDrift`, `applyMigrationEntries`).
// [#25521 cut 12] And the canonical-encoding convergence schema sync runs at init (the SQLite
// backfills, and the MySQL widening's column reads and ALTER runner, `runWideningAlters`).
// [#25521 cut 17] And the data-lifecycle rotation sub-banner's shard path (`ensureRotation`, `rotationShardKey`,
// `rotationColumnList`), the builtin-column collision warning (`warnBuiltinColumnCollisions`) and the DDL-free
// federated registration `registerExternalObject`.
// [#25521 cut 18] And the deferred-DDL previews (`previewDeferredSchemaWork`, `previewDatetimeConvergence`,
// `previewTimeConvergence`): the read-only plan of what the deferred schema sync would do.
// [#25521 cut 19] And the declared column DEFAULT emission (`nowColumnDefault`, `applyDeclaredColumnDefault`):
// what a field's `defaultValue` becomes in the DDL of a fresh or rebuilt column.
import { applyDeclaredColumnDefault, applyDriftOpInPlace, applyIndexDriftOp, applyMigrationEntries, applyNullSafeUniquePreflight, backfillCanonicalDatetimes, backfillCanonicalJsonEncoding, backfillCanonicalTimes, convergeJsonColumn, countNonTemporalTextRows, createNullSafeUniqueIndex, detectManagedDrift, detectTableDrift, detectTableIndexDrift, ensureRotation, legacyMysqlTimeColumns, legacyMysqlTimestampColumns, nowColumnDefault, planMediaColumnMove, previewDatetimeConvergence, previewDeferredSchemaWork, previewTimeConvergence, rebuildSqliteTablePatched, reconcileAndWarnDrift, registerExternalObject, restoreBareIndexAfterFailedTighten, rotationColumnList, rotationShardKey, runWideningAlters, syncDeclaredIndexes, warnBuiltinColumnCollisions } from './sql-driver-schema-sync.js';
// [#25521 cut 11] The autonumber sequence path (`getNextSequenceValue`, `fillAutoNumberFields`,
// `issueAutonumbers`, `maxAutonumberCounter`, and the #5495 collision re-seed `collidingAutoNumberReservations`
// and `resyncSequenceToDataMax`); the methods of the same names below hand each body the members it reads
// (`AutonumberHost`).
import { collidingAutoNumberReservations, fillAutoNumberFields, getNextSequenceValue, issueAutonumbers, maxAutonumberCounter, resyncSequenceToDataMax } from './sql-driver-autonumber.js';
// [#25521 cut 13] The cross-field and now-anchored comparison compile (`applyCrossFieldComparison`,
// `applyNowAnchorComparison`, and the operand builders `nowAnchorBaseExpr` and `crossFieldOffsetExpr`);
// the methods of the same names below hand each body the members it reads (`CrossFieldComparisonHost`).
import { applyCrossFieldComparison, applyNowAnchorComparison, crossFieldOffsetExpr, nowAnchorBaseExpr } from './sql-driver-cross-field-comparison.js';
// [#25521 cut 14] The upsert conflict-target path (`assertConflictTargetHonoured`, its no-clause twin
// `assertConflictTargetBackedWithoutClause`, `introspectKeyIndexes`, and the fence helpers `upsertTenantGuard`
// and `upsertConflictRefusal`); the methods of the same names below hand each body what it reads (`UpsertConflictTargetHost`).
import { assertConflictTargetBackedWithoutClause, assertConflictTargetHonoured, introspectKeyIndexes, upsertConflictRefusal, upsertTenantGuard } from './sql-driver-upsert-conflict-target.js';
// [#25521 cut 15] The read exits' fault terminals (`backendStatementFault`, the classifiers `aggregateBackendFault`
// and `distinctBackendFault`, and the three unresolvable-column refusals); the methods of the same names below
// hand each body what it reads (`ReadExitFaultHost`).
import { aggregateBackendFault, backendStatementFault, distinctBackendFault, unresolvableAggregateColumnRefusal, type unresolvableColumnNameOf, unresolvableDistinctColumnRefusal, unresolvableFilterColumnRefusal } from './sql-driver-read-exit-fault.js';
// [#25521 cut 16] The filter compiler's leaf predicate emitters and the dialect constructs only they read; the
// methods of the same names below hand each body what it reads (`PredicateEmitterHost`). The declarations
// imported as types are named by docblocks here.
import { applyEmptyOperator, applyJsonMembership, applyLike, applyLikePattern, applyNormalizedComparison, applyNullSafeNegative, type emptyJsonListPredicate, type emptyListUnsupportedDialectError, type likePatternPredicate, type textMatchPredicate, type undeclaredEmptyOperatorFieldError } from './sql-driver-predicate-emitters.js';
import { emitBalancedGroup } from './sql-driver-balanced-group.js';
// [#25521 cut 20] Date bucketing (`buildDateBucketExpr`); the method of the same name below hands the body what
// it reads (`DateBucketHost`).
import { buildDateBucketExpr } from './sql-driver-date-bucket.js';
// [#25521 cut 21] The presumed-timestamp update; the two methods of the same names below hand the bodies what
// they read (`PresumedTimestampHost`).
import { resolveUpdatedAtColumnPresence, updateWithPresumedTimestamp } from './sql-driver-presumed-timestamp.js';
import { makeDatabaseDirectory, probeAbsentSqliteDatabaseFile, SqliteDatabaseFileError } from './sqlite-database-file.js';
import { jsonMembershipPredicate } from '@objectstack/core';
import knex, { Knex } from 'knex';
import { nanoid } from 'nanoid';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { currentPerfTiming, perfNow, type PerfTiming } from '@objectstack/observability';
// [#21007] The JSON-column gate's operator set and refusal text — shared with
// `@objectstack/objectql`'s per-aggregation `filter`, which refuses the same
// operators on the same declared fields. See {@link jsonColumnOperatorError}.
// [#21236] And the class of JSON column the refusal words, which this driver
// reads from its own registries — see {@link SqlDriver.jsonColumnFieldClass}.
import {
  JSON_COLUMN_INCOMPATIBLE_OPERATORS,
  jsonColumnOperatorRefusalText,
  type JsonColumnFieldClass,
} from '@objectstack/core';
// [ADR-0139 D3] The walk that finds a `ReadableIds` leaf this compiler will not
// evaluate, and the one refusal every driver answers it with — shared with
// Turso's remote transport, `driver-memory` and `driver-mongodb`.
import { findMisplacedReadableIds, refuseReadableIdsOnce } from '@objectstack/core';
import { isComposedReadableIds, type ComposedReadableIds } from '@objectstack/spec/data';
// [#29520 codemod] The top-level declarations that moved whole to `sql-driver-top-level.ts`, as this file still reads them.
import { AUTONUMBER_COLLISION_RETRIES, SEQUENCES_TABLE } from './sql-driver-top-level.js';
import type {
  AutoNumberReservation, ConflictTargetVerdict, IntrospectedColumn, IntrospectedForeignKey, IntrospectedSchema,
  NowAnchor, ReadPresentationKind, RowWidthContribution, SqlAggregateLowering, SqlDriverConfig,
  SqlWindowFunctionQuery, SqlWindowFunctionSpec, SqliteAbsentFileMode, SqliteJournalMode, TextMatchShape,
} from './sql-driver-top-level.js';
// [#29520 codemod] Re-exported by name, so every importer of `./sql-driver.js` reads what it read.
export {
  AUDIT_TIMESTAMP_COLUMNS, type AutoNumberReservation, CREATE_INDEX_DDL, type ConflictTargetVerdict, DROP_INDEX_DDL,
  INDEX_DDL_PREFIX, type IntrospectedColumn, type IntrospectedForeignKey, type IntrospectedSchema,
  type IntrospectedTable, JSON_COLUMN_TYPES, LIKE_ESCAPE_CHARACTER, LOCK_WAIT_REFUSAL, MYSQL_DATETIME_PRECISION,
  NUMERIC_SCALAR_TYPES, type NowAnchor, OWN_STATEMENT_FAULT, PRE_DDL_QUESTION_SCOPE, type ReadPresentationKind,
  SEQUENCES_TABLE, SQLITE_NON_TEMPORAL_TEXT_REFS, SQLITE_TIME_EXPR_REFS, type SqlDriverConfig,
  type SqlWindowFunctionQuery, type SqlWindowFunctionSpec, type SqliteAbsentFileMode, type SqliteJournalMode,
  type TextMatchShape, crossFieldComparisonError, declaredValueShapes, fieldReferenceOf, isFilterNode,
  isMultiValuedColumn, isNowDefaultValue, isUnresolvableColumnError, lastIdentifierSegment, mysqlDatetimeLiteral,
  nowAnchorPositionError, postgresTableNameCollisionError, rawStatementFaultError, refuseUnbackedConflictTarget,
  refuseUpsertConflictOutsideWrittenOrganization, resolveSqliteAbsentFileTarget, unquoteSqlIdentifier,
  unsupportedFilterError, withheldFilterDiagnosticOf, withheldFilterError,
} from './sql-driver-top-level.js';
// [#29520 codemod] Class head: dialect probes, logger, configuration: the methods of the same names below hand the bodies what they read (`ClassHeadHost`).
import { ClassHeadFacet } from './sql-driver-class-head.js';
// [#29520 codemod] Lifecycle: the methods of the same names below hand the bodies what they read (`LifecycleHost`).
import { LifecycleFacet } from './sql-driver-lifecycle.js';
// [#29520 codemod] CRUD — IDataDriver core: the methods of the same names below hand the bodies what they read (`CrudHost`).
import { CrudFacet } from './sql-driver-crud.js';
// [#29520 codemod] The sequence semantics a second face shares, stated once: the methods of the same names below hand the bodies what they read (`SequenceSemanticsHost`).
import { SequenceSemanticsFacet } from './sql-driver-sequence-semantics.js';
// [#29520 codemod] Bulk & Batch Operations: the methods of the same names below hand the bodies what they read (`BulkOperationsHost`).
import { BulkOperationsFacet } from './sql-driver-bulk-operations.js';
// [#29520 codemod] Transactions: the methods of the same names below hand the bodies what they read (`TransactionsSectionHost`).
import { TransactionsSectionFacet } from './sql-driver-transactions-section.js';
// [#29520 codemod] Aggregation: the methods of the same names below hand the bodies what they read (`AggregationHost`).
import { AggregationFacet } from './sql-driver-aggregation.js';
// [#29520 codemod] Distinct: the methods of the same names below hand the bodies what they read (`DistinctHost`).
import { DistinctFacet } from './sql-driver-distinct.js';
// [#29520 codemod] Window Functions: the methods of the same names below hand the bodies what they read (`WindowFunctionsHost`).
import { WindowFunctionsFacet } from './sql-driver-window-functions.js';
// [#29520 codemod] Query Plan Analysis: the methods of the same names below hand the bodies what they read (`QueryPlanHost`).
import { QueryPlanFacet } from './sql-driver-query-plan.js';
// [#29520 codemod] Schema Sync (syncSchema / init): the methods of the same names below hand the bodies what they read (`SchemaSyncSectionHost`).
import { SchemaSyncSectionFacet } from './sql-driver-schema-sync-section.js';
// [#29520 codemod] Data-lifecycle rotation (ADR-0057 P2): the methods of the same names below hand the bodies what they read (`RotationHost`).
import { RotationFacet } from './sql-driver-rotation.js';
// [#29520 codemod] Deferred schema DDL (#3917): the methods of the same names below hand the bodies what they read (`DeferredDdlHost`).
import { DeferredDdlFacet } from './sql-driver-deferred-ddl.js';
// [#29520 codemod] Managed-schema drift & reconcile (#2186): the methods of the same names below hand the bodies what they read (`ManagedDriftHost`).
import { ManagedDriftFacet } from './sql-driver-managed-drift.js';
// [#29520 codemod] Schema Introspection: the methods of the same names below hand the bodies what they read (`SchemaIntrospectionHost`).
import { SchemaIntrospectionFacet } from './sql-driver-schema-introspection.js';
// [#29520 codemod] Internal helpers: the methods of the same names below hand the bodies what they read (`InternalHelpersHost`).
import { InternalHelpersFacet } from './sql-driver-internal-helpers.js';
// [#29520 codemod] Filter helpers: the methods of the same names below hand the bodies what they read (`FilterHelpersHost`).
import { FilterHelpersFacet } from './sql-driver-filter-helpers.js';
// [#29520 codemod] Field mapping: the methods of the same names below hand the bodies what they read (`FieldMappingHost`).
import { FieldMappingFacet } from './sql-driver-field-mapping.js';
// [#29520 codemod] Window function builder: the methods of the same names below hand the bodies what they read (`WindowFunctionBuilderHost`).
import { WindowFunctionBuilderFacet } from './sql-driver-window-function-builder.js';
// [#29520 codemod] Column creation helper: the methods of the same names below hand the bodies what they read (`ColumnCreationHost`).
import { ColumnCreationFacet } from './sql-driver-column-creation.js';
// [#29520 codemod] Database helpers: the methods of the same names below hand the bodies what they read (`DatabaseHelpersHost`).
import { DatabaseHelpersFacet } from './sql-driver-database-helpers.js';
// [#29520 codemod] SQLite serialisation: the methods of the same names below hand the bodies what they read (`SqliteSerialisationHost`).
import { SqliteSerialisationFacet } from './sql-driver-sqlite-serialisation.js';
// [#29520 codemod] The facets' hosts, one per driver, which the static block at the end of the class builds.
import {
  aggregationHost, bulkOperationsHost, classHeadHost, columnCreationHost, crudHost, databaseHelpersHost,
  deferredDdlHost, distinctHost, fieldMappingHost, filterHelpersHost, internalHelpersHost, lifecycleHost,
  managedDriftHost, queryPlanHost, rotationHost, schemaIntrospectionHost, schemaSyncSectionHost,
  sequenceSemanticsHost, sqliteSerialisationHost, transactionsSectionHost, windowFunctionBuilderHost,
  windowFunctionsHost,
} from './sql-driver-facet-hosts.js';

// [#29520 codemod] The statics of `SqlDriver` its facet modules read, private ones included, as
// the class declares them (an indexed access on the class). The static block at the end of
// the class fills `SqlDriverStatics` with forwarders: a method is called on the class at
// call time, a field or accessor is read when the body reads it. A facet module imports
// `SqlDriverStatics` AS `SqlDriver`, so each moved body reads `SqlDriver.x` unedited;
// `index.ts` re-exports neither, so neither reaches the package.
export interface SqlDriverStaticsHost {
  readonly ASSUMED_BYTES_PER_CHAR: (typeof SqlDriver)['ASSUMED_BYTES_PER_CHAR'];
  readonly DEFAULT_CONNECT_TIMEOUT_MS: (typeof SqlDriver)['DEFAULT_CONNECT_TIMEOUT_MS'];
  readonly DEFAULT_CREATE_TIMEOUT_MS: (typeof SqlDriver)['DEFAULT_CREATE_TIMEOUT_MS'];
  readonly DEFAULT_STRING_VARCHAR_CHARS: (typeof SqlDriver)['DEFAULT_STRING_VARCHAR_CHARS'];
  readonly DIALECT_CONNECT_TIMEOUT: (typeof SqlDriver)['DIALECT_CONNECT_TIMEOUT'];
  readonly MAX_KEYABLE_VARCHAR_CHARS: (typeof SqlDriver)['MAX_KEYABLE_VARCHAR_CHARS'];
  readonly MAX_VARCHAR_CHARS: (typeof SqlDriver)['MAX_VARCHAR_CHARS'];
  readonly MYSQL_EMIT_CLIENTS: (typeof SqlDriver)['MYSQL_EMIT_CLIENTS'];
  readonly MYSQL_ROW_BYTE_BUDGET: (typeof SqlDriver)['MYSQL_ROW_BYTE_BUDGET'];
  readonly MYSQL_TEXT_TEMPORAL_TYPES: (typeof SqlDriver)['MYSQL_TEXT_TEMPORAL_TYPES'];
  readonly PG_OID_DATE: (typeof SqlDriver)['PG_OID_DATE'];
  readonly PG_OID_DATE_ARRAY: (typeof SqlDriver)['PG_OID_DATE_ARRAY'];
  readonly PG_OID_TEXT_ARRAY: (typeof SqlDriver)['PG_OID_TEXT_ARRAY'];
  readonly POSTGRES_EMIT_CLIENTS: (typeof SqlDriver)['POSTGRES_EMIT_CLIENTS'];
  readonly POSTGRES_WIRE_CLIENTS: (typeof SqlDriver)['POSTGRES_WIRE_CLIENTS'];
  readonly POSTGRES_WIRE_ONLY_CLIENTS: (typeof SqlDriver)['POSTGRES_WIRE_ONLY_CLIENTS'];
  readonly SQLITE_AUTO_VACUUM_INCREMENTAL: (typeof SqlDriver)['SQLITE_AUTO_VACUUM_INCREMENTAL'];
  readonly SQLITE_EMIT_CLIENTS: (typeof SqlDriver)['SQLITE_EMIT_CLIENTS'];
  readonly SQLITE_FILE_REFUSALS: (typeof SqlDriver)['SQLITE_FILE_REFUSALS'];
  readonly SQLITE_JOURNAL_MODE_ENV: (typeof SqlDriver)['SQLITE_JOURNAL_MODE_ENV'];
  readonly autoVacuumOf: (typeof SqlDriver)['autoVacuumOf'];
  readonly clientSpelling: (typeof SqlDriver)['clientSpelling'];
  readonly emissionClients: (typeof SqlDriver)['emissionClients'];
  readonly hashShadowColumnFor: (typeof SqlDriver)['hashShadowColumnFor'];
  readonly isSqliteBusyError: (typeof SqlDriver)['isSqliteBusyError'];
  readonly journalModeOf: (typeof SqlDriver)['journalModeOf'];
  readonly varcharPackLength: (typeof SqlDriver)['varcharPackLength'];
  readonly withConnectBound: (typeof SqlDriver)['withConnectBound'];
  readonly withMysqlCalendarDayAsText: (typeof SqlDriver)['withMysqlCalendarDayAsText'];
  readonly withPostgresCalendarDayAsText: (typeof SqlDriver)['withPostgresCalendarDayAsText'];
  readonly withUtcSession: (typeof SqlDriver)['withUtcSession'];
}
export const SqlDriverStatics = {} as SqlDriverStaticsHost;

export class SqlDriver implements IDataDriver {
  // IDataDriver metadata
  public readonly name: string = 'com.objectstack.driver.sql';
  public readonly version: string = '1.0.0';
  /**
   * Capability advertisement (#4634, ADR-0049): only the bits with an engine
   * reader survive — everything the old 30-bit literal declared (transactions,
   * joins, filters, …) is expressed by the methods this class implements, and
   * subclasses (`SqliteWasmDriver`, cloud's `TursoDriver`) inherit or spread
   * this getter, so keep it truthful per instance.
   */
  public get supports() {
    return {
      /**
       * Per-granularity native date bucket support. Granularities marked
       * `false` (or absent) fall back to in-memory `bucketDateValue()` via
       * `engine.findData` — see `buildDateBucketExpr()` for the SQL emitted.
       */
      queryDateGranularity: this.dateGranularityCapabilities,
      // Persistent, atomic autonumber sequences via `_objectstack_sequences`
      // (see fillAutoNumberFields / getNextSequenceValue). The engine defers
      // autonumber generation to this driver — it is the single source of truth.
      autonumber: true,
      // No syncSchemasBatch() here: the engine calls syncSchema() per object.
      // Subclasses whose transport batches (Turso) implement the method AND
      // flip this bit — the engine requires both.
      batchSchemaSync: false,
      // [#18063] knex transactions are real here, so this stays false — spelled
      // rather than left absent for the same reason `batchSchemaSync` is: this
      // literal is the baseline subclasses SPREAD, and the bit is the only way
      // a subclass whose transport cannot carry a handle (TursoDriver's remote
      // mode) opts out of the `beginTransaction()` it inherits from this class.
      // Absence would mean the same thing and say nothing.
      transactionsUnsupported: false,
    };
  }

  protected knex: Knex;
  protected config: Knex.Config;
  protected jsonFields: Record<string, string[]> = {};
  /**
   * [#20444] Each field's DECLARED value shape — its `type` and `multiple`, the
   * slice {@link expandEmptyOperator} reads — per table, filled at the same
   * three places {@link jsonFields} is ({@link registerManagedObjectMetadata},
   * {@link registerExternalObject} and the shard alias), from the declaration
   * and nothing else.
   *
   * It is the one input the `$empty` operator needs that no other registry
   * holds: `jsonFields` cannot say it, because a structured JSON type (`json`,
   * `address`, …) is a JSON column whose row of the ruled table is null-only,
   * while a multi-value field is a JSON column whose row counts `[]`; and no
   * registry here names the text-like types at all.
   *
   * A field declared with no `type` is not recorded, and neither is a column no
   * field declares (`id`, a table built outside this driver's registration), so
   * `$empty` on either is refused ({@link undeclaredEmptyOperatorFieldError})
   * rather than answered by a guessed row. A declared type the spec does not
   * list among the text-like or multi-value types — including the
   * driver-internal aliases an introspected or test object carries (`string`,
   * `object`, `array`) — takes the row the spec's expansion gives it, which is
   * null-only.
   */
  protected valueShapeFields: Record<string, Record<string, ValueShapeFieldDef>> = {};
  /**
   * SINGLE-VALUE file-family columns per table (`image` / `file` / `avatar` /
   * `video` / `audio`), filled at the same two registration sites as
   * {@link jsonFields} and on BOTH arms of the ADR-0104 window.
   *
   * ## Why a second registry rather than a narrower first one
   *
   * `jsonFields` freezes {@link isJsonField}'s answer at REGISTRATION time and
   * is read by `formatInput` / `formatOutput` on every row. The media arm is a
   * DEPLOYMENT fact that is not knowable then — `sys_migration` does not exist
   * until schema sync has run — so keying the codec off `jsonFields` alone
   * would have frozen the wrong answer on every cold boot. This registry names
   * the media columns unconditionally and the codec asks {@link
   * fileColumnsMoved}, a live boolean, at call time. One registry, one
   * question, and the answer can arrive after registration.
   *
   * ⚠️ MULTI-VALUED media is deliberately NOT here. Its value is a LIST of
   * ids, it stays a JSON column on every deployment, and it is already covered
   * by `jsonFields` through {@link isMultiValuedColumn}. [#17469] That is
   * `file` / `image` — the two `MULTI_CAPABLE_TYPES` members of the family.
   * `avatar` / `video` / `audio` cannot be multi-valued at all any more (the
   * flag is refused on them at the authoring entrance), so they are SINGLE-
   * value media columns whatever they declare, and they belong here.
   */
  protected mediaFields: Record<string, string[]> = {};
  /**
   * Has this deployment moved its media columns to the bare-id encoding?
   * `false` until something says otherwise — see
   * {@link SqlDriverConfig.fileColumnsMoved} for why absence must mean JSON.
   */
  protected fileColumnsMoved = false;
  /** The unresolved resolver from config, cleared once it has been asked. */
  private fileColumnsMovedResolver?: () => boolean | Promise<boolean>;
  /**
   * Did the HOST name {@link SqlDriverConfig.fileColumnsMoved} at
   * construction, in either polarity (#15989)?
   *
   * Distinguishes "the host declared `false`" from "the host said nothing" —
   * two states the boolean field above cannot tell apart, because both leave
   * it `false`. Only the second is an empty slot
   * {@link setFileColumnsMovedResolver} may fill.
   */
  private fileColumnsMovedDeclared = false;
  /**
   * The columns whose DECLARED type is `boolean` or `toggle` — a READ-COERCION
   * registry: its readers present the stored form (SQLite INTEGER 0/1, MySQL
   * `tinyint(1)`) as one JS boolean.
   *
   * ⚠️ [commit d46deba19] SCALAR only. A MULTI-VALUED boolean/toggle is deliberately
   * NOT here — the same carve-out {@link mediaFields} states just above, and
   * the one `numericFields` / `numericValueFields` carry in both fills. Its
   * value is a LIST of booleans in a JSON column, and "present this as ONE
   * boolean" has no meaning
   * over an array: `Boolean(v)` is `true` for EVERY non-empty array, so a
   * stored `[false]` presented as `true` is the OPPOSITE of what is stored,
   * silently.
   *
   * ⭐ [#17469] The condition is {@link isMultiValuedColumn} now, and it has no
   * reachable input on THESE two types any more: `boolean` / `toggle` are
   * outside `MULTI_CAPABLE_TYPES`, the flag is refused on them at the
   * authoring entrance, and a column that declares it is an ordinary boolean
   * column which BELONGS in this registry. The condition stays because the
   * registry must keep following storage, ⛔ not because the old shape
   * survives — a JSON column must never be in here, whichever declaration
   * produces one.
   *
   * The fills spell the condition rather than each reader because
   * no reader needs the entry — measured, all four:
   *
   * 1. the [#11635] Postgres aggregate CAST — would emit `cast(?? as int)`
   *    over a `json` column, which is not a defined cast there;
   * 2. {@link readPresentationKind} — hands the same one-boolean presenter to
   *    the `aggregate()` / `distinct()` doors, where the raw cell is the JSON
   *    STRING `'[false]'` and `Boolean('[false]')` is `true`: the identical
   *    inversion one door over;
   * 3. `formatOutput`'s row pass — the [#11782] coercion this registry exists
   *    for, and where the collapse was filed;
   * 4. {@link isNonTextColumn} — already carves multi-valued out AT THE READER
   *    (`&& !this.isJsonColumn(...)`, commit 82cb69fed), so its answer is UNCHANGED by
   *    the narrowing rather than merely unharmed by it.
   */
  protected booleanFields: Record<string, string[]> = {};
  protected numericFields: Record<string, string[]> = {};
  /**
   * [#16318] The subset of {@link numericFields} whose field type is an
   * AUTHORABLE numeric one (`NUMERIC_VALUE_TYPES`), with the driver-internal
   * SQL aliases `integer` / `int` / `float` deliberately left out.
   *
   * Why a second registry rather than a narrower first one: `numericFields` is
   * read by three other seams — the presentation-kind door, the cross-field
   * comparability door, and the shard aliasing — and every one of them is about
   * "this column holds a number", which the aliases do. Only the READ COERCION
   * needed narrowing, and it needed it on exactly one axis.
   *
   * ⚠️ The axis is EXISTING columns. Moving the coercion off the SQLite-only
   * arm (see `formatOutput`) is what the exact-decimal column forced, and the
   * aliases are how an EXTERNAL, introspected table's columns reach this
   * driver — a PostgreSQL `bigint`, which node-postgres hands back as a STRING
   * precisely because it does not fit a JS double. Coercing those through
   * `Number()` would silently round above 2^53 on a table this change never
   * created, which is outside the "new tables only" bound the ruling drew
   * (「不考虑现有数据」). So on the server dialects the coercion applies to the
   * seven authorable numeric types and to nothing else; SQLite keeps the wider
   * set, because that is where the legacy TEXT-affinity repair this pass was
   * originally written for actually lives.
   */
  protected numericValueFields: Record<string, string[]> = {};
  /**
   * [#20387] The subset of {@link numericFields} whose declared type holds
   * FRACTIONS — the exact-decimal members of `NUMERIC_COLUMN_REPRESENTATION`
   * (`numericColumnFor(type).kind === 'exact'`) and the driver's `float` alias,
   * which is how an introspected decimal / floating column reaches it. What is
   * left out is integer-valued: `rating`, and the `integer` / `int` aliases (an
   * introspected `bigint` among them).
   *
   * Read by {@link SqlDriver.aggregate} only: a `sum` over one of these columns
   * accumulates in double on PostgreSQL and MySQL, and a `sum` over an
   * integer-valued column keeps the database's exact integer total. See
   * `AGGREGATE_ACCUMULATION`.
   */
  protected fractionalNumericFields: Record<string, string[]> = {};
  protected dateFields: Record<string, Set<string>> = {};
  protected datetimeFields: Record<string, Set<string>> = {};
  /**
   * [#21259] The builtin audit timestamps ({@link AUDIT_TIMESTAMP_COLUMNS}) a
   * MANAGED object does not declare — the columns this driver provisions on
   * every table it builds ({@link createAuditTimestampColumn}) that no
   * declaration types. `formatInput` writes them in the `Field.datetime` form,
   * the type their column was created with.
   *
   * Most objects declare both, because the engine's registry injects them as
   * `Field.datetime`; a `managedBy: 'better-auth'` or `systemFields: false`
   * object gets nothing injected, and the engine's audit hook stamps both
   * anyway. A declared column keeps its declaration, whatever its type.
   * Installed by {@link registerManagedObjectMetadata} only: an external object
   * (ADR-0015) maps a remote table whose columns this driver did not create.
   */
  protected undeclaredAuditTimestampFields: Record<string, readonly string[]> = {};
  /**
   * SQLite `Field.datetime` columns proven to hold ONLY canonical UTC text —
   * either backfilled by {@link backfillCanonicalDatetimes} or created empty in
   * this process. Read by {@link needsLegacyDatetimeRepair} to drop the repair
   * expression, so a migrated deployment gets plain indexable `col op ?` SQL.
   */
  protected canonicalDatetimeFields: Record<string, Set<string>> = {};
  protected timeFields: Record<string, Set<string>> = {};
  /**
   * The `Field.time` twin of {@link canonicalDatetimeFields} (#3994): columns
   * known to hold only canonical `HH:MM:SS[.fff]` text — backfilled by
   * {@link backfillCanonicalTimes} or created empty in this process. Read by
   * {@link needsLegacyTimeRepair} to drop the repair expression.
   */
  protected canonicalTimeFields: Record<string, Set<string>> = {};
  /**
   * Federation read path (ADR-0015). For external objects whose physical
   * remote table differs from the object name, these map between the two so
   * {@link getBuilder} targets the remote table while the coercion maps above
   * stay keyed by OBJECT name (matching formatInput/formatOutput). Empty for
   * managed objects, so the managed query path is unchanged.
   */
  protected physicalTableByObject: Record<string, string> = {};
  protected physicalSchemaByObject: Record<string, string> = {};
  protected objectByPhysicalTable: Record<string, string> = {};
  /** External columnMap (ADR-0015): logical field -> physical remote column (for WHERE/ORDER BY/writes). */
  protected fieldColumnByObject: Record<string, Record<string, string>> = {};
  /** External columnMap inverse: physical remote column -> logical field (for read output remap). */
  protected columnFieldByObject: Record<string, Record<string, string>> = {};
  protected tablesWithTimestamps: Set<string> = new Set();
  /**
   * [commit 479fba50d] What is known about `updated_at` on a table this driver was told
   * about WITHOUT running DDL against it.
   *
   * ## Why {@link tablesWithTimestamps} could not answer this
   *
   * That set means "OBSERVED to carry the audit columns", and every one of its
   * four fill sites is downstream of DDL: `initObjects`' `createTable` branch
   * (we built the table, so we know), its "the existing table already has an
   * `updated_at` column" branch (decided from a physical `columnInfo()`), its
   * rotation branch, and `aliasShardBookkeeping`'s rotation-shard copy. A
   * deployment that manages DDL out-of-band — `skipSchemaSync` /
   * `OS_SKIP_SCHEMA_SYNC=1`, the documented posture after running migrations
   * manually — reaches none of them, so it served every UPDATE with the set
   * empty and never stamped. `updated_at` then records the row's CREATION time
   * forever: the column carries an INSERT-time `DEFAULT now()` and no dialect
   * here gives it an `ON UPDATE` clause or a trigger. Nothing errors; list-view
   * sorts, delta sync, cache invalidation and audit answers are just wrong.
   *
   * ## The three states, and what may move between them
   *
   *  - `presumed` — {@link registerManagedObjectMetadata} put it here from the
   *    DECLARED shape alone, at zero round-trips: every table this driver's own
   *    DDL creates gets `created_at`/`updated_at` unconditionally, so a managed
   *    object registered with us is expected to have them. That is an inference,
   *    not an observation, which is the whole reason this is a separate map
   *    rather than more entries in `tablesWithTimestamps`.
   *  - `present` — a stamped UPDATE SUCCEEDED. A column named in a SET list that
   *    does not exist is a parse/plan error on every dialect here, independent
   *    of how many rows matched, so the success IS the proof. From then on the
   *    table is settled and costs nothing.
   *  - `absent` — {@link resolveUpdatedAtColumnPresence} asked the database and
   *    it is genuinely not there (a hand-migrated table that diverged). Never
   *    stamped again, and never re-probed.
   *
   * ⛔ Deliberately NOT read by {@link stampInsertTimestamps}. That helper writes
   * `created_at` too, and none of the evidence above says anything about
   * `created_at` — promoting on an UPDATE's success would let it write a column
   * this driver has no reason to believe exists. The insert path keeps reading
   * `tablesWithTimestamps` exactly as before.
   */
  protected updatedAtColumnState: Map<string, 'presumed' | 'present' | 'absent'> = new Map();
  /** Tables this driver created since connect — see `getSchemaSyncStats`. */
  protected tablesCreatedHere: Set<string> = new Set();
  /** Tables that were already present when this driver first touched them. */
  protected tablesFoundExisting: Set<string> = new Set();
  /**
   * Autonumber field configs per table, captured during initObjects.
   *
   * Each entry records:
   *   - `prefix` + `padWidth`: how to render the next value (`CTR-0007`)
   *   - `tenantField`: the column to scope the sequence by (defaults to
   *     `organization_id` if the object has that field, otherwise null →
   *     sequence is shared globally for that field)
   *
   * Numbering is backed by the `_objectstack_sequences` row keyed by
   * `(object, tenant_id, field)`, not by scanning the data table on each
   * insert. The sequence row is bootstrapped from the existing MAX on
   * first use so legacy data is respected.
   */
  protected autoNumberFields: Record<
    string,
    Array<{ name: string; format: string; tokens: AutonumberToken[]; tenantField: string | null }>
  > = {};

  /** Whether the sequences table has been ensured this process. */
  protected sequencesTableReady = false;
  /**
   * Whether `_objectstack_sequences` is the current `key_hash`-keyed shape.
   * Set on a fresh create or a successful in-place migration. If a legacy table
   * could NOT be migrated, this stays false: fixed-prefix sequences (empty
   * scope) keep working via the legacy `(object, tenant_id, field)` key, while a
   * per-scope write raises an actionable error rather than corrupting counters.
   */
  protected sequencesHasKeyHash = false;
  /** In-flight ensure promise; deduplicates concurrent first calls. */
  protected sequencesTableEnsurePromise: Promise<void> | null = null;

  /**
   * Count of transactions currently open through `beginTransaction`. On SQLite
   * the pool holds a single connection, so while this is > 0 that connection is
   * busy and any bare `this.knex` query would dead-lock acquiring a second one.
   * Used only by the dev/test guard `assertBareKnexSafe`. Incremented in
   * `beginTransaction`, decremented in `commit`/`rollback`; the `openTransactions`
   * set makes the decrement idempotent so a double commit/rollback can't drive
   * the count negative or double-count.
   */
  protected activeTransactions = 0;
  /** Transactions counted in `activeTransactions` and not yet released. */
  protected openTransactions = new WeakSet<object>();

  /**
   * Per-table tenant-isolation column. Populated during `initObjects` by
   * detecting an `organization_id` field. When set and the caller passes
   * `DriverOptions.tenantId`, the driver automatically:
   *
   *   - scopes reads/updates/deletes/aggregates to that tenant
   *   - injects `organization_id` on inserts that omit it
   *
   * If `tenantId` is absent (admin / seed / system path) no scope is
   * applied — preserves backward compatibility for tools that legitimately
   * need cross-tenant access. Tenant enforcement is therefore opt-in by
   * the caller, not by the driver.
   *
   * Entries are overwritten on every (re-)registration; the sticky
   * {@link tenantOptOutByTable} record keeps an explicit `tenancy.enabled:false`
   * declaration from being lost to a later partial re-registration.
   */
  protected tenantFieldByTable: Record<string, string | null> = {};

  /**
   * Tables whose schema EXPLICITLY declared `tenancy.enabled === false`.
   * Sticky across re-registrations: a later registration that omits the
   * `tenancy` block (lifecycle archive `syncSchema`, schema-drift re-sync,
   * partial-schema callers) must NOT resurrect org-scoping via the implicit
   * `organization_id` heuristic — that is how a platform-global object like
   * `sys_license` ends up org-scoped and its NULL-org rows vanish for
   * org-context reads (#3249). A registration that DOES carry a `tenancy`
   * declaration is authoritative and updates/clears the entry.
   */
  protected tenantOptOutByTable: Set<string> = new Set();

  /**
   * Has this driver registered the organization object
   * (`SystemObjectName.ORGANIZATION`)? Set by {@link computeAndRecordTenantField},
   * the one funnel every registration door (managed, external, remote, shard)
   * passes through, and never cleared. It is the composition fact
   * {@link resolveSequenceTenantId} reads: where it holds, an organization-less
   * row on a tenant table is refused (ADR-0131 D9); where it does not — a lean
   * embedding with no identity objects — no organization can exist, and the
   * counter keeps `GLOBAL_TENANT`, as the engine's `no-organization-object`
   * branch does.
   */
  protected organizationObjectRegistered = false;

  /** Throttle table for missing-tenantId warnings ({object}:{op}). */
  protected tenantAuditWarned: Set<string> = new Set();
  /** [ADR-0139 D3] Whether this instance has logged its `ReadableIds` refusal (once per driver). */
  protected readonly readableIdsRefusalLog = { logged: false };
  /**
   * [ADR-0139 D3] The driver its `ReadableIds` refusal names — the package a
   * subclass that inherits this compiler ships in (`driver-sqlite-wasm`,
   * `driver-turso`), so the operator reading the line looks in the right place.
   */
  protected readonly readableIdsDriverName: string = 'driver-sql';

  /**
   * Optional logger sink for security-audit warnings. Tests inject a spy;
   * production callers wire in their preferred logger. Defaults to
   * `console.warn` so warnings surface even without setup.
   */
  protected logger: {
    warn: (msg: string, meta?: any) => void;
    info?: (msg: string, meta?: any) => void;
    /**
     * [#20768] Below-warn channel for a refusal that is the ordinary state of
     * the store, not a fault (see {@link SqlDriver.backendStatementFault}).
     * The default sink has none, so such a line is dropped unless a host
     * injects a logger that keeps `debug`.
     */
    debug?: (msg: string, meta?: any) => void;
    /**
     * Durability-degradation channel (see AGENTS.md §Degradation log levels):
     * used when a constraint the metadata claims is enforced is NOT — e.g. a
     * NULL-safe unique that could not be (re)built (ADR-0120 D4). Falls back
     * to `warn` when the injected sink has no `error`.
     */
    error?: (msg: string, meta?: any) => void;
  } = ClassHeadFacet.logger();

  /**
   * [#9609] Emit on the durability-degradation channel: `error` when the
   * injected sink has one, `warn` when it does not.
   *
   * # Why a named method and not the inline `(this.logger.error ?? this.logger.warn)(…)`
   *
   * Three reasons, and the third is the load-bearing one.
   *
   * ① It names the AGENTS.md channel at the call site, so the level is read as
   * a classification ("this is durability, not functionality") rather than as
   * an adjective someone picked. The `error?` field above already documents
   * that channel; this is its verb.
   *
   * ② `check-durability-degradation-log-level.mjs` cannot SEE the inline
   * fallback. Its `loggerLevel()` matches the shape `<logger|log|console>.<level>(…)`
   * — a call whose expression is a property access. `(a ?? b)(…)` is a call on
   * a PARENTHESIZED expression, so the matcher returns nothing and the catch is
   * reported as `catch swallows the failure with no log at all` — a false
   * silent-swallow on code that is loud at runtime. Measured, not inferred:
   * with `runWideningAlters` in the vocabulary, both widening catches reported
   * exactly that while calling the fallback inline.
   *
   * ⛔ Deliberately NOT `this.logger.error?.(…)`, which the gate DOES recognise.
   * That spelling drops the message entirely for a sink that has no `error` —
   * turning a durability-critical failure into true silence in order to
   * satisfy a matcher, which is the failure this whole rule exists to prevent. The gate follows
   * same-file helpers transitively (its header says so, and the audit reports
   * sites as `loud (error@… via <helper>())`), so routing through this method
   * keeps the fallback AND is correctly classified.
   *
   * ③ **The RECEIVER** (#12792 — the reason this is now the only spelling here).
   * `a.b(…)` passes `a` as the receiver; `(a.b ?? c.d)(…)` evaluates to the bare
   * FUNCTION and then calls it, so the call runs with `this === undefined`. A
   * plain-closure sink — which is this class's own default and every test double
   * in this package — does not read `this` and survives it perfectly, which is
   * why no suite ever went red. `@objectstack/core`'s `ObjectLogger` is a class
   * with prototype methods and no constructor binding: `error`/`fatal` reach for
   * `this.writeErrorLike`, `debug`/`info`/`warn` for `this.write`. Detached, it
   * throws `TypeError: Cannot read properties of undefined` — measured next door
   * on a composed EE boot, where it turned every audience refusal into
   * `HTTP 500 null` (#12773). On THIS channel the loss is worse than the
   * exception: these lines report durability degradation and schema drift, so a
   * throw converts the one signal that exists to be loud into silence plus an
   * unrelated crash.
   *
   * The eight inline `error ?? warn` uses this file used to carry (the ADR-0120
   * D4 index sites) are gone — they now call this method. They were left alone
   * when reason ② was written because the receiver question was not in scope
   * then, not because they were judged safe; two orthogonal problems shared one
   * syntax and only one of them had been reasoned about.
   *
   * ⚠️ The ninth inline use was NOT converted here and must not be: the
   * `info ?? warn` line in {@link reconcileAndWarnDrift} reports a reconcile that
   * SUCCEEDED. It was given the receiver-safe property-access spelling in place,
   * keeping its level. Routing it here would escalate a functional report to the
   * durability channel — the over-application AGENTS.md names as what makes
   * `error` unreadable in the first place.
   *
   * ⚠️ And reason ② turned out NOT to be improved by the conversion, measured
   * rather than assumed (#12792): none of those eight sites sat inside a `catch`
   * guarding a `DURABILITY_CRITICAL_CALLEES` operation, so the checker never
   * discovered them and they produced no findings before the change. The two
   * driver seams it does discover (`runWideningAlters`) already reached this
   * method. The audit prints the same 29 seams, all loud, before and after.
   * Reason ② is why this method exists; it is not what this conversion bought.
   */
  protected logDurabilityFailure(msg: string, meta?: any): void {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts` (see `ClassHeadHost`).
    return ClassHeadFacet.logDurabilityFailure.call(classHeadHost.of(this), msg, meta);
  }

  /**
   * The knex `client` spellings that mean "emit THIS dialect's SQL", one set
   * per dialect family. The single source the three identity getters below and
   * every client-keyed table further down read — {@link DIALECT_CONNECT_TIMEOUT},
   * {@link POSTGRES_WIRE_CLIENTS} and {@link withUtcSession} used to carry a
   * hand-written copy each, and the copies had already drifted apart (#11550).
   *
   * ## Why a set and not a pair of literals
   *
   * {@link SqlDriverConfig} is `Knex.Config & {…}`, so the DECLARED surface is
   * every client name knex accepts, while the enforced one used to be two
   * literals per family. knex's own table (`knex/lib/constants.js`, knex 3.3.0
   * — the version this repo pins) registers aliases:
   *
   * ```js
   * CLIENT_ALIASES = { pg: 'postgres', postgresql: 'postgres', sqlite: 'sqlite3' }
   * ```
   *
   * So `postgres` is knex's CANONICAL name for the dialect of which `pg` and
   * `postgresql` are merely the registered aliases, and `sqlite` is an alias of
   * the canonical `sqlite3`. Measured on the pinned knex: `pg`, `postgres` and
   * `postgresql` each construct a client with `dialect === 'postgresql'` and
   * `driverName === 'pg'` — one dialect, three spellings.
   *
   * Matching two literals therefore made `client: 'postgres'` — knex's PRIMARY
   * name for the dialect — answer `isPostgres === false`, silently dropping
   * every Postgres branch in this file on a config knex considers valid.
   * Nothing failed. The sharpest case is {@link nowColumnDefault}: the
   * fall-through emits a bare `CURRENT_TIMESTAMP` default on a `DATE` column,
   * i.e. the calendar day in the SERVER's timezone — the exact defect
   * ("measured: a UTC-12 server records YESTERDAY") that method's Postgres
   * branch exists to remove.
   *
   * ## What is deliberately NOT in here — settled by the #11756 ruling
   *
   * `redshift` and `cockroachdb` speak the pg WIRE protocol and are in
   * {@link POSTGRES_WIRE_ONLY_CLIENTS} for that reason — but they are separate
   * knex dialects (`redshift` compiles its own DDL; `cockroachdb` ships its own
   * driver), and whether this driver should claim to emit correct DDL for them
   * was a SUPPORT-SCOPE question rather than a spelling one. It is no longer
   * open: the maintainer ruled on 2026-08-25 (#11756, verbatim 「同意」 on
   * 「C，但 pgnative 归入 Postgres 家族」) that they keep wire recognition and
   * get NO emission identity — and that a configuration of theirs reaching the
   * DDL path is REFUSED BY NAME ({@link assertDialectEmits}) rather than served
   * a table this driver cannot vouch for.
   *
   * What "cannot vouch for" means, measured on the pinned knex rather than
   * argued (#11991, one CREATE TABLE, three clients):
   *
   * ```
   * pg         create table "t" ("id" varchar(255), …, "body" text,
   *                              constraint "t_pkey" primary key ("id"))
   * pgnative   … byte-identical to pg …
   * redshift   create table "t" ("id" varchar(255) not null, …,
   *                              "body" varchar(max));
   *            alter table "t" add constraint "t_pkey" primary key ("id")
   * ```
   *
   * `mariadb` is the same shape against the MySQL family and is EXPLICITLY out
   * of that ruling's scope: it stays unrecognised, and — deliberately — it is
   * not refused either. {@link POSTGRES_WIRE_ONLY_CLIENTS} is the refusal's
   * only input, so nothing here quietly widens the ruling by one dialect.
   *
   * Wire recognition and the connect-timeout table EXTEND these sets through
   * that one declared extension; nothing derives these sets from a union of the
   * others, because that would re-answer #11756 as a side effect of a refactor.
   *
   * `better-sqlite3` is a member rather than an extension because it is not a
   * scope question: this driver's own default SQLite client is `better-sqlite3`
   * and every SQLite branch in this file was written against it.
   */
  private static readonly POSTGRES_EMIT_CLIENTS: ReadonlySet<string> = new Set([
    // `pgnative` is a MEMBER, not an extension (#11756 ruling): knex resolves it
    // to `dialect === 'postgresql'` — the same query compiler as `pg`, differing
    // only in which npm binding carries the bytes (`driverName: 'pgnative'`).
    // Measured on the pinned knex while landing #11991. Before that ruling it
    // was the easy end of the question lumped in with the hard end, and it paid
    // for it: `isPostgres === false` meant a `date` column got a bare
    // CURRENT_TIMESTAMP default — the server-timezone calendar day, the exact
    // #11550 defect — on a config knex compiles as Postgres.
    'postgres', 'pg', 'postgresql', 'pgnative',
  ]);
  /** SQLite spellings that mean "emit SQLite SQL". See {@link POSTGRES_EMIT_CLIENTS}. */
  private static readonly SQLITE_EMIT_CLIENTS: ReadonlySet<string> = new Set([
    'sqlite3', 'sqlite', 'better-sqlite3',
  ]);
  /** MySQL spellings that mean "emit MySQL SQL". See {@link POSTGRES_EMIT_CLIENTS}. */
  private static readonly MYSQL_EMIT_CLIENTS: ReadonlySet<string> = new Set([
    'mysql', 'mysql2',
  ]);

  /**
   * The ONE declared extension over the emission sets above: knex clients this
   * driver recognises on the pg WIRE and deliberately does not emit DDL for.
   *
   * #11756 ruling, maintainer, 2026-08-25, verbatim 「同意」 on 「C，但
   * pgnative 归入 Postgres 家族」 — "connection and parsing yes, building your
   * tables no", stated in the open instead of left to be discovered.
   *
   * ## Why it exists as a NAMED set rather than two literal pairs
   *
   * Before #11991 the pair `cockroachdb, redshift` was hand-written into
   * {@link DIALECT_CONNECT_TIMEOUT} and again into
   * {@link POSTGRES_WIRE_CLIENTS}, and a third copy would have been needed for
   * the refusal — three lists that must agree, kept in step by nobody. They
   * answer one question ("recognised on the wire, not for emission") and now
   * have one answer: both tables extend the emission sets through THIS set, and
   * {@link assertDialectEmits} refuses exactly its members. Adding a future
   * pg-wire client to this line therefore gives it the connect bound, the
   * #11389 calendar-day parser AND the named DDL refusal in one edit — the
   * three cannot drift apart again.
   *
   * ## The direction is load-bearing
   *
   * ⛔ Never derive the emission sets FROM this one. Emission is the source and
   * this is the extension; the reverse would grant `redshift` and `cockroachdb`
   * SQL-emission identity as a silent side effect of a refactor — the outcome
   * (option A) the ruling explicitly declined, on a platform that has never
   * measured how far their DDL diverges.
   *
   * ⛔ `mariadb` is NOT here. It is the same shape one family over and the
   * ruling put it explicitly out of scope: unrecognised for emission, and not
   * refused either. A dialect the platform never claimed and never refused is a
   * third state, and it is the deliberate one.
   */
  private static readonly POSTGRES_WIRE_ONLY_CLIENTS: ReadonlySet<string> = new Set([
    'cockroachdb', 'redshift',
  ]);

  /**
   * Every client spelling this driver will emit DDL for, sorted — the guidance
   * half of {@link assertDialectEmits}'s refusal.
   *
   * Read off the emission sets rather than written out, so the sentence an
   * operator is shown can never name a client the driver has stopped
   * supporting, or omit one it has just gained (`pgnative` arrived exactly that
   * way).
   */
  protected static emissionClients(): string[] {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts`.
    return ClassHeadFacet.emissionClients();
  }

  private static clientSpelling(config: unknown): string {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts`, its docblock with it.
    return ClassHeadFacet.clientSpelling(config);
  }

  /**
   * Whether the underlying database is a SQLite variant.
   *
   * Every knex spelling of the family: `sqlite3` (knex's canon), its registered
   * alias `sqlite`, and `better-sqlite3`. See {@link SQLITE_EMIT_CLIENTS}.
   */
  protected get isSqlite(): boolean {
    return SqlDriver.SQLITE_EMIT_CLIENTS.has(SqlDriver.clientSpelling(this.config));
  }

  /**
   * Whether the underlying database is PostgreSQL.
   *
   * Every knex spelling of the family: `postgres` (knex's canon), its registered
   * aliases `pg` / `postgresql`, and `pgnative` — a separate knex client name
   * that resolves to the same `postgresql` dialect and compiler (#11756 ruling).
   * `redshift` and `cockroachdb` are deliberately NOT here: they are refused by
   * name at the DDL gate instead. See {@link POSTGRES_EMIT_CLIENTS},
   * {@link POSTGRES_WIRE_ONLY_CLIENTS} and {@link assertDialectEmits}.
   */
  protected get isPostgres(): boolean {
    return SqlDriver.POSTGRES_EMIT_CLIENTS.has(SqlDriver.clientSpelling(this.config));
  }

  /**
   * Whether the underlying database is MySQL.
   *
   * Both knex spellings of the family; `mariadb` is a separate knex dialect and
   * is deliberately NOT here. The #11756 ruling put `mariadb` explicitly OUT of
   * its scope, so it is neither recognised nor refused — see
   * {@link POSTGRES_WIRE_ONLY_CLIENTS} for why that third state is deliberate.
   */
  protected get isMysql(): boolean {
    return SqlDriver.MYSQL_EMIT_CLIENTS.has(SqlDriver.clientSpelling(this.config));
  }

  /**
   * [#21227] Whether this dialect's `INSERT … RETURNING *` answers the rows it
   * STORED.
   *
   * `create` and `bulkCreate` answer the inserted record (`IDataDriver.create`).
   * Where this is true they take it from the statement, in one round trip.
   * Where it is false the statement answers no rows, and both doors read back
   * what they wrote, by the ids they wrote ({@link readBackInsertedRows}).
   *
   * True for the SQLite and PostgreSQL families. knex compiles `RETURNING` for
   * both, and the row it answers is the stored one, server-side column defaults
   * included (measured on better-sqlite3 and on live PostgreSQL 16.14).
   *
   * False for the MySQL family, which has no `RETURNING`. knex's MySQL compiler
   * drops the clause with a `.returning() is not supported by mysql` warning and
   * answers `[insertId]`: ONE element whatever the row count, and `0` for this
   * driver's string primary key. Measured on live MySQL 8.0.46 before this
   * change: `create` answered `0`, a three-row `bulkCreate` answered `[0]`, and
   * every row was stored. The auth adapter answers what `create` answers, so
   * sign-up failed on MySQL with the user row stored and no account row.
   *
   * False, too, for a client this driver recognises as neither family (a Client
   * constructor, a wire-only spelling such as `redshift`): reading back is
   * correct on every dialect, and `RETURNING` is only the shortcut a dialect
   * known to answer the stored row is given. The SQLite and PostgreSQL doors
   * therefore pay no extra round trip, and the MySQL doors pay one SELECT per
   * statement (per `create`, and per `bulkCreate` batch).
   */
  protected get insertReturnsStoredRows(): boolean {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts` (see `ClassHeadHost`).
    return ClassHeadFacet.insertReturnsStoredRows.call(classHeadHost.of(this));
  }

  /**
   * Per-granularity native SQL bucket support, computed from dialect.
   *
   * Must match `bucketDateValue()` in @objectstack/objectql exactly:
   *   year    → 'YYYY'
   *   month   → 'YYYY-MM'
   *   day     → 'YYYY-MM-DD'
   *   quarter → 'YYYY-Q[1-4]'
   *   week    → 'YYYY-W[01-53]' (ISO-8601)
   *
   * Granularities not listed (or set to false) fall back to in-memory bucketing
   * via engine.findData → applyInMemoryAggregation.
   */
  /**
   * [#13714] The caller's OUTPUT COLUMN NAME, quoted as exactly ONE identifier.
   *
   * ## The defect this exists for
   *
   * Knex's `??` binding does not quote an identifier — it PARSES one. Its
   * `wrapString` splits the value on `.` into `table.column` segments (and on a
   * literal `" as "` into value + alias) and re-quotes each piece separately.
   * That is right for a column REFERENCE, which may legitimately be qualified,
   * and wrong for an ALIAS, which is a single name the caller reads its own
   * result back under. Every alias site here used `?? `, so an alias carrying a
   * dot compiled to a qualified reference in the alias position:
   *
   * ```
   * select strftime('%Y-%m', `due_date`) as `due_date`,
   *        count(*) as `showcase_delivery`.`count`   ← not valid SQL anywhere
   *   from `showcase_task` group by strftime('%Y-%m', `due_date`)
   *   -- near ".": syntax error   (better-sqlite3, measured)
   * ```
   *
   * The statement never runs, so the caller gets `DATABASE_ERROR`/500 from
   * {@link SqlDriver.aggregate}'s terminal envelope (#11455) — a backend fault
   * for a query that is spelled correctly.
   *
   * ## Why analytics hits this and almost nothing else does
   *
   * An analytics measure is named `<cube>.<measure>` on the wire, and
   * `ObjectQLStrategy` uses that name verbatim as the aggregation `alias` —
   * because it is the key the caller reads the number back under. So EVERY cube
   * query that reaches this face carries a dotted alias. It only shows when a
   * `timeDimensions[].granularity` is present, and the granularity is the ROUTER
   * rather than the fault: `NativeSQLStrategy.canHandle` declines exactly on a
   * granularity, and that native face hand-writes `AS "<measure>"` — one quoted
   * identifier, correct — so every un-bucketed cube query is served by the face
   * that already got this right. That fork is why the field report's controls
   * are 200 while `granularity: 'month'` is a 500, and why the date-bucket
   * parity pins are green: their reference side keys rows by the alias as a
   * plain JS object key, where a dot is inert.
   *
   * ## Why this is not "quote it ourselves"
   *
   * `client.wrapIdentifier` is the SAME function knex calls on each segment it
   * split out, so this changes nothing but the segmentation: the dialect's own
   * quoting and quote-doubling still apply (`"` on Postgres, backticks on MySQL
   * and SQLite), and a host-supplied `wrapIdentifier` config hook is still
   * honoured. An alias is therefore never grammar — it stays a quoted
   * identifier, exactly as it was before, minus the split.
   *
   * ⛔ NOT for column references. `field` may be qualified and MUST keep going
   * through `??`; only the name after `as` is one identifier by definition.
   */
  protected aliasIdentifierSql(alias: string): string {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts` (see `ClassHeadHost`).
    return ClassHeadFacet.aliasIdentifierSql.call(classHeadHost.of(this), alias);
  }

  protected get dateGranularityCapabilities(): Record<string, boolean> {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts` (see `ClassHeadHost`).
    return ClassHeadFacet.dateGranularityCapabilities.call(classHeadHost.of(this));
  }

  /**
   * Build SQL fragment + bindings for a date bucket expression.
   * Returns `null` when the current dialect does not support the requested
   * granularity — callers must fall back to in-memory bucketing.
   *
   * Exposed as `{sql, bindings}` (not `Knex.Raw`) so callers can both
   * `groupByRaw()` and embed the same expression inside a `select() as alias`
   * with correctly forwarded identifier bindings.
   *
   * `table` is the coercion key of the object being aggregated (what
   * {@link coercionKey} returns for the builder). It is what makes the SQLite
   * expression storage-aware — see {@link sqliteTemporalArg}. Omitting it yields
   * the plain column form, which is correct for any TEXT-stored column.
   *
   * ## A `Field.date` buckets as its calendar day (#21485)
   *
   * `table` also decides which value the PostgreSQL and MySQL arms bucket. A
   * declared `Field.date` ({@link temporalFieldKind} `'date'`) is a calendar
   * day with no instant (ADR-0053), so it is bucketed as that day and never
   * converted between zones. Everything else, a `Field.datetime` or an
   * undeclared column, keeps the UTC-instant conversion, byte for byte.
   *
   * The instant form cannot carry a `date`. Casting one to `timestamptz`, or
   * handing it to `convert_tz`, invents an instant at midnight in the
   * SESSION's zone, and the UTC conversion then reads the previous day on any
   * session east of UTC. Measured on PostgreSQL 16.14 at `Asia/Shanghai` and on
   * MySQL 8.0.46 with the session at `+08:00`: `2026-06-01` bucketed into month
   * `2026-05`, and `2026-01-01` into year `2025`.
   *
   * On PostgreSQL the day goes to `to_char` as a `timestamp` (no zone), not as
   * a bare `date`. A bare `date` resolves `to_char(timestamptz, text)` through
   * the implicit cast, which round-trips the session zone. That round trip is
   * the identity on every day except one the zone skipped: measured over
   * 1900..2100, `Pacific/Apia` printed `2011-12-30` as `2011-12-31` and
   * `Pacific/Kiritimati` printed `1994-12-31` as `1995-01-01`.
   */
  protected buildDateBucketExpr(
    field: string,
    granularity: 'day' | 'week' | 'month' | 'quarter' | 'year',
    table?: string | null,
  ): { sql: string; bindings: any[] } | null {
    // [#25521 cut 20] The body moved to `sql-driver-date-bucket.ts` (see `DateBucketHost`).
    const readDateGranularityCapabilities = () => this.dateGranularityCapabilities;
    const readIsMysql = () => this.isMysql;
    const readIsPostgres = () => this.isPostgres;
    const readIsSqlite = () => this.isSqlite;
    const host: ThisParameterType<typeof buildDateBucketExpr> = {
      get dateGranularityCapabilities() { return readDateGranularityCapabilities(); },
      get isMysql() { return readIsMysql(); },
      get isPostgres() { return readIsPostgres(); },
      get isSqlite() { return readIsSqlite(); },
      sqliteTemporalArg: (...a) => this.sqliteTemporalArg(...a),
      temporalFieldKind: (...a) => this.temporalFieldKind(...a),
    };
    return buildDateBucketExpr.call(host, field, granularity, table);
  }

  /**
   * [#21441] The date-bucket expression this dialect groups `field` by at
   * `granularity` (the one {@link aggregate} runs), rendered as SQL text, or
   * `null` where {@link buildDateBucketExpr} has none: a client this driver
   * does not model, whose {@link dateGranularityCapabilities} row is empty.
   * SQLite, PostgreSQL and MySQL render all five granularities.
   *
   * It is for callers that PRINT the statement an aggregate stands for rather
   * than run it. `service-analytics`' ObjectQL face echoes a date-bucketed
   * query as SQL (`/analytics/sql`). While it spelled the bucket itself it
   * printed `date_trunc(…)` on every dialect: SQLite refuses that, and
   * PostgreSQL answers a timestamp where this driver answers `2026-01`.
   *
   * Reading the expression from here keeps this driver the one source of its
   * bucketing. The text is `buildDateBucketExpr`'s, unchanged, with each `??`
   * rendered by knex (`Raw.toQuery`) through this dialect's own identifier
   * quoting. The expression binds identifiers only, so the text carries no
   * value placeholder. `objectName` goes in as the coercion key, as
   * `aggregate` passes it, so a SQLite `Field.datetime` column that may still
   * hold pre-canonical values renders the repair the GROUP BY runs (#3773),
   * and a `Field.date` renders its calendar day on every dialect (#21485).
   *
   * Read structurally by its caller, like {@link dialectName}. It is not a
   * member of the `IDataDriver` contract.
   */
  public dateBucketSql(objectName: string, field: string, granularity: DateGranularityValue): string | null {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts` (see `ClassHeadHost`).
    return ClassHeadFacet.dateBucketSql.call(classHeadHost.of(this), objectName, field, granularity);
  }

  /**
   * Schema ownership mode (ADR-0015). When not `'managed'`, all
   * schema-mutating DDL is rejected by {@link assertSchemaMutable}. The
   * runtime injects this from `Datasource.schemaMode`; defaults to
   * `'managed'` so existing callers are unaffected.
   */
  protected readonly schemaMode: SchemaMode;

  /**
   * Dev-only auto-reconcile policy (issue #2186). See {@link SqlDriverConfig.autoMigrate}.
   */
  protected readonly autoMigrate: 'off' | 'safe';

  /**
   * The journal mode the host declared, if any (#3941). Kept unresolved so an
   * absent declaration can still defer to the environment at connect time —
   * see {@link resolveSqliteJournalMode}.
   */
  protected readonly declaredJournalMode?: SqliteJournalMode;

  /**
   * Metadata field defs for every table this driver manages, captured during
   * `initObjects` (tableName → fields). The source of truth that
   * {@link detectManagedDrift} diffs the physical schema against.
   */
  protected managedObjectFields = new Map<string, Record<string, any>>();

  /** Declared indexes per managed table (tableName → indexes[]), captured in `initObjects`. Used to recreate indexes after a SQLite table rebuild. */
  protected managedObjectIndexes = new Map<string, any[]>();

  /**
   * [#8621] PHYSICAL key indexes per table (tableName → the PRIMARY KEY and
   * UNIQUE indexes that actually exist), for {@link assertConflictTargetHonoured}.
   *
   * Deliberately not `managedObjectIndexes`, which records what metadata
   * DECLARES. The pre-flight answers "can this conflict target resolve to a key
   * on the database in front of me", and the two differ in both directions: a
   * table created before its `unique` declaration was emitted as DDL is declared
   * and unbacked (the case the refusal wording already names), and a federated
   * or hand-indexed table is backed while declaring nothing here at all.
   *
   * Invalidated per table in {@link initObjects} — the one seam that creates
   * indexes — and re-read from the database before any refusal, so a stale entry
   * can cost a redundant read but can never produce a false refusal.
   */
  private physicalKeyIndexes = new Map<string, PhysicalIndex[]>();

  /** De-dup set for boot-time drift warnings (keyed by {@link driftKey}). */
  protected driftWarned = new Set<string>();

  /**
   * Objects already reported as unable to keep the deterministic-paging
   * contract (objectstack#4363) — see {@link orderKeysFor}. One line per
   * object, not per query.
   */
  protected nondeterministicPagingWarned = new Set<string>();

  /** Deferred-DDL mode (#3917) — see {@link setDeferredDdl}. */
  protected deferredDdl = false;

  /** Object defs `initObjects` registered but did not physically sync while {@link deferredDdl}. */
  protected deferredSchemaObjects = new Map<string, { name: string; fields?: Record<string, any> }>();

  /**
   * [#9354] True only while {@link flushDeferredSchemaDdl} is performing the
   * deferred work — the operator-initiated `os migrate apply` path.
   *
   * The MySQL widening ALTERs are reached from BOTH boot schema-sync and the
   * flush, through the same `initObjects` line, and the two want opposite
   * failure policies: boot must never be taken down by a migration, while a
   * command the operator ran must never report success for work it did not do.
   * This flag is what tells them apart at the point the policy is applied, so
   * neither path needs its own copy of the widening.
   */
  private flushingDeferredDdl = false;

  /** Backing field for {@link sqliteOpenedEmptyInMemory} (#6743). */
  private openedEmptyInMemory = false;

  constructor(config: SqlDriverConfig) {
    // `schemaMode` / `autoMigrate` / `sqliteJournalMode` / `sqliteAbsentFile`
    // are ObjectStack concerns, not Knex options — strip them before handing
    // the config to Knex.
    const { schemaMode, autoMigrate, sqliteJournalMode, sqliteAbsentFile, fileColumnsMoved, ...knexConfig } = config;
    // [#15989] Recorded before the branch, and on the KEY rather than on the
    // value: `fileColumnsMoved: false` is a host declaration just as much as
    // `true` is, and it must shut the engine's supply seam out — see
    // {@link setFileColumnsMovedResolver}.
    this.fileColumnsMovedDeclared = fileColumnsMoved !== undefined;
    if (typeof fileColumnsMoved === 'function') {
      this.fileColumnsMovedResolver = fileColumnsMoved;
    } else if (fileColumnsMoved === true) {
      // A literal is an assertion by the host, taken as given — it is the
      // spelling a test cell and an already-resolved caller both want, and it
      // needs no seam of its own. Anything else (false, undefined) is the
      // JSON arm the field already holds.
      this.fileColumnsMoved = true;
    }
    this.schemaMode = schemaMode ?? 'managed';
    this.autoMigrate = autoMigrate ?? 'off';
    this.declaredJournalMode = sqliteJournalMode;
    // `this.config` keeps the DECLARED target, deliberately: it is what
    // `describeDriverConnection` renders, so `os migrate plan` still names the
    // database the plan is about rather than the `:memory:` stand-in it read
    // (#6743 — the ruling's "same report as today, byte for byte"). Only the
    // Knex instance below is redirected.
    this.config = knexConfig;
    this.knex = knex(SqlDriver.withConnectBound(this.knexConfigFor(knexConfig, sqliteAbsentFile)));
    this.installQueryTiming();
  }

  /**
   * Whether this driver opened an ephemeral `:memory:` database because its
   * declared SQLite file did not exist and the host asked for
   * `sqliteAbsentFile: 'empty-in-memory'` (#6743).
   *
   * `false` for every driver that did not ask for that mode — which is every
   * driver that existed before it.
   */
  public get sqliteOpenedEmptyInMemory(): boolean {
    return this.openedEmptyInMemory;
  }

  private knexConfigFor(
    knexConfig: Knex.Config,
    mode: SqliteAbsentFileMode | undefined,
  ): Knex.Config {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts`, its docblock with it (see `ClassHeadHost`).
    return ClassHeadFacet.knexConfigFor.call(classHeadHost.of(this), knexConfig, mode);
  }

  /**
   * Default bound on establishing ONE connection (framework#3769).
   *
   * A database endpoint that accepts the TCP connection but never completes the
   * handshake — an overloaded instance, a half-open firewall, a load balancer
   * mid-failover — is the failure mode that hurts most, because nothing fails:
   * the query just waits. Left to tarn's default that wait is **30 seconds**,
   * per query, on the request path; with a small `pool.max` a handful of them
   * saturate the pool and everything queues behind it.
   *
   * 10s matches driver-mongodb's existing `connectTimeoutMS ?? 10_000`, so both
   * drivers give up on an unreachable server at the same point. A host that
   * knows better (a deliberately slow cross-region replica) sets its own
   * `pool.createTimeoutMillis` and this leaves it alone.
   *
   * Applied in two layers, because the outer one bounds the wait but misstates
   * the cause. Knex reports its own timeout as "Timeout acquiring a connection.
   * The pool is probably full" — which sends an operator to tune `pool.max`
   * while the actual problem is the network. So each network dialect ALSO gets
   * its own connect timeout, which fails with a message that names what really
   * happened (`timeout expired` from pg, `connect ETIMEDOUT` from mysql2).
   *
   * **The two bounds must not be equal.** They race, and knex wins a tie — set
   * to the same value, the pool timeout fires first and the accurate message is
   * never seen (caught by the black-hole test, which asserts the wording). So
   * the dialect timeout is the effective bound at 10s and the pool timeout is a
   * strictly looser backstop at 15s, reached only by a dialect that has no
   * connect-timeout knob (SQLite) or ignores the one we set.
   */
  private static readonly DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
  private static readonly DEFAULT_CREATE_TIMEOUT_MS = 15_000;

  /**
   * Per-dialect connect timeout: how the driver spells "how long may
   * establishing ONE connection take", and where a URL goes once `connection`
   * has to become an object to carry it.
   *
   * SQLite (`better-sqlite3` / `sqlite3`) is deliberately absent — it opens a
   * file, so there is no handshake to time out and nothing to inject.
   */
  private static readonly DIALECT_CONNECT_TIMEOUT: Record<string, { key: string; urlKey: string }> =
    Object.fromEntries<{ key: string; urlKey: string }>([
      // Every spelling that means Postgres SQL, EXTENDED by
      // {@link POSTGRES_WIRE_ONLY_CLIENTS}: separate knex dialects, but ones
      // that reach the server through the same `pg` driver and therefore take
      // the same knob. Knex's `Client_Redshift` literally `extends Client_PG`,
      // so the settings object it hands to `pg.Client` honours
      // `connectionTimeoutMillis` exactly as `pg` does. Deriving the pg arm
      // from {@link POSTGRES_EMIT_CLIENTS} is what keeps this table from
      // drifting away from the getters again (#11550) — widening recognition
      // now widens this with it, which is how `pgnative` got its row when the
      // #11756 ruling made it a Postgres client (#11991), with no edit here.
      //
      // `redshift`'s row arrived with #11784. It had the knob and would have
      // obeyed it, but carried no entry, so its connection attempt fell through
      // to the strictly looser 15s `pool.createTimeoutMillis` backstop while
      // the docblock above called 10s "the effective bound". Nothing errored
      // and nothing was logged — the bound was simply 50% looser, for one
      // client name.
      //
      // ⚠️ This arm and {@link POSTGRES_WIRE_CLIENTS} are spelled from the same
      // two sets and therefore hold the same six names. That remains a fact
      // about today's membership, NOT an invariant, and the two must not be
      // collapsed into one another: they answer different questions (how do I
      // spell the connect timeout vs. which npm package parses the wire), and
      // one may gain a client the other should not. What #11991 removed is the
      // hand-written `'cockroachdb', 'redshift'` pair that used to sit here and
      // again in the wire set — the extension is declared ONCE now, so the two
      // tables extend the same answer rather than two copies of it.
      ...[...SqlDriver.POSTGRES_EMIT_CLIENTS, ...SqlDriver.POSTGRES_WIRE_ONLY_CLIENTS].map(
        (c): [string, { key: string; urlKey: string }] =>
          [c, { key: 'connectionTimeoutMillis', urlKey: 'connectionString' }],
      ),
      ...[...SqlDriver.MYSQL_EMIT_CLIENTS].map(
        (c): [string, { key: string; urlKey: string }] =>
          [c, { key: 'connectTimeout', urlKey: 'uri' }],
      ),
    ]);

  private static withConnectBound(knexConfig: Record<string, any>): Record<string, any> {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts`.
    return ClassHeadFacet.withConnectBound(knexConfig);
  }

  private static withUtcSession(knexConfig: Record<string, any>): Record<string, any> {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts`, its docblock with it.
    return ClassHeadFacet.withUtcSession(knexConfig);
  }

  /**
   * The mysql2 column types handed back as the server's own text rather than
   * as a JS `Date` — see {@link withMysqlCalendarDayAsText}. `DATE` only:
   * `DATETIME` and `TIMESTAMP` are instants, and ADR-0053 D-F2 keeps the
   * client parser's `Date` for them.
   */
  private static readonly MYSQL_TEXT_TEMPORAL_TYPES: readonly string[] = ['DATE'];

  private static withMysqlCalendarDayAsText(knexConfig: Record<string, any>): Record<string, any> {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts`, its docblock with it.
    return ClassHeadFacet.withMysqlCalendarDayAsText(knexConfig);
  }

  /**
   * knex client names that route to the `pg` npm driver, and therefore reach
   * {@link withPostgresCalendarDayAsText}. Wider than {@link isPostgres} on
   * purpose: that getter answers "which dialect's SQL do I emit", while this
   * answers "which npm package parses the wire format": `cockroachdb` and
   * `redshift` speak the pg wire protocol with the same type OIDs without
   * being the same DIALECT. The hook is additionally guarded on the connection
   * really exposing `setTypeParser`, so a client name that turns out not to be
   * a `pg.Client` degrades to a no-op instead of throwing.
   *
   * Built by EXTENDING {@link POSTGRES_EMIT_CLIENTS} with the one declared
   * {@link POSTGRES_WIRE_ONLY_CLIENTS} set, never by unioning tables into it:
   * the reverse direction would grant `cockroachdb` and `redshift` SQL-emission
   * identity as a silent side effect of a refactor — the outcome #11756's
   * ruling declined, and not this file's to re-make (#11550, #11991).
   *
   * `pgnative` is here because it is in the EMISSION set, not by a second
   * decision: before #11991 it was in neither, so it got no calendar-day parser
   * — the one table membership the #11756 ruling had to add by hand, and it is
   * this derivation that added it.
   */
  private static readonly POSTGRES_WIRE_CLIENTS: ReadonlySet<string> = new Set([
    ...SqlDriver.POSTGRES_EMIT_CLIENTS,
    ...SqlDriver.POSTGRES_WIRE_ONLY_CLIENTS,
  ]);

  /** Postgres OID of `date` — a bare calendar day, no time and no zone. */
  private static readonly PG_OID_DATE = 1082;
  /** Postgres OID of `date[]`. */
  private static readonly PG_OID_DATE_ARRAY = 1182;
  /**
   * Postgres OID of `text[]`. Borrowed, not used for its own type: pg's
   * built-in `text[]` parser IS its array-literal splitter with an identity
   * element transform, so applying it to a `date[]` literal yields the raw
   * `YYYY-MM-DD` element strings — including `null` for a SQL NULL element,
   * `[]` for an empty array, and nested arrays for the multi-dimensional case.
   * Reusing it is what keeps this hook free of a hand-rolled array parser and
   * free of any dependency on the `pg` module being importable from here.
   */
  private static readonly PG_OID_TEXT_ARRAY = 1009;

  private static withPostgresCalendarDayAsText(
    knexConfig: Record<string, any>,
  ): Record<string, any> {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts`, its docblock with it.
    return ClassHeadFacet.withPostgresCalendarDayAsText(knexConfig);
  }

  private installQueryTiming(): void {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts`, its docblock with it (see `ClassHeadHost`).
    return ClassHeadFacet.installQueryTiming.call(classHeadHost.of(this));
  }

  /**
   * DDL gate (ADR-0015 §5.1). Single choke-point asserting that
   * schema-mutating DDL is only performed on a `managed` datasource.
   * Federated datasources (`external` / `validate-only`) are guests in a
   * database ObjectStack does not own and must never run DDL against.
   *
   * [#11991] Since the #11756 ruling this choke-point asks a SECOND question
   * after that one — may this driver emit DDL for the configured DIALECT at all
   * ({@link assertDialectEmits}). Two questions, one gate, in this order: the
   * datasource question is unchanged and still answered first, so the new
   * refusal fires only where DDL would otherwise have PROCEEDED.
   */
  protected assertSchemaMutable(operation: string): void {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts` (see `ClassHeadHost`).
    return ClassHeadFacet.assertSchemaMutable.call(classHeadHost.of(this), operation);
  }

  /**
   * Emission-scope gate (#11991, landing the #11756 ruling of 2026-08-25):
   * refuse — by name, with guidance — a client this driver recognises on the pg
   * WIRE and deliberately does not emit DDL for.
   *
   * ## Why it sits inside the DDL gate rather than at each DDL verb
   *
   * {@link assertSchemaMutable} is already the one place every schema mutation
   * passes through (`initObjects` / `syncSchema`, `dropTable`, `rotateShards`,
   * `reconcileManagedSchema`), so putting the question here answers it once for
   * all of them. The alternative — refuse CREATE/ALTER but allow DROP, on the
   * grounds that `DROP TABLE` is portable — requires deciding WHICH DDL is safe
   * on Redshift, and how far Redshift's DDL diverges is precisely the thing
   * #11756 recorded as never measured. A gate that guesses at that would be
   * making the ruling's option A one verb at a time.
   *
   * ## What it deliberately does NOT refuse
   *
   * Only {@link POSTGRES_WIRE_ONLY_CLIENTS} — never "anything the getters do
   * not recognise". `mariadb` is out of the ruling's scope and stays
   * unrecognised-and-unrefused; so does a bring-your-own Client constructor
   * (knex's documented hatch, which names no spelling in any table here). A
   * refusal keyed on `dialectName === 'unknown'` would have swept both in and
   * widened a decided ruling by side effect — the exact move the ruling's own
   * implementation note forbids.
   *
   * ## Reads, never writes
   *
   * Nothing has been issued to the database when this throws: it runs before
   * `ensureDatabaseExists` and before the first `hasTable` probe. The refusal
   * is therefore total for schema work and inert for everything else — reads,
   * writes and connection handling on these databases are untouched.
   */
  protected assertDialectEmits(operation: string): void {
    // [#29520 codemod] The body moved to `sql-driver-class-head.ts` (see `ClassHeadHost`).
    return ClassHeadFacet.assertDialectEmits.call(classHeadHost.of(this), operation);
  }

  // ===================================
  // Lifecycle
  // ===================================

  connect(): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts` (see `LifecycleHost`).
    return LifecycleFacet.connect.call(lifecycleHost.of(this));
  }

  private releaseRefusedSqliteConnection(): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts`, its docblock with it (see `LifecycleHost`).
    return LifecycleFacet.releaseRefusedSqliteConnection.call(lifecycleHost.of(this));
  }

  private applyAutoVacuumIncremental(): Promise<boolean> {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts`, its docblock with it (see `LifecycleHost`).
    return LifecycleFacet.applyAutoVacuumIncremental.call(lifecycleHost.of(this));
  }

  /**
   * The SQLite codes the connection's first statement can answer that are a
   * verdict on the FILE, each with the words {@link SqliteDatabaseFileError}
   * names it with. Only a loaded addon answers with a SQLite code, so none of
   * these is a native-addon load failure; and every rung of a step-down opens
   * the same file, so no other engine can cure one (`resolveSqliteDriver` in
   * `@objectstack/service-datasource` re-throws them).
   */
  private static readonly SQLITE_FILE_REFUSALS: ReadonlyMap<string, string> = new Map([
    ['SQLITE_CANTOPEN', 'cannot be opened or created'],
    ['SQLITE_NOTADB', 'is not a SQLite database, and was left as it is'],
    ['SQLITE_CORRUPT', 'is damaged (SQLite cannot read its header or its schema), and was left as it is'],
  ]);

  /** What `PRAGMA auto_vacuum` answers for INCREMENTAL (0 is NONE, 1 is FULL). */
  private static readonly SQLITE_AUTO_VACUUM_INCREMENTAL = 2;

  private static autoVacuumOf(result: unknown): number | null {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts`, its docblock with it.
    return LifecycleFacet.autoVacuumOf(result);
  }

  /**
   * Env override for the SQLite journal mode — the ops-side escape hatch for a
   * deployment whose filesystem cannot host WAL.
   */
  private static readonly SQLITE_JOURNAL_MODE_ENV = 'OS_DATABASE_SQLITE_JOURNAL_MODE';

  /**
   * Which journal mode to ask this file-backed database for.
   *
   * An explicit `sqliteJournalMode` in the driver config outranks the
   * environment: it is a decision the host made about this datasource, while
   * the env var is a blanket per-deployment setting. Anything unrecognised is
   * reported and ignored rather than silently treated as an opt-out — a typo
   * must not quietly leave a database serialized.
   */
  protected resolveSqliteJournalMode(): SqliteJournalMode {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts` (see `LifecycleHost`).
    return LifecycleFacet.resolveSqliteJournalMode.call(lifecycleHost.of(this));
  }

  /**
   * Whether this transport can hold its database in WAL mode.
   *
   * True for a real SQLite file. Overridden to `false` by a transport whose
   * "file" is a byte image it serializes itself (`SqliteWasmDriver`): no other
   * process reads its live database, so a persistent mode change made for
   * cross-process concurrency buys it nothing.
   */
  protected get supportsWalJournal(): boolean {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts`.
    return LifecycleFacet.supportsWalJournal();
  }

  /**
   * Put a file-backed SQLite database in WAL mode (#3941).
   *
   * ObjectStack's normal shape is **several processes on one file**: a dev
   * server, `os migrate`, a test run. SQLite's built-in
   * default — `journal_mode = delete`, a rollback journal — is the worst mode
   * for that, in two measured ways:
   *
   *   - **A writer must wait for every reader.** Committing a rollback journal
   *     takes an EXCLUSIVE lock, which cannot coexist with a reader, so an
   *     `os migrate` write serializes behind whatever the live server is
   *     reading (`SQLITE_BUSY`). Under WAL neither direction blocks: readers
   *     see the last committed snapshot while a writer appends.
   *   - **An attached connection leaves no trace.** Rollback-journal locks
   *     exist only for the duration of a transaction, so an idle `os serve` is
   *     invisible to SQL — which is what defeated the first cut of the
   *     `os migrate` occupancy check (#3924) and forced it onto file-descriptor
   *     inspection (#3940). Under WAL the SQL probe
   *     (`locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE`) reports `SQLITE_BUSY`
   *     against an idle attached connection, so it becomes authoritative
   *     instead of a fallback.
   *
   * Journal mode is a **persistent property of the file**, not of a connection:
   * setting it once is enough, and it stays set after every process detaches.
   * That is also why the opt-out has to *apply* `delete` rather than skip —
   * skipping would leave an already-converted database in WAL forever. Only
   * `journal_mode` changes here; `synchronous` is untouched, so durability is
   * exactly what it was before.
   *
   * Two failure modes, both handled because neither is loud on its own:
   *
   *   1. **A refusal is an answer, not an error.** `PRAGMA journal_mode = X`
   *      replies with the mode actually in force — `:memory:` answers `memory`,
   *      and a filesystem that cannot host WAL answers `delete` — without
   *      raising anything. So the reply is always read back, never assumed.
   *   2. **Accepted, then unusable.** WAL needs a shared-memory index beside
   *      the database, which network filesystems (NFS/SMB) do not provide; the
   *      mode change can succeed and the first read *through* the WAL then
   *      fail. The mode is persisted by that point, so leaving it would strand
   *      the database — hence the read-back probe and the revert to `delete`.
   *
   * Never throws and never blocks the boot: a database that stays on a rollback
   * journal is slower under concurrency, not broken, and refusing to start over
   * a pragma would be worse than the problem this solves.
   */
  protected applySqliteJournalMode(): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts` (see `LifecycleHost`).
    return LifecycleFacet.applySqliteJournalMode.call(lifecycleHost.of(this));
  }

  private verifyWalReadable(filename: string): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts`, its docblock with it (see `LifecycleHost`).
    return LifecycleFacet.verifyWalReadable.call(lifecycleHost.of(this), filename);
  }

  private static isSqliteBusyError(e: unknown): boolean {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts`, its docblock with it.
    return LifecycleFacet.isSqliteBusyError(e);
  }

  private static journalModeOf(result: unknown): string | null {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts`, its docblock with it.
    return LifecycleFacet.journalModeOf(result);
  }

  checkHealth(): Promise<boolean> {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts` (see `LifecycleHost`).
    return LifecycleFacet.checkHealth.call(lifecycleHost.of(this));
  }

  disconnect(): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-lifecycle.ts` (see `LifecycleHost`).
    return LifecycleFacet.disconnect.call(lifecycleHost.of(this));
  }

  // ===================================
  // CRUD — IDataDriver core
  // ===================================

  // [commit be5c60291] The return is the contract's own type. It was `Promise<any[]>`, and the
  // reason #15267's census never named this door is worth carrying: that census
  // matched the literal string `Promise<any>`, and here the `any` is NESTED
  // inside a wider type, so the characters were not there to match. The door
  // appeared in neither its repaired set nor its excluded set — it was never
  // seen. Pinned at the type level, both halves, in
  // `sql-driver-doors-declared-types.test.ts`.
  find(object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    // [#29520 codemod] The body moved to `sql-driver-crud.ts` (see `CrudHost`).
    return CrudFacet.find.call(crudHost.of(this), object, query, options);
  }

  private findRows(
    object: string,
    query: DriverQuery,
    options?: DriverOptions,
    singleRowLookup = false,
  ): Promise<any[]> {
    // [#29520 codemod] The body moved to `sql-driver-crud.ts`, its docblock with it (see `CrudHost`).
    return CrudFacet.findRows.call(crudHost.of(this), object, query, options, singleRowLookup);
  }

  /**
   * `IDataDriver.findOne` — find a single record BY QUERY.
   *
   * This also accepted a bare id (`findOne('task', 't1')`) through an
   * undeclared `typeof query === 'string' | 'number'` branch until #4311. No
   * caller outside this package's own tests used it, it was on no contract, and
   * the other two drivers answer that same call differently: `MemoryDriver`
   * spreads the argument (`{ ...query }` over a string yields `{0:'t',1:'1'}`)
   * and `MongoDriver` reads `query.where` (undefined → an unfiltered findOne,
   * i.e. an arbitrary row). One spelling meaning three things across three
   * drivers is the second de-facto contract Prime Directive #12 exists to
   * prevent — and the branch also bypassed the shared `findRows()` path
   * (field selection, temporal coercion, unknown-column recovery, and the
   * `singleRowLookup` ORDER BY decision).
   * Spell an id lookup as what it is: `{ object, where: { id } }`.
   *
   * [#15267] Declared as `IDataDriver.findOne()` declares it: the row, or
   * `null` when nothing matches — `results[0] || null`, and `null` outright for
   * a non-object query. The annotation used to be an explicit `Promise<any>`,
   * which an un-narrowed caller could read fields off with no compiler
   * complaint; it is the contract's type now, pinned by
   * `sql-driver-doors-declared-types.test.ts`.
   */
  findOne(object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown> | null> {
    // [#29520 codemod] The body moved to `sql-driver-crud.ts` (see `CrudHost`).
    return CrudFacet.findOne.call(crudHost.of(this), object, query, options);
  }

  // `findStream` was removed with the contract method in 17.0.0 (#4484). This driver's
  // implementation awaited `find()` in full and then yielded row by row, so it never
  // avoided the memory it was declared to avoid; nothing called it. Page through
  // `find()` with `limit`/`offset` until a real Knex `.stream()` read is built to a
  // caller's requirement.

  /**
   * [#15267] Declared as `IDataDriver.create()` declares it: the inserted
   * record, `formatOutput(...)` over the stored row. The annotation
   * used to be an explicit `Promise<any>`, so the published `.d.ts` let a
   * caller read any member off the result; it is the contract's type now,
   * pinned by `sql-driver-doors-declared-types.test.ts`.
   *
   * [#21227] The stored row comes from the statement's own `returning('*')`
   * where the dialect answers one, and from {@link readBackInsertedRows}
   * where it does not ({@link insertReturnsStoredRows}: the MySQL family). The
   * type was the contract's all along; on MySQL the VALUE was the insert id.
   */
  create(object: string, data: Record<string, any>, options?: DriverOptions): Promise<Record<string, unknown>> {
    // [#29520 codemod] The body moved to `sql-driver-crud.ts` (see `CrudHost`).
    return CrudFacet.create.call(crudHost.of(this), object, data, options);
  }

  private readBackInsertedRows(
    object: string,
    writeTable: string,
    written: Record<string, any>[],
    options?: DriverOptions,
  ): Promise<Record<string, unknown>[]> {
    // [#29520 codemod] The body moved to `sql-driver-crud.ts`, its docblock with it (see `CrudHost`).
    return CrudFacet.readBackInsertedRows.call(crudHost.of(this), object, writeTable, written, options);
  }

  /**
   * Ensure the sequence-counter table exists. Idempotent and cheap after
   * the first call (cached via `sequencesTableReady`).
   *
   * The row key is `key_hash` — a SHA-256 of `(object, tenant_id, field, scope)`
   * where `scope` is the rendered autonumber prefix (date/field tokens before
   * the `{0000}` slot), so a new day/group/parent starts a fresh counter. A
   * single 64-char hashed primary key (rather than the four raw columns, which
   * blow past MySQL's 3072-byte index limit under utf8mb4 and bound how long a
   * `{field}` scope may be) keys every dialect uniformly and lets `scope` be a
   * generous non-indexed column. Fixed-prefix formats use the empty scope and
   * keep their single global counter (backward compatible).
   */
  protected ensureSequencesTable(parentTrx?: Knex.Transaction): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-crud.ts` (see `CrudHost`).
    return CrudFacet.ensureSequencesTable.call(crudHost.of(this), parentTrx);
  }

  /** SHA-256 of the composite counter key — the table's single-column PK. */
  protected sequenceKeyHash(object: string, tenantId: string, field: string, scope: string): string {
    // [#29520 codemod] The body moved to `sql-driver-crud.ts`.
    return CrudFacet.sequenceKeyHash(object, tenantId, field, scope);
  }

  // ── The sequence semantics a second face shares, stated once ──────────────
  //
  // `TursoDriver`'s REMOTE face issues record numbers over `@libsql/client`
  // rather than through this class's Knex transaction, and an embedded-replica
  // face and a remote face can point at ONE database. Two faces computing a
  // different counter key, a different tenant bucket or a different data-table
  // bootstrap would hand out colliding numbers on that database, so each rule
  // below is a `protected` member that face CALLS — never a copy it keeps. The
  // members are small on purpose: they are the whole of what decides which
  // counter a value is drawn from and where a cold counter starts.

  /** The sequence-counter table's name, for a face that spells its own statements against it. */
  protected get sequencesTableName(): string {
    return SEQUENCES_TABLE;
  }

  /** How many times a write re-seeds and retries on a provable autonumber collision (#5495). */
  protected get autoNumberCollisionRetries(): number {
    return AUTONUMBER_COLLISION_RETRIES;
  }

  /**
   * The tenant bucket a counter row is keyed by. One spelling for the issue
   * path, the re-seed path and the counter identity, on both faces:
   *
   *  - an object with NO tenant column → `GLOBAL_TENANT`, the installation's
   *    one counter for it;
   *  - a tenant column and a row that carries its organization → that
   *    organization;
   *  - a tenant column and NO organization → REFUSED
   *    ({@link OrganizationlessCounterRefusal}, ADR-0131 D9) wherever this
   *    driver registered the organization object, before any counter row is
   *    read or written. Only a composition with no organization object (a lean
   *    embedding) keeps `GLOBAL_TENANT` here — no organization can exist there.
   */
  protected resolveSequenceTenantId(
    tenantField: string | null,
    tenantId: string | null,
    table: string,
    field: string,
  ): string {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.resolveSequenceTenantId.call(sequenceSemanticsHost.of(this), tenantField, tenantId, table, field);
  }

  /**
   * The column definitions of the `key_hash`-keyed sequences table — the ONE
   * place the shape is spelled. {@link createSequencesTable} runs it through a
   * live connection; a face with no Knex connection compiles the same builder
   * to text (`knex.schema.createTable(name, t => this.defineSequencesTable(t)).toSQL()`)
   * and sends that, so both faces create byte-for-byte the same table.
   */
  protected defineSequencesTable(t: Knex.CreateTableBuilder): void {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.defineSequencesTable.call(sequenceSemanticsHost.of(this), t);
  }

  /**
   * Create the current `key_hash`-keyed sequences table shape. `runner` is the
   * connection the DDL runs on (a fresh pooled connection by default, or the
   * caller's transaction on SQLite — see {@link ensureSequencesTable}).
   */
  protected createSequencesTable(
    table: string,
    runner: Knex | Knex.Transaction = this.knex,
  ): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.createSequencesTable.call(sequenceSemanticsHost.of(this), table, runner);
  }

  /**
   * Migrate a pre-existing `_objectstack_sequences` table to the current
   * `key_hash`-keyed shape. Handles both the original 3-column table (no
   * `scope`) and an interim 4-column `(object, tenant_id, field, scope)` table:
   * every legacy row is read, its `key_hash` computed in app code (no portable
   * SQL hash exists), and re-inserted into a freshly built table that then
   * replaces the original. Idempotent — a no-op once `key_hash` is present.
   *
   * If the rebuild fails, `sequencesHasKeyHash` stays false: fixed-prefix
   * sequences keep working via the legacy key and per-scope writes error
   * actionably (see getNextSequenceValue), rather than corrupting data.
   */
  protected ensureSequencesKeyHashShape(
    runner: Knex | Knex.Transaction = this.knex,
  ): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.ensureSequencesKeyHashShape.call(sequenceSemanticsHost.of(this), runner);
  }

  /**
   * Bootstrap helper: scan the data table for the highest counter value among
   * the values matching `prefix` (optionally scoped to a tenant). Used the first
   * time a sequence row is created so legacy/seeded data continues monotonically.
   *
   * # Where the counter sits in a stored value (#6468)
   *
   * `renderAutonumber` composes `prefix + zero-padded(seq) + suffix`, so a format
   * with tokens AFTER the `{0..0}` slot (`{000}-{YYYY}` → `001-2026`) does not
   * end in the counter. Concatenating every digit of the tail read that as
   * `12026` against a true counter of `1`, and the engine's own fallback seeding
   * read the same row as `2026` — two different wrong answers for one dataset,
   * so the issued band depended on which driver ran.
   *
   * `prefix` and `suffix` are `renderAutonumber`'s own output, computed by the
   * caller and passed down: this driver derives no format understanding of its
   * own, and the engine's `seedAutonumber` applies the identical rule to the
   * identical two strings.
   *
   *   - **Either declared ⇒ ANCHORED**: the counter is the digit run at the
   *     START of what follows the prefix, after removing the declared suffix
   *     when the row carries it. That reading is not this driver's to hold: it
   *     is spec's `readAutonumberCounter`, the declared inverse of
   *     `renderAutonumber`, called here and by the engine's seeding scan so one
   *     edit moves both sides (#6560 — the ruling that retired the two
   *     hand-written copies PR #6553 left).
   *   - **Neither declared ⇒ UNANCHORED**: the legacy reading (every digit in
   *     the value, concatenated) is kept byte-for-byte, and stays HERE. The
   *     engine's legacy reading of the same case differs on purpose (it takes
   *     the last digit run), so there is nothing shared to hoist — spec answers
   *     `undefined` for an unanchored slot rather than pick one of the two.
   *
   * ## The unanchored arm is IMPLEMENTATION DETAIL, outside the declared contract (#7287)
   *
   * That refusal is now a DECLARED boundary, not merely an absent agreement: the
   * #7287 ruling (2026-08-10, 「宣告边界」) states that a stored value carrying
   * non-digit content on an unanchored format is out of contract for counter
   * readback, and that `readAutonumberCounter`'s `undefined` for that slot is the
   * contract rather than a gap. The boundary and its rationale live in that
   * function's TSDoc in `packages/spec/src/data/autonumber-format.ts`; the pins
   * are `packages/spec/src/data/autonumber-unanchored-boundary.test.ts`.
   *
   * So the concatenate-every-digit reading below is THIS DRIVER'S behavior, not a
   * promise the platform makes. On the inputs the contract admits — pure-digit
   * values, which is what `renderAutonumber` emits for an unanchored format — it
   * answers the same number the engine does. On mixed-content values it may
   * answer differently (`'SO-2024-0007'` → `20240007` here, `7` in the engine's
   * `readStoredAutonumberCounter`), and that difference is out of contract on
   * both sides, not a defect on either.
   *
   * Consequently the ruling moves nothing here: neither this reading nor the
   * engine's was hoisted into the shared helper, precisely because doing so would
   * move live behavior on the other side over record numbers already issued.
   *
   * ## Why the suffix is NOT pushed into the LIKE
   *
   * `like 'prefix%suffix'` looks tempting and is wrong: the counter scope is the
   * rendered PREFIX, so `{000}-{YYYY}` keeps ONE counter across years while its
   * suffix renders `-2025` on last year's rows. Filtering on the current
   * suffix would drop exactly those rows and seed BELOW the real max — the
   * duplicate-record-number harm, self-inflicted. The predicate therefore stays
   * `prefix%` and the suffix is applied per row, where a non-match simply means
   * "different suffix, same counter".
   *
   * ## The escape the prefix is escaped FOR is declared, on every dialect (#21163)
   *
   * {@link escapeLikePrefix} writes a backslash before each `\`, `%` and `_`,
   * which only means "literally" under a `LIKE` whose escape character IS that
   * backslash. SQLite's `LIKE` has no escape character unless one is declared,
   * and Knex's `where(col, 'like', …)` declares none on any dialect. Measured on
   * better-sqlite3 before this change: the pattern `SO\_%` without `ESCAPE`
   * matched nothing against a stored `SO_0007`, so on every SQLite face a
   * format whose rendered prefix carries `_`, `%` or `\` — from the format's
   * literal text OR from a `{field}` value such as `north_east` — scanned an
   * empty partition: the cold bootstrap seeded the counter from 0 and the
   * #5495 re-seed could not move it. Postgres and MySQL read a backslash as the
   * default `LIKE` escape, so they were right by default rather than by
   * declaration.
   *
   * The character is BOUND, never written as a literal — the same
   * {@link LIKE_ESCAPE_CHARACTER} the filter compiler binds, for the reason
   * given there: MySQL applies C escape syntax inside string literals, so a
   * literal backslash is spelled differently per dialect while a bound value
   * has one spelling everywhere. Turso's remote face sends its own statement
   * to a SQLite engine only, and declares the same backslash there.
   */
  protected scanMaxNumericTail(
    queryRunner: Knex | Knex.Transaction,
    tableName: string,
    field: string,
    prefix: string,
    tenantField: string | null,
    tenantId: string | null,
    suffix = '',
  ): Promise<number> {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.scanMaxNumericTail.call(sequenceSemanticsHost.of(this), queryRunner, tableName, field, prefix, tenantField, tenantId, suffix);
  }

  /**
   * The rendered prefix as a `LIKE` anchor: `\`, `%` and `_` escaped with a
   * backslash, so a prefix is matched literally — under a `LIKE` that declares
   * that backslash as its `ESCAPE`, which every statement using this anchor
   * must do (see {@link scanMaxNumericTail}; SQLite has no escape character
   * otherwise). The predicate's pre-filter only — {@link maxAutonumberCounter}
   * re-checks the prefix per row.
   */
  protected escapeLikePrefix(prefix: string): string {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts`.
    return SequenceSemanticsFacet.escapeLikePrefix(prefix);
  }

  /**
   * The bootstrap reading itself — the highest counter among the stored values
   * of one counter's partition, under the anchored / unanchored rules the
   * {@link scanMaxNumericTail} docblock states. Separated from the statement
   * that fetches the values so a face that fetches them through another
   * transport reads them by this one rule rather than by a copy of it.
   */
  protected maxAutonumberCounter(values: Iterable<unknown>, prefix: string, suffix: string): number {
    // [#25521 cut 11] The body moved to `sql-driver-autonumber.ts`; it reads no member of the driver.
    return maxAutonumberCounter(values, prefix, suffix);
  }

  /**
   * Run a SPECULATIVE statement — one whose failure is an expected outcome the
   * caller recovers from — so that its error cannot poison the surrounding
   * transaction.
   *
   * # Why this exists (#8269)
   *
   * On Postgres, ANY statement error aborts the whole transaction: every
   * subsequent statement returns `25P02 current transaction is aborted` until
   * rollback. So the `try { … } catch { …recover… }` idiom, where the recovery
   * itself issues SQL on the same transaction, can never run there — the
   * recovery statement is the one that raises the error you observe. SQLite and
   * MySQL do not abort the transaction on a statement error, which is why the
   * idiom looked correct and why the SQLite-backed autonumber suite never
   * caught it.
   *
   * Measured on `postgres:16`, two tenants inserting into the same cold
   * autonumber object concurrently: `select … from "_objectstack_sequences"
   * where "key_hash" = $1 limit $2 for update - current transaction is aborted,
   * commands ignored until end of transaction block`. The whole batch failed
   * while the counters advanced, so the reserved numbers were lost — a
   * permanent gap at the start of both tenants' sequences.
   *
   * A knex nested transaction is a `SAVEPOINT`, released on success and rolled
   * back to on failure, so the outer transaction stays usable on every dialect
   * (verified: PG 16, and better-sqlite3 at pool `max: 1`, where the savepoint
   * rides the parent's connection and never asks the pool for a second one —
   * the deadlock #4250 exists to prevent).
   *
   * Chosen over `INSERT … ON CONFLICT DO NOTHING` on two pieces of evidence:
   *
   *  1. It is the only form that covers BOTH speculative sites here — the other
   *     one is a `SELECT … FOR UPDATE`, and there is no `ON CONFLICT` for a
   *     read.
   *  2. `ON CONFLICT (object, tenant_id, field)` — the columns the legacy key
   *     shape uses when `sequencesHasKeyHash` is false — raises `42P10 there is
   *     no unique or exclusion constraint matching the ON CONFLICT
   *     specification` against an INTERIM table whose primary key is the FOUR
   *     columns `(object, tenant_id, field, scope)`. That pairing is reachable:
   *     it is exactly what a failed {@link ensureSequencesKeyHashShape}
   *     migration leaves behind. It would have replaced this bug with a harder
   *     one on the deployments least able to absorb it.
   *
   * Returns a discriminated result rather than rethrowing, so the caller keeps
   * the ORIGINAL error to inspect or rethrow — an `ON CONFLICT DO NOTHING` that
   * silently affects zero rows cannot tell "another writer raced me" apart from
   * "the row was rejected for some other reason".
   */
  protected attemptWithoutPoisoning<T>(
    trx: Knex.Transaction,
    attempt: (scoped: Knex.Transaction) => Promise<T> | Knex.QueryBuilder<any, T>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts`.
    return (SequenceSemanticsFacet.attemptWithoutPoisoning<T>)(trx, attempt);
  }

  /**
   * Atomically reserve and return the next sequence value for
   * `(object, tenantId, field)`. Bootstraps from the data-table MAX on
   * first call so existing seeded records continue monotonically.
   *
   * Concurrency:
   *   - SQLite: a write transaction (`BEGIN IMMEDIATE` via knex) serializes
   *     all writers; safe in-process. Cross-process SQLite is out of scope.
   *   - Postgres/MySQL: `SELECT … FOR UPDATE` row lock ensures only one
   *     transaction reads-modifies-writes at a time. A PK-violation race on
   *     first insert is retried as an UPDATE.
   *
   * ## Which gaps are by design, and which one was a defect (#5495)
   *
   * These are two different things, and the sentence that used to stand here
   * ("gaps are tolerated by design — a rolled-back insert burns a number")
   * covered only the first while reading as though it covered both:
   *
   *  - **A rolled-back insert burns a number — still by design.** The caller
   *    asked for a value, got one, and abandoned it. That is what every
   *    standard sequence does, and nothing here tries to reclaim it.
   *  - **A *persistently failing* insert used to burn one number per attempt —
   *    that was the defect.** The bootstrap below runs exactly once, in the
   *    `if (!existing)` branch: after it, the data table is never consulted
   *    again. Any row landing by a path that bypasses `fillAutoNumberFields`
   *    (an `isSystem` seed replay or a `preserveAudit` import — both
   *    strip-exempt under #5503 and keeping their explicit numbers — or direct
   *    SQL) therefore never raises the sequence, and once the counter sits
   *    below `MAX` it is permanently behind. Every create then collided,
   *    burned a number, and failed the request, until the counter had ground
   *    past the seeded range one 409 at a time. That is the "one-time storm
   *    per database" #5495 reported from the field: 25 consecutive 409s.
   *
   * The second one is no longer reachable from `create()`, which re-seeds this
   * counter from the data-table MAX and retries when it can prove the
   * collision was this counter's — see {@link collidingAutoNumberReservations}
   * and {@link resyncSequenceToDataMax}. The storm now costs one internal
   * retry instead of one failed request per burned number. This function's own
   * contract is unchanged: it still hands out one value per call and never
   * takes one back.
   */
  protected getNextSequenceValue(
    object: string,
    tableName: string,
    field: string,
    prefix: string,
    tenantField: string | null,
    tenantId: string | null,
    parentTrx?: Knex.Transaction,
    scope = '',
    // Rendered text AFTER the sequence slot — forwarded verbatim to the
    // bootstrap scan so it can find the counter in values that do not end in it
    // (#6468). Purely positional plumbing; no sequencing logic reads it.
    suffix = '',
  ): Promise<number> {
    // [#25521 cut 11] The body moved to `sql-driver-autonumber.ts` (see `AutonumberHost`).
    const readKnex = () => this.knex;
    const readSequencesHasKeyHash = () => this.sequencesHasKeyHash;
    const host: ThisParameterType<typeof getNextSequenceValue> = {
      attemptWithoutPoisoning: (...a) => this.attemptWithoutPoisoning(...a),
      ensureSequencesTable: (...a) => this.ensureSequencesTable(...a),
      get knex() { return readKnex(); },
      resolveSequenceTenantId: (...a) => this.resolveSequenceTenantId(...a),
      scanMaxNumericTail: (...a) => this.scanMaxNumericTail(...a),
      sequenceKeyHash: (...a) => this.sequenceKeyHash(...a),
      get sequencesHasKeyHash() { return readSequencesHasKeyHash(); },
    };
    return getNextSequenceValue.call(host, object, tableName, field, prefix, tenantField, tenantId, parentTrx, scope, suffix);
  }

  /**
   * For each `auto_number` field the caller left empty, render the format and
   * reserve the next counter value. The counter is scoped to the rendered
   * prefix (date tokens like `{YYYYMMDD}` in the request's business timezone,
   * plus `{field}` interpolation from the row), so it resets per period/group;
   * the full rendered prefix bootstraps the counter from existing data, and the
   * tenant scopes it for isolation.
   *
   * Returns one {@link AutoNumberReservation} per field it actually generated —
   * the collision path in `create()` needs to know which values on the row are
   * this driver's own and which the caller supplied, and under what scan
   * coordinates a stale counter would be re-seeded (#5495). A field the caller
   * filled is not reported, because a duplicate on it is the caller's 409 to
   * receive, not a sequence to re-seed.
   */
  protected fillAutoNumberFields(
    object: string,
    row: Record<string, any>,
    options?: DriverOptions,
  ): Promise<AutoNumberReservation[]> {
    // [#25521 cut 11] The body moved to `sql-driver-autonumber.ts` (see `AutonumberHost`).
    const readAutoNumberFields = () => this.autoNumberFields;
    const readPhysicalTableByObject = () => this.physicalTableByObject;
    const host: ThisParameterType<typeof fillAutoNumberFields> = {
      get autoNumberFields() { return readAutoNumberFields(); },
      getNextSequenceValue: (...a) => this.getNextSequenceValue(...a),
      get physicalTableByObject() { return readPhysicalTableByObject(); },
    };
    return fillAutoNumberFields.call(host, object, row, options);
  }

  /**
   * The reservations {@link issueAutonumbers} made, keyed by the caller's row
   * object, so its collision call can tell a number it issued from one the
   * caller typed — the distinction `create()` draws from its own local
   * `reservations`. Weak, so a row the caller drops takes its entry with it.
   */
  private readonly issuedAutoNumbers = new WeakMap<object, AutoNumberReservation[]>();

  /**
   * [#25073] `IDataDriver.issueAutonumbers`: {@link fillAutoNumberFields} on
   * request, ahead of the write, so the engine can compute a stored field
   * whose `expression` reads the number before it hands the row to
   * {@link create} / {@link bulkCreate}. Those find the slot filled and
   * reserve nothing, so the row goes in as ONE statement carrying the number
   * the engine computed from.
   *
   * After a collision it is {@link create}'s and {@link bulkCreate}'s own
   * re-seed (#5495, #6943), split at the point where only the caller can go
   * on: which numbers collided is decided as there
   * ({@link collidingAutoNumberReservations}, so a duplicate on a value the
   * caller typed is never this counter's), each stale counter is re-seeded
   * ONCE, and every slot drawn from a stale counter is emptied — on a batch
   * that includes rows whose own value did not collide, for the reason
   * {@link bulkCreate} gives. The caller issues again; this method never
   * re-issues on its own, because the caller has to recompute what reads
   * the number. Inside a caller's transaction nothing is retried, as
   * {@link create} retries nothing there (Postgres has aborted the handle).
   *
   * Inherited by `driver-sqlite-wasm` and `driver-turso`: the remote face
   * issues through its own `getNextSequenceValue` and probes through its own
   * `autoNumberValueExists` / `resyncSequenceToDataMax`, the overrides its
   * `create()` already calls.
   */
  issueAutonumbers(
    object: string,
    rows: Record<string, unknown>[],
    options?: DriverOptions,
    afterCollision?: unknown,
  ): Promise<string[][]> {
    // [#25521 cut 11] The body moved to `sql-driver-autonumber.ts` (see `AutonumberHost`).
    const readIssuedAutoNumbers = () => this.issuedAutoNumbers;
    const host: ThisParameterType<typeof issueAutonumbers> = {
      autoNumberCounterKey: (...a) => this.autoNumberCounterKey(...a),
      collidingAutoNumberReservations: (...a) => this.collidingAutoNumberReservations(...a),
      fillAutoNumberFields: (...a) => this.fillAutoNumberFields(...a),
      injectTenantOnInsert: (...a) => this.injectTenantOnInsert(...a),
      get issuedAutoNumbers() { return readIssuedAutoNumbers(); },
      resyncSequenceToDataMax: (...a) => this.resyncSequenceToDataMax(...a),
    };
    return issueAutonumbers.call(host, object, rows, options, afterCollision);
  }

  /**
   * Does a row already hold `reservation.value` in the partition this
   * counter covers? (#5495)
   *
   * This is the collision path's **dialect-free** discriminator, and it exists
   * because the text-based one cannot answer for the configuration the field
   * report came from. `uniqueViolationColumn()` (#6544) deliberately returns
   * `undefined` for a composite key and for an index name — and the unique
   * index this driver builds for a tenanted autonumber field is BOTH: ADR-0120
   * D3 makes it `(COALESCE(organization_id,'__global__'), field)`, an
   * expression composite, on which SQLite reports
   * `UNIQUE constraint failed: index 'uniq_…'` and names no column at all
   * (measured). So on the exact shape #5495 was filed against, the conflicting
   * column is *never* determinable, and a retry predicate resting on it would
   * either never fire or fire blindly.
   *
   * Asking the data instead is decidable in every dialect: if the value this
   * driver just generated is already present, the collision was this counter's
   * and re-seeding is the right answer. If it is absent, the duplicate was on
   * some OTHER unique field — a value the caller typed — and that 409 is theirs
   * to receive, so the error is rethrown untouched. That is the distinction the
   * card required and the reason a blanket "retry any unique violation" is
   * wrong.
   *
   * Costs one indexed lookup, on the failure path only. The happy path is
   * unchanged.
   *
   * The partition matches {@link scanMaxNumericTail} exactly — same tenant
   * column, same tenant value — so "exists here" and "would be re-seeded from
   * here" cannot disagree. Built directly on the query runner rather than via
   * `getBuilder`, mirroring `scanMaxNumericTail`: this is the sequence's own
   * bookkeeping read against an explicit tenant, not a caller-facing read.
   */
  protected autoNumberValueExists(
    queryRunner: Knex | Knex.Transaction,
    reservation: AutoNumberReservation,
  ): Promise<boolean> {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts`.
    return SequenceSemanticsFacet.autoNumberValueExists(queryRunner, reservation);
  }

  /**
   * Which of this row's generated autonumbers did the failed INSERT collide on?
   * Empty means "none of them" — the caller must rethrow (#5495).
   *
   * Three states, all of them handled explicitly, because #6544's contract has
   * three and collapsing any two of them silently is how a real 409 gets eaten:
   *
   *  1. **A column was named and it is one of ours** → that reservation
   *     collided. No probe needed; the dialect already answered.
   *  2. **A column was named and it is not ours** → the duplicate is on a
   *     caller-supplied unique field. Return empty: the 409 is the client's and
   *     must reach them unchanged. Retrying here would silently swallow it.
   *  3. **No column was determinable** — a composite key, an index name, or
   *     MySQL, which names only indexes. This is NOT treated as either of the
   *     first two. It is resolved by {@link autoNumberValueExists}, which reads
   *     the data instead of the message. On this repo's tenanted autonumber
   *     index, state 3 is the ONLY state that ever occurs.
   */
  protected collidingAutoNumberReservations(
    error: unknown,
    reservations: AutoNumberReservation[],
    options?: DriverOptions,
  ): Promise<AutoNumberReservation[]> {
    // [#25521 cut 11] The body moved to `sql-driver-autonumber.ts` (see `AutonumberHost`).
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof collidingAutoNumberReservations> = {
      autoNumberValueExists: (...a) => this.autoNumberValueExists(...a),
      get knex() { return readKnex(); },
    };
    return collidingAutoNumberReservations.call(host, error, reservations, options);
  }

  /**
   * Re-seed one counter from the data-table MAX, the operation the original
   * bootstrap performs exactly once and never again (#5495).
   *
   * Only ever moves a counter FORWARD. A counter already at or ahead of the
   * observed MAX is left alone: the collision that brought us here was then a
   * concurrent writer taking the number rather than a stale counter, and
   * rewinding would hand out numbers that are already in use.
   *
   * ## Read failures are not swallowed
   *
   * The MAX scan is deliberately NOT wrapped in a catch. #6114's rule for the
   * engine's seeding path is that a read failure must be type-discriminated
   * (`isMissingTableError`) and never folded into `0` or a stale value — the
   * #5979 family. Here the stronger form is available: there is nothing to
   * discriminate, because a scan failure simply propagates. Note also that the
   * benign case that rule exists for cannot arise on this path — we are here
   * *because* an INSERT into this very table was refused by a constraint, so
   * the table demonstrably exists.
   */
  protected resyncSequenceToDataMax(reservation: AutoNumberReservation): Promise<void> {
    // [#25521 cut 11] The body moved to `sql-driver-autonumber.ts` (see `AutonumberHost`).
    const readKnex = () => this.knex;
    const readSequencesHasKeyHash = () => this.sequencesHasKeyHash;
    const host: ThisParameterType<typeof resyncSequenceToDataMax> = {
      ensureSequencesTable: (...a) => this.ensureSequencesTable(...a),
      get knex() { return readKnex(); },
      resolveSequenceTenantId: (...a) => this.resolveSequenceTenantId(...a),
      scanMaxNumericTail: (...a) => this.scanMaxNumericTail(...a),
      sequenceKeyHash: (...a) => this.sequenceKeyHash(...a),
      get sequencesHasKeyHash() { return readSequencesHasKeyHash(); },
    };
    return resyncSequenceToDataMax.call(host, reservation);
  }

  /**
   * Identity of the counter a reservation was drawn from — the same
   * `(table, tenant, field, scope)` hash {@link getNextSequenceValue} keys the
   * sequences row by (#6943).
   *
   * `create()` never needed this: one row draws at most one reservation per
   * field, so "which counter" and "which reservation" are the same question.
   * A batch breaks that — many rows draw from ONE counter — and both of the
   * batch's collision decisions are per *counter*, not per reservation: re-seed
   * each stale counter once rather than once per row, and re-issue every row
   * that drew from it. See {@link bulkCreate}.
   */
  protected autoNumberCounterKey(reservation: AutoNumberReservation): string {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.autoNumberCounterKey.call(sequenceSemanticsHost.of(this), reservation);
  }

  /**
   * Stamp the builtin audit timestamps to one canonical ISO-8601-with-`Z`
   * instant on the SQLite write paths (`create`/`bulkCreate`/`upsert`), so
   * INSERT and UPDATE agree on a single zone-explicit format.
   *
   * Without this, an insert that omits `created_at`/`updated_at` falls back to
   * the column's `CURRENT_TIMESTAMP` default, which on SQLite renders a
   * zone-NAIVE, space-separated `'YYYY-MM-DD HH:MM:SS'` (no millis, no zone) —
   * the same ambiguity the old UPDATE stamp had. Stamping app-side (rather than
   * changing the column default) fixes this for EXISTING tenant databases
   * immediately, since their tables keep the legacy default. Legacy/raw rows
   * still written zone-naive are repaired on read by
   * `repairNaiveUtcAuditTimestamp`.
   *
   * Only fills a slot the caller left empty — an explicit value (a seed fixture,
   * the sys_metadata writer, a service outbox) is preserved. No-op for
   * timestamp-less objects and for Postgres/MySQL, whose native `now()` column
   * default already stores a zone-aware TIMESTAMP.
   */
  protected stampInsertTimestamps(object: string, formatted: Record<string, any>): void {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.stampInsertTimestamps.call(sequenceSemanticsHost.of(this), object, formatted);
  }

  /**
   * [#11176] Has this driver OBSERVED that `object`'s physical table carries
   * `updated_at` — as opposed to merely presuming it from the declared shape?
   *
   * The stronger of the two answers {@link stampsUpdatedAt} folds together, and
   * the only one the INSERT door may act on. `presumed` (commit 479fba50d) is deliberately
   * excluded: that state exists so an UPDATE can speculate and then RECOVER
   * ({@link updateWithPresumedTimestamp}), and the upsert door has no such
   * recovery — a presumption that turned out wrong there would name a column
   * that does not exist in an INSERT column list, turning a call that works
   * today into a hard failure. See {@link stampUpsertUpdatedAt}.
   */
  protected observedUpdatedAtColumn(object: string): boolean {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.observedUpdatedAtColumn.call(sequenceSemanticsHost.of(this), object);
  }

  /**
   * [#11176] Put a mergeable `updated_at` in an UPSERT payload — on EVERY
   * dialect, not just SQLite.
   *
   * ## The asymmetry this closes
   *
   * `upsert`'s merge set is derived from the keys of `formatted`, so a column
   * absent from the payload is absent from `ON CONFLICT … DO UPDATE` too. The
   * merge site's comment claims *"Everything else (incl. `updated_at`) merges as
   * before, so an upsert that updates a row still advances `updated_at`"* — true
   * only where something PUT `updated_at` in the payload. On SQLite
   * {@link stampInsertTimestamps} does; on Postgres and MySQL it returns early
   * (`if (!this.isSqlite …) return`) because the column DEFAULT already stores a
   * zone-aware instant on insert. But a DEFAULT does not re-fire on the conflict
   * path, so the merged row kept the INSERT's value forever. Measured on live
   * PostgreSQL 16.13 and MySQL 8.0.46: `update()` advanced the same column on
   * the same table in the same run, and the upsert did not. SQLite was
   * accidentally correct.
   *
   * ## Only an EMPTY slot is filled
   *
   * Same rule as `stampInsertTimestamps`: an explicit caller value (a seed
   * fixture, a historical import) is preserved, and on SQLite that helper has
   * already filled the slot — so the SQL this driver emits for SQLite is
   * unchanged, byte for byte.
   *
   * ## Only an OBSERVED column is stamped
   *
   * {@link observedUpdatedAtColumn}, not {@link stampsUpdatedAt} — see there for
   * why the commit 479fba50d presumption stops at the UPDATE door.
   */
  protected stampUpsertUpdatedAt(object: string, formatted: Record<string, any>): void {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.stampUpsertUpdatedAt.call(sequenceSemanticsHost.of(this), object, formatted);
  }

  /**
   * True when the UPDATE path must KEEP a caller-supplied `updated_at` rather
   * than force-advancing it to `now` (#3493). Only for an opt-in "historical"
   * import (`DriverOptions.preserveAudit`, threaded from
   * `ExecutionContext.preserveAudit`) that carries an explicit `updated_at` —
   * mirroring how `stampInsertTimestamps` preserves an explicit value on insert.
   * A normal update leaves the flag unset, so `updated_at` always advances.
   */
  protected keepSuppliedUpdatedAt(formatted: Record<string, any>, options?: DriverOptions): boolean {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts`.
    return SequenceSemanticsFacet.keepSuppliedUpdatedAt(formatted, options);
  }

  /**
   * The canonical instant a write stamps into `updated_at` on this dialect —
   * for EVERY door that stamps it: {@link update}, {@link updateMany},
   * {@link rotatedUpdateById} and {@link stampUpsertUpdatedAt}.
   *
   * On SQLite (no native timestamp type) full ISO-8601 WITH an explicit `Z` —
   * matching the insert paths ({@link stampInsertTimestamps}) so create and
   * update agree on one zone-explicit format. The previous
   * `…replace('T',' ').replace('Z','')` wrote a zone-NAIVE, space-separated
   * string that `Date.parse` reads as LOCAL time, silently shifting the instant
   * by the host offset on a non-UTC runtime (the objectos freshness-probe
   * miss). Postgres/MySQL keep a native server clock — a real zone-aware
   * TIMESTAMP that never had the issue.
   *
   * ## [#11224] MySQL takes the precision its audit column was CREATED with
   *
   * {@link createAuditTimestampColumn} builds the audit columns on MySQL as
   * `DATETIME(3)` defaulted with `now(3)`, and says why in as many words
   * ("`CURRENT_TIMESTAMP` has to carry matching precision for a `DATETIME(3)`
   * default", #3942). A bare `knex.fn.now()` compiles to an unqualified
   * `CURRENT_TIMESTAMP`, which MySQL truncates to whole seconds — so the column
   * was created at millisecond precision on purpose and then written at second
   * precision. Measured on live MySQL 8.0.46, a row updated inside the second it
   * was created in stored `updated_at` 911 ms EARLIER than its own `created_at`.
   *
   * Three silent consequences, none of which errors: "last modified" precedes
   * "created"; a millisecond-precision delta cursor (`updated_at > cursor`)
   * SKIPS every row truncated back below it; and two updates in the same second
   * are indistinguishable, so an `order by updated_at` over them is unstable.
   *
   * Postgres and SQLite are untouched, and that is a measurement rather than an
   * assumption (`sql-driver-11224-update-stamp-precision.test.ts` §5 pins the
   * emitted expression per dialect): `CURRENT_TIMESTAMP` on Postgres is
   * `transaction_timestamp()` at microsecond precision against a `timestamptz`
   * column, and the SQLite branch is a JS ISO-8601 string that already carries
   * millis. Neither has anything to truncate.
   *
   * ## One helper, not two
   *
   * #11176 needed this exact expression for the UPSERT door — the stamp lands in
   * the INSERT branch of the same statement, where a coarser value would have
   * put a brand-new row's `updated_at` before its own `created_at` — and carried
   * it as a separate `upsertUpdatedAtStamp()` precisely so that a card which had
   * not measured the UPDATE door's emitted SQL did not change it. This card
   * measured it, so the pair collapses back into this one definition and there
   * is no longer a second place for the two doors to drift apart.
   */
  protected updatedAtStamp(): string | Knex.Raw {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.updatedAtStamp.call(sequenceSemanticsHost.of(this));
  }

  /**
   * [commit 479fba50d] Should an UPDATE to `object` refresh `updated_at`?
   *
   * `true` on the DDL-observed tables exactly as before, and now also on a
   * table whose declared shape says it has the column — see
   * {@link updatedAtColumnState} for why the second answer is kept apart from
   * the first. `absent` (the database was asked and said no) and "never heard
   * of this object" both stay `false`.
   */
  protected stampsUpdatedAt(object: string): boolean {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.stampsUpdatedAt.call(sequenceSemanticsHost.of(this), object);
  }

  /**
   * [commit 479fba50d] Is that stamp still a PRESUMPTION — i.e. must this write carry the
   * fallback?
   *
   * Only for a table in the `presumed` state and outside `tablesWithTimestamps`.
   * Once a stamped UPDATE has succeeded the state is `present` and this is
   * `false` forever after, which is what keeps the steady state free.
   */
  protected updatedAtStampIsPresumed(object: string): boolean {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.updatedAtStampIsPresumed.call(sequenceSemanticsHost.of(this), object);
  }

  /**
   * [commit 479fba50d] Ask the DATABASE whether `object`'s physical table carries
   * `updated_at`. `null` when the question could not be answered.
   *
   * ⛔ This is deliberately not a read of the failure's message. Every dialect
   * spells the missing column differently (`42703` on Postgres,
   * `ER_BAD_FIELD_ERROR` on MySQL, `SQLITE_ERROR: no such column` on SQLite),
   * those strings are localizable and version-dependent, and a fallback keyed
   * to them would silently stop recovering on the next server upgrade while
   * looking correct. `columnInfo()` answers the actual question, in the
   * dialect's own terms, and is the same call `initObjects` already uses to
   * decide the identical fact on the DDL path.
   *
   * An empty column set means the table is not visible to us at all (it does
   * not exist, or we cannot see it) — NOT that `updated_at` is missing from a
   * table that is otherwise fine. Answering `null` there sends the caller back
   * to rethrowing the original error, which names the real problem.
   *
   * Runs on the caller's transaction when there is one, so it observes the same
   * snapshot — and, on Postgres, so it runs on a transaction that is still
   * usable (see {@link updateWithPresumedTimestamp}).
   */
  protected resolveUpdatedAtColumnPresence(
    object: string,
    trx?: Knex.Transaction,
  ): Promise<boolean | null> {
    // [#25521 cut 21] The body moved to `sql-driver-presumed-timestamp.ts` (see `PresumedTimestampHost`).
    const readKnex = () => this.knex;
    const readPhysicalSchemaByObject = () => this.physicalSchemaByObject;
    const readPhysicalTableByObject = () => this.physicalTableByObject;
    const host: ThisParameterType<typeof resolveUpdatedAtColumnPresence> = {
      get knex() { return readKnex(); },
      get physicalSchemaByObject() { return readPhysicalSchemaByObject(); },
      get physicalTableByObject() { return readPhysicalTableByObject(); },
    };
    return resolveUpdatedAtColumnPresence.call(host, object, trx);
  }

  /**
   * [commit 479fba50d] Issue an UPDATE whose `updated_at` stamp is a PRESUMPTION, and
   * recover if the column turns out not to be there.
   *
   * ## Why this exists rather than option 1 on its own
   *
   * Inferring from the declared shape is free and right for every table this
   * driver's DDL would have built. On a hand-migrated table that genuinely
   * lacks `updated_at` it is wrong, and wrong LOUDLY: an `update()` that
   * succeeds today (without stamping) would start failing, because the driver
   * would name a column that does not exist. That is a NEW REJECTION for a call
   * that works — not something a bug fix may ship. This method is what keeps
   * the net observable change to "`updated_at` is now correctly stamped on any
   * physical shape".
   *
   * ## Why the recovery is safe to retry
   *
   * A single UPDATE is atomic on all three dialects: one that fails to compile
   * or plan has changed no rows, so re-issuing it without the stamp cannot
   * double-apply anything. The recovery re-issues the caller's own payload
   * minus `updated_at` — the exact statement `main` sends today.
   *
   * ## Why the speculative write is fenced when a caller transaction is open
   *
   * On Postgres ANY statement error aborts the WHOLE transaction: every
   * subsequent statement returns `25P02 current transaction is aborted` until
   * rollback. So a bare `try { … } catch { …recover… }` whose recovery issues
   * SQL on the same transaction can never run there — the recovery statement is
   * the one that raises the error you observe. {@link attemptWithoutPoisoning}
   * wraps the attempt in a knex nested transaction (a `SAVEPOINT`, released on
   * success and rolled back to on failure), which leaves the outer transaction
   * usable on every dialect. This is #8269's mechanism applied to the second
   * speculative write in this driver.
   *
   * Outside a caller transaction no fence is needed: knex runs the statement in
   * its own implicit transaction, so a failure is already isolated — and paying
   * for a savepoint on the ordinary write path would be a cost the flag exists
   * to avoid.
   *
   * ## Why it happens at most once per table
   *
   * A successful stamped UPDATE proves the column exists — a column named in a
   * SET list that is not there is a parse/plan error on every dialect here,
   * whatever the row count — so success settles the table as `present`. A
   * resolved absence settles it as `absent`. Either way the table leaves the
   * speculative state and every later write goes straight down the plain path,
   * with no probe and no fence.
   *
   * @param issue re-issues the UPDATE for a given payload and options — the
   *   caller owns the WHERE and the tenant scope, so this method never rebuilds
   *   them and cannot get them wrong.
   */
  protected updateWithPresumedTimestamp(
    object: string,
    formatted: Record<string, any>,
    options: DriverOptions | undefined,
    issue: (payload: Record<string, any>, options?: DriverOptions) => Promise<number>,
  ): Promise<number> {
    // [#25521 cut 21] The body moved to `sql-driver-presumed-timestamp.ts` (see `PresumedTimestampHost`).
    const readLogger = () => this.logger;
    const readUpdatedAtColumnState = () => this.updatedAtColumnState;
    const host: ThisParameterType<typeof updateWithPresumedTimestamp> = {
      attemptWithoutPoisoning: (...a) => this.attemptWithoutPoisoning(...a),
      get logger() { return readLogger(); },
      resolveUpdatedAtColumnPresence: (...a) => this.resolveUpdatedAtColumnPresence(...a),
      get updatedAtColumnState() { return readUpdatedAtColumnState(); },
    };
    return updateWithPresumedTimestamp.call(host, object, formatted, options, issue);
  }

  /**
   * [commit 2200f8ec8] Declared as `IDataDriver.update()` declares it: the updated
   * record, or `null` when no row carries `id` — the un-rotated path answers
   * `formatOutput(...) || null` and the rotation path answers `null` once
   * every shard has been probed. The annotation used to be an explicit
   * `Promise<any>`, which an un-narrowed caller could read fields off with no
   * compiler complaint; it is the contract's type now, pinned by
   * `sql-driver-update-declared-null.test.ts`.
   */
  update(object: string, id: string | number, data: Record<string, any>, options?: DriverOptions): Promise<Record<string, unknown> | null> {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.update.call(sequenceSemanticsHost.of(this), object, id, data, options);
  }

  /**
   * Columns `upsert`'s merge branch must never write ([#7011]): `id` (the row's
   * stable identity — see below), `created_at` (the row's birth timestamp
   * belongs to the original insert) and every `auto_number` column — an
   * autonumber is an immutable business identifier once assigned, so an upsert
   * that lands on an existing row keeps that row's number (see the fuller
   * rationale at the merge site). Autonumber columns are returned under their
   * PHYSICAL names (an external object can remap logical fields via
   * `external.columnMap`), matching the `applyWriteColumnMap`-processed row the
   * merge column list is derived from; `created_at` stays the literal post-map
   * key it has always been filtered as.
   *
   * ## `id` is resolved through {@link remoteColumn}, and that is not defensive
   *
   * [#8622] The primary key takes the autonumber spelling rather than
   * `created_at`'s literal one because `id` is demonstrably remappable: the
   * ADR-0015 §18 fixture in `sql-driver-external-columnmap.test.ts` binds a
   * federated object with `columnMap: { …, cust_id: 'id' }`, so `formatted`
   * carries the key `cust_id` and a literal `'id'` in this set would filter
   * nothing at all on exactly the objects federation exists to serve. Measured
   * on the shipped fixture, not inferred.
   *
   * ## What that identifier guarantees: unique and monotonic, NOT gapless (#8283)
   *
   * Immutable-once-assigned is one half of the contract; this is the other. It
   * is a **decided** property, not an undocumented default — ruled by the
   * maintainer on 2026-08-13 (#8283), which weighed and rejected both reserving
   * the number only after the row is known to be insertable, and an opt-in
   * gapless mode.
   *
   * Per counter — the `(table, tenant, field, scope)` key
   * {@link getNextSequenceValue} issues from — an autonumber is:
   *
   *  - **unique**: no two rows are issued the same value;
   *  - **monotonic**: each value issued is greater than the last;
   *  - **NOT gapless**: the series may skip values, permanently.
   *
   * **A rejected write consumes the number it reserved.** The value is reserved
   * before the INSERT is attempted, so any rejection after that point burns it:
   * a unique violation on another field, a validation rule, a `beforeInsert`
   * hook that throws. That number is issued to no row and will never be issued
   * again — the next write gets the one after it. `TK-0001`, a failed insert,
   * then `TK-0003` is this contract behaving correctly (measured on both
   * SQLite and Postgres in #8283).
   *
   * Why it cannot be taken back: {@link getNextSequenceValue} commits the
   * reservation in **its own transaction** (`runner.transaction` over
   * `parentTrx ?? this.knex`), deliberately independent of the caller's insert
   * — which is what makes a forward-only counter meaningful and what the batch
   * paths' re-seed logic stands on. With no caller transaction the reservation
   * is already committed when the insert fails, and nothing reclaims it.
   * (Inside a caller transaction it nests, rolling back with the refused
   * insert, so that path burns nothing — measured, and relied on at the
   * `upsert` retry site below.)
   *
   * This is ordinary sequence semantics — every standard database sequence
   * behaves this way — and **not a defect to repair**. Do not add reclamation,
   * reservation-reordering, or a "return the number on a clean rejection" path:
   * that shape was rejected in #8283 because it only narrows gaps rather than
   * closing them (a crash after reservation still burns a number) while having
   * to compose with the savepoint structure at both speculative sites.
   *
   * For callers: an autonumber is sound as a business identifier and must not
   * be presented as a **gapless** series (an audit-grade invoice or contract
   * number). A customer with a compliance-grade gapless requirement is the
   * recorded restart condition for an opt-in gapless mode — it is not built.
   *
   * ## The tenant column, and why an upsert never re-parents a row (#21185)
   *
   * The object's tenant column ({@link resolveTenantField}) is on this list for
   * `id`'s and `auto_number`'s argument: which organization owns a row is part
   * of its identity, and an upsert that lands on an existing row keeps that
   * row's organization — an explicit payload value does not move it on merge
   * either. `update()` is the deliberate path that moves a row between
   * organizations. Resolved through {@link remoteColumn} like the autonumber
   * columns, so the name matches the write payload's physical keys.
   *
   * For a TENANT-SCOPED call this exclusion is a no-op, because the merge leg is
   * fenced to rows of the written organization anyway (see {@link upsert} and
   * {@link upsertTenantGuard}), where the stored and written values are equal.
   * Its job is the call with NO tenant context — the lifecycle archiver's
   * `cold.upsert(object, row, ['id'])`, a seed or a connector — which carries no
   * organization fence: there, this entry is what keeps a payload's tenant value
   * from re-parenting the row it merges into. Ruled on #21185 (record
   * 5934879010, half 2), the #7011 / #8622 argument applied to the tenant column.
   *
   * The remote face (`driver-turso`) reads this same list, so the exclusion
   * holds on both faces from one place.
   */
  protected insertOnlyUpsertColumns(object: string): Set<string> {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.insertOnlyUpsertColumns.call(sequenceSemanticsHost.of(this), object);
  }

  /**
   * [#21185] The organization fence for a tenant-scoped upsert, or `null` when
   * the call carries none — read off the row AFTER `injectTenantOnInsert` has
   * run, so `value` is the organization the row is WRITTEN under.
   *
   * A fence exists exactly when the call is tenant-scoped (a non-empty
   * `options.tenantId`, the condition every tenant mechanism in this class keys
   * on) on an object with a tenant column. Inside that set the merge leg may
   * only land on a row whose stored tenant column equals the written one, for
   * ANY conflict target — the primary key included, since `id` and a
   * `unique: 'global'` column are both installation-wide (ADR-0120 D1). A
   * conflict that lands anywhere else is refused with `UNIQUE_VIOLATION` and
   * writes nothing.
   *
   * Why the WRITTEN organization and not the caller's active one: an admin may
   * name another organization on the row ({@link injectTenantOnInsert}: explicit
   * values are never overwritten), and that row really is written there — the
   * reading #8807's identity probe already settled
   * ({@link assertMergeLandedOnSuppliedIdentity}). On an ordinary call the two
   * are the same value.
   *
   * Shared with the remote face (`driver-turso`), so both faces fence on one
   * reading of "tenant-scoped".
   */
  protected upsertTenantGuard(
    object: string,
    row: Record<string, any>,
    options?: DriverOptions,
  ): { field: string; column: string; value: unknown } | null {
    // [#25521 cut 14] The body moved to `sql-driver-upsert-conflict-target.ts` (see `UpsertConflictTargetHost`).
    const host: ThisParameterType<typeof upsertTenantGuard> = {
      remoteColumn: (...a) => this.remoteColumn(...a),
      resolveTenantField: (...a) => this.resolveTenantField(...a),
    };
    return upsertTenantGuard.call(host, object, row, options);
  }

  private mergeLandsInWrittenOrganization(writeTable: string, column: string): Knex.Raw {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts`, its docblock with it (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.mergeLandsInWrittenOrganization.call(sequenceSemanticsHost.of(this), writeTable, column);
  }

  /**
   * [#21185] The refusal both faces throw when an upsert's conflict lands
   * outside the written organization — `UNIQUE_VIOLATION` / 409. Protected so
   * the remote face throws the one sentence this class builds.
   */
  protected upsertConflictRefusal(object: string, conflictKeys?: string[]): Error {
    // [#25521 cut 14] The body moved to `sql-driver-upsert-conflict-target.ts`; it reads no member of the driver.
    return upsertConflictRefusal(object, conflictKeys);
  }

  /**
   * The PRIMARY KEY and UNIQUE indexes a table PHYSICALLY carries, or `null`
   * when the database could not be asked.
   *
   * Partial indexes are excluded: a `WHERE`-restricted unique index constrains
   * only the rows its predicate admits, so it cannot serve as a conflict target
   * for an arbitrary row. (MySQL — the only dialect the pre-flight runs on
   * today — has no partial indexes at all, so this arm is defensive rather than
   * exercised; it is written here so extending the pre-flight to SQLite or
   * Postgres does not have to rediscover it.)
   *
   * `null` and `[]` are different answers and both mean "do not refuse": a read
   * that threw is unknown, and a table that reports NO keys whatsoever is a
   * table this driver did not create — every managed table has an `id` PRIMARY
   * KEY — most likely one that does not exist yet. An empty result is
   * indistinguishable from a missing table on MySQL, whose `information_schema`
   * answers zero rows either way, so treating it as "unbacked" would answer
   * *"no unique index backs your conflict keys"* to a caller whose real problem
   * is a typo in the table name.
   */
  private introspectKeyIndexes(
    tableName: string,
    opts: { fresh?: boolean } = {},
  ): Promise<PhysicalIndex[] | null> {
    // [#25521 cut 14] The body moved to `sql-driver-upsert-conflict-target.ts` (see `UpsertConflictTargetHost`).
    const readPhysicalKeyIndexes = () => this.physicalKeyIndexes;
    const host: ThisParameterType<typeof introspectKeyIndexes> = {
      introspectIndexes: (...a) => this.introspectIndexes(...a),
      get physicalKeyIndexes() { return readPhysicalKeyIndexes(); },
    };
    return introspectKeyIndexes.call(host, tableName, opts);
  }

  /**
   * Refuse an upsert whose named `conflictKeys` this dialect will not honour as
   * the merge target — BEFORE the statement is compiled, on the dialect where
   * the server will never say so itself. Two conditions, one introspection:
   *
   *  - **[#8621] unbacked** — no PRIMARY KEY or UNIQUE index covers the named
   *    target, so there is no merge target at all;
   *  - **[#8755] ambiguous** — the target IS covered, but another UNIQUE key on
   *    the table can absorb the conflict instead of it.
   *
   * # Why a pre-flight exists at all, when a refusal already did
   *
   * The refusal this throws is the one #8445/#8567 already landed, and the
   * catch that raises it (`isUnbackedConflictTargetError` in {@link upsert}) is
   * REACTIVE — it classifies an error the server raised. On SQLite and Postgres
   * the server does raise one: `ON CONFLICT (email)` names an arbiter index, the
   * planner fails to find it, and the statement is refused before it writes.
   *
   * On MySQL no error is ever raised, because the conflict target never reaches
   * the server. knex compiles the driver's exact call to `ON DUPLICATE KEY
   * UPDATE`, which takes no target at all — pinned with no server needed in
   * `sql-driver-upsert-conflict-target-dialects.test.ts`:
   *
   * ```
   * knex('t').insert({...}).onConflict(['email']).merge(['title']).toSQL()
   *   mysql2 -> insert into `t` (…) values (?, ?, ?)
   *             on duplicate key update `title` = values(`title`)   ← no `email`
   * ```
   *
   * So the reactive catch cannot fire there, and what MySQL does instead is
   * strictly worse than the illegible errors the other two dialects were fixed
   * for — measured on live MySQL 8.0.46 (#8592, re-measured here): it merges on
   * whichever unique index the row happens to collide with, and does NOT merge
   * on the key it was given. A wrong write, with no error.
   *
   * Consulting the declared indexes before compiling is therefore a genuinely
   * different mechanism, not a re-use of the existing path. What IS re-used is
   * the answer: the same `refuseUnbackedConflictTarget` wording, `code` and
   * `status`, per #5240 — one condition, one wording — so all three dialects
   * now answer the same sentence for the same mistake.
   *
   * # Why it runs on MySQL ONLY
   *
   * Not a dialect exemption — the opposite. SQLite and Postgres already refuse
   * this exact call with this exact sentence, and they refuse it with the
   * SERVER's own text attached as `cause`, which is the ground truth an operator
   * debugging the table wants and which no pre-flight can reconstruct. Running
   * the pre-flight there would replace a server verdict with an introspection
   * verdict, discard that `cause`, and make the accept set depend on this
   * driver's reading of `pg_index` rather than on the planner's — a strictly
   * worse trade on the two dialects that are already correct. The criterion is
   * "the compiler drops the conflict target, so the server can never be asked",
   * and MySQL is the dialect that meets it.
   *
   * # Why it refuses only what it can PROVE
   *
   * A false refusal breaks a working merge, which is the expensive direction —
   * the same asymmetry `isUnbackedConflictTargetError` records. So every
   * uncertain answer proceeds: a failed introspection, a table with no keys at
   * all (see {@link introspectKeyIndexes}), and a possibly stale cache, which is
   * re-read from the database before any refusal is thrown. The stale-cache leg
   * covers BOTH verdicts and in opposite directions — an index created since the
   * read would make a backed target read as unbacked, and one DROPPED since the
   * read would make a rival key exist that no longer does.
   *
   * The comparison is against the conflict target as EMITTED. `onConflict()`
   * receives `mergeKeys` verbatim — the write column map is applied to the row,
   * never to the target — so the identifiers compared here are the identifiers
   * the statement would carry, and a key set matches an index when the two hold
   * the same columns, order-insensitively (which is how both `ON CONFLICT`
   * dialects infer an arbiter index, and the only reading under which a
   * composite key means anything).
   *
   * # [#8755] The SECOND condition this pre-flight answers, added later
   *
   * `ON DUPLICATE KEY UPDATE` carries no target even when the target IS backed,
   * so a table with a second unique index can still merge on a key the caller
   * never named. Measured on live MySQL 8.0.46, both columns unique, caller
   * naming `email` — re-measured for #8755 before it was fixed:
   *
   * ```
   * upsert({email:'a@b.com',     tax_id:'T-1', title:'first'},  ['email']) -> seeded
   * upsert({email:'other@b.com', tax_id:'T-1', title:'second'}, ['email'])
   *   -> ONE row, merged on `tax_id`. The named target was backed the whole time.
   * ```
   *
   * #8621 deliberately left that standing — it is a different condition, and
   * refusing it narrows the accept set past what that card ruled. #8755's
   * maintainer ruling then took it, choosing refusal (its option A) over
   * emulating a target-honouring statement on MySQL (its option B, rejected:
   * a SELECT-then-branch with a race window and an execution path unlike every
   * other dialect — *"dressing 'the dialect can't' up as 'it did'"*).
   *
   * The two conditions share this method because they share the QUESTION —
   * "what keys does this table physically carry?" — asked once, cached once
   * ({@link physicalKeyIndexes}), invalidated in one place. They do NOT share an
   * answer: see {@link refuseAmbiguousConflictTarget} for why the second gets
   * its own sentence, and for why the PRIMARY KEY is never a rival key.
   *
   * ⚠️ **Renamed from `assertConflictTargetBacked` when the second condition
   * landed.** "Backed" was the whole question while #8621 was the whole method;
   * it is now one of two, and a name that describes half of what a guard refuses
   * is how the other half gets deleted by someone tidying up.
   */
  protected assertConflictTargetHonoured(
    object: string,
    mergeKeys: string[],
    callerNamed: boolean,
  ): Promise<ConflictTargetVerdict> {
    // [#25521 cut 14] The body moved to `sql-driver-upsert-conflict-target.ts` (see `UpsertConflictTargetHost`).
    const readPhysicalTableByObject = () => this.physicalTableByObject;
    const host: ThisParameterType<typeof assertConflictTargetHonoured> = {
      introspectKeyIndexes: (...a) => this.introspectKeyIndexes(...a),
      get physicalTableByObject() { return readPhysicalTableByObject(); },
      rotationWriteTarget: (...a) => this.rotationWriteTarget(...a),
    };
    return assertConflictTargetHonoured.call(host, object, mergeKeys, callerNamed);
  }

  /**
   * [#8740] The unbacked-conflict-target refusal for an upsert statement that
   * carries NO conflict clause — the one {@link upsert} sends when nothing is
   * left to merge ({@link withUpsertConflictClause}).
   *
   * With a conflict clause, SQLite and PostgreSQL refuse an unbacked target
   * themselves (the planner finds no arbiter index) and MySQL refuses it in
   * {@link assertConflictTargetHonoured}. A plain INSERT asks the server
   * nothing about the target, so without this check that path would accept on
   * two dialects a call every dialect refuses when there is something to merge.
   * So the answer is the same refusal, on every dialect, read from the same
   * cached introspection MySQL's pre-flight reads, with the same certainty
   * rule: a failed read or a table with no keys at all proceeds, and a refusal
   * is re-read fresh first, so a stale cache can never refuse a backed target.
   */
  private assertConflictTargetBackedWithoutClause(
    object: string,
    writeTable: string,
    mergeKeys: string[],
  ): Promise<void> {
    // [#25521 cut 14] The body moved to `sql-driver-upsert-conflict-target.ts` (see `UpsertConflictTargetHost`).
    const readPhysicalTableByObject = () => this.physicalTableByObject;
    const host: ThisParameterType<typeof assertConflictTargetBackedWithoutClause> = {
      introspectKeyIndexes: (...a) => this.introspectKeyIndexes(...a),
      get physicalTableByObject() { return readPhysicalTableByObject(); },
    };
    return assertConflictTargetBackedWithoutClause.call(host, object, writeTable, mergeKeys);
  }

  private assertMergeLandedOnSuppliedIdentity(
    object: string,
    writeTable: string,
    id: string | number,
    rivals: PhysicalIndex[],
    writtenTenant: unknown,
    options?: DriverOptions,
  ): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts`, its docblock with it (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.assertMergeLandedOnSuppliedIdentity.call(sequenceSemanticsHost.of(this), object, writeTable, id, rivals, writtenTenant, options);
  }

  private assertMergeLandedInWrittenOrganization(
    object: string,
    writeTable: string,
    mergeKeys: string[],
    matchOn: Record<string, unknown>,
    sent: Record<string, unknown>,
    guard: { column: string; value: unknown },
    identity: { id: string | number; rivals: PhysicalIndex[] } | null,
    options?: DriverOptions,
  ): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts`, its docblock with it (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.assertMergeLandedInWrittenOrganization.call(sequenceSemanticsHost.of(this), object, writeTable, mergeKeys, matchOn, sent, guard, identity, options);
  }

  // [commit be5c60291] The return is the contract's own type. It was `Promise<Record<string, any>>`, and the
  // reason #15267's census never named this door is worth carrying: that census
  // matched the literal string `Promise<any>`, and here the `any` is NESTED
  // inside a wider type, so the characters were not there to match. The door
  // appeared in neither its repaired set nor its excluded set — it was never
  // seen. Pinned at the type level, both halves, in
  // `sql-driver-doors-declared-types.test.ts`.
  upsert(object: string, data: Record<string, any>, conflictKeys?: string[], options?: DriverOptions): Promise<Record<string, unknown>> {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.upsert.call(sequenceSemanticsHost.of(this), object, data, conflictKeys, options);
  }

  delete(object: string, id: string | number, options?: DriverOptions): Promise<boolean> {
    // [#29520 codemod] The body moved to `sql-driver-sequence-semantics.ts` (see `SequenceSemanticsHost`).
    return SequenceSemanticsFacet.delete.call(sequenceSemanticsHost.of(this), object, id, options);
  }

  // ===================================
  // Bulk & Batch Operations
  // ===================================

  /**
   * [#15267] Declared as `IDataDriver.bulkCreate()` declares it: the inserted
   * rows, each through `formatOutput()` for read-back parity with
   * {@link create}. The annotation used to be an explicit `Promise<any>`, which
   * erased both the array and the row shape on the published `.d.ts`; it is the
   * contract's type now, pinned by `sql-driver-doors-declared-types.test.ts`.
   */
  bulkCreate(object: string, data: any[], options?: DriverOptions): Promise<Record<string, unknown>[]> {
    // [#29520 codemod] The body moved to `sql-driver-bulk-operations.ts` (see `BulkOperationsHost`).
    return BulkOperationsFacet.bulkCreate.call(bulkOperationsHost.of(this), object, data, options);
  }

  /**
   * Batch-update multiple records by ID — atomically, as ONE unit.
   *
   * [#13854] The loop itself is unchanged, and deliberately so: each id carries
   * its OWN patch, so there is no single statement that expresses N different
   * SET lists (the reason `bulkCreate`'s "send it as one INSERT" shape does not
   * transfer). What this card changed is the transaction boundary around it.
   *
   * ## The defect
   *
   * With no boundary, every `update()` autocommitted its own row —
   * {@link getBuilder} hands back a plain `this.knex` builder whenever
   * `options.transaction` is unset — so a batch refused partway through left
   * every row processed BEFORE the refusal permanently committed. The caller
   * got an exception and the database was left in a state nobody declared:
   * neither the pre-image nor the post-image. Same defect class #13340/#13435
   * closed on `driver-memory`'s batch doors; `driver-turso` reaches this door
   * through `super.bulkUpdate`, which is why the repair belongs to the parent
   * and patching the subclass would only wait for the next subclass.
   *
   * ⚠️ A missing id is NOT the reachable failure on this door, and a pin that
   * uses one measures nothing: `update()` issues an UPDATE matching zero rows
   * and returns `null`, which this loop skips (`if (updated)`). That skip is
   * the established convention #13435's note defers to, and it is unchanged
   * here. The reachable refusals are the database's own — a unique violation on
   * a later row, a NOT NULL violation, a bind refusal.
   *
   * {@link bulkDelete} needs no such wrapper: it is one `whereIn(...).delete()`
   * per rotation shard, atomic per shard on its own.
   *
   * ## One runner, two meanings — and why the caller's transaction is fenced
   *
   * With no caller transaction, `this.knex.transaction()` opens the driver's
   * own — the shape {@link upsert}'s `verifyIdentity` branch uses. Inside a
   * caller transaction, `trx.transaction()` opens a knex NESTED transaction: a
   * `SAVEPOINT`, released on success and rolled back to on failure, the exact
   * primitive {@link attemptWithoutPoisoning} is built on and which this file
   * has verified on PG 16 and on better-sqlite3 at pool `max: 1`, where the
   * savepoint rides the parent's connection and never asks the pool for a
   * second one.
   *
   * ⚠️ Joining the caller's transaction WITHOUT a savepoint — the posture
   * {@link upsert} takes at its own boundary — would be wrong here, and the
   * difference is N statements versus one. `upsert` reasons that "the statement
   * is already transactional", which is true of one statement and false of this
   * loop: a caller that catches the refusal and commits its transaction anyway
   * lands precisely the partial batch this card is about. That is reachable on
   * SQLite and MySQL; Postgres aborts the whole transaction on any statement
   * error, so it is the one dialect where the hole was already shut by
   * accident. The savepoint makes "every row applied in THIS call is undone"
   * true whatever the caller wraps around it, while leaving that transaction
   * usable — the rollback decision for the caller's OWN work stays the
   * caller's, which is the half of `upsert`'s reasoning that does transfer.
   */
  // [commit be5c60291] The return is the contract's own type. It was `Promise<Record<string, any>[]>`, and the
  // reason #15267's census never named this door is worth carrying: that census
  // matched the literal string `Promise<any>`, and here the `any` is NESTED
  // inside a wider type, so the characters were not there to match. The door
  // appeared in neither its repaired set nor its excluded set — it was never
  // seen. Pinned at the type level, both halves, in
  // `sql-driver-doors-declared-types.test.ts`.
  bulkUpdate(object: string, updates: Array<{ id: string | number; data: Record<string, any> }>, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    // [#29520 codemod] The body moved to `sql-driver-bulk-operations.ts` (see `BulkOperationsHost`).
    return BulkOperationsFacet.bulkUpdate.call(bulkOperationsHost.of(this), object, updates, options);
  }

  bulkDelete(object: string, ids: Array<string | number>, options?: DriverOptions): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-bulk-operations.ts` (see `BulkOperationsHost`).
    return BulkOperationsFacet.bulkDelete.call(bulkOperationsHost.of(this), object, ids, options);
  }

  /**
   * Bulk UPDATE by filter.
   *
   * [#11176] `updated_at` is stamped here for the same reason {@link update} and
   * {@link rotatedUpdateById} stamp it: the column means "last modified", it
   * carries an INSERT-time `DEFAULT now()` and no `ON UPDATE` clause or trigger
   * on any dialect this driver speaks, so a path that does not stamp leaves
   * every row it touched reading its previous value. This door did not stamp at
   * all — a bulk status change was invisible to every consumer that reads
   * `updated_at` (list-view sorts, delta/incremental sync, cache invalidation,
   * audit), without erroring.
   *
   * The decision is commit 479fba50d's, unchanged and shared rather than re-derived:
   * {@link stampsUpdatedAt} answers whether to stamp, {@link keepSuppliedUpdatedAt}
   * honours an opt-in historical import, and {@link updateWithPresumedTimestamp}
   * carries the speculative case so a hand-migrated table that genuinely lacks
   * the column keeps working instead of gaining a new rejection.
   *
   * [#11223] The payload goes through `formatInput` + `applyWriteColumnMap`, the
   * pair every other write door in this file applies (`create`, `update`,
   * `bulkCreate`, `upsert`, `rotatedUpdateById`). This door was the only one that
   * did not, and the WHERE side of the very same statement WAS translated by
   * `applyFilters` — so the gap produced three measured failures, two loud and
   * one silent:
   *
   *   - a `json` / `Field.multiple` value was REFUSED, because nothing stringified
   *     it for the bind: `22P02 invalid input syntax for type json` on live
   *     Postgres, `SQLite3 can only bind numbers, strings, bigints, buffers, and
   *     null` on SQLite, and on MySQL an array expanded into the SET list itself
   *     (`set \`tags\` = 'y', 'z'`) — a SYNTAX error, not a bind error;
   *   - an external object with an `external.columnMap` emitted a SET clause
   *     naming a LOCAL field beside a WHERE naming the physical column, in one
   *     statement — ``update `legacy_p` set `name` = 'Bulk' where `full_name` =
   *     'Renamed'`` → `no such column: name`. The door was unusable on every
   *     remapped federated object;
   *   - a zone-naive datetime was stored VERBATIM. On SQLite that is the
   *     pre-#3912 `'YYYY-MM-DD HH:MM:SS'` storage form being newly written into a
   *     column `canonicalDatetimeFields` has certified — and a certified column
   *     has had its read-side repair dropped, so nothing downstream corrects it.
   *     On live Postgres the same literal is resolved in the SERVER's timezone
   *     rather than UTC: measured 8 hours off on an `Asia/Shanghai` server, the
   *     hazard `formatInput`'s own ADR-0053 note describes. `update()` stored the
   *     canonical instant from the identical input in the same run.
   *
   * Ordering is the other doors' ordering and matters: `formatInput` coerces by
   * LOGICAL field name, `applyWriteColumnMap` renames afterwards. The `updated_at`
   * stamp stays where #11176 put it — applied to the assembled payload as the
   * literal post-map column name, the spelling `created_at` carries everywhere in
   * this file.
   */
  updateMany(object: string, query: DriverQuery, data: any, options?: DriverOptions): Promise<number> {
    // [#29520 codemod] The body moved to `sql-driver-bulk-operations.ts` (see `BulkOperationsHost`).
    return BulkOperationsFacet.updateMany.call(bulkOperationsHost.of(this), object, query, data, options);
  }

  deleteMany(object: string, query: DriverQuery, options?: DriverOptions): Promise<number> {
    // [#29520 codemod] The body moved to `sql-driver-bulk-operations.ts` (see `BulkOperationsHost`).
    return BulkOperationsFacet.deleteMany.call(bulkOperationsHost.of(this), object, query, options);
  }

  /** By-id update for a rotation-managed object: the row lives in exactly one
   * shard — probe newest-first, mirroring the un-rotated {@link update}. */
  protected rotatedUpdateById(
    object: string,
    shards: string[],
    id: string | number,
    data: Record<string, any>,
    options?: DriverOptions,
  ): Promise<Record<string, unknown> | null> {
    // [#29520 codemod] The body moved to `sql-driver-bulk-operations.ts` (see `BulkOperationsHost`).
    return BulkOperationsFacet.rotatedUpdateById.call(bulkOperationsHost.of(this), object, shards, id, data, options);
  }

  /**
   * [#8790] Compose the refusal for a WHERE column the backend could not
   * resolve, writing the dialect's own message to the SERVER LOG on the way.
   *
   * Logging is the half that keeps this a redaction rather than a deletion. The
   * dialect message is genuinely useful, and `count()`'s old raw throw was the
   * only place an operator ever saw it. It also carries the caller's bound
   * literals inlined, which is why it may not travel to the caller (#7929's
   * line, applied to the one refusal on this path that is raised from a
   * dialect error rather than composed from the filter AST). So: diagnostic to
   * the log, column name to the caller.
   *
   * [#21385, maintainer ruling 2026-10-02] …and the log line is cut too. A
   * server log leaves the data's trust boundary, so the line writes the
   * dialect's text through the shared driver-fault redaction
   * (`@objectstack/types`): the code, the column and the dialect's own
   * diagnostic stay; the compiled statement and the literals inlined into it
   * do not.
   *
   * Returns the error rather than throwing it, the same shape
   * {@link SqlDriver.resolveWithheldFilterRefusal} uses, so each call site
   * spells its own `throw` and no reader has to know whether this returns.
   *
   * [#20020, the #8220 contract] The column NAME is the predicate's too. A read
   * scope naming a column the table lacks — a policy written against a field
   * that was later renamed, removed or never synced — used to put that column
   * in front of a caller who never wrote it. `rootFilter` is the query's own
   * `where` — the tree the read-scope merge boundaries marked — and the name
   * reaches the wire only when every node naming it is positively marked
   * `'author'` ({@link unresolvableColumnProvenance}); otherwise the refusal
   * takes the unnamed wording this method already had for a dialect message
   * it could not parse, and the name stays in the log line above it. Same
   * code, same status, whichever wording answers.
   */
  protected unresolvableFilterColumnRefusal(object: string, error: unknown, rootFilter?: unknown): Error {
    // [#25521 cut 15] The body moved to `sql-driver-read-exit-fault.ts` (see `ReadExitFaultHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof unresolvableFilterColumnRefusal> = {
      get logger() { return readLogger(); },
      mapSortField: (...a) => this.mapSortField(...a),
      remoteColumn: (...a) => this.remoteColumn(...a),
    };
    return unresolvableFilterColumnRefusal.call(host, object, error, rootFilter);
  }

  /**
   * [#8931, maintainer ruling 2026-08-17] The TERMINAL of both read halves:
   * compose {@link backendStatementFaultError} for a dialect error nothing
   * above classified, writing the dialect's own message to the SERVER LOG on
   * the way.
   *
   * # What reaches here, measured on live PG 16.13 and on better-sqlite3
   *
   * Everything the read path can throw that is not an unresolvable WHERE column
   * (which {@link SqlDriver.unresolvableFilterColumnRefusal} already answers)
   * and not already ADR-0112-enveloped:
   *
   * | condition                | before                                   |
   * |--------------------------|------------------------------------------|
   * | table never provisioned  | `42P01` / `SQLITE_ERROR`, no `status`    |
   * | a dotted WHERE key on pg | `42P01`, no `status` — **this card**     |
   * | comparand-shape syntax   | `42601` / `SQLITE_ERROR`, no `status`    |
   * | value/type rejection     | `22P02`, no `status`, **value inlined**  |
   * | connection, timeout, ACL | the dialect's own error, no `status`     |
   *
   * All of them left the driver as the dialect's raw error object: a `code`
   * from the backend's vocabulary, no `status`, and a message opening with the
   * compiled statement. The last row is the one worth naming — Postgres puts
   * the caller's rejected VALUE in its own `22P02` prose (`invalid input syntax
   * for type integer: "…"`), which no statement-cut removes, and this envelope
   * closes it as a consequence of withholding the dialect text wholesale.
   *
   * ⛔ Deliberately NOT here: the WRITE paths. `create`/`update`/`delete` faults
   * are classified at the REST boundary FROM their message text — a unique
   * violation becomes `409 UNIQUE_VIOLATION`, an unknown column `400
   * INVALID_FIELD` — so composing a message over them would turn precise 4xx
   * answers into a generic 500. Those routes have their own cards; this ruling
   * is about the read exits, and the boundary is drawn here rather than left to
   * be discovered.
   *
   * Returns the error rather than throwing it, the shape both siblings on this
   * path use, so each call site spells its own `throw`.
   */
  protected backendStatementFault(object: string, error: unknown): Error {
    // [#25521 cut 15] The body moved to `sql-driver-read-exit-fault.ts` (see `ReadExitFaultHost`).
    const readDeferredDdl = () => this.deferredDdl;
    const readDeferredSchemaObjects = () => this.deferredSchemaObjects;
    const readLogger = () => this.logger;
    const readPhysicalTableByObject = () => this.physicalTableByObject;
    const host: ThisParameterType<typeof backendStatementFault> = {
      get deferredDdl() { return readDeferredDdl(); },
      get deferredSchemaObjects() { return readDeferredSchemaObjects(); },
      get logger() { return readLogger(); },
      get physicalTableByObject() { return readPhysicalTableByObject(); },
    };
    return backendStatementFault.call(host, object, error);
  }

  count(object: string, query?: DriverQuery, options?: DriverOptions): Promise<number> {
    // [#29520 codemod] The body moved to `sql-driver-bulk-operations.ts` (see `BulkOperationsHost`).
    return BulkOperationsFacet.count.call(bulkOperationsHost.of(this), object, query, options);
  }

  // ===================================
  // Raw Execution
  // ===================================

  /**
   * [#16019] The terminal of the raw path — compose
   * {@link rawStatementFaultError} for a backend refusal nothing declared,
   * writing the dialect's own message to the SERVER LOG on the way.
   *
   * [#21385, maintainer ruling 2026-10-02] That line once wrote the statement
   * as well, and the dialect's message whole: both carry the values the
   * statement bound or spelled inline. It now writes the dialect's text
   * through the shared driver-fault redaction (`@objectstack/types`) and drops
   * the sent statement, keeping the code and the dialect's own diagnostic.
   *
   * The same "is it already ours" gate {@link SqlDriver.backendStatementFault}
   * applies, asked over the DECLARED status and ⛔ never over an error class: a
   * transport that already answers with an ADR-0112 envelope must not be
   * buried under a generic one.
   *
   * Returns the error rather than throwing it — the shape every sibling
   * terminal in this file uses — so each call site spells its own `throw`.
   * `protected` so a subclass that routes `execute()` around this class's knex
   * (`TursoDriver` in remote mode) declares through the SAME composition.
   */
  protected rawStatementFault(command: string, error: unknown): Error {
    // [#25521 cut 2] The body moved to `sql-driver-raw-execution.ts` (see `RawExecutionHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof rawStatementFault> = {
      get logger() { return readLogger(); },
    };
    return rawStatementFault.call(host, command, error);
  }

  /**
   * Run a raw SQL string or knex builder through the underlying knex
   * connection.
   *
   * ⚠️ **Tenant isolation bypass.** Unlike `find`/`update`/`delete` etc.,
   * raw `execute()` does NOT inject the `organization_id` predicate. The
   * caller is responsible for either:
   *   - inlining the tenant filter into the SQL (`WHERE organization_id = ?`),
   *   - or restricting `execute()` to genuinely global queries
   *     (schema introspection, sys_* tables that opt out of tenancy).
   *
   * Prefer the typed CRUD APIs whenever the operation can be expressed
   * through them — they handle tenancy, soft-delete, and audit warnings
   * automatically. See `README.md > Tenant Isolation` for the full bypass
   * matrix.
   *
   * [#15267] Declared as `IDataDriver.execute()` declares it: `unknown` — a raw
   * statement's result is whatever the dialect returned, and the contract's own
   * `unknown` says exactly that. The annotation used to be an explicit
   * `Promise<any>`, which erased the contract's `unknown` on the class and let
   * a caller dereference the result unchecked; pinned by
   * `sql-driver-doors-declared-types.test.ts`.
   */
  execute(command: any, params?: any[], options?: DriverOptions): Promise<unknown> {
    // [#25521 cut 2] The body moved to `sql-driver-raw-execution.ts` (see `RawExecutionHost`).
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof execute> = {
      get knex() { return readKnex(); },
      noteRuntimeIndexDdl: (...a) => this.noteRuntimeIndexDdl(...a),
      rawStatementFault: (...a) => this.rawStatementFault(...a),
    };
    return execute.call(host, command, params, options);
  }

  /**
   * Index names this process created through raw {@link execute} DDL, keyed by
   * table (#4884).
   *
   * The framework runs a handful of index migrations the additive metadata sync
   * cannot express — ADR-0048's partial UNIQUE overlay indexes on `sys_metadata`
   * are the reference case, issued by `metadata-protocol`'s `ensureOverlayIndex`
   * through this very seam. The drift detector has no other way to tell those
   * apart from an index a stale metadata declaration abandoned, and it used to
   * tell an operator to `--allow-destructive` the *draft-overlay uniqueness
   * guarantee* on a database this build had created seconds earlier.
   *
   * This is a ledger of fact, not a heuristic: an entry means "this process ran
   * that CREATE INDEX and it succeeded". Process-scoped by design — a restart
   * starts empty, and the durable half of the guarantee is
   * {@link isSyncReproducibleIndex}, which reads the index's own definition.
   */
  protected readonly runtimeCreatedIndexes = new Map<string, Set<string>>();

  /** Record (or, on a DROP, forget) an index this driver just created via raw DDL. */
  protected noteRuntimeIndexDdl(sql: string): void {
    // [#25521 cut 2] The body moved to `sql-driver-raw-execution.ts` (see `RawExecutionHost`).
    const readRuntimeCreatedIndexes = () => this.runtimeCreatedIndexes;
    const host: ThisParameterType<typeof noteRuntimeIndexDdl> = {
      get runtimeCreatedIndexes() { return readRuntimeCreatedIndexes(); },
    };
    return noteRuntimeIndexDdl.call(host, sql);
  }

  // ===================================
  // Transactions
  // ===================================

  beginTransaction(): Promise<Knex.Transaction> {
    // [#25521 cut 3] The body moved to `sql-driver-transactions.ts` (see `TransactionHost`).
    const readActiveTransactions = () => this.activeTransactions;
    const writeActiveTransactions = (v: SqlDriver['activeTransactions']) => { this.activeTransactions = v; };
    const readKnex = () => this.knex;
    const readOpenTransactions = () => this.openTransactions;
    const host: ThisParameterType<typeof beginTransaction> = {
      get activeTransactions() { return readActiveTransactions(); },
      set activeTransactions(v) { writeActiveTransactions(v); },
      get knex() { return readKnex(); },
      get openTransactions() { return readOpenTransactions(); },
    };
    return beginTransaction.call(host);
  }

  /** Idempotently drop a transaction from the open-count (safe on double close). */
  protected releaseTransaction(transaction: unknown): void {
    // [#29520 codemod] The body moved to `sql-driver-transactions-section.ts` (see `TransactionsSectionHost`).
    return TransactionsSectionFacet.releaseTransaction.call(transactionsSectionHost.of(this), transaction);
  }

  /**
   * Dev/test guard against the SQLite single-connection dead-lock. SQLite's pool
   * hands out exactly one connection, so issuing a bare `this.knex` query while a
   * transaction holds that connection blocks forever acquiring a second one and
   * finally fails with an opaque `Knex: Timeout acquiring a connection`. This
   * turns that into an immediate, actionable error at the call site.
   *
   * No-op in production (zero overhead on the hot path) and on every non-SQLite
   * dialect, whose pool holds more than one connection and so cannot exhibit the
   * single-connection dead-lock. That headroom is `max: 5`, from `buildSqlPool`
   * in service-datasource's `default-datasource-driver-factory.ts`, which gives
   * every datasource it composes `{min:0,max:5}` unless one declares its own
   * `pool` — not knex's roomier `poolDefaults()` of `{min:2,max:10}`, which the
   * factory never reaches. Callers that legitimately need the connection during
   * a transaction must bind the operation to that transaction instead of
   * `this.knex`.
   */
  protected assertBareKnexSafe(op: string): void {
    // [#25521 cut 3] The body moved to `sql-driver-transactions.ts` (see `TransactionHost`).
    const readActiveTransactions = () => this.activeTransactions;
    const readIsSqlite = () => this.isSqlite;
    const host: ThisParameterType<typeof assertBareKnexSafe> = {
      get activeTransactions() { return readActiveTransactions(); },
      isProductionEnv: (...a) => this.isProductionEnv(...a),
      get isSqlite() { return readIsSqlite(); },
    };
    return assertBareKnexSafe.call(host, op);
  }

  /** IDataDriver standard */
  commit(transaction: unknown): Promise<void> {
    // [#25521 cut 3] The body moved to `sql-driver-transactions.ts` (see `TransactionHost`).
    const host: ThisParameterType<typeof commit> = {
      releaseTransaction: (...a) => this.releaseTransaction(...a),
    };
    return commit.call(host, transaction);
  }

  /** IDataDriver standard */
  rollback(transaction: unknown): Promise<void> {
    // [#25521 cut 3] The body moved to `sql-driver-transactions.ts` (see `TransactionHost`).
    const host: ThisParameterType<typeof rollback> = {
      releaseTransaction: (...a) => this.releaseTransaction(...a),
    };
    return rollback.call(host, transaction);
  }

  /** @deprecated Use commit() instead */
  commitTransaction(trx: Knex.Transaction): Promise<void> {
    // [#25521 cut 3] The body moved to `sql-driver-transactions.ts` (see `TransactionHost`).
    const host: ThisParameterType<typeof commitTransaction> = {
      commit: (...a) => this.commit(...a),
    };
    return commitTransaction.call(host, trx);
  }

  /** @deprecated Use rollback() instead */
  rollbackTransaction(trx: Knex.Transaction): Promise<void> {
    // [#25521 cut 3] The body moved to `sql-driver-transactions.ts` (see `TransactionHost`).
    const host: ThisParameterType<typeof rollbackTransaction> = {
      rollback: (...a) => this.rollback(...a),
    };
    return rollbackTransaction.call(host, trx);
  }

  // ===================================
  // Aggregation
  // ===================================

  /**
   * [#6212] `query` is a {@link DriverQuery}, not `any`.
   *
   * `any` here was not "the object name goes unchecked", it was every check off
   * on the members this body READS: `where`'s filter dialect, `groupBy`'s node
   * union, `aggregations`' node shape. #5181 narrowed the six methods it swept
   * and commit d367f03d6 followed through on five drivers; this door was reached by
   * neither.
   *
   * [#17277] The sentence that used to close the paragraph above —
   * "`aggregate` is not on that contract" — was FALSE, and it is the whole
   * reason #15267's census walked past this door: that census asked "is it on
   * the contract?" and answered from THIS COMMENT rather than from the
   * contract. `IDataDriver` declares
   * `aggregate?(object, query, options?): Promise<Record<string, unknown>[]>`,
   * beside the calling convention that dispatches on
   * `typeof driver.aggregate === 'function'`. The `?` governs whether the
   * member EXISTS, not what it returns once it does, so the declared return is
   * a published promise here exactly as on a required door. The annotation
   * below is the contract's own, pinned at the type level in
   * `sql-driver-doors-declared-types.test.ts`.
   */
  aggregate(object: string, query: DriverQuery, options?: DriverOptions): Promise<Record<string, unknown>[]> {
    // [#29520 codemod] The body moved to `sql-driver-aggregation.ts` (see `AggregationHost`).
    return AggregationFacet.aggregate.call(aggregationHost.of(this), object, query, options);
  }

  /**
   * [#20387, #11635, #21042] The class {@link aggregate}'s operand policies read
   * for one aggregated column (`aggregandColumnClass`, `@objectstack/core`),
   * answered from this driver's registries of the column's declaration:
   * `booleanFields` is the `'boolean'` class, `fractionalNumericFields` (filled
   * by the predicate itself) the `'fractional'` one, and the rest of
   * `numericFields` the `'integral'` one. Every other column — and an unknown
   * table — is in no class, so it keeps the database's own arithmetic, as
   * before.
   *
   * The policies apply on PostgreSQL and MySQL only (`aggregandOperandSql`
   * reads the dialect). SQLite stores the fractional family as REAL
   * (`ColumnCompiler_SQLite3.prototype.decimal` is `'float'`), so its `sum` /
   * `avg` already add doubles.
   */
  protected aggregandColumnClassOf(table: string | null, field: string): AggregandColumnClass | undefined {
    // [#29520 codemod] The body moved to `sql-driver-aggregation.ts` (see `AggregationHost`).
    return AggregationFacet.aggregandColumnClassOf.call(aggregationHost.of(this), table, field);
  }

  /**
   * [#15546] Fold the NULL a SQL aggregate answers over an all-NULL aggregand
   * to the identity the platform declares for that aggregate over NOTHING.
   *
   * SQL `SUM` skips NULLs, and once it has skipped every row of a group it
   * answers NULL — on every dialect this driver targets. Measured 2026-09-07
   * on better-sqlite3, live PostgreSQL 16.13 and live MySQL 8.0.46: `sum` over
   * a group of three rows whose column is NULL in each of them is `null` on
   * all three, for `number` and `currency` columns alike. The engine's
   * in-memory aggregate tier (`objectql`'s `in-memory-aggregation.ts`) answers
   * `0` for the same rows, as do `driver-memory` and `driver-mongodb`'s
   * lowering, and `emptyGroupValueFor` (spec `data/aggregation-policy.ts`)
   * rules that summing nothing is `0` — a measured fact, not missing data.
   * Which face answered was decided by a driver capability bit the caller
   * never sees (`engine.ts`'s `typeof drv.aggregate === 'function'` fork), so
   * one grouped list view rendered a blank total on one deployment and `0` on
   * another. Maintainer ruling 2026-09-07 on #15546 (option A): three rows
   * whose aggregand is absent and zero rows are the SAME case for `sum` — the
   * addend set is empty either way — and this face is the one that moves.
   *
   * The identity is READ from the policy rather than restated here, so the
   * other half of the same rule holds by construction: an aggregate whose
   * `emptyGroupValueFor` is `undefined` (`avg`/`min`/`max`) has no answer over
   * nothing, is never registered, and its NULL reaches the caller untouched.
   * `count`/`count_distinct` register too but never arrive as NULL — `COUNT`
   * answers `0` on its own — so the entry is inert for them, deliberately
   * rather than special-cased away.
   *
   * Presentation, not compilation. The statement is unchanged — no `COALESCE`
   * — so the emitted-SQL pins and the per-dialect result-type parsing above
   * are untouched, and the answer is the JS number `0` on every dialect, the
   * same value the in-memory tier produces. Only `null` folds: an `undefined`
   * would mean the column was never projected, a different defect that must
   * stay visible. Rows are mutated in place, as {@link presentReadColumns}
   * does. The unaliased branch of {@link SqlDriver.aggregate} is not tracked,
   * for the reason `presentedOutput` gives: `alias` is required by
   * `AggregationNodeSchema`, and that branch lands under a dialect-dependent
   * column name.
   *
   * Pinned on every enrolled face by the `sum(amount)` cases of
   * `AGGREGATION_CASES` (spec `data/aggregation-conformance.ts`).
   */
  protected foldEmptyAggregateAnswers(rows: any, identities: Map<string, number>): any {
    // [#29520 codemod] The body moved to `sql-driver-aggregation.ts`.
    return AggregationFacet.foldEmptyAggregateAnswers(rows, identities);
  }

  /**
   * [#11541] Which envelope a dialect error leaving {@link SqlDriver.aggregate}
   * deserves — the #8790 unresolvable-column refusal, at last, on the third
   * read door, without the unsupportable attribution #8931 forbids.
   *
   * # The condition, and why it could not ride `count()`'s arm verbatim
   *
   * `find()` and `count()` answer an unresolvable WHERE column with
   * `INVALID_FILTER` / 400 naming the column (#8790, maintainer ruling
   * 2026-08-15: one unresolvable WHERE column, one answer, on both read
   * halves). `aggregate()` is the third read door and never received that arm,
   * so the same predicate answered `DATABASE_ERROR` / 500 one door over — the
   * exact split #8790 closed. But this door names columns in THREE clauses
   * (`where`, `groupBy`, each aggregation's `field`), and the WHERE refusal's
   * words assert the FILTER was at fault. Telling the author of
   * `avg('nosuchcol')` that their filter was wrong is an attribution the
   * signal cannot support — the #8931 ruling (2026-08-17 「同意 C」, restated
   * by #11455 when it deliberately left this arm out).
   *
   * # The three arms — attribution comes from the CALLER'S OWN QUERY
   *
   * The dialect names the column; it does not name the clause. The clause is
   * read off the query AST this driver just compiled — the same `groupBy` /
   * `aggregations` reads the statement builder performed — so every claim the
   * refusal makes is a fact about the caller's own request, never a guess
   * from the backend's prose:
   *
   * 1. the name is a `groupBy` field or an aggregation `field` ⇒ a refusal
   *    naming THAT clause ({@link SqlDriver.unresolvableAggregateColumnRefusal},
   *    `INVALID_FIELD` / 400);
   * 2. the name is in neither ⇒ the statement's only remaining column sources
   *    are the WHERE this method compiled from `query.where` and the
   *    tenant-scope predicate — both filters — so #8790's existing
   *    {@link SqlDriver.unresolvableFilterColumnRefusal} applies verbatim;
   * 3. {@link unresolvableColumnNameOf} answers `null` ⇒ the wording parsed by
   *    nothing. Without a name there is no AST lookup, so NO attribution is
   *    supportable — the #11455 terminal envelope stands unchanged. ⛔ Reading
   *    `null` as license for the WHERE arm would attribute a clause on no
   *    evidence, which is arm 2's own justification inverted.
   *
   * ⚠️ Arm 1 is judged by EXACT name equality against the same AST reads the
   * builder performed. A suffix match ("`title.x` ends in `.x`") would
   * attribute a dotted WHERE key to an aggregation over `x` — a false verdict
   * about a clause that may be perfectly fine — and inspecting the key for a
   * `.` is #8371's axis besides. When one column is named by BOTH the where
   * and a groupBy/aggregation, arm 1 wins and its claim is still true: the
   * caller's groupBy/aggregation really does name a column the table lacks.
   *
   * # No new dialect recognizer
   *
   * Both predicates this method consults ({@link isUnresolvableColumnError},
   * {@link unresolvableColumnNameOf}) are #8790's, shared with `find()` and
   * `count()`, untouched. MySQL's wording even names the clause position
   * (`in 'field list'` / `'where clause'`), and it is deliberately NOT read:
   * a per-dialect clause parser is the split-recognizer shape the #8926
   * ruling refused, and the other two dialects could never feed it.
   *
   * Returns the error rather than throwing it, the shape every sibling on
   * this path uses, so the call site spells its own `throw`.
   */
  protected aggregateBackendFault(object: string, query: DriverQuery, error: unknown): Error {
    // [#25521 cut 15] The body moved to `sql-driver-read-exit-fault.ts` (see `ReadExitFaultHost`).
    const host: ThisParameterType<typeof aggregateBackendFault> = {
      backendStatementFault: (...a) => this.backendStatementFault(...a),
      unresolvableAggregateColumnRefusal: (...a) => this.unresolvableAggregateColumnRefusal(...a),
      unresolvableFilterColumnRefusal: (...a) => this.unresolvableFilterColumnRefusal(...a),
    };
    return aggregateBackendFault.call(host, object, query, error);
  }

  /**
   * [#11541] Compose the refusal for a `groupBy` / aggregation column the
   * backend could not resolve, writing the dialect's own message to the
   * SERVER LOG on the way — the same diagnostic-to-log, name-to-caller split
   * {@link SqlDriver.unresolvableFilterColumnRefusal} performs for the WHERE
   * (#7929: the dialect text inlines the statement's bound literals on two of
   * the three dialects, so it may not travel to the caller). [#21385] The log
   * line takes the same cut as the WHERE's: no statement, no bound literal.
   *
   * # `INVALID_FIELD` / 400 — the ingress door's own answer, not a new choice
   *
   * The protocol ingress already refuses THIS condition one layer up:
   * `assertGroupByFieldsExist` and `assertAggregationFieldsExist`
   * (`@objectstack/metadata-protocol`, #4254) answer a grouping or
   * aggregation target the object does not have with `400 INVALID_FIELD`
   * naming the field and the object — reserving `INVALID_QUERY` for entries
   * the spec cannot READ (shape violations), which this is not. One condition
   * refused at two layers must not carry two codes — the exact rule
   * {@link unresolvableFilterColumnError} applied when it took the ingress
   * door's `INVALID_FILTER` for the WHERE axis. The driver's half of the
   * condition is the registry-backstop case: a field the metadata DECLARES
   * (so ingress passed it) whose column the table lacks, which is why the
   * message adds the one thing only the driver knows — run schema sync.
   *
   * ⛔ Not `INVALID_QUERY`: #5907's aggregate-door precedent
   * (`undeclaredAggregateFunctionError`) is about a FUNCTION name outside the
   * spec enum — a query no backend could run. A missing column is not a
   * malformed query; the identical query answers rows the moment schema sync
   * runs. ⛔ And no code is minted: `INVALID_FIELD` is a standard-catalog
   * member (ADR-0112), already the write path's answer for an unknown column
   * at the REST boundary.
   *
   * `field` / `object` ride the error the way the ingress door's refusals
   * carry them, so `@objectstack/rest`'s `INVALID_FIELD` branch serves the
   * same enriched envelope whichever layer refused. Both are the caller's own
   * vocabulary — the column name equals a field their query spells, the
   * object name is the one they passed — so neither discloses anything the
   * caller did not write.
   */
  protected unresolvableAggregateColumnRefusal(
    object: string,
    column: string,
    namedBy: { inGroupBy: boolean; inAggregations: boolean },
    error: unknown,
  ): Error {
    // [#25521 cut 15] The body moved to `sql-driver-read-exit-fault.ts` (see `ReadExitFaultHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof unresolvableAggregateColumnRefusal> = {
      get logger() { return readLogger(); },
    };
    return unresolvableAggregateColumnRefusal.call(host, object, column, namedBy, error);
  }

  // ===================================
  // Distinct
  // ===================================

  /**
   * Distinct values of one field, optionally constrained.
   *
   * The third argument is a **bare {@link FilterCondition}** — the same value
   * `find()` carries under `query.where`, NOT a query envelope. The body has
   * always said so (`applyFilters(builder, filters)` is handed the argument
   * itself, never a `.where` off it); `filters?: any` simply left that sentence
   * out of the type, and #6320 measured what the omission costs.
   *
   * What the annotation actually buys, measured rather than assumed (#6320):
   *
   * - **A truthy SCALAR no longer compiles.** `distinct('orders', 'product',
   *   'completed')` used to type-check and RESOLVE the *unfiltered* set —
   *   `applyFilters` emits no predicate for a non-object, non-array `where`
   *   (see the closing comment there). That silent widening is the family
   *   #6320/#5234 are about, and it is what this narrowing removes.
   * - **A query envelope still compiles, and that is not fixable here.**
   *   `FilterCondition` is an open map (`[key: string]: any`) because a filter
   *   key is a *field name*, so `{ object, where }` is structurally a perfectly
   *   good filter — one that constrains columns named `object` and `where`.
   *   No type can separate it from a legitimate filter. It is caught at
   *   RUNTIME instead, loudly: `INVALID_FILTER` / 400 out of
   *   {@link assertCompilableComparand}, because the envelope's `where` value
   *   is an object and no comparand may be. `driver-memory`'s half of that
   *   asymmetry (a bare filter there returns the unfiltered set in silence)
   *   stays open; the #5499 freeze that explained it dissolved 2026-08-11 and
   *   nothing has claimed it since. This driver's half never was silent.
   *
   * Held by `sql-driver-distinct-filter-narrowing.test.ts`.
   */
  distinct(object: string, field: string, filters?: FilterCondition, options?: DriverOptions): Promise<any[]> {
    // [#29520 codemod] The body moved to `sql-driver-distinct.ts` (see `DistinctHost`).
    return DistinctFacet.distinct.call(distinctHost.of(this), object, field, filters, options);
  }

  /**
   * [commit 9ccc4179e] Which envelope a dialect error leaving {@link SqlDriver.distinct}
   * deserves — the #8790 unresolvable-column refusal reaching the LAST read
   * door, without the attribution #8931 forbids.
   *
   * # The condition, and why the blanket arm stayed forbidden until now
   *
   * `find()` and `count()` answer an unresolvable WHERE column with
   * `INVALID_FILTER` / 400 naming the column (#8790, maintainer ruling
   * 2026-08-15: one unresolvable WHERE column, one answer, on both read
   * halves); #11541 brought the same answer to `aggregate()`. `distinct()` was
   * the fourth call shape and the one still answering `DATABASE_ERROR` / 500
   * — a SERVER fault for a caller's own typo, one door away from a 400 that
   * names the column. Measured on better-sqlite3 and on live PostgreSQL 16.13,
   * one object with a single `title` column:
   *
   * ```
   * count(t,    { where: { nosuchcol: 1 } })  => INVALID_FILTER  400
   * find(t,     { where: { nosuchcol: 1 } })  => INVALID_FILTER  400
   * aggregate(t, { groupBy: ['nosuchcol'] })  => INVALID_FIELD   400
   * distinct(t, 'title', { nosuchcol: 1 })    => DATABASE_ERROR  500  ← this card
   * distinct(t, 'nosuchcol')                  => DATABASE_ERROR  500  ← this card
   * ```
   *
   * A BLANKET `isUnresolvableColumnError` arm is still refused, and commit 7c2c5aedd
   * wrote the reason at the door: this door names columns in TWO clauses — the
   * `field` being listed and the WHERE compiled from `filters` — so the WHERE
   * refusal's words ("Filter on 'x' names a column …") would tell the author of
   * `distinct(o, 'nosuchcol')`, who passed no filter at all, that their FILTER
   * was wrong. What this method adds is not a safer blanket arm; it is the
   * attribution that makes the blanket arm unnecessary.
   *
   * # The three arms — attribution comes from the CALLER'S OWN REQUEST
   *
   * The dialect names the column; it does not name the clause. The clause is
   * read off the request this driver just compiled, so every claim the refusal
   * makes is a fact about the caller's own call and never a guess from the
   * backend's prose:
   *
   * 1. the name EQUALS the `field` argument ⇒ a refusal naming the listed
   *    column ({@link SqlDriver.unresolvableDistinctColumnRefusal},
   *    `INVALID_FIELD` / 400);
   * 2. it does not ⇒ the statement's only remaining column sources are the
   *    WHERE compiled from `filters` and the tenant-scope predicate — both
   *    filters — so #8790's existing
   *    {@link SqlDriver.unresolvableFilterColumnRefusal} applies verbatim;
   * 3. {@link unresolvableColumnNameOf} answers `null` ⇒ the wording parsed by
   *    nothing. With no name there is no request lookup, so NO attribution is
   *    supportable — commit 7c2c5aedd's terminal envelope stands unchanged. ⛔ Reading
   *    `null` as license for the WHERE arm would attribute a clause on no
   *    evidence, which is arm 2's own justification inverted.
   *
   * ⭐ Arm 2 is the COMPLEMENT of arm 1, never a search of the `filters` AST for
   * the name, and that is load-bearing rather than economical. `FilterCondition`
   * nests (`$and` / `$or` / `$not`, `@objectstack/spec` `LOGICAL_OPERATORS`), so
   * a key scan has to walk every declared node shape, and every shape it failed
   * to walk would silently DOWNGRADE that filter's 400 back to the 500 this card
   * exists to remove — for `{ $or: [{ nosuchcol: 1 }] }`, the exact defect,
   * re-introduced one nesting level down and invisible to any pin written on a
   * flat filter. The complement needs no walker to be complete: the compiled
   * statement is `select distinct <field> from <table> where <filters + tenant
   * scope>`, and a column reference that is not the `field` can only have come
   * from a predicate. Pinned by
   * `sql-driver-17857-distinct-unresolvable-column-refusal.test.ts`.
   *
   * ⚠ Arm 1 is judged by EXACT name equality, the discipline #11541 set: a
   * suffix match ("`title.x` ends in `.x`") would attribute a dotted WHERE key
   * to the listed field — a false verdict about a clause that may be perfectly
   * fine — and inspecting the key for a `.` is #8371's axis besides. When the
   * caller names one missing column in BOTH clauses
   * (`distinct(o, 'nosuchcol', { nosuchcol: 1 })`), arm 1 wins and its claim is
   * still true: the listed field really is a column the table lacks.
   *
   * # No new dialect recognizer
   *
   * Both predicates this method consults ({@link isUnresolvableColumnError},
   * {@link unresolvableColumnNameOf}) are #8790's, shared with `find()`,
   * `count()` and `aggregate()`, untouched — the #8926 ruling's refusal of a
   * per-dialect clause parser applies here exactly as it did one door over.
   *
   * Returns the error rather than throwing it, the shape every sibling on this
   * path uses, so the call site spells its own `throw`.
   */
  protected distinctBackendFault(object: string, field: string, error: unknown, filters?: unknown): Error {
    // [#25521 cut 15] The body moved to `sql-driver-read-exit-fault.ts` (see `ReadExitFaultHost`).
    const host: ThisParameterType<typeof distinctBackendFault> = {
      backendStatementFault: (...a) => this.backendStatementFault(...a),
      unresolvableDistinctColumnRefusal: (...a) => this.unresolvableDistinctColumnRefusal(...a),
      unresolvableFilterColumnRefusal: (...a) => this.unresolvableFilterColumnRefusal(...a),
    };
    return distinctBackendFault.call(host, object, field, error, filters);
  }

  /**
   * [commit 9ccc4179e] Compose the refusal for the LISTED field of a distinct read whose
   * column the backend could not resolve, writing the dialect's own message to
   * the SERVER LOG on the way — the same diagnostic-to-log, name-to-caller split
   * {@link SqlDriver.unresolvableFilterColumnRefusal} performs for the WHERE
   * (#7929: the dialect text inlines the statement's bound literals on two of
   * the three dialects, so it may not travel to the caller). [#21385] The log
   * line takes the same cut as the WHERE's: no statement, no bound literal.
   *
   * # `INVALID_FIELD` / 400 — read off the repo, not chosen
   *
   * No code is minted (ADR-0112): `INVALID_FIELD` is a standard-catalog member
   * and is already this repo's answer for a named column an object does not
   * have — `assertGroupByFieldsExist` / `assertAggregationFieldsExist`
   * (`@objectstack/metadata-protocol`, #4254) at the protocol ingress, the
   * write path at the REST boundary, and
   * {@link SqlDriver.unresolvableAggregateColumnRefusal} (#11541) for this
   * condition's aggregate twin. One condition must not carry two codes
   * depending on which door asked, which is the whole of #8790's ruling.
   *
   * ⛔ Not `INVALID_FILTER`: the caller may have passed no filter at all, and
   * that misattribution is what #8931 refuses. ⛔ Not `INVALID_QUERY`: a
   * missing column is not a malformed query — the identical call answers
   * values the moment schema sync runs. ⛔ Not the `DATABASE_ERROR` terminal:
   * the failure IS attributable here, to a column the caller named.
   *
   * # Why refusal beats the empty list
   *
   * The wrong answer this refusal displaces is specific: `[]`. A picklist
   * populated from `distinct()` renders an empty dropdown for a field name
   * that does not exist, which looks like "no values yet" and is
   * indistinguishable from a correct answer — the #8790 reasoning
   * ("can only match zero records") applied to VALUES instead of rows.
   *
   * `field` / `object` ride the error the way the ingress door's refusals carry
   * them, so `@objectstack/rest`'s `INVALID_FIELD` branch serves the same
   * enriched envelope whichever layer refused. Both are the caller's own
   * vocabulary — the column name equals the argument they passed, the object
   * name is the one they passed — so neither discloses anything the caller did
   * not write.
   */
  protected unresolvableDistinctColumnRefusal(object: string, column: string, error: unknown): Error {
    // [#25521 cut 15] The body moved to `sql-driver-read-exit-fault.ts` (see `ReadExitFaultHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof unresolvableDistinctColumnRefusal> = {
      get logger() { return readLogger(); },
    };
    return unresolvableDistinctColumnRefusal.call(host, object, column, error);
  }

  // ===================================
  // Window Functions
  // ===================================

  /**
   * The one live window-function door (#4286): not on `IDataDriver`, callable
   * directly on a SQL driver instance. Takes {@link SqlWindowFunctionQuery} —
   * the contract query shape plus this driver's private `windowFunctions`
   * array — so `where` / `orderBy` / `limit` / `offset` are checked here
   * exactly as they are on `find()`, instead of being erased along with the
   * driver-private part (#6212).
   */
  findWithWindowFunctions(object: string, query: SqlWindowFunctionQuery, options?: DriverOptions): Promise<any[]> {
    // [#29520 codemod] The body moved to `sql-driver-window-functions.ts` (see `WindowFunctionsHost`).
    return WindowFunctionsFacet.findWithWindowFunctions.call(windowFunctionsHost.of(this), object, query, options);
  }

  // ===================================
  // Query Plan Analysis
  // ===================================

  /**
   * IDataDriver standard: analyze query performance.
   *
   * [#15267] Declared as `IDataDriver.explain()` declares it: `unknown` — a
   * query plan's shape is the dialect's, and the contract's own `unknown` says
   * so. The annotation used to be an explicit `Promise<any>`, which erased that
   * `unknown` on the class; pinned by
   * `sql-driver-doors-declared-types.test.ts`. {@link analyzeQuery}, the
   * off-contract helper it forwards to, keeps its own annotation — it is not an
   * `IDataDriver` door and is out of that card's scope.
   */
  explain(object: string, query: DriverQuery, options?: DriverOptions): Promise<unknown> {
    // [#29520 codemod] The body moved to `sql-driver-query-plan.ts` (see `QueryPlanHost`).
    return QueryPlanFacet.explain.call(queryPlanHost.of(this), object, query, options);
  }

  /**
   * `explain()`'s implementation, and the only other caller of it. It reads
   * `fields` / `where` / `orderBy` / `limit` / `offset` — every one of them a
   * `DriverQuery` member — so it takes `DriverQuery`, which is what `explain()`
   * already declared and forwarded here (#6212).
   */
  analyzeQuery(object: string, query: DriverQuery, options?: DriverOptions): Promise<any> {
    // [#29520 codemod] The body moved to `sql-driver-query-plan.ts` (see `QueryPlanHost`).
    return QueryPlanFacet.analyzeQuery.call(queryPlanHost.of(this), object, query, options);
  }

  // ===================================
  // Schema Sync (syncSchema / init)
  // ===================================

  syncSchema(object: string, schema: unknown, _options?: DriverOptions): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-schema-sync-section.ts` (see `SchemaSyncSectionHost`).
    return SchemaSyncSectionFacet.syncSchema.call(schemaSyncSectionHost.of(this), object, schema, _options);
  }

  dropTable(object: string, _options?: DriverOptions): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-schema-sync-section.ts` (see `SchemaSyncSectionHost`).
    return SchemaSyncSectionFacet.dropTable.call(schemaSyncSectionHost.of(this), object, _options);
  }

  /**
   * Reclaim free pages after bulk deletions (ADR-0057 §3.4). On SQLite this
   * runs `PRAGMA incremental_vacuum` TO COMPLETION, returning every freelist
   * page — it pairs with the `auto_vacuum=INCREMENTAL` default set in
   * {@link connect} (files created before that default need one full `VACUUM`
   * to adopt it). Postgres/MySQL manage space via their own vacuum/purge
   * machinery, so this is a no-op there.
   *
   * "To completion" is a property of how the statement is STEPPED, not of its
   * text. SQLite's incremental-vacuum program frees one page per step and
   * yields a column-less result row for it, so a caller that steps once frees
   * one page. knex's better-sqlite3 client runs a statement that declares no
   * result columns with `Statement.run()`, which steps it once: through
   * `knex.raw` one call freed ONE page (freelist 300 → 299, read from a second
   * connection). An explicit page count, `incremental_vacuum(N)`, freed one
   * page too — the count is a ceiling, not what stops the loop. So that binding
   * is driven through its own `exec()`, which steps every statement until
   * SQLite reports done (300 → 0). sql.js needs nothing: `driver-sqlite-wasm`'s
   * dialect already iterates every row a PRAGMA yields (300 → 0 through the
   * `knex.raw` below). knex's node-sqlite3 client runs a raw statement with
   * `Database.all()`, which reads every row too (read from knex's source; that
   * binding is not installed in this repository).
   *
   * On better-sqlite3 the freed bytes also leave the `-wal` sidecar, which is
   * what a file-backed database in WAL mode (the default, see
   * {@link applySqliteJournalMode}) needs — see `reclaimBetterSqlite3`.
   */
  reclaimSpace(_options?: DriverOptions): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-schema-sync-section.ts` (see `SchemaSyncSectionHost`).
    return SchemaSyncSectionFacet.reclaimSpace.call(schemaSyncSectionHost.of(this), _options);
  }

  // ── Data-lifecycle rotation (ADR-0057 P2) ─────────────────────────────────
  //
  // High-frequency telemetry declared with `lifecycle.storage.strategy =
  // 'rotation'` is physically time-sharded: writes land in the CURRENT shard
  // table (`<table>__r<key>`), reads go through a UNION ALL view named after
  // the base table (so every query path is unchanged), and expiry is an O(1)
  // `DROP TABLE` of the oldest shard — real space reclamation with no
  // row-by-row delete (the ServiceNow Table Rotation model, ADR-0057 §3.3).
  //
  // The view is READ-ONLY by design (SQLite views reject writes and don't
  // support RETURNING): the driver redirects every write path shard-wise
  // instead — inserts to the current shard; by-id updates/deletes probe each
  // live shard; bulk updates/deletes fan out and sum. SQLite-only
  // ({@link supportsRotation}); on other dialects the LifecycleService falls
  // back to an age-based reap, so the declared bound holds everywhere — only
  // the reclamation mechanics differ.

  /** table → live rotation state (shard names newest-first + write target). */
  protected rotationStateByTable = new Map<string, { shards: string[]; current: string }>();

  get supportsRotation(): boolean {
    return this.isSqlite;
  }

  /** Live shard set (newest first) when `object` is rotation-managed. */
  protected rotationShardsOf(object: string): string[] | undefined {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return RotationFacet.rotationShardsOf.call(rotationHost.of(this), object);
  }

  /** The shard new rows land in when `object` is rotation-managed. */
  protected rotationWriteTarget(object: string): string | undefined {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return RotationFacet.rotationWriteTarget.call(rotationHost.of(this), object);
  }

  /**
   * Shard key for an instant: `day` → UTC `YYYYMMDD`, `week` → the UTC
   * Monday's `YYYYMMDD`, `month` → `YYYYMM`. Keys of one unit sort
   * lexicographically = chronologically, which `ensureRotation` relies on.
   */
  protected rotationShardKey(nowMs: number, unit: 'day' | 'week' | 'month'): string {
    // [#25521 cut 17] The body moved to `sql-driver-schema-sync.ts`; it reads no member of the driver.
    return rotationShardKey(nowMs, unit);
  }

  /**
   * Public Rotator entry point (called by the LifecycleService each sweep and
   * by {@link initObjects} at boot). Idempotent: ensures the current shard +
   * read view exist, adopts a legacy pre-rotation base table as the current
   * shard, column-syncs every retained shard so the UNION stays uniform, and
   * drops shards past the `shards × unit` window.
   */
  rotateShards(
    objectDef: { name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[]; lifecycle?: any },
    nowMs?: number,
  ): Promise<{ object: string; current: string; shards: string[]; dropped: string[] }> {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return RotationFacet.rotateShards.call(rotationHost.of(this), objectDef, nowMs);
  }

  protected ensureRotation(
    tableName: string,
    obj: { name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[] },
    policy: { shards: number; unit: 'day' | 'week' | 'month' },
    nowMs?: number,
  ): Promise<{ object: string; current: string; shards: string[]; dropped: string[] }> {
    // [#25521 cut 17] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readKnex = () => this.knex;
    const readLogger = () => this.logger;
    const readRotationStateByTable = () => this.rotationStateByTable;
    const host: ThisParameterType<typeof ensureRotation> = {
      aliasShardBookkeeping: (...a) => this.aliasShardBookkeeping(...a),
      ensureShardTable: (...a) => this.ensureShardTable(...a),
      get knex() { return readKnex(); },
      get logger() { return readLogger(); },
      rotationColumnList: (...a) => this.rotationColumnList(...a),
      rotationShardKey: (...a) => this.rotationShardKey(...a),
      get rotationStateByTable() { return readRotationStateByTable(); },
    };
    return ensureRotation.call(host, tableName, obj, policy, nowMs);
  }

  /**
   * [#12015] Say out loud which half of a declaration on a builtin column name
   * was discarded — and say nothing when nothing was.
   *
   * `id`, `created_at` and `updated_at` are emitted by the driver itself, so a
   * field an author DECLARES under one of those names never reaches
   * {@link createColumn}: its declared column shape is dropped. The driver is
   * right to own its primary key and audit stamps; the defect was that it
   * disagreed with the author in **silence**. Measured on live PostgreSQL
   * 16.13: an object declaring `id: { type: 'text' }` boots green and gets
   * `id varchar(255)` — `table.string('id')`, not TEXT — with nothing anywhere
   * recording that the declaration had been thrown away. Same substitution
   * measured here on SQLite, where a declared `maxLength` binds nothing either.
   *
   * # Why this fires on a SUBSET of collisions, and why that is the point
   *
   * Only the STORAGE half is discarded. The rest of the declaration — `label`
   * and its four generated locales, `readonly`, `searchable`, the ADR-0113
   * write contract in `required` — is honoured, on the platform's column
   * exactly as on any other. The first cut of this warning fired on every
   * collision and told the author "the declaration is NOT applied … remove the
   * declaration": measured at 116 lines on a stock boot of
   * `@objectstack/platform-objects` alone, where the dominant shape is
   * `id: Field.text({ label: 'Presence ID', required: true, readonly: true })`.
   * That sentence was **false** there, and following it would have deleted an
   * author-facing label for a column every list view shows.
   *
   * So the trigger is "asks for storage the platform's own column does not
   * deliver" ({@link undeliveredStorageAttributes}), the message names the
   * attributes rather than the declaration, and a presentation-only
   * declaration is silent. Maintainer ruling 2026-08-25, narrowing its own
   * earlier ruling on this card.
   *
   * ⛔ Still a diagnostic, NOT a rejection door, and NOT route C: the platform
   * still owns the column and the declaration still does not take effect. What
   * changed is what we SAY. Every object that booted before still boots.
   *
   * `phase` is part of the message because all THREE paths that drop such a
   * declaration carry this warning — create, the ADD COLUMN diff, and the
   * shard path — and a warning on one path with silence on the others just
   * moves the trap. Each phase is pinned separately, so a regression to a
   * silent `continue` on ONE path fails by name.
   */
  protected warnBuiltinColumnCollisions(
    tableName: string,
    fields: Record<string, any> | undefined,
    builtinColumns: ReadonlySet<string>,
    phase: 'create' | 'alter' | 'shard',
  ): string[] {
    // [#25521 cut 17] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof warnBuiltinColumnCollisions> = {
      get logger() { return readLogger(); },
    };
    return warnBuiltinColumnCollisions.call(host, tableName, fields, builtinColumns, phase);
  }

  /** Create/column-sync one physical shard table (mirrors the managed-table
   * branch of {@link initObjects}, scoped to a shard).
   *
   * Commit 7862fb711: `indexes` and `tenancy` are DECLARED here, on {@link ensureRotation}
   * and on {@link rotateShards}, because this leaf reads both off the object the
   * public entry point was handed — a shard carries the base table's declared
   * indexes (commit d0e3a885b) and must scope a `unique: 'organization'` index the same
   * way on every shard (ADR-0120 D1). Declaring them only here would leave the
   * two links above still narrowing the same value, so a caller spelling
   * `indexes` in a fresh literal to `rotateShards` would still be refused by a
   * type while the driver read the key regardless.
   *
   * `baseTable` is the table the shard belongs to — the key its tenancy record
   * is held under until {@link aliasShardBookkeeping} copies it across. It
   * defaults to `shardName` so an existing override or external caller keeps
   * today's behaviour, and the one in-tree call site names the base.
   */
  protected ensureShardTable(
    shardName: string,
    obj: { fields?: Record<string, any>; tenancy?: any; indexes?: any[] },
    baseTable: string = shardName,
  ): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return RotationFacet.ensureShardTable.call(rotationHost.of(this), shardName, obj, baseTable);
  }

  /** Quoted, deterministic column list for the rotation view. */
  protected rotationColumnList(obj: { fields?: Record<string, any> }): string {
    // [#25521 cut 17] The body moved to `sql-driver-schema-sync.ts`; it reads no member of the driver.
    return rotationColumnList(obj);
  }

  /**
   * Point every per-table bookkeeping map (read coercion, JSON/boolean
   * columns, tenant scope, timestamp stamping) for a shard at the base
   * table's entries, so a builder targeting a shard behaves exactly like one
   * targeting the view.
   */
  protected aliasShardBookkeeping(base: string, shard: string): void {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return RotationFacet.aliasShardBookkeeping.call(rotationHost.of(this), base, shard);
  }

  /**
   * Resolve the per-table tenant-isolation column for a schema, honoring an
   * explicit tenancy opt-out. Single source of truth for both {@link initObjects}
   * and {@link registerExternalObject} (they previously inlined this logic and
   * drifted).
   *
   * Precedence:
   *  1. `tenancy.enabled === false` → `null` (NO driver-level org scope), even
   *     when the object carries an `organization_id` column. Platform-global
   *     objects (e.g. `sys_license`) keep an optional, often-NULL org FK but must
   *     NOT be tenant-scoped: otherwise an authenticated caller's active-org
   *     `DriverOptions.tenantId` injects `WHERE organization_id = <org>` and every
   *     NULL-org / cross-org row silently disappears (the platform admin then
   *     reads zero licenses while an unscoped/anonymous read still sees them).
   *     The declarative branch below already respected `enabled !== false`; the
   *     implicit `organization_id` fallback did not — this closes that gap.
   *  2. Declared `tenancy.tenantField` (when that field exists on the object).
   *  3. Implicit `organization_id` column detection (legacy objects whose
   *     multi-tenant column was injected by the kernel without a spec migration).
   */
  protected computeTenantField(schema: { fields?: Record<string, any>; tenancy?: any }): string | null {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts`.
    return RotationFacet.computeTenantField(schema);
  }

  /**
   * {@link computeTenantField} + maintenance of the sticky explicit-opt-out
   * record (#3249). Key by the same key the caller uses for
   * `tenantFieldByTable` (table name in `initObjects`, object name in
   * `registerExternalObject` — {@link resolveTenantField} checks both).
   *
   * A schema that carries a `tenancy` declaration is authoritative: it sets or
   * clears the opt-out and is computed normally. A schema WITHOUT one (partial
   * re-registration — e.g. the lifecycle archive path passes only
   * `{ name, fields }` to `syncSchema`) preserves a previously declared
   * opt-out instead of letting the implicit `organization_id` heuristic
   * re-scope a platform-global table.
   */
  protected computeAndRecordTenantField(
    key: string,
    schema: { fields?: Record<string, any>; tenancy?: any },
  ): string | null {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return RotationFacet.computeAndRecordTenantField.call(rotationHost.of(this), key, schema);
  }

  /**
   * Batch-initialise tables from an array of object definitions.
   */
  /**
   * DDL-free metadata registration for a federated (external) object — the
   * read-path counterpart to {@link initObjects} (ADR-0015 federation).
   *
   * `initObjects` is gated by `assertSchemaMutable` and therefore throws for
   * any non-`managed` driver, which left external objects with NO read-coercion
   * metadata and the query path resolving to a table named after the object
   * instead of its remote table. This populates the same coercion maps (keyed
   * by OBJECT name, matching formatInput/formatOutput/coerceFilterValue) and
   * records the physical remote table (`external.remoteName`, optionally
   * `external.remoteSchema`) so {@link getBuilder} targets it — WITHOUT running
   * any DDL (createTable/alterTable/columnInfo). Keep the field-classification
   * below in sync with initObjects() if the field-type -> storage mapping changes.
   */
  registerExternalObject(schema: {
    name: string;
    fields?: Record<string, any>;
    tenancy?: any;
    external?: { remoteName?: string; remoteSchema?: string; columnMap?: Record<string, string> };
  }): void {
    // [#25521 cut 17] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readAutoNumberFields = () => this.autoNumberFields;
    const readBooleanFields = () => this.booleanFields;
    const readColumnFieldByObject = () => this.columnFieldByObject;
    const readDateFields = () => this.dateFields;
    const readDatetimeFields = () => this.datetimeFields;
    const readFieldColumnByObject = () => this.fieldColumnByObject;
    const readFractionalNumericFields = () => this.fractionalNumericFields;
    const readIsSqlite = () => this.isSqlite;
    const readJsonFields = () => this.jsonFields;
    const readLogger = () => this.logger;
    const readMediaFields = () => this.mediaFields;
    const readNumericFields = () => this.numericFields;
    const readNumericValueFields = () => this.numericValueFields;
    const readObjectByPhysicalTable = () => this.objectByPhysicalTable;
    const readPhysicalSchemaByObject = () => this.physicalSchemaByObject;
    const readPhysicalTableByObject = () => this.physicalTableByObject;
    const readTenantFieldByTable = () => this.tenantFieldByTable;
    const readTimeFields = () => this.timeFields;
    const readValueShapeFields = () => this.valueShapeFields;
    const host: ThisParameterType<typeof registerExternalObject> = {
      get autoNumberFields() { return readAutoNumberFields(); },
      get booleanFields() { return readBooleanFields(); },
      get columnFieldByObject() { return readColumnFieldByObject(); },
      computeAndRecordTenantField: (...a) => this.computeAndRecordTenantField(...a),
      get dateFields() { return readDateFields(); },
      get datetimeFields() { return readDatetimeFields(); },
      get fieldColumnByObject() { return readFieldColumnByObject(); },
      get fractionalNumericFields() { return readFractionalNumericFields(); },
      isJsonField: (...a) => this.isJsonField(...a),
      get isSqlite() { return readIsSqlite(); },
      get jsonFields() { return readJsonFields(); },
      get logger() { return readLogger(); },
      get mediaFields() { return readMediaFields(); },
      get numericFields() { return readNumericFields(); },
      get numericValueFields() { return readNumericValueFields(); },
      get objectByPhysicalTable() { return readObjectByPhysicalTable(); },
      get physicalSchemaByObject() { return readPhysicalSchemaByObject(); },
      get physicalTableByObject() { return readPhysicalTableByObject(); },
      get tenantFieldByTable() { return readTenantFieldByTable(); },
      get timeFields() { return readTimeFields(); },
      get valueShapeFields() { return readValueShapeFields(); },
    };
    return registerExternalObject.call(host, schema);
  }

  /**
   * Register one MANAGED object's in-memory metadata — and run no DDL.
   *
   * Everything the write and read paths need to encode a value correctly is
   * installed here: the JSON / boolean / numeric / date / datetime / time
   * coercion registries, the auto_number descriptors, the tenant-isolation
   * column, and the `managedObjectFields` / `managedObjectIndexes` entries
   * drift detection diffs against. {@link SqlDriver.initObjects} calls it as
   * its first step and then issues DDL; {@link registerObjectMetadata} calls
   * it and stops.
   *
   * @returns the physical table name registered, and the tenant column
   *          {@link computeAndRecordTenantField} resolved for it — both of
   *          which `initObjects` goes on to use for its DDL.
   */
  protected registerManagedObjectMetadata(
    obj: { name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[] },
  ): { tableName: string; tenantField: string | null } {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return RotationFacet.registerManagedObjectMetadata.call(rotationHost.of(this), obj);
  }

  /**
   * Install the read/write metadata for MANAGED objects WITHOUT running DDL —
   * the managed sibling of {@link SqlDriver.registerExternalObject}.
   *
   * ## Why this exists as its own entry point
   *
   * Until this method, the ONLY way to tell this driver a managed object's
   * field types was {@link initObjects} / `syncSchema()` — which also runs
   * CREATE TABLE / ALTER TABLE. A deployment that manages DDL out-of-band
   * (`skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1`, the documented posture after
   * running migrations manually) therefore booted with EVERY coercion
   * registry empty, and value encoding silently degraded to whatever the
   * underlying client does with a bare JS value.
   *
   * On Postgres that is not a cosmetic difference. `formatInput` stringifies a
   * JSON field ONLY when the field is in `jsonFields`; with the registry empty
   * the value reaches node-postgres, whose per-type defaults are:
   *
   *  - object -> JSON text (accidentally correct);
   *  - array  -> a Postgres ARRAY LITERAL (`{…}`) -> `22P02 invalid input
   *    syntax for type json` -> 500, **except `[]`, whose literal `{}` is
   *    valid JSON**, so an empty array is accepted and silently stored as an
   *    empty OBJECT — data corruption, not an error;
   *  - bare string -> passed raw -> not valid JSON text -> 500 (a number
   *    survives because `42` already is valid JSON).
   *
   * SQLite never showed it: `formatInput` ends with a bind-safety net that
   * stringifies any leftover object/array on that dialect, so the same empty
   * registry is invisible there — which is why the SQLite/Turso suites are
   * blind to this and every Postgres deployment inherited it.
   *
   * Registration is the DDL-free half, so it is safe on any datasource and on
   * any boot: no `assertSchemaMutable` gate (nothing here mutates a schema),
   * no `ensureDatabaseExists` probe, no round-trip at all. That is what makes
   * it affordable on exactly the cold-start-sensitive boots `skipSchemaSync`
   * exists to protect: it costs one pass over the object list, in memory.
   *
   * It is the same ruling #7737 already made for FEDERATED objects (commit 199ec4712) —
   * `OS_SKIP_SCHEMA_SYNC` is about DDL, and a binding that is DDL-free must
   * not ride on it — extended to the managed ones.
   *
   * Idempotent: pure metadata assignment, safe to re-drive on every reload.
   */
  registerObjectMetadata(
    objects: Array<{ name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[] }>,
  ): void {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return RotationFacet.registerObjectMetadata.call(rotationHost.of(this), objects);
  }

  // `tenancy` is part of what this method READS — each object flows into
  // `computeAndRecordTenantField`, which consumes `obj.tenancy` to pick the
  // tenant column and to set or clear the sticky explicit-opt-out. It went
  // undeclared here until #4311 (`registerExternalObject` and
  // `computeAndRecordTenantField` both had it), so a caller spelling the key
  // correctly was rejected by the type while the driver read it regardless.
  //
  // `indexes` is the same story, one key over, and it went undeclared here for
  // longer: `registerManagedObjectMetadata` fills `managedObjectIndexes` from
  // it, and that map is what `syncDeclaredIndexes` renders every declared
  // UNIQUE from — so the whole index-sync path was driven by a key this
  // signature said did not exist, reached through an `as any`. The sibling
  // `detectManagedDrift` on this class had always declared it, so the two
  // halves disagreed about the shape of the same input. Nothing tripped over
  // it because TypeScript's excess-property check fires on a FRESH object
  // literal and not on one bound to a variable first, and every caller here
  // happened to bind first — a green that held for a reason unrelated to
  // correctness. `src/sql-driver-16570-init-objects-indexes-param.test.ts`
  // pins the fresh-literal form so it cannot silently go back.
  //
  // `lifecycle` was the third instance, and the one that made the card behind commit 7862fb711 file the
  // CLASS rather than a fourth single-key card: the loop below reads
  // `obj.lifecycle?.storage` to decide whether a table is time-sharded, while
  // the sibling `rotateShards` on this same class had always declared the key.
  // Dropping it does not fail — it leaves the ADR-0057 rotation policy unarmed,
  // silently, exactly as dropping `indexes` leaves a declared UNIQUE unsynced.
  // `scripts/check-object-def-param-keys.mjs` now holds the whole class,
  // including the half no in-file gate could see: a SUBCLASS in another
  // published package overriding one of these methods with a narrower literal
  // (`TursoDriver.initObjects` shadowed #4311's `tenancy` fix for five weeks).
  initObjects(
    objects: Array<{ name: string; fields?: Record<string, any>; tenancy?: any; indexes?: any[]; lifecycle?: any }>,
  ): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return RotationFacet.initObjects.call(rotationHost.of(this), objects);
  }

  /**
   * Converge one table's `Field.datetime` columns on the canonical UTC-text
   * storage form (#3912), then mark them clean so the read paths can drop their
   * repair expression.
   *
   * SQLite only, and this is the whole reason the convention is affordable.
   * Postgres/MySQL store a real temporal type, so their rows are already one
   * shape — there is nothing on disk to rewrite. (What Postgres CANNOT recover is
   * an instant written from a zone-naive string before this change: it was
   * resolved against the server's timezone at write time and the original wall
   * clock is gone. `formatInput` stops producing those going forward; existing
   * rows are simply the instants the server recorded.)
   *
   * ONE `UPDATE` per column, whose SET expression is the very same
   * {@link sqliteCanonicalDatetimeSql} the read paths use — so "what canonical
   * means" has a single definition and the migration cannot drift from the repair
   * it retires. It converts every non-canonical shape in one pass: INTEGER/REAL
   * epoch ms, zone-naive `CURRENT_TIMESTAMP` output, an offset-bearing `+08:00`
   * value, a bare `YYYY-MM-DD`.
   *
   * `col IS NOT <canonical>` is the whole `WHERE`. `IS NOT` rather than `<>`
   * because it is null-safe AND type-aware: an INTEGER value is never equal to
   * the text the expression yields, so epoch rows match; an already-canonical
   * string equals it exactly and is skipped. A value SQLite cannot parse falls
   * through the expression's `coalesce` unchanged, compares equal to itself, and
   * is left alone rather than destroyed. So a converged table costs one scan and
   * zero writes, and re-running is a no-op.
   *
   * ## The one shape `coalesce` does NOT preserve, and what happens to it (#6009)
   *
   * "A value SQLite cannot parse falls through the `coalesce`" is true of
   * everything except the julian-day limb of SQLite's time-value grammar (and
   * its `now` keyword): for a bare-numeric TEXT cell `strftime` returns a
   * confident wrong answer instead of NULL, so `coalesce` never fires and this
   * `UPDATE` would write `-4707-06-11T12:00:00.000Z` over a stored `'2026'`,
   * irrecoverably. {@link sqliteNonTemporalTextSql} is the structural
   * complement of the parseable spellings; rows it matches are excluded from
   * the `UPDATE` and left exactly as they are, which is what the paragraph
   * above already promises for every other uninterpretable value.
   *
   * ⭐ **A withheld row also blocks the canonical mark, and that is the half
   * that keeps query answers identical.** Skipping a row costs nothing while
   * the read-side repair is still applied to it — it keeps reading as the same
   * (wrong) instant it read as before, so no query answer moves. Marking the
   * column clean is what would move one: `needsLegacyDatetimeRepair` would then
   * drop the repair and the raw `'2026'` would be compared as TEXT. Unlike the
   * `coalesce` fixpoints, these rows are NOT invariant under the repair, so
   * they cannot ride through the mark the way genuinely unparseable junk does.
   * The column therefore stays un-marked, the reads keep their (unindexed)
   * repair, and the answers are bit-for-bit what they were before this method
   * ran — the same degradation a failed `UPDATE` already takes.
   *
   * Failures are logged and swallowed: the column simply stays un-marked, the
   * read paths keep their repair, and queries stay CORRECT (just unindexed). A
   * migration that cannot run must never be able to take the process down at
   * boot, and correctness must never be contingent on one having run. The
   * #6009 probe runs BEFORE the `UPDATE` for the same reason: a gate that could
   * not be measured must stop the write, not wave it through.
   */
  protected backfillCanonicalDatetimes(table: string, tableExisted: boolean): Promise<void> {
    // [#25521 cut 12] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readCanonicalDatetimeFields = () => this.canonicalDatetimeFields;
    const readDatetimeFields = () => this.datetimeFields;
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof backfillCanonicalDatetimes> = {
      get canonicalDatetimeFields() { return readCanonicalDatetimeFields(); },
      countNonTemporalTextRows: (...a) => this.countNonTemporalTextRows(...a),
      get datetimeFields() { return readDatetimeFields(); },
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
      get logger() { return readLogger(); },
      sqliteCanonicalDatetimeSql: (...a) => this.sqliteCanonicalDatetimeSql(...a),
      sqliteNonTemporalTextSql: (...a) => this.sqliteNonTemporalTextSql(...a),
    };
    return backfillCanonicalDatetimes.call(host, table, tableExisted);
  }

  /**
   * How many not-yet-canonical rows of `table.field` the #6009 guard withholds
   * from a temporal backfill's `UPDATE` — the count shared by
   * {@link backfillCanonicalDatetimes} and {@link backfillCanonicalTimes}, so
   * the two cannot end up asking the question two ways.
   *
   * The predicate is the migration's own `WHERE` with
   * {@link sqliteNonTemporalTextSql} ANDed on instead of negated, so what this
   * counts and what the `UPDATE` skips are one expression by construction. It
   * deliberately does NOT swallow its own failure: the caller's `catch` owns
   * that, and there the whole column is skipped — a gate that could not be
   * measured must stop the write rather than wave it through.
   *
   * @param canonicalSql the caller's canonical expression, spelling `??`
   * @param exprBindings one binding per `??` in `canonicalSql`
   */
  protected countNonTemporalTextRows(
    table: string,
    field: string,
    canonicalSql: string,
    exprBindings: string[],
  ): Promise<number> {
    // [#25521 cut 12] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof countNonTemporalTextRows> = {
      get knex() { return readKnex(); },
      sqliteNonTemporalTextSql: (...a) => this.sqliteNonTemporalTextSql(...a),
    };
    return countNonTemporalTextRows.call(host, table, field, canonicalSql, exprBindings);
  }

  /**
   * Converge one table's `Field.json` columns on the injective JSON-text
   * storage form (commit 4045b954d) — the `Field.json` twin of
   * {@link backfillCanonicalDatetimes}, built the same way for the same reasons.
   *
   * SQLite only. Postgres and MySQL never had the defect: their half of
   * `formatInput` has always been an unconditional `JSON.stringify`, so their
   * rows are already in this exact format and there is nothing on disk to
   * rewrite (measured 17/17 faithful on PG 16.13 and MySQL 8.0.46).
   *
   * ## What it converts, and the one class it converts
   *
   * The ONLY on-disk class the pre-fix encoding left unambiguous — a TEXT cell
   * the driver's JSON codec cannot parse. Nothing but a stored plain string
   * could have produced one: `JSON.stringify` of an object or an array always
   * parses, and every other input either stayed a primitive storage class or
   * already parses.
   *
   * ## SQL pre-filters, the codec decides (#19912)
   *
   * Which cell is rewritten, and into what, is {@link recoverUnencodedJsonText}
   * — the rule the Turso remote backfill imports too, so the two faces cannot
   * come to disagree about a cell. It asks `JSON.parse`, the same question
   * `formatOutput` asks of every json TEXT cell it reads, and answers the
   * `JSON.stringify` the write path stores.
   *
   * The SQL only narrows the scan: `typeof(col) = 'text' and json_valid(col) =
   * 0` selects the candidates, a page at a time in `rowid` order
   * ({@link SQLITE_JSON_BACKFILL_PAGE_SIZE}). It must not decide, because
   * SQLite's JSON parser and the driver's disagree in the dangerous direction:
   * `json_valid()` answers 0 for JSON nested past SQLite's depth limit (a
   * build-time constant; 1000 in the better-sqlite3, sql.js and libsql builds
   * this repository bundles) while `JSON.parse` reads it. The single `UPDATE …
   * set col = json_quote(col) where … json_valid(col) = 0` this method used to
   * run therefore quoted a correctly stored deep array into a string on the
   * next schema sync. Such a candidate is now left as stored and counted in
   * `rowsWithheld`.
   *
   * The pre-filter is a superset of what the rule rewrites, with one exception
   * in the safe direction: `json_valid()` stops at an embedded NUL, so a text
   * that is valid JSON up to a NUL is never selected and stays as stored.
   *
   * Each rewrite is a compare-and-set, `where rowid = ? and typeof(col) =
   * 'text' and col = <the text the decision read>`, so a value written between
   * the page read and the write is never overwritten. A page's writes commit as
   * one transaction. Because the new text is a function of the old text alone,
   * the compare-and-set also withholds, in the safe direction, a cell whose
   * stored bytes the engine does not read back verbatim (better-sqlite3 and
   * sql.js, the engines measured, read invalid UTF-8 back as U+FFFD): its
   * bytes are not what was read, so it is not written, and it keeps reading as
   * it did. On better-sqlite3 every other text round-trips byte-for-byte, and
   * `JSON.stringify` of it is byte-identical to the `json_quote()` this method
   * used to write (measured over every non-surrogate BMP code point).
   *
   * ⛔ **It does not guess, because the rest cannot be guessed.** Two classes are
   * left exactly as they are, and both are named here rather than discovered:
   *
   *  - **INTEGER/REAL cells** (`typeof` is not `'text'`). A number, a boolean,
   *    and a number-like string eaten by NUMERIC affinity are the SAME BYTES on
   *    disk — `123` the number and `'123'` the string are one INTEGER 123, and a
   *    boolean `true` is one INTEGER 1 alongside the number 1. No migration can
   *    know which was written, so this one asks nothing of them. This is the
   *    class the ruling accepts as unrecoverable: it stops growing (new writes
   *    encode injectively), it is not repaired.
   *  - **TEXT cells that DO parse.** A stored object `{"a":1}` and a stored
   *    STRING `'{"a":1}'` were byte-identical before this change, and both read
   *    back as the object under the pre-fix read path. Re-quoting them would
   *    turn every legacy object and array into a string — corrupting the common
   *    case to guess at the rare one. Left alone, they read after this change
   *    exactly as they read before it.
   *
   * ⇒ **This migration changes no read.** A legacy plain string reads back as
   * that string before it runs (via `formatOutput`'s parse fallback) and after
   * it runs (because `"…"` parses back to it). It is a canonicalisation that
   * makes the on-disk format uniform and injective going forward — so a string
   * written TOMORROW whose content is valid JSON is distinguishable from the
   * structure it looks like — not a repair of what reads wrong today.
   *
   * ## Idempotent by construction, not by convention
   *
   * The pre-filter is the exact complement of the rewrite's output:
   * `JSON.stringify` of a string is a quoted JSON string, for which
   * `json_valid()` is 1, so a converted row cannot be selected again. A
   * withheld cell is selected on every run and never written. Re-running costs
   * one scan, a read of the withheld cells, and zero writes — the same "a
   * converged table is a no-op" property {@link backfillCanonicalDatetimes}
   * has, and pinned the same way.
   *
   * ⚠️ An out-of-band reader of the SQLite file sees quoted JSON text where it
   * saw a bare value. That is the accepted cost of the format, recorded here so
   * it is read rather than discovered.
   *
   * Failures are logged and swallowed, exactly as in the datetime twin: the
   * rows simply stay in the legacy form, `formatOutput`'s parse fallback keeps
   * reading them correctly, and correctness never becomes contingent on a
   * migration having run. That also covers a SQLite build without the JSON
   * functions and a `skipSchemaSync` deployment that never reaches this path.
   * A failure part-way through a column leaves the committed pages converted
   * and the rest legacy — each cell reads the same either way, so nothing is
   * lost and `warn` is the level (AGENTS.md, degradation log levels).
   */
  protected backfillCanonicalJsonEncoding(table: string, tableExisted: boolean): Promise<void> {
    // [#25521 cut 12] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readIsSqlite = () => this.isSqlite;
    const readJsonFields = () => this.jsonFields;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof backfillCanonicalJsonEncoding> = {
      convergeJsonColumn: (...a) => this.convergeJsonColumn(...a),
      get isSqlite() { return readIsSqlite(); },
      get jsonFields() { return readJsonFields(); },
      get logger() { return readLogger(); },
    };
    return backfillCanonicalJsonEncoding.call(host, table, tableExisted);
  }

  /**
   * One column's pass for {@link backfillCanonicalJsonEncoding}: walk the
   * pre-filtered candidates a page at a time in `rowid` order, let
   * {@link recoverUnencodedJsonText} decide each, and compare-and-set the ones
   * it rewrites. Throws on a failed statement; `tally` then holds what the
   * committed pages did.
   */
  private convergeJsonColumn(
    table: string,
    field: string,
    tally: { converted: number; withheld: number },
  ): Promise<void> {
    // [#25521 cut 12] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof convergeJsonColumn> = {
      get knex() { return readKnex(); },
    };
    return convergeJsonColumn.call(host, table, field, tally);
  }

  /**
   * Converge one table's `Field.time` columns on the canonical time-of-day text
   * form (#3994) — the `Field.time` twin of {@link backfillCanonicalDatetimes},
   * built the same way for the same reasons.
   *
   * SQLite only: Postgres/MySQL store a native TIME, so their rows are already
   * one shape. ONE `UPDATE` per column whose SET expression IS
   * {@link sqliteCanonicalTimeSql} — the very expression the read paths use —
   * with the null-safe, type-aware `IS NOT` guard as the whole `WHERE`. It
   * converts INTEGER/REAL epoch ms, full-timestamp text (ISO or zone-naive) and
   * under-specified `HH:MM` in one pass; canonical rows compare equal and cost
   * nothing; unparseable values fall through the expression's `coalesce`
   * unchanged and are left alone.
   *
   * What it CANNOT repair, exactly like the datetime backfill: a wall clock the
   * old write path never recorded correctly. An epoch row folds to its UTC
   * time-of-day — the same answer reads have always given for it.
   *
   * It inherits the #6009 guard for the same reason and on the same terms: a
   * bare-numeric TEXT cell is read through SQLite's julian-day limb here too
   * (`'2026'` → `12:00:00`, `'now'` → the wall clock), so
   * {@link sqliteNonTemporalTextSql} withholds those rows from the `UPDATE`
   * and, because they are not fixpoints of the read-side repair, from the
   * canonical mark as well — see {@link backfillCanonicalDatetimes} for the
   * argument in full.
   *
   * Failures are logged and swallowed: the column stays un-marked, the read and
   * filter paths keep their repair expression, and queries stay correct (just
   * unindexed). A migration must never take boot down.
   */
  protected backfillCanonicalTimes(table: string, tableExisted: boolean): Promise<void> {
    // [#25521 cut 12] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readCanonicalTimeFields = () => this.canonicalTimeFields;
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const readLogger = () => this.logger;
    const readTimeFields = () => this.timeFields;
    const host: ThisParameterType<typeof backfillCanonicalTimes> = {
      get canonicalTimeFields() { return readCanonicalTimeFields(); },
      countNonTemporalTextRows: (...a) => this.countNonTemporalTextRows(...a),
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
      get logger() { return readLogger(); },
      sqliteCanonicalTimeSql: (...a) => this.sqliteCanonicalTimeSql(...a),
      sqliteNonTemporalTextSql: (...a) => this.sqliteNonTemporalTextSql(...a),
      get timeFields() { return readTimeFields(); },
    };
    return backfillCanonicalTimes.call(host, table, tableExisted);
  }

  /**
   * The `Field.datetime` (and audit) columns of `table` that MySQL still stores
   * as a legacy `TIMESTAMP`, with the nullability each must keep.
   *
   * Shared by {@link migrateMysqlDatetimeColumns}, which widens them, and
   * {@link previewDatetimeConvergence}, which reports them into `os migrate
   * plan` (#3954) — so what the plan lists and what apply does are the same set
   * by construction, not by two filters that agree today.
   *
   * `[]` on any dialect but MySQL, and on a table declaring no datetime column.
   */
  protected legacyMysqlTimestampColumns(
    table: string,
    fields: Record<string, any>,
  ): Promise<Array<{ name: string; nullable: boolean }>> {
    // [#25521 cut 12] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readIsMysql = () => this.isMysql;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof legacyMysqlTimestampColumns> = {
      get isMysql() { return readIsMysql(); },
      get knex() { return readKnex(); },
    };
    return legacyMysqlTimestampColumns.call(host, table, fields);
  }

  /**
   * Widen a table's legacy MySQL `TIMESTAMP` datetime columns to `DATETIME(3)`
   * (#3942) — the MySQL counterpart of {@link backfillCanonicalDatetimes}.
   *
   * `TIMESTAMP` cannot hold an instant past 2038-01-19 or before 1970, keeps no
   * milliseconds, and converts using the session timezone. `ALTER … MODIFY` moves
   * the column to `DATETIME(3)`, which has none of those properties. The instants
   * survive because the connection pins `@@session.time_zone` to UTC
   * ({@link withUtcSession}): MySQL renders each `TIMESTAMP` in the session zone
   * to produce the `DATETIME` wall clock, so UTC in gives the UTC wall clock the
   * driver's own writes use.
   *
   * Only the audit columns and declared `Field.datetime` columns are touched, and
   * only when they are still `timestamp` — so this is idempotent and re-running
   * costs one `information_schema` lookup.
   *
   * Failures are logged and swallowed, like the SQLite backfill and for the same
   * reason: a `TIMESTAMP` column keeps working (the driver binds the same UTC
   * wall-clock literal either way, and the session is pinned to UTC), it merely
   * keeps the range and precision limits. Correctness must not depend on a
   * migration having run, and a migration must never take boot down.
   */
  /**
   * [#9354] Run the deferred flush's MySQL widening ALTERs under a bounded
   * metadata-lock wait, on ONE pinned connection.
   *
   * # Why the connection has to be pinned
   *
   * `lock_wait_timeout` is a SESSION variable, and `this.knex.raw` takes
   * whatever connection the pool hands it. Issuing `SET SESSION …` through the
   * pool and the ALTER through the pool sets the bound on one connection and
   * runs the ALTER on another — a no-op that looks exactly like a fix, and that
   * a test can pass against by asserting the `SET` was merely emitted. A knex
   * transaction is this file's existing single-connection seam (it is how every
   * multi-statement unit here already holds one connection), so both statements
   * provably ride the same session. MySQL implicitly commits on DDL, which
   * costs nothing here: the transaction is being used for connection affinity,
   * not atomicity — an ALTER was never rollback-able on MySQL to begin with.
   *
   * # The prior value is restored
   *
   * The connection goes back to the pool afterwards and would otherwise carry
   * this bound into every later statement on it — a migration quietly changing
   * the lock behaviour of unrelated runtime work. The restore is best-effort:
   * it must never mask the refusal it runs alongside.
   *
   * # Armed on BOTH callers; only the flush escapes the swallow (commit 8bbf45947)
   *
   * The bound is armed unconditionally, because the year-long default is no
   * better for boot than it is for an operator: a boot blocked on another
   * session's metadata lock waits 31,536,000 seconds having printed nothing,
   * and boot is the path nobody can retry from a prompt. Bounding it turns
   * that into a bounded wait plus the widening's own durability log — which,
   * until the bound reached here, could never fire at all: the ALTER never
   * returned, so its catch never ran. #9609 raised that line from `warn` to
   * `error`; the level is the operator's only signal, and the swallow below is
   * exactly what makes an un-run ALTER invisible without it.
   *
   * What stays gated on {@link flushDeferredSchemaDdl} is the REFUSAL, and
   * only it. Boot still swallows: correctness never depends on the widening
   * having run, and a migration must never take boot down, so throwing here
   * would trade a silent hang for a failed boot — a worse answer, not the
   * same one. `this.isMysql` is therefore the only early return left; no other
   * dialect takes this lock, and `lock_wait_timeout` is MySQL's variable.
   */
  protected runWideningAlters(
    table: string,
    statements: ReadonlyArray<{ sql: string; bindings: unknown[] }>,
  ): Promise<void> {
    // [#25521 cut 12] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readFlushingDeferredDdl = () => this.flushingDeferredDdl;
    const readIsMysql = () => this.isMysql;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof runWideningAlters> = {
      get flushingDeferredDdl() { return readFlushingDeferredDdl(); },
      get isMysql() { return readIsMysql(); },
      get knex() { return readKnex(); },
      withPinnedSession: (...a) => this.withPinnedSession(...a),
    };
    return runWideningAlters.call(host, table, statements);
  }

  /**
   * [#9354] Hold one connection for the duration of `fn`, and give it a runner
   * that provably issues every statement on that connection.
   *
   * Its own method so the connection acquisition can be replaced in a test
   * without stubbing any of the bounding, recognition or refusal logic above —
   * the parts that must be exercised for real.
   */
  protected withPinnedSession<T>(
    fn: (run: (sql: string, bindings?: unknown[]) => Promise<unknown>) => Promise<T>,
  ): Promise<T> {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return (RotationFacet.withPinnedSession<T>).call(rotationHost.of(this), fn);
  }

  protected migrateMysqlDatetimeColumns(
    table: string,
    fields: Record<string, any>,
  ): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return RotationFacet.migrateMysqlDatetimeColumns.call(rotationHost.of(this), table, fields);
  }

  /**
   * The declared `Field.time` columns of `table` that MySQL still stores as a
   * zero-precision `TIME`, with the nullability each must keep. Shared by
   * {@link migrateMysqlTimeColumns} and {@link previewTimeConvergence} — the
   * plan and the migration are the same set by construction (#3954 pattern).
   */
  protected legacyMysqlTimeColumns(
    table: string,
    fields: Record<string, any>,
  ): Promise<Array<{ name: string; nullable: boolean }>> {
    // [#25521 cut 12] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readIsMysql = () => this.isMysql;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof legacyMysqlTimeColumns> = {
      get isMysql() { return readIsMysql(); },
      get knex() { return readKnex(); },
    };
    return legacyMysqlTimeColumns.call(host, table, fields);
  }

  /**
   * Widen a table's legacy MySQL `TIME` columns to `TIME(3)` (#3994) — the
   * `Field.time` twin of {@link migrateMysqlDatetimeColumns}.
   *
   * A zero-precision `TIME` does not truncate a fractional literal — it ROUNDS
   * it, so the canonical `'14:30:00.500'` would land as `14:30:01`: the write
   * path would be changing the wall clock it was asked to store. `TIME(3)`
   * keeps the milliseconds instead, matching the canonical form's resolution
   * and the `DATETIME(3)` precedent (#3942).
   *
   * Failures are swallowed for the usual reason; the only cost of a `TIME(0)`
   * column that could not be widened is second-rounding of fractional writes —
   * which is today's behaviour.
   *
   * # The level is `error`, and that is a separate question from the swallow (#9609)
   *
   * Swallow-vs-throw was adjudicated (commit 8bbf45947) and is unchanged: boot must not go
   * down over a migration. `warn`-vs-`error` was never separately decided, and
   * AGENTS.md → "Degradation log levels" decides it with one question — after
   * the degradation, does the system still look normal from the outside while
   * something it claims is persisted has not landed? Both halves hold: boot
   * completes and serves traffic, and its `error` limb names this case by name
   * ("DDL that was supposed to run did not"). Nothing else reports the column
   * as un-widened, so the level IS the signal. Same reasoning, same level, on
   * {@link migrateMysqlDatetimeColumns}.
   */
  protected migrateMysqlTimeColumns(
    table: string,
    fields: Record<string, any>,
  ): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-rotation.ts` (see `RotationHost`).
    return RotationFacet.migrateMysqlTimeColumns.call(rotationHost.of(this), table, fields);
  }

  // ── Deferred schema DDL (#3917) ────────────────────────────────────────────

  /**
   * Arm/disarm DDL deferral for {@link initObjects}.
   *
   * `os migrate plan` promises a dry run and `os migrate apply` promises a
   * confirmation prompt, but both booted the full plugin set first — and boot
   * schema-sync ran create-table / add-column DDL against the target database
   * *before* either promise was kept (#3917). With the deferral armed,
   * `initObjects` still registers all in-memory metadata (so drift detection
   * sees the same authoritative field set) but records the physical work
   * instead of performing it. {@link previewDeferredSchemaWork} renders it into
   * the plan; {@link flushDeferredSchemaDdl} performs it once the operator has
   * said yes.
   *
   * Off by default: every other boot (serve/dev/start) wants the additive sync
   * to run exactly as before.
   */
  setDeferredDdl(deferred: boolean): void {
    // [#29520 codemod] The body moved to `sql-driver-deferred-ddl.ts` (see `DeferredDdlHost`).
    return DeferredDdlFacet.setDeferredDdl.call(deferredDdlHost.of(this), deferred);
  }

  /** How many objects are waiting for {@link flushDeferredSchemaDdl}. */
  get deferredSchemaObjectCount(): number {
    return this.deferredSchemaObjects.size;
  }

  /**
   * Tables this driver created vs found already present since `connect()` —
   * the `IDataDriver.getSchemaSyncStats` contract. `existing === 0 &&
   * created > 0` is the platform's only observation that a datastore was
   * empty when this process reached it (#3438 / ADR-0104).
   */
  getSchemaSyncStats(): { created: number; existing: number } {
    // [#29520 codemod] The body moved to `sql-driver-deferred-ddl.ts` (see `DeferredDdlHost`).
    return DeferredDdlFacet.getSchemaSyncStats.call(deferredDdlHost.of(this));
  }

  /**
   * What the deferred sync *would* do, without doing it.
   *
   * Read-only: `hasTable` + `columnInfo` decide between create and alter (the
   * same two probes the additive sync uses), then
   * {@link previewDatetimeConvergence} asks whether the datetime storage steps
   * have anything left to do. Tables that already match metadata and hold
   * canonical data produce no entry, so an in-sync database returns `[]`.
   *
   * The convergence probe COUNTS rows, so this is more than metadata lookups on
   * a database that has not been migrated yet. That is the right trade for a
   * command the operator ran to be told the size of the job — and it is paid
   * once, by `plan`/`apply`, never on a normal boot.
   *
   * The obligation runs both ways (#3978). #3954 closed "the plan understates
   * what apply does"; this closes its mirror image — the plan must not promise
   * work apply CANNOT do. Only fields that materialize a column are listed,
   * decided by {@link fieldHasColumn}, the same helper `createColumn` and the
   * column differ use. A virtual `formula` field has no column, so listing it
   * produced an `add_columns` entry `apply` reported as performed without doing
   * anything and the next `plan` reported again: a finding no invocation could
   * ever clear, making a freshly-applied database look un-migrated.
   *
   * [#30636] One existing shape is not planned additively, because the sync
   * does not adopt it additively: a table keyed by `_id` with no `id` column.
   * It is planned as `initObjects` treats it — `rebuild_table` while empty,
   * `refuse_table` (with the refusal's text and the row count) while it holds
   * rows — never `add_columns`.
   */
  previewDeferredSchemaWork(): Promise<PendingSchemaWork[]> {
    // [#25521 cut 18] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readDeferredSchemaObjects = () => this.deferredSchemaObjects;
    const readKnex = () => this.knex;
    const readSupportsRotation = () => this.supportsRotation;
    const host: ThisParameterType<typeof previewDeferredSchemaWork> = {
      get deferredSchemaObjects() { return readDeferredSchemaObjects(); },
      get knex() { return readKnex(); },
      previewDatetimeConvergence: (...a) => this.previewDatetimeConvergence(...a),
      previewTimeConvergence: (...a) => this.previewTimeConvergence(...a),
      rotationShardKey: (...a) => this.rotationShardKey(...a),
      get supportsRotation() { return readSupportsRotation(); },
    };
    return previewDeferredSchemaWork.call(host);
  }

  /**
   * The datetime storage-convergence work {@link backfillCanonicalDatetimes} and
   * {@link migrateMysqlDatetimeColumns} would do for `table` — measured, not
   * performed (#3954).
   *
   * Both steps run inside `initObjects` alongside the create/alter path, so
   * `apply` performs them; without an entry here `plan` would show a two-column
   * change and `apply` would additionally rewrite every row of a datetime column
   * or rebuild one on a large table. The plan promises to show what apply does.
   *
   * Each probe reuses the very predicate its migration uses, so the preview
   * cannot claim work the migration will not do (or miss work it will):
   *   - SQLite counts rows matching `col IS NOT <canonical>` **and not**
   *     {@link sqliteNonTemporalTextSql} — the backfill's entire `WHERE`,
   *     #6009 exclusion included, so the plan does not promise to rewrite the
   *     julian-day rows the migration now deliberately leaves alone.
   *   - MySQL lists the candidate columns still typed `timestamp` — the
   *     migration's own `information_schema` filter.
   *
   * Failures are swallowed to `[]`, matching the migrations themselves: a probe
   * that cannot run must not fail the plan, and under-reporting here costs an
   * unlisted step rather than a wrong one.
   */
  protected previewDatetimeConvergence(
    table: string,
    fields: Record<string, any>,
    existingColumns: Set<string>,
  ): Promise<PendingSchemaWork[]> {
    // [#25521 cut 18] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readDatetimeFields = () => this.datetimeFields;
    const readIsMysql = () => this.isMysql;
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof previewDatetimeConvergence> = {
      get datetimeFields() { return readDatetimeFields(); },
      get isMysql() { return readIsMysql(); },
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
      legacyMysqlTimestampColumns: (...a) => this.legacyMysqlTimestampColumns(...a),
      sqliteCanonicalDatetimeSql: (...a) => this.sqliteCanonicalDatetimeSql(...a),
      sqliteNonTemporalTextSql: (...a) => this.sqliteNonTemporalTextSql(...a),
    };
    return previewDatetimeConvergence.call(host, table, fields, existingColumns);
  }

  /**
   * The `Field.time` storage-convergence work {@link backfillCanonicalTimes} and
   * {@link migrateMysqlTimeColumns} would do for `table` — measured, not
   * performed. The time twin of {@link previewDatetimeConvergence}, with the
   * same probe-reuses-the-migration's-predicate construction and the same
   * swallow-to-`[]` failure policy.
   */
  protected previewTimeConvergence(
    table: string,
    fields: Record<string, any>,
    existingColumns: Set<string>,
  ): Promise<PendingSchemaWork[]> {
    // [#25521 cut 18] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readIsMysql = () => this.isMysql;
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const readTimeFields = () => this.timeFields;
    const host: ThisParameterType<typeof previewTimeConvergence> = {
      get isMysql() { return readIsMysql(); },
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
      legacyMysqlTimeColumns: (...a) => this.legacyMysqlTimeColumns(...a),
      sqliteCanonicalTimeSql: (...a) => this.sqliteCanonicalTimeSql(...a),
      sqliteNonTemporalTextSql: (...a) => this.sqliteNonTemporalTextSql(...a),
      get timeFields() { return readTimeFields(); },
    };
    return previewTimeConvergence.call(host, table, fields, existingColumns);
  }

  /**
   * Run the deferred sync and disarm the deferral. Returns the work that was
   * outstanding (captured before the DDL ran, so the caller can report what it
   * just did). A no-op when nothing was deferred.
   *
   * [#30636] A `refuse_table` entry in that list is a table the sync refused
   * and left exactly as it was; it is not performed work, and the caller must
   * report it as refused. Its refusal stops nothing else: every other deferred
   * object still gets its DDL.
   */
  flushDeferredSchemaDdl(): Promise<PendingSchemaWork[]> {
    // [#29520 codemod] The body moved to `sql-driver-deferred-ddl.ts` (see `DeferredDdlHost`).
    return DeferredDdlFacet.flushDeferredSchemaDdl.call(deferredDdlHost.of(this));
  }

  // ── Managed-schema drift & reconcile (#2186) ───────────────────────────────

  /**
   * Canonical dialect name for the drift differ — and, since #15684, the one
   * answer to "which SQL does this driver speak" that anything outside the
   * driver may read.
   *
   * PUBLIC for exactly one consumer: `service-analytics` compiles its own
   * statements (an analytics `where`, an ADR-0021 D-C read scope, the
   * `/analytics/sql` echo) and executes them through this driver, so it needs
   * the same per-dialect construct choices {@link textMatchPredicate} makes —
   * a plain `LIKE` folds ASCII case on SQLite, which made a case-SENSITIVE
   * `$contains` admit rows the predicate excludes, over-reach (#3948) on the
   * read scope. That package depends on no driver and reads this structurally
   * through `IDataEngine.getDriverForObject`; exposing the getter is what
   * keeps the answer THIS driver's rather than a second dialect-resolution
   * table drifting one knex spelling behind {@link SQLITE_EMIT_CLIENTS} and
   * friends.
   *
   * Read-only and derived: there is nothing to set, and `'unknown'` is a real
   * answer (a client neither emission set names), not a missing one.
   */
  public get dialectName(): SqlDialectName {
    // [#29520 codemod] The body moved to `sql-driver-managed-drift.ts` (see `ManagedDriftHost`).
    return ManagedDriftFacet.dialectName.call(managedDriftHost.of(this));
  }

  /** True only when running under `NODE_ENV=production` — auto-DDL is force-disabled there. */
  protected isProductionEnv(): boolean {
    // [#29520 codemod] The body moved to `sql-driver-managed-drift.ts`.
    return ManagedDriftFacet.isProductionEnv();
  }

  /**
   * Diff one table's metadata (fields + indexes) against its physical schema.
   *
   * `declaredIndexes` is authoritative and complete: `undefined` means the
   * object declares none, NOT "look it up". Every caller already holds the
   * object it is diffing, and falling back to the last-synced set would make a
   * removed `indexes[]` undetectable as an orphan.
   */
  protected detectTableDrift(
    tableName: string,
    fields: Record<string, any>,
    declaredIndexes?: any[],
  ): Promise<ManagedDriftEntry[]> {
    // [#25521 cut 10] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readDialectName = () => this.dialectName;
    const readFileColumnsMoved = () => this.fileColumnsMoved;
    const host: ThisParameterType<typeof detectTableDrift> = {
      detectTableIndexDrift: (...a) => this.detectTableIndexDrift(...a),
      get dialectName() { return readDialectName(); },
      get fileColumnsMoved() { return readFileColumnsMoved(); },
      introspectColumns: (...a) => this.introspectColumns(...a),
      resolveTenantField: (...a) => this.resolveTenantField(...a),
      varcharColumnChars: (...a) => this.varcharColumnChars(...a),
    };
    return detectTableDrift.call(host, tableName, fields, declaredIndexes);
  }

  /**
   * Diff one table's expected index set against the physical one (#3728).
   *
   * Kept separate from {@link diffManagedTable} because it needs a second
   * introspection round-trip (indexes, not columns) and two inputs the column
   * differ has no use for: the object's declared `indexes[]` and its tenant
   * column.
   *
   * [ADR-0131 D1] `tenantColumnNotNull` and {@link isTenantKeyCertified} are
   * the two witnesses that the tenant column holds no NULL here, which is what
   * lets the differ read an earlier release's `COALESCE(<tenant>, …)` key part
   * as the plain column new DDL keys. The certification is asked only when a
   * physical index carries that form and the column is not NOT NULL already.
   */
  protected detectTableIndexDrift(
    tableName: string,
    fields: Record<string, any>,
    declaredIndexes: any[] | undefined,
    physicalColumns: Set<string>,
    tenantColumnNotNull = false,
  ): Promise<ManagedDriftEntry[]> {
    // [#25521 cut 10] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readRuntimeCreatedIndexes = () => this.runtimeCreatedIndexes;
    const host: ThisParameterType<typeof detectTableIndexDrift> = {
      applyNullSafeUniquePreflight: (...a) => this.applyNullSafeUniquePreflight(...a),
      introspectIndexes: (...a) => this.introspectIndexes(...a),
      isTenantKeyCertified: (...a) => this.isTenantKeyCertified(...a),
      resolveTenantField: (...a) => this.resolveTenantField(...a),
      get runtimeCreatedIndexes() { return readRuntimeCreatedIndexes(); },
    };
    return detectTableIndexDrift.call(host, tableName, fields, declaredIndexes, physicalColumns, tenantColumnNotNull);
  }

  /**
   * ADR-0120 D4 — duplicate pre-flight for unique index CREATEs.
   *
   * Probes every index op that would create a UNIQUE index over data that
   * already violates it, grouping by the exact key the index will enforce —
   * `COALESCE(<org>, '__global__')` for a NULL-safe organization key part, the
   * bare column otherwise:
   *
   *   - `recreate_index` marked `tightenNullSafeOnly` (the bare composite
   *     tightening into its COALESCE form — same identities, physical fully
   *     plain): a clean probe recategorises it `safe`, so dev
   *     `autoMigrate: 'safe'` and a plain `os migrate apply` may apply it; a
   *     dirty probe keeps it blocked (`destructive` + a re-probe refusal in
   *     {@link applyIndexDriftOp}) and reports the offending rows.
   *   - `create_index` for a unique index: a dirty probe demotes the default
   *     `safe` to blocked with the same row report — the CREATE could only
   *     fail at apply time otherwise, with a raw driver error naming no rows.
   *
   * ⚠️ Commit 61821e54c — the second bullet covers the PLAIN unique too: an index with no
   * organization key part at all, reached by an object with
   * `tenancy: { enabled: false }` or by any explicit `unique: 'global'`. The
   * `nullSafeColumns.length > 0` guard used to exclude it, so `os migrate plan`
   * classified the one op that was about to take the boot down `safe` — an
   * instrument reporting nothing wrong about the thing that kills the boot.
   * Nothing new was needed to probe it:
   * {@link probeNullSafeUniqueDuplicates} groups by the bare columns when the
   * NULL-safe set is empty, so the guard MOVED rather than a second copy of the
   * check appearing beside the first — one pre-flight, two key shapes, no way
   * for them to drift apart again.
   *
   * A PLAIN unique `recreate_index` stays unprobed: it has no
   * `tightenNullSafeOnly` shape, and `diffManagedIndexes` already categorises a
   * unique recreate `destructive`, so it never carried the `safe` claim this
   * pre-flight exists to withdraw.
   *
   * `replace_unique_index` is deliberately NOT probed: the legacy index it
   * retires is a platform-wide unique, strictly stronger than the NULL-safe
   * composite, so duplicates in the new key are impossible by construction.
   */
  protected applyNullSafeUniquePreflight(entries: ManagedDriftEntry[]): Promise<void> {
    // [#25521 cut 9] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof applyNullSafeUniquePreflight> = {
      get logger() { return readLogger(); },
      probeNullSafeUniqueDuplicates: (...a) => this.probeNullSafeUniqueDuplicates(...a),
    };
    return applyNullSafeUniquePreflight.call(host, entries);
  }

  /**
   * Find duplicate groups under a unique key: GROUP BY the exact key the index
   * will enforce — `COALESCE(<org>, '__global__')` for the NULL-safe parts,
   * the bare column otherwise — HAVING COUNT(*) > 1. Returns one entry per
   * conflicting group, `key` naming columns and values.
   *
   * [ADR-0131 D1] A row with a NULL in a plain key part conflicts with nothing
   * under SQL's NULL-distinct UNIQUE, while GROUP BY puts NULLs together, so
   * such rows are left out ({@link uniqueProbeNotNullClause}). Since new DDL
   * keys the plain tenant column, that is every organization-less row a
   * nullable tenant column still holds — a group of them is no duplicate the
   * index will refuse.
   */
  protected probeNullSafeUniqueDuplicates(
    table: string,
    columns: string[],
    nullSafeColumns: string[],
  ): Promise<Array<{ key: string; rows: number }>> {
    // [#29520 codemod] The body moved to `sql-driver-managed-drift.ts` (see `ManagedDriftHost`).
    return ManagedDriftFacet.probeNullSafeUniqueDuplicates.call(managedDriftHost.of(this), table, columns, nullSafeColumns);
  }

  /**
   * Detect every managed-schema divergence between metadata and the physical
   * database. Metadata is the source of truth. Returns one entry per drift,
   * sorted by table then column. Used by `os migrate` (P3) and tests.
   *
   * Covers both the column dimension ({@link diffManagedTable}) and, since
   * #3728, the index dimension ({@link detectTableIndexDrift}).
   *
   * @param objects optional explicit object list — `fields` and `indexes` are
   *   then authoritative for those tables. Defaults to whatever `initObjects`
   *   last synced (captured in {@link managedObjectFields} /
   *   {@link managedObjectIndexes}).
   */
  detectManagedDrift(
    objects?: Array<{ name: string; fields?: Record<string, any>; indexes?: any[] }>,
  ): Promise<ManagedDriftEntry[]> {
    // [#25521 cut 10] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readKnex = () => this.knex;
    const readManagedObjectFields = () => this.managedObjectFields;
    const readManagedObjectIndexes = () => this.managedObjectIndexes;
    const host: ThisParameterType<typeof detectManagedDrift> = {
      detectTableDrift: (...a) => this.detectTableDrift(...a),
      get knex() { return readKnex(); },
      get managedObjectFields() { return readManagedObjectFields(); },
      get managedObjectIndexes() { return readManagedObjectIndexes(); },
    };
    return detectManagedDrift.call(host, objects);
  }

  /**
   * Every single-value media column on this datastore that still holds the
   * legacy encoding, with the statements that move it (#15989).
   *
   * The read-only half of the ADR-0104 column step: it enumerates and plans,
   * and it runs no DDL and no UPDATE. `os migrate files-to-references --apply`
   * is what executes the plans, and only after its backfill and self-check
   * have reported zero blocking rows — this method deliberately cannot tell
   * whether that happened, so it must never be the thing that decides to move
   * anything.
   *
   * ## The shape of each move is read off the COLUMN, never off the dialect
   *
   * A media column can already be a string column on a server dialect — `os
   * generate migration --format sql` emits `VARCHAR(2048)` for the family, and
   * a JSON-arm driver writes quoted ids into it (#15771, reproduced on live
   * PostgreSQL 16.13). Deciding `retype` vs `unquote` from the dialect alone
   * would leave that population full of `"file_…"` behind a `columns_moved_at`
   * stamp claiming it had been converted. So each target is classified by
   * introspection.
   *
   * ## What is left OUT, and why each omission is not a silent one
   *
   *  - a table the datastore does not physically have — nothing to move;
   *  - `multiple: true` media — a list of ids, a JSON column on every
   *    deployment and on both arms, and not part of this move at all (see
   *    {@link mediaFields}, which already excludes it);
   *  - a column the introspection cannot see — reported as a `refusals` entry
   *    rather than skipped, because a column silently missing from a move is
   *    the one way this step can under-report and still look complete;
   *  - every dialect outside {@link MEDIA_COLUMN_MOVE_DIALECTS} — one refusal
   *    naming the dialect. ⛔ MySQL lands here on purpose: #17788 owns its
   *    statement order, on a real instance.
   */
  planMediaColumnMove(): Promise<MediaColumnMoveScan> {
    // [#25521 cut 10] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readDialectName = () => this.dialectName;
    const readKnex = () => this.knex;
    const readManagedObjectFields = () => this.managedObjectFields;
    const readMediaFields = () => this.mediaFields;
    const host: ThisParameterType<typeof planMediaColumnMove> = {
      get dialectName() { return readDialectName(); },
      introspectColumns: (...a) => this.introspectColumns(...a),
      get knex() { return readKnex(); },
      get managedObjectFields() { return readManagedObjectFields(); },
      get mediaFields() { return readMediaFields(); },
    };
    return planMediaColumnMove.call(host);
  }

  /**
   * Boot-time per-table drift handling (P1 + P2): detect divergence, in dev
   * auto-reconcile the *safe* (loosening) subset when `autoMigrate==='safe'`,
   * then WARN once per remaining divergence with an actionable hint.
   */
  protected reconcileAndWarnDrift(
    tableName: string,
    fields: Record<string, any>,
    declaredIndexes?: any[],
  ): Promise<void> {
    // [#25521 cut 10] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readAutoMigrate = () => this.autoMigrate;
    const readDriftWarned = () => this.driftWarned;
    const readLogger = () => this.logger;
    const readSchemaMode = () => this.schemaMode;
    const host: ThisParameterType<typeof reconcileAndWarnDrift> = {
      applyMigrationEntries: (...a) => this.applyMigrationEntries(...a),
      get autoMigrate() { return readAutoMigrate(); },
      detectTableDrift: (...a) => this.detectTableDrift(...a),
      get driftWarned() { return readDriftWarned(); },
      isProductionEnv: (...a) => this.isProductionEnv(...a),
      isTenantKeyCertified: (...a) => this.isTenantKeyCertified(...a),
      get logger() { return readLogger(); },
      get schemaMode() { return readSchemaMode(); },
    };
    return reconcileAndWarnDrift.call(host, tableName, fields, declaredIndexes);
  }

  /**
   * Apply a set of drift entries to the physical schema. Destructive entries
   * are skipped unless `allowDestructive` is set. Postgres/MySQL alter columns
   * in place; SQLite (which cannot alter constraints in place) rebuilds each
   * affected table (copy → swap) applying only those requested edits it can
   * express as a rebuild — the rest are reported `skipped` and logged, exactly
   * as the in-place arm reports an op its dialect cannot perform (#11722).
   *
   * @returns the entries actually applied and those skipped (e.g. destructive
   *   without `allowDestructive`, or unsupported on the dialect).
   */
  applyMigrationEntries(
    entries: ManagedDriftEntry[],
    opts: { allowDestructive?: boolean } = {},
  ): Promise<{ applied: ManagedDriftEntry[]; skipped: ManagedDriftEntry[] }> {
    // [#25521 cut 10] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readDialectName = () => this.dialectName;
    const readIsSqlite = () => this.isSqlite;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof applyMigrationEntries> = {
      applyDriftOpInPlace: (...a) => this.applyDriftOpInPlace(...a),
      applyIndexDriftOp: (...a) => this.applyIndexDriftOp(...a),
      assertSchemaMutable: (...a) => this.assertSchemaMutable(...a),
      get dialectName() { return readDialectName(); },
      get isSqlite() { return readIsSqlite(); },
      get logger() { return readLogger(); },
      rebuildSqliteTablePatched: (...a) => this.rebuildSqliteTablePatched(...a),
    };
    return applyMigrationEntries.call(host, entries, opts);
  }

  /**
   * Apply one index drift op (#3728). Portable across dialects: index DDL needs
   * neither `ALTER COLUMN` nor the SQLite table rebuild that column ops do.
   */
  protected applyIndexDriftOp(op: DriftOp): Promise<boolean> {
    // [#25521 cut 8] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readKnex = () => this.knex;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof applyIndexDriftOp> = {
      dropIndexIfExists: (...a) => this.dropIndexIfExists(...a),
      dropOrphanedHashShadowColumn: (...a) => this.dropOrphanedHashShadowColumn(...a),
      getExistingIndexNames: (...a) => this.getExistingIndexNames(...a),
      get knex() { return readKnex(); },
      get logger() { return readLogger(); },
      logDurabilityFailure: (...a) => this.logDurabilityFailure(...a),
      probeNullSafeUniqueDuplicates: (...a) => this.probeNullSafeUniqueDuplicates(...a),
      restoreBareIndexAfterFailedTighten: (...a) => this.restoreBareIndexAfterFailedTighten(...a),
      syncDeclaredIndexes: (...a) => this.syncDeclaredIndexes(...a),
    };
    return applyIndexDriftOp.call(host, op);
  }

  /**
   * Last-resort restore for the ADR-0120 D4 tightening: the old index is
   * already dropped and the NULL-safe replacement could not be created (a
   * write raced the probe, or the dialect refused the expression key). Put the
   * previous BARE composite back under the same name so the constraint that
   * existed before the attempt keeps existing — then say, at `error` level,
   * exactly what is NOT enforced and how to fix it, because from the outside
   * everything keeps looking normal (the durability-degradation rule).
   */
  protected restoreBareIndexAfterFailedTighten(
    op: Extract<DriftOp, { type: 'recreate_index' }>,
    cause: unknown,
  ): Promise<void> {
    // [#25521 cut 8] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof restoreBareIndexAfterFailedTighten> = {
      getExistingIndexNames: (...a) => this.getExistingIndexNames(...a),
      get knex() { return readKnex(); },
      logDurabilityFailure: (...a) => this.logDurabilityFailure(...a),
      syncDeclaredIndexes: (...a) => this.syncDeclaredIndexes(...a),
    };
    return restoreBareIndexAfterFailedTighten.call(host, op, cause);
  }

  /** Apply a single drift op in place (Postgres / MySQL). Returns false if unsupported. */
  protected applyDriftOpInPlace(op: DriftOp): Promise<boolean> {
    // [#25521 cut 6] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readDialectName = () => this.dialectName;
    const readIsMysql = () => this.isMysql;
    const readIsPostgres = () => this.isPostgres;
    const readKnex = () => this.knex;
    const readLogger = () => this.logger;
    const host: ThisParameterType<typeof applyDriftOpInPlace> = {
      applyIndexDriftOp: (...a) => this.applyIndexDriftOp(...a),
      get dialectName() { return readDialectName(); },
      get isMysql() { return readIsMysql(); },
      get isPostgres() { return readIsPostgres(); },
      get knex() { return readKnex(); },
      get logger() { return readLogger(); },
    };
    return applyDriftOpInPlace.call(host, op);
  }

  /**
   * Rebuild a SQLite table applying a set of column edits (relax/tighten NOT
   * NULL, drop column, drop a column DEFAULT), preserving all other columns and
   * their data. Follows the official SQLite procedure: create patched table →
   * copy → drop → rename. varchar widen/narrow are no-ops on SQLite (dynamic
   * typing) and ignored.
   *
   * @returns the entries this rebuild actually ACTED on. Anything else in
   *   `ents` was ignored, and the caller must report those as `skipped` rather
   *   than `applied` (#11722) — on SQLite `applied` otherwise meant only "a
   *   rebuild ran", while every consumer of it reads "this op happened".
   *
   * ⚠️ The rebuild still runs for the WHOLE table even when it honours
   * nothing: it re-materializes every kept column's default and the full
   * declared index set from metadata, so it is not a no-op, and skipping it in
   * that case would change what the reconciler DOES rather than what it
   * reports. Honesty about the report is this function's contract; deciding
   * whether a rebuild is worth running is not.
   *
   * SQLite cannot alter a column's DEFAULT in place, so `drop_column_default`
   * (#4560) is reconciled here too — by re-materializing every column's default
   * from METADATA through {@link applyDeclaredColumnDefault} and simply not
   * re-emitting the dropped one. Rebuilding from metadata rather than copying
   * the physical DEFAULT is what makes this safe both ways: the token default
   * the op targets is gone because metadata never declared it, and a sibling
   * `defaultValue: 'NOW()'` column keeps the default it always had instead of
   * silently losing it to the rebuild.
   *
   * Unique field-level constraints and declared indexes are recreated from
   * metadata afterwards (the source of truth). DB-level foreign keys declared
   * by `lookup` fields are not re-added (ObjectStack enforces relationships at
   * the application layer, not via SQLite FK constraints).
   */
  protected rebuildSqliteTablePatched(table: string, ents: ManagedDriftEntry[]): Promise<ManagedDriftEntry[]> {
    // [#25521 cut 6] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readKnex = () => this.knex;
    const readLogger = () => this.logger;
    const readManagedObjectFields = () => this.managedObjectFields;
    const readManagedObjectIndexes = () => this.managedObjectIndexes;
    const host: ThisParameterType<typeof rebuildSqliteTablePatched> = {
      applyDeclaredColumnDefault: (...a) => this.applyDeclaredColumnDefault(...a),
      buildRebuiltColumn: (...a) => this.buildRebuiltColumn(...a),
      introspectColumns: (...a) => this.introspectColumns(...a),
      get knex() { return readKnex(); },
      get logger() { return readLogger(); },
      get managedObjectFields() { return readManagedObjectFields(); },
      get managedObjectIndexes() { return readManagedObjectIndexes(); },
      nowColumnDefault: (...a) => this.nowColumnDefault(...a),
      resolveTenantField: (...a) => this.resolveTenantField(...a),
      syncTableIndexes: (...a) => this.syncTableIndexes(...a),
    };
    return rebuildSqliteTablePatched.call(host, table, ents);
  }

  /**
   * Map an introspected SQLite column to a knex builder for the rebuilt table.
   *
   * ⚠️ [#12738] The `json` arm below is DELIBERATELY not routed through
   * {@link jsonColumn}, and this is the one place in the driver where that
   * reads like an oversight. The input here is a column's EXISTING declared
   * type, read back from `pragma_table_info` — not a field's metadata — and
   * this method's whole contract is to hand back the column the table already
   * had. A legacy column declared `json` therefore stays `json` through a
   * rebuild, which is exactly the migration shape #12738 ruled: new columns
   * only, existing columns keep their declared type.
   *
   * Routing it through the new emitter would make an UNRELATED drift rebuild
   * (a relaxed NOT NULL, a dropped column) silently re-declare the column as
   * `text` and, because the rebuild's `insert … select` copies every row
   * through the new affinity, rewrite the stored bytes of live data — a
   * conversion nobody asked for, ridden in on an unrelated op. Columns created
   * AFTER #12738 arrive here declared `text` already and take the `text` arm
   * below, so the rebuild is stable in both eras without special-casing.
   */
  protected buildRebuiltColumn(t: Knex.CreateTableBuilder, c: IntrospectedColumn): any {
    // [#29520 codemod] The body moved to `sql-driver-managed-drift.ts`.
    return ManagedDriftFacet.buildRebuiltColumn(t, c);
  }

  /**
   * Build a deterministic index name for a declared index so repeated
   * `initObjects` runs converge on the same identifier (and can detect an
   * already-materialized index by name).
   *
   * Delegates to the shared {@link buildIndexName} so the names the driver
   * *creates* and the names the drift differ *looks for* can never diverge.
   */
  protected buildIndexName(tableName: string, fields: string[], unique: boolean): string {
    // [#29520 codemod] The body moved to `sql-driver-managed-drift.ts`.
    return ManagedDriftFacet.buildIndexName(tableName, fields, unique);
  }

  /**
   * Read the indexes that physically exist on a table — name, ordered columns,
   * uniqueness, and whether it backs the PRIMARY KEY — per dialect.
   *
   * Used both for sync idempotency ({@link getExistingIndexNames}) and for index
   * drift detection (#3728), which needs the full definition rather than just
   * the name.
   *
   * ⚠️ A failed read is an ERROR, not an empty table (#7332). This used to wrap
   * the whole dialect dispatch in a bare `catch {}` and return `byName` in
   * whatever half-built state it had reached, so the caller could not tell "this
   * table genuinely has no such index" from "the read failed and I am guessing".
   * Downstream, `diffManagedIndexes` takes its declared-index-missing branch on
   * exactly that input: a transient SQLITE_BUSY, or a WAL read landing
   * mid-flush, was laundered into a confident, specific and FALSE
   * `actual: '(absent)'` — *"metadata declares index 'x' but the database has no
   * such index"* — about an index that was there the whole time.
   *
   * The swallow's justification, *"let creation handle conflicts"*, is sound
   * only where it was written: {@link getExistingIndexNames}, whose caller
   * {@link syncDeclaredIndexes} corrects an optimistic wrong reading by
   * attempting the create and absorbing the "already exists" error. Detection
   * has no such backstop, and it inherited the swallow only because #3728 wired
   * a second consumer onto the same function. So the split is by CALL SITE:
   * `onFailure: 'partial'` is the creation seam's opt-in, and everything else —
   * detection included — sees the throw. Its callers are already built for it:
   * {@link reconcileAndWarnDrift} catches and warns "could not introspect
   * '<table>' for drift detection", and `os migrate plan` / `apply` both catch,
   * print the error and exit non-zero. The sibling read in the same detect
   * path, {@link introspectColumns}, has never swallowed.
   *
   * Postgres reads `pg_index` rather than `pg_indexes` so indexes backing a
   * UNIQUE CONSTRAINT (which is exactly what knex's old `col.unique()` produced)
   * are returned too — the drift detector cannot see the #3696 legacy shape
   * otherwise.
   *
   * ⚠️ The key is read from the index DEFINITION, not from the dialect's
   * per-column catalogue view (#4884). Those views describe an expression key
   * with a NULL column and nothing else, so `(type, name, organization_id,
   * COALESCE(package_id,''))` used to arrive here as three columns — and a
   * healthy ADR-0048 overlay index read as drift against its own four-column
   * declaration. The partial predicate is captured for the same reason: it is
   * what tells the differ this index is none of its business
   * (`isSyncReproducibleIndex`).
   */
  protected introspectIndexes(
    tableName: string,
    opts: {
      /**
       * What a failed read means to THIS caller (#7332). `'throw'` (the
       * default) surfaces it; `'partial'` returns whatever was read before the
       * failure — correct only where a short read is self-correcting.
       */
      onFailure?: 'throw' | 'partial';
    } = {},
  ): Promise<PhysicalIndex[]> {
    // [#25521 cut 5] The body moved to `sql-driver-introspection.ts` (see `IntrospectionHost`).
    const readIsMysql = () => this.isMysql;
    const readIsPostgres = () => this.isPostgres;
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof introspectIndexes> = {
      get isMysql() { return readIsMysql(); },
      get isPostgres() { return readIsPostgres(); },
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
      resolveHashShadowKeys: (...a) => this.resolveHashShadowKeys(...a),
    };
    return introspectIndexes.call(host, tableName, opts);
  }

  /**
   * Record, on each #11627 hash-shadow CARRIER, the declared key its shadow
   * actually hashes (commit cd1348802).
   *
   * ## Why introspection and not the differ
   *
   * A carrier is recognisable by name alone — its sole key column is
   * {@link SqlDriver.hashShadowColumnFor} of its own index name — but a NAME
   * cannot say WHAT is hashed, and that difference decides between two
   * opposite verdicts. A shadow written since commit df1c75c4b hashes the declared key
   * with its NULL-safe `COALESCE(organization_id, '__global__')` parts intact
   * and is HEALTHY; one written before it hashes the RAW columns, so `CONCAT`
   * yields NULL for every NULL-organization row and the constraint those rows
   * were promised does not exist (#5030's shape). Both look identical from the
   * `STATISTICS` view. Only the stored `GENERATION_EXPRESSION` separates them,
   * and reading it is the difference between the differ SKIPPING shadows and
   * the differ UNDERSTANDING them.
   *
   * ## Why the failure is swallowed
   *
   * This is an ENRICHMENT of a read with other consumers — the upsert
   * conflict-target check and the boot's index-presence probe among them — and
   * none of them may start failing because a second query did. A carrier whose
   * key stays unresolved is still recognised as a carrier by
   * `isHashShadowCarrier`, and `diffManagedIndexes` then reports NOTHING for it
   * rather than proposing a rebuild it cannot reason about. The degraded
   * outcome is a missing finding, never a dropped constraint.
   */
  protected resolveHashShadowKeys(
    tableName: string,
    indexes: PhysicalIndex[],
  ): Promise<void> {
    // [#25521 cut 7] The body moved to `sql-driver-introspection.ts` (see `IntrospectionHost`).
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof resolveHashShadowKeys> = {
      get knex() { return readKnex(); },
    };
    return resolveHashShadowKeys.call(host, tableName, indexes);
  }

  /**
   * Names of the indexes that already exist on a table. Used to make
   * declared-index sync idempotent across repeated runs.
   *
   * Best-effort by design (#7332), and the one caller entitled to be: every
   * consumer of this set uses it to decide whether to SKIP a create, so a name
   * missing from a short read costs at most one redundant `CREATE INDEX` —
   * which {@link syncDeclaredIndexes} absorbs as "already exists" — and a
   * throw here would instead take the whole boot down on a transient read.
   * The presence probes in {@link applyIndexDriftOp} fail the same safe way:
   * a false absence keeps the legacy index in place and under-reports what was
   * applied, never the reverse.
   */
  protected getExistingIndexNames(tableName: string): Promise<Set<string>> {
    // [#29520 codemod] The body moved to `sql-driver-managed-drift.ts` (see `ManagedDriftHost`).
    return ManagedDriftFacet.getExistingIndexNames.call(managedDriftHost.of(this), tableName);
  }

  /**
   * Translate field-level `unique` declarations into concrete index
   * descriptors, applying tenant scoping (#3696). Delegates to the shared
   * {@link uniqueIndexesFromFields} — see there for the scoping rule.
   */
  protected uniqueIndexesFromFields(
    tableName: string,
    fields: Record<string, any>,
    tenantField: string | null,
  ): Array<{ name: string; fields: string[]; unique: true; nullSafeColumns?: string[] }> {
    // [#29520 codemod] The body moved to `sql-driver-managed-drift.ts`.
    return ManagedDriftFacet.uniqueIndexesFromFields(tableName, fields, tenantField);
  }

  /**
   * Drop an index (or the constraint backing it) by name if present, across
   * dialects.
   *
   * Postgres materializes knex's `col.unique()` as a table CONSTRAINT (not a
   * bare index), so `DROP INDEX` alone silently leaves it in place — the exact
   * failure that would have made the #3696 migration a no-op on the deployments
   * that matter most. Try the constraint form first, then the index form.
   *
   * Returns true when something was actually dropped.
   */
  protected dropIndexIfExists(tableName: string, indexName: string): Promise<boolean> {
    // [#29520 codemod] The body moved to `sql-driver-managed-drift.ts` (see `ManagedDriftHost`).
    return ManagedDriftFacet.dropIndexIfExists.call(managedDriftHost.of(this), tableName, indexName);
  }

  /**
   * Materialize a table's full index set: field-level `unique` (tenancy-aware,
   * see {@link uniqueIndexesFromFields}) plus the object's declared `indexes`.
   * Single entry point so every caller — create, alter, SQLite rebuild — lands
   * on identical DDL.
   *
   * ADDITIVE ONLY (#3728). This creates indexes; it never drops or rewrites
   * one. Retiring the legacy platform-wide unique index a tenant-scoped field
   * used to carry (#3696) used to happen right here, unconditionally, at every
   * boot — a DROP that `os migrate plan` could not show and an operator could
   * not pre-inspect, and which altered a managed schema in production in
   * violation of the #2186 contract. That DROP is now a
   * `replace_unique_index` drift entry: detected by
   * {@link detectManagedDrift}, rendered by `os migrate plan`, applied by
   * `os migrate apply` — and still auto-reconciled at boot in dev, via the same
   * `autoMigrate: 'safe'` policy that governs every other safe drift.
   */
  protected syncTableIndexes(
    tableName: string,
    fields: Record<string, any>,
    declaredIndexes: any[] | undefined,
    tenantField: string | null,
    physicalColumns: Set<string>,
  ): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-managed-drift.ts` (see `ManagedDriftHost`).
    return ManagedDriftFacet.syncTableIndexes.call(managedDriftHost.of(this), tableName, fields, declaredIndexes, tenantField, physicalColumns);
  }

  /**
   * Materialize declared object-level indexes.
   *
   * - Multi-column and single-column indexes are both supported.
   * - `unique: true` / `'global'` emits a UNIQUE index over the column list
   *   taken VERBATIM — no tenant column is injected. That verbatim behavior is
   *   the `'global'` arm of the ADR-0120 D1 scope vocabulary (it was the only
   *   arm before that ADR): a `'global'` declared index already names its
   *   columns and is frequently platform-wide on purpose (a DNS hostname, a
   *   reserved slug, an external provider id, every engine dedup key), so
   *   rewriting it would break real constraints. NULL-distinct semantics are
   *   the default across SQLite/Postgres/MySQL, so multiple NULL rows remain
   *   allowed while non-NULL duplicates are rejected — matching the
   *   convergence-on-conflict pattern the messaging pipeline relies on.
   * - `unique: 'organization'` (ADR-0120 D1/D3) prepends the table's tenant
   *   column in its NULL-safe form — `COALESCE(tenantField, '__global__')` —
   *   resolved here at registration, where tenancy is known; with no tenant
   *   column it degrades to the listed columns (S11). Field-level `unique` is
   *   scoped upstream in {@link uniqueIndexesFromFields} and arrives here
   *   pre-resolved (`nullSafeColumns`). Both routes land on
   *   {@link normalizeDeclaredIndex}, the differ's normalizer, so what the
   *   sync CREATES and what the differ EXPECTS cannot drift apart.
   * - Idempotent: indexes already present (by deterministic name) are
   *   skipped, and an "already exists" race is absorbed.
   * - An index referencing a column that is not materialized (a misspelt name
   *   the Studio save door admits, or a virtual `formula` field) is skipped
   *   rather than failing the sync. The skip is logged at `error` through
   *   {@link logDurabilityFailure}; it used to be a `warn`. A declared UNIQUE
   *   that is never created is exactly the durability-degradation rule's case:
   *   the constraint is not enforced while everything looks normal. The
   *   duplicate-row arms below already answer their version of it at `error`.
   *   A plain index is DDL that was supposed to run and did not, so it takes
   *   the same channel, and the line says which of the two it is. The drift
   *   report carries the same index as a report-only `unbuildable_index` entry
   *   (`diffUnbuildableIndexes`), so `os migrate plan` shows it too.
   * - A NULL-safe unique whose data already violates it (legacy duplicates the
   *   void constraint admitted, #5030) is NOT created; the failure is logged
   *   at `error` (a declared constraint is not enforced — the
   *   durability-degradation rule) and surfaces as drift with a row report via
   *   the ADR-0120 D4 pre-flight, instead of failing the whole boot.
   * - Commit 61821e54c: a PLAIN unique — no organization key part, i.e.
   *   `tenancy: { enabled: false }` or an explicit `unique: 'global'` — over
   *   data that already violates it gets the SAME disposition, where it used to
   *   throw the database's raw error and take the boot down naming no rows and
   *   no remedy.
   * - #15479: the same disposition on the HASH-SHADOW route (the MySQL arm
   *   #11627 added, taken when the server refuses to key the column directly).
   *   Its guard asked `nullSafe.size > 0` as well, so a plain unique reached
   *   neither branch and took the boot down carrying the UNKEYABLE-COLUMN
   *   refusal instead of the duplicate rows. Measured on live MySQL 8.0.46 in
   *   `sql-driver-15479-shadow-plain-unique-duplicates.test.ts`.
   */
  protected syncDeclaredIndexes(
    tableName: string,
    indexes: DeclaredIndexInput[],
    physicalColumns: Set<string>,
    tenantField?: string | null,
    /**
     * The object's fields, when the caller holds them. They only tell the
     * skip line WHY a column is missing (not a field, or a virtual `formula`).
     * The drift-op apply paths re-feed already-normalized shapes and pass none.
     */
    fields?: Record<string, any>,
  ): Promise<void> {
    // [#25521 cut 9] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof syncDeclaredIndexes> = {
      createHashShadowUniqueIndex: (...a) => this.createHashShadowUniqueIndex(...a),
      createNullSafeUniqueIndex: (...a) => this.createNullSafeUniqueIndex(...a),
      explainUnkeyableTextColumn: (...a) => this.explainUnkeyableTextColumn(...a),
      getExistingIndexNames: (...a) => this.getExistingIndexNames(...a),
      get knex() { return readKnex(); },
      logDurabilityFailure: (...a) => this.logDurabilityFailure(...a),
      probeNullSafeUniqueDuplicates: (...a) => this.probeNullSafeUniqueDuplicates(...a),
      resolveTenantField: (...a) => this.resolveTenantField(...a),
    };
    return syncDeclaredIndexes.call(host, tableName, indexes, physicalColumns, tenantField, fields);
  }

  /**
   * Raw DDL for an organization-scoped unique index (ADR-0120 D3): knex's
   * schema builder cannot express an expression key part, so the CREATE is
   * spelled out. SQLite and Postgres take the function call as a key part
   * directly; MySQL requires functional key parts to be parenthesized.
   *
   * On a MySQL that predates functional key parts (< 8.0.13) or MariaDB, the
   * expression form is rejected — degrade to the BARE composite so non-NULL
   * rows keep their constraint, and say at `error` level exactly what is not
   * enforced (the NULL-organization bucket) and what fixes it. A silent bare
   * fallback would re-open #5030 unnamed; failing the boot would brick every
   * such deployment for every unique field. The drift differ keeps reporting
   * the tightening for the day the server is upgraded.
   */
  protected createNullSafeUniqueIndex(
    tableName: string,
    name: string,
    columns: string[],
    nullSafe: ReadonlySet<string>,
  ): Promise<void> {
    // [#25521 cut 9] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readIsMysql = () => this.isMysql;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof createNullSafeUniqueIndex> = {
      get isMysql() { return readIsMysql(); },
      get knex() { return readKnex(); },
      logDurabilityFailure: (...a) => this.logDurabilityFailure(...a),
    };
    return createNullSafeUniqueIndex.call(host, tableName, name, columns, nullSafe);
  }

  // ===================================
  // Schema Introspection
  // ===================================

  /**
   * [ADR-0131 D7 · #23429] The PHYSICAL column names of `object`'s table, as
   * the catalog holds them — the declared ones and any a past release left
   * behind. Read-only, one table, through the builder every read uses (so it
   * resolves a federated object's remote table, and joins
   * `options.transaction` like any read: a single-connection pool would
   * otherwise wait on the connection the caller's transaction holds).
   *
   * A table that does not exist answers `[]`. It is not `execute()`, so a
   * declaration boot's write guard has nothing to count: a question every
   * boot asks (does a retired column still physically exist?) must not cost a
   * plan its "writes nothing" claim.
   *
   * Built on Knex directly, not {@link getBuilder}: it reads the CATALOG and
   * returns column names, never a row, so the tenant scope a row read must
   * carry (`check:tenant-chokepoint`) has nothing to scope. The table is
   * resolved as `getBuilder` resolves it.
   */
  listPhysicalColumns(object: string, options?: DriverOptions): Promise<string[]> {
    // [#29520 codemod] The body moved to `sql-driver-schema-introspection.ts` (see `SchemaIntrospectionHost`).
    return SchemaIntrospectionFacet.listPhysicalColumns.call(schemaIntrospectionHost.of(this), object, options);
  }

  introspectSchema(): Promise<IntrospectedSchema> {
    // [#25521 cut 4] The body moved to `sql-driver-introspection.ts` (see `IntrospectionHost`).
    const readDialectName = () => this.dialectName;
    const readIsMysql = () => this.isMysql;
    const readIsPostgres = () => this.isPostgres;
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof introspectSchema> = {
      get dialectName() { return readDialectName(); },
      introspectColumns: (...a) => this.introspectColumns(...a),
      introspectForeignKeys: (...a) => this.introspectForeignKeys(...a),
      introspectPrimaryKeys: (...a) => this.introspectPrimaryKeys(...a),
      introspectUniqueConstraints: (...a) => this.introspectUniqueConstraints(...a),
      get isMysql() { return readIsMysql(); },
      get isPostgres() { return readIsPostgres(); },
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
    };
    return introspectSchema.call(host);
  }

  // ===================================
  // Internal helpers
  // ===================================

  /** Expose the underlying Knex instance for advanced usage. */
  getKnex(): Knex {
    // [#29520 codemod] The body moved to `sql-driver-internal-helpers.ts` (see `InternalHelpersHost`).
    return InternalHelpersFacet.getKnex.call(internalHelpersHost.of(this));
  }

  protected getBuilder(object: string, options?: DriverOptions): knex.Knex.QueryBuilder<any, { _base: any; _hasSelection: false; _keys: never; _aliases: {}; _single: false; _intersectProps: {}; _unionProps: never }[]> {
    // [#29520 codemod] The body moved to `sql-driver-internal-helpers.ts` (see `InternalHelpersHost`).
    return InternalHelpersFacet.getBuilder.call(internalHelpersHost.of(this), object, options);
  }

  /**
   * Resolve the tenant column for the given object, if any.
   *
   * Lookup falls back to both the storage-mapped table name and the raw
   * object name so callers that pass either form get the same answer.
   * Returns `null` when the object has no tenant-isolation field.
   */
  protected resolveTenantField(object: string): string | null {
    // [#29520 codemod] The body moved to `sql-driver-internal-helpers.ts` (see `InternalHelpersHost`).
    return InternalHelpersFacet.resolveTenantField.call(internalHelpersHost.of(this), object);
  }

  /**
   * Whether this deployment requested an organization wall — the same resolved
   * POSTURE the SchemaRegistry and SecurityPlugin key off. Gates the
   * tenant-audit warning, which is only meaningful where tenant isolation is
   * something the deployment actually asked for.
   *
   * [ADR-0105 D1 / #5262] ⛔ Never `resolveMultiOrgEnabled()`. That boolean was
   * DEMOTED to a back-compat input of `resolveTenancyPosture()` and reads
   * `false` on a deployment configured the documented way
   * (`OS_TENANCY_POSTURE=isolated|group`, legacy boolean unset), so the
   * tenant-audit warning — the one signal that catches a sudo/seed write
   * landing outside its tenant — was silently off on exactly the walled
   * deployments it exists for.
   *
   * REQUESTED posture, not the `tenancy` service's effective answer, for two
   * reasons. This class is a driver: it is constructed from connection config
   * with no kernel or service registry to ask, so the effective posture is not
   * reachable here at all. And the asymmetry runs the right way for a WARNING —
   * a spurious line on a degraded stack costs a log entry, while a suppressed
   * one on a walled stack is the defect being fixed.
   *
   * ⚠️ Read LIVE on every call, never memoised. The previous `_multiTenantMode`
   * field froze a process-level fact into a per-instance verdict on whichever
   * write happened to land first — the "startup reading recorded as a judgment"
   * shape AGENTS.md warns about — which made the gate unable to see anything a
   * later boot phase (or a test) established. It is affordable because
   * {@link auditMissingTenant} now consults it only AFTER the cheap `tenantId`
   * early-out, so a normal tenant-scoped write never reaches this at all.
   */
  protected isMultiTenantMode(): boolean {
    // [#29520 codemod] The body moved to `sql-driver-internal-helpers.ts`.
    return InternalHelpersFacet.isMultiTenantMode();
  }

  /**
   * Apply a `WHERE tenant_field = ?` clause to the given query builder
   * when:
   *   1. `options.tenantId` is provided by the caller, AND
   *   2. the object actually has a tenant-isolation field
   *      (`organization_id` by convention).
   *
   * Without a tenantId the call is treated as an unscoped/admin path —
   * keeps legacy callers, seed scripts, and cross-org tooling working.
   *
   * This is the single chokepoint for read-side tenant isolation in the SQL
   * driver, and every read door routes through it — `findRows()` (what
   * `find()`/`findOne()` use), `count()`, `aggregate()`, `distinct()`,
   * `findWithWindowFunctions()`, `analyzeQuery()`/`explain()`, and the
   * update/delete predicates and their readbacks. Write-side tenancy is a
   * different mechanism and deliberately not this one: inserts stamp the
   * column via {@link injectTenantOnInsert}, so the three `insert` builders
   * (create / upsert / bulkCreate) reach `getBuilder` without coming here.
   *
   * ⚠️ That sentence used to be written as a claim — "every CRUD method routes
   * through it" — and it was FALSE for as long as it had existed (#6792).
   * Three doors built through `getBuilder` and never arrived:
   * `findWithWindowFunctions` (ROWS — a caller passing `tenantId` got every
   * tenant's rows), `analyzeQuery`/`explain` (a PLAN for a statement `find()`
   * would not run), and `distinct` (every tenant's values for one column). The
   * first two were filed; the third was found only because the invariant was
   * finally MEASURED. Nothing had ever checked it, which is exactly how a
   * docstring becomes the last place a wrong fact survives.
   *
   * So it is no longer a claim. `scripts/check-tenant-chokepoint.mjs`
   * (`pnpm check:tenant-chokepoint`, wired into `.github/workflows/lint.yml`)
   * re-derives it from the AST on every run: a method that builds through
   * `getBuilder(object, options)` and lets that builder escape as a read must
   * call this, or carry a written exemption. Edit this list and the gate will
   * disagree with you — that is the point.
   */
  protected applyTenantScope(
    builder: Knex.QueryBuilder,
    object: string,
    options?: DriverOptions,
  ): Knex.QueryBuilder {
    // [#29520 codemod] The body moved to `sql-driver-internal-helpers.ts` (see `InternalHelpersHost`).
    return InternalHelpersFacet.applyTenantScope.call(internalHelpersHost.of(this), builder, object, options);
  }

  /**
   * [ADR-0139 D3] The subquery a composed `ReadableIds` leaf compiles to:
   * `SELECT id FROM P_TABLE WHERE SCOPE AND TENANT`, which the `$in` arm of
   * {@link applyFilterCondition} embeds as `field IN (…)`.
   *
   * - **TENANT** is {@link applyTenantScope} on the PARENT table with the
   *   OUTER read's options — the engine never composes the wall (D2 step 3),
   *   so a parent row in another tenant is never readable through the leaf;
   * - **SCOPE** is the composed scope, compiled by this same compiler against
   *   the parent table (`undefined` is no row restriction). It arrives lowered
   *   and `'policy'`-marked, so a refusal inside it withholds its operands
   *   exactly as an injected RLS predicate's does.
   *
   * One statement, so `find`, `count` and `aggregate` agree by construction,
   * and the subquery binds only the scope's and the wall's own parameters —
   * no per-id parameter, whatever the parent's size. The subquery carries no
   * transaction of its own: it is part of the outer statement, which does.
   */
  protected readableIdsSubquery(leaf: ComposedReadableIds, options?: DriverOptions): Knex.QueryBuilder {
    // [#29520 codemod] The body moved to `sql-driver-internal-helpers.ts` (see `InternalHelpersHost`).
    return InternalHelpersFacet.readableIdsSubquery.call(internalHelpersHost.of(this), leaf, options);
  }

  /**
   * Auto-inject the tenant column on insert rows when:
   *   1. `options.tenantId` is provided, AND
   *   2. the object has a tenant-isolation field, AND
   *   3. the row does not already set that field.
   *
   * Explicit values are never overwritten — admins writing to a specific
   * tenant via raw row data keep that authority.
   */
  protected injectTenantOnInsert(
    object: string,
    row: Record<string, any>,
    options?: DriverOptions,
  ): void {
    // [#29520 codemod] The body moved to `sql-driver-internal-helpers.ts` (see `InternalHelpersHost`).
    return InternalHelpersFacet.injectTenantOnInsert.call(internalHelpersHost.of(this), object, row, options);
  }

  /**
   * Surface writes that target a tenant-scoped object but don't carry a
   * `tenantId`. These are almost always system / seed / admin paths that
   * forgot to thread the active session context — easy to miss in code
   * review and impossible to find after a breach.
   *
   * Throttled to one warning per `${object}:${op}` so background workers
   * don't spam the log. Set `options.bypassTenantAudit = true` (or env
   * `OS_TENANT_AUDIT=0`) to silence intentionally.
   *
   * The line names BOTH readings, because this driver cannot tell them apart:
   * an unscoped write here is either one that lost its organization (fix:
   * run it in that organization's context) or one the organization wall
   * lifted the scope from on purpose — an exempt platform admin's
   * cross-organization update or delete arrives exactly so, with no
   * `tenantId` (ADR-0131 D8). Telling that second write to "pass tenantId"
   * prescribes the one change that would break it, so ⛔ the remedy sentence
   * never addresses the write as if it were only the first kind.
   *
   * [ADR-0131 8c-1] An INSERT names its organization in a second place: the
   * row's own tenant column, the slot {@link injectTenantOnInsert} fills from
   * `tenantId`. A `create` / `bulkCreate` whose every row already carries that
   * column is confined to the organizations its rows name, so there is nothing
   * to report — and that is how the elevated seed and replay inserts of a
   * walled boot arrive (a system insert with no organization is refused above
   * this driver, ADR-0131 D9). `insertRows` is those rows, passed by the two
   * insert doors only; one row without the column keeps the line. ⛔ Never for
   * update, delete or upsert: there the column is a value being written, not
   * the statement's scope (the line says so), and an upsert's merge leg can
   * reach a row of another organization. Diagnostics only: no write changes.
   */
  protected auditMissingTenant(
    object: string,
    op: 'create' | 'update' | 'delete' | 'bulkCreate' | 'bulkDelete' | 'updateMany' | 'deleteMany' | 'upsert',
    options?: DriverOptions,
    insertRows?: readonly unknown[],
  ): void {
    // [#29520 codemod] The body moved to `sql-driver-internal-helpers.ts` (see `InternalHelpersHost`).
    return InternalHelpersFacet.auditMissingTenant.call(internalHelpersHost.of(this), object, op, options, insertRows);
  }

  // ── Filter helpers ──────────────────────────────────────────────────────────

  /**
   * Resolve the underlying table name for a Knex query builder so we can
   * look up column type metadata (date/datetime maps populated during
   * `initObjects`). Returns null when the builder is not table-scoped yet.
   */
  protected tableNameForBuilder(builder: any): string | null {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts`.
    return FilterHelpersFacet.tableNameForBuilder(builder);
  }

  /**
   * Coercion-map key for a builder. Coercion maps (date/datetime) are keyed by
   * OBJECT name, but after the federation change {@link getBuilder} targets the
   * physical remote table, so a builder reports the remote name. Map it back to
   * the object name for external objects; identity for managed ones (no reverse
   * entry). Note datetime coercion is a SQLite-only concern (see
   * coerceFilterValue), and SQLite external tables are bare-named, so this is
   * exact where it matters.
   */
  protected coercionKey(builder: any): string | null {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.coercionKey.call(filterHelpersHost.of(this), builder);
  }

  /**
   * Collapse a `Field.date` value to a timezone-naive `YYYY-MM-DD`
   * calendar-day string (ADR-0053 Phase 1). A string keeps its leading date
   * and drops any time component. Anything else (and `null`/`undefined`)
   * passes through unchanged. This is the single source of truth for date-only
   * truncation, shared by the filter (`coerceFilterValue`), write
   * (`formatInput`) and read (`formatOutput`, `presentReadValue`) paths so all
   * of them agree on what a date *is*.
   *
   * ## Which clock a `Date` argument is on — the contract, not an accident
   *
   * **A `Date` reaching this helper is read on the UTC clock**
   * (`getUTCFullYear` / `getUTCMonth` / `getUTCDate`), and callers must hand it
   * one whose UTC components name the intended calendar day. That is the same
   * clock every other temporal canon in this driver folds through
   * (`storageDatetimeValue`, `canonicalTimeOfDay`, `nowColumnDefault`'s
   * `timezone('utc', now())::date`), so a `Field.date` means one day on every
   * host regardless of the process `TZ`.
   *
   * It is written down because the three call paths do NOT hand it `Date`s
   * from one source, and #11389 was the reading of that. Measured (PostgreSQL
   * 16, one process, only `TZ` changed):
   *
   * | argument, for calendar day 2026-08-24 | `TZ=Asia/Shanghai` | `TZ=America/New_York` |
   * |---|---|---|
   * | caller's `new Date('2026-08-24')` — write/filter | `…T00:00Z` | `…T00:00Z` |
   * | caller's `new Date(2026, 7, 24)` — write/filter | `…T16:00Z` (prev. day UTC) | `…T04:00Z` |
   * | what `pg` used to hand the READ path for a `date` column | `…T16:00Z` (prev. day UTC) | `…T04:00Z` |
   *
   * So no single clock is right for every `Date` that could arrive: reading
   * local components would fix the third row and break the first (a
   * `new Date('2026-08-24')` comparand becomes `2026-08-23` west of UTC — the
   * identical one-day error, moved onto the write and filter paths). The read
   * path was fixed at its source instead — see
   * {@link withPostgresCalendarDayAsText} and, for MySQL,
   * {@link withMysqlCalendarDayAsText} — so on every dialect a `date`
   * column now arrives here as TEXT and no driver-materialised `Date` reaches
   * this helper at all. ⛔ Do not "repair" a residual date skew by switching
   * the rule's UTC getters to their local twins; that reintroduces #11389 in the
   * mirror direction, and `sql-driver-11389-date-tz-skew.test.ts` pins it.
   */
  protected toDateOnly(value: any): any {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts`.
    return FilterHelpersFacet.toDateOnly(value);
  }

  /**
   * Present a `Field.time` value as its canonical wall-clock time-of-day
   * (`HH:MM:SS[.fff]` — {@link canonicalTimeOfDay}). Shared by the filter
   * (`coerceFilterValue`), write (`formatInput`) and read (`formatOutput`,
   * `presentReadValue`) paths, exactly like {@link toDateOnly} for `Field.date`
   * — one definition of what a time *is* on all three, which is the #3994 fix.
   * On read it transparently repairs legacy rows (full-timestamp text from the
   * old `CURRENT_TIMESTAMP` default, epoch ms from a bound `Date`) with no data
   * migration, and re-pads a dialect's trimmed fraction (Postgres returns
   * `.5` for the stored `.500`).
   */
  protected toTimeOnly(value: any): any {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts`.
    return FilterHelpersFacet.toTimeOnly(value);
  }

  /**
   * Put a filter comparand into the same canonical form the column is STORED in,
   * so a comparison can never be decided by the two sides' shapes disagreeing.
   *
   * `Field.datetime` → canonical UTC ISO ({@link canonicalUtcDatetime}), the
   * exact function `formatInput` applies on write. One rule, every dialect:
   *   - It is what a SQLite column now holds, as TEXT that sorts chronologically,
   *     so the comparison is a plain indexable string compare.
   *   - It is unambiguous for a Postgres `timestamptz`. This part is a FIX, not a
   *     no-op: the comparand used to be passed through untouched there, so a bare
   *     `YYYY-MM-DD` from a `{30_days_ago}` token meant midnight in the SERVER's
   *     timezone. Measured on an `Asia/Shanghai` server, the identical query put
   *     the identical instant on a different calendar day than SQLite did — a
   *     silently wrong window rather than an empty one.
   *
   * The previous rule coerced to an epoch INTEGER on SQLite only, which assumed
   * a storage form the write path never guaranteed; see #3912 for why that could
   * not be made correct without also rewriting what the writer produces.
   *
   * `Field.date` keeps ISO TEXT, normalised to `YYYY-MM-DD` (ADR-0053 Phase 1).
   */
  protected coerceFilterValue(table: string | null, field: string, value: any): any {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.coerceFilterValue.call(filterHelpersHost.of(this), table, field, value);
  }

  /**
   * Might this SQLite `Field.datetime` column still hold values written BEFORE
   * the canonical-UTC-text convention (#3912) — an INTEGER/REAL epoch from a
   * bound JS `Date`, a zone-naive `CURRENT_TIMESTAMP` string, an offset-bearing
   * `+08:00` string — and therefore need
   * {@link sqliteCanonicalDatetimeSql} wrapped around it before it is compared
   * or bucketed?
   *
   * This is the ONE predicate for that question. Every consumer of it has already
   * been bitten by disagreeing about storage — the filter comparand (#2034, then
   * #3912) and the aggregate bucket expression (#3773) — so they share it rather
   * than each carrying a copy of the rule.
   *
   * `false` in three cases, and the third is the point of the whole exercise:
   *   - not SQLite (Postgres/MySQL have a real temporal type);
   *   - not a declared `Field.datetime`;
   *   - the column has been BACKFILLED to the canonical form in this process
   *     ({@link backfillCanonicalDatetimes}), so every row is already canonical
   *     text and the repair would only cost an unindexable expression.
   *
   * That last exit is what makes the convention pay off rather than just move the
   * cost around: after migration the emitted SQL is a plain `col >= ?` again.
   */
  /**
   * The physical form a `Field.datetime` value takes on THIS dialect — what is
   * actually bound, on both the write path (`formatInput`) and the filter path
   * (`coerceFilterValue`), so the two can never disagree.
   *
   * The logical canon is {@link canonicalUtcDatetime}'s `…Z` string everywhere.
   * MySQL is the one dialect that cannot parse it, so it gets the same instant
   * spelled as a MySQL literal (see {@link mysqlDatetimeLiteral}); SQLite stores
   * the canonical string as-is and Postgres parses it straight into `timestamptz`.
   */
  protected storageDatetimeValue(value: unknown): unknown {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.storageDatetimeValue.call(filterHelpersHost.of(this), value);
  }

  protected needsLegacyDatetimeRepair(table: string | null | undefined, field: string): boolean {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.needsLegacyDatetimeRepair.call(filterHelpersHost.of(this), table, field);
  }

  /**
   * Read a possibly-legacy SQLite `Field.datetime` column as canonical UTC text
   * — the SQL twin of {@link canonicalUtcDatetime}, for rows written before the
   * convention existed and not yet backfilled.
   *
   * `strftime('%Y-%m-%dT%H:%M:%fZ', …)` is the same format string
   * {@link nowColumnDefault} already writes, so a repaired value is
   * byte-identical to a freshly written one — which is what lets the comparison
   * be a plain text compare. The `typeof()` dispatch is load-bearing: an epoch
   * INTEGER handed to `strftime` unconverted is read as a Julian day (#3773),
   * while `'unixepoch'` applied to text would read its leading year as seconds.
   *
   * `coalesce(…, col)` preserves genuinely uninterpretable junk instead of
   * turning it into NULL, matching `canonicalUtcDatetime`'s totality — a value
   * the driver cannot parse keeps failing the comparison, rather than silently
   * becoming "no value".
   */
  protected sqliteCanonicalDatetimeSql(columnSql: string): string {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts`.
    return FilterHelpersFacet.sqliteCanonicalDatetimeSql(columnSql);
  }

  /**
   * Is this TEXT cell one that SQLite's date functions ANSWER FOR without it
   * being a spelling of any temporal literal? (#6009)
   *
   * The `else` arm of {@link sqliteCanonicalDatetimeSql} /
   * {@link sqliteCanonicalTimeSql} leans on `coalesce(strftime(…), col)` to
   * preserve what it cannot parse. That reasoning has one hole, and it is not a
   * NULL: SQLite's time-value grammar accepts a **bare number** as a JULIAN DAY
   * (`DDDD.DDDD`, the last of its documented formats) and the keyword `now`.
   * For those two shapes `strftime` does not return NULL — it returns a
   * confident wrong answer, so `coalesce` never fires. Measured on
   * better-sqlite3 13.0.3 / SQLite 3.53.4, with the column declared `TEXT`:
   *
   * ```text
   * '2026'      -> -4707-06-11T12:00:00.000Z   'now'  -> the wall clock, now
   * '86400'     -> -4476-06-15T12:00:00.000Z   '1e5'  -> -4439-09-09T12:00:00.000Z
   * '2440587.5' ->  1970-01-01T00:00:00.000Z   (the julian epoch — still a julian read)
   * ```
   *
   * On a READ that is a temporary misreading and the bytes on disk survive it.
   * On the SET side of {@link backfillCanonicalDatetimes} /
   * {@link backfillCanonicalTimes} the same expression WRITES that answer over
   * the original value, and no later run can get it back — which is the one
   * thing the backfill contract promises it never does ("a value SQLite cannot
   * parse … is left alone rather than destroyed").
   *
   * ## The predicate is the COMPLEMENT of the parseable spellings, not a heuristic
   *
   * Every other format `sqlite3ParseDateOrTime` accepts goes through
   * `parseYyyyMmDd` (which requires `YYYY-MM-DD`, so a `-`) or `parseHhMmSs`
   * (which requires `HH:MM`, so a `:`). So a cell that the date functions parse
   * while containing NEITHER character reached them through the julian-day
   * limb or the `now` limb — there is no third way in. That is a structural
   * exclusion, not a guess about what a value "looks like": it never inspects
   * the magnitude of the number and never decides what the cell MEANS.
   *
   * `julianday()` rather than `strftime()` for the parse probe because the two
   * agree on NULL-ness by construction (both call the same parser) and this way
   * the predicate is format-free, so one spelling serves both the datetime
   * expression and the time one.
   *
   * ⛔ This is a BACKFILL-SIDE guard and belongs nowhere near the read path.
   * The maintainer's 2026-08-03 ruling on cloud#1005 refused teaching the
   * shared read expression to recognise numeric-looking text: that expression
   * is a public contract for every SQLite consumer, it runs on every read, and
   * there it would misread a legitimate numeric-string column. Everything here
   * runs once, as a migration, only on a column the METADATA declares
   * `Field.datetime` / `Field.time`, and it only ever declines to WRITE.
   *
   * The column reference appears {@link SQLITE_NON_TEMPORAL_TEXT_REFS} times;
   * callers bind accordingly.
   */
  protected sqliteNonTemporalTextSql(columnSql: string): string {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts`.
    return FilterHelpersFacet.sqliteNonTemporalTextSql(columnSql);
  }

  /**
   * The `Field.time` twin of {@link needsLegacyDatetimeRepair} (#3994): might
   * this SQLite `Field.time` column still hold pre-canonical values and
   * therefore need {@link sqliteCanonicalTimeSql} wrapped around it?
   */
  protected needsLegacyTimeRepair(table: string | null | undefined, field: string): boolean {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.needsLegacyTimeRepair.call(filterHelpersHost.of(this), table, field);
  }

  /**
   * Read a possibly-legacy SQLite `Field.time` column as canonical time-of-day
   * text — the SQL twin of {@link canonicalTimeOfDay}, for rows written before
   * the convention existed and not yet backfilled.
   *
   * `strftime` parses every legacy text shape in one call — bare `HH:MM`,
   * full-ISO, zone-naive `CURRENT_TIMESTAMP` output — and the `typeof()`
   * dispatch converts epoch INTEGER/REAL through `'unixepoch'`, exactly as in
   * {@link sqliteCanonicalDatetimeSql}. The extra `like '%.000'` CASE trims the
   * zero-millisecond suffix `%f` always emits, so the SQL spelling of
   * "canonical" is byte-identical to the JS one — the property the backfill's
   * `IS NOT` guard and the plan's row count both lean on.
   *
   * `coalesce(…, col)` preserves uninterpretable junk, matching
   * `canonicalTimeOfDay`'s totality. The column reference appears
   * {@link SQLITE_TIME_EXPR_REFS} times; callers bind accordingly.
   */
  protected sqliteCanonicalTimeSql(columnSql: string): string {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts`.
    return FilterHelpersFacet.sqliteCanonicalTimeSql(columnSql);
  }

  /**
   * Which temporal presentation rule, if any, a declared field takes —
   * `null` for everything that is not a `Field.datetime` / `Field.date` /
   * `Field.time`.
   */
  protected temporalFieldKind(
    table: string | null | undefined,
    field: string,
  ): 'datetime' | 'date' | 'time' | null {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.temporalFieldKind.call(filterHelpersHost.of(this), table, field);
  }

  /**
   * Which read-presentation rule, if any, a declared field takes — the same
   * question {@link formatOutput} answers implicitly while walking a `find()`
   * row, asked one field at a time so the paths that return raw builder output
   * can ask it too. `null` means the stored form already IS the presented form.
   *
   * The temporal kinds run on every dialect. For `datetime` that is [ADR-0053
   * D-F1] (#13973): the fold was SQLite-only before, so `aggregate()` and
   * `distinct()` handed Postgres' and MySQL's `Date` through here exactly as
   * `find()` did. The builtin audit columns take their OWN rule,
   * `audit_timestamp` — the same `presentAuditTimestampOutput` `formatOutput`
   * applies to them — unless the author declared the column temporal (the
   * engine's `applySystemFields` declares both as `Field.datetime`), in which
   * case the temporal rule wins here exactly as `formatOutput`'s datetime fold
   * runs after its audit fold there. They are not in `datetimeFields` by
   * themselves (builtin, not declared), and before #13973 this function had
   * NO arm for them on ANY dialect, so `max(updated_at)` and
   * `distinct('created_at')` diverged from `find()` even on SQLite, where they
   * missed ADR-0074's legacy-row repair. The arm is the audit presenter and
   * not the `datetime` one because the two differ on a NUMBER: ADR-0074 §3
   * passes an epoch INTEGER through on a `find()` row, and a `created_at` the
   * author declared non-temporal (`applySystemFields` lets the declaration
   * win; `AUDIT_FIELD_GOVERNANCE` forces only `readonly` / `system`, never
   * `type`) leaves `find()` as the number it is — routed to the datetime fold,
   * both became ISO text at this door and nowhere else (commit 45cfa1b88's contract
   * review's finding; `sql-driver-13973-canonical-iso-read-door.test.ts` §D
   * pins the agreement).
   *
   * The boolean rule runs on SQLite AND MySQL — the two dialects that store a
   * declared boolean as a number (INTEGER 0/1, `tinyint(1)`) — because
   * `formatOutput` gates its row reads that way (#11782; SQLite-only before,
   * which is how a declared boolean answered `1`/`0` on MySQL). Postgres
   * stores a real `boolean` node-pg parses, so there the stored form already
   * IS the presented form. The numeric repair ran SQLite-only on the premise
   * that string-valued numerics exist only for legacy TEXT-affinity columns;
   * #16318 falsified that premise by moving the numeric family to an exact
   * decimal, which node-postgres and mysql2 both hand back as a string, so it
   * runs on every dialect now.
   */
  protected readPresentationKind(
    table: string | null | undefined,
    field: string,
  ): ReadPresentationKind | null {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.readPresentationKind.call(filterHelpersHost.of(this), table, field);
  }

  /**
   * Present one value through the presenter `formatOutput` applies to that
   * column class on a `find()` row, for the read paths that return raw builder
   * output instead (`aggregate`, `distinct` — #3797 for instants, #3849 for
   * scalars): one presenter per kind, and it is the function `formatOutput`
   * itself calls, never a re-derivation of it.
   *
   * The dialect gating mirrors `formatOutput`: the three temporal folds and
   * the audit-stamp fold run everywhere (`datetime` and `audit_timestamp`
   * since #13973, [ADR-0053 D-F1] — the former SQLite-only and the latter
   * absent before, which handed the two live dialects' `Date` through), the
   * numeric coercion runs everywhere (#16318 for a declared numeric column;
   * [#20335] for `aggregate()`'s counts and totals, `AGGREGATE_ANSWER_KIND`),
   * and the boolean coercion runs on SQLite
   * and MySQL (#11782 — the two dialects whose stored boolean is a number).
   * {@link readPresentationKind} does the dialect gating for the scalar kinds,
   * so by the time one arrives here the dialect is settled.
   *
   * Where this is NOT `formatOutput` to the letter: a row walk COMPOSES. A
   * `created_at` an author declared `number` takes the SQLite numeric repair
   * and then the audit presenter there, while here it takes the audit
   * presenter alone (`readPresentationKind` answers one kind per column). The
   * two differ on any TEXT that `Number()` accepts but SQLite's NUMERIC
   * affinity leaves as TEXT — hex, binary and octal literals (`'0x10'`,
   * `'0b101'`, `'0o17'`) and `'Infinity'` — which `find()` reads as the number
   * (`16`, `5`, `15`, `Infinity`) and this door as the string; that is
   * reachable through `create()` / `update()` on the driver's own DDL with an
   * author-declared non-temporal audit column, not only through a hand-made
   * TEXT-affinity column (measured in the contract review commit 45cfa1b88 records). A decimal
   * or exponent spelling (`'1700000000000'`, `'1e3'`, `'.5'`) is folded to
   * INTEGER/REAL by the affinity before it is read back, and a number passes
   * both presenters untouched, so those agree. The B1 ruling did not decide
   * that residual shape — it lies outside its column classes — and nothing
   * here closes it. `sql-driver-13973-canonical-iso-read-door.test.ts` §D
   * pins the agreement on the shapes the ruling covers.
   */
  protected presentReadValue(kind: ReadPresentationKind, value: any): any {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.presentReadValue.call(filterHelpersHost.of(this), kind, value);
  }

  /**
   * Apply {@link presentReadValue} to the result columns a caller of
   * `aggregate()` will read as column VALUES — group keys, and `min`/`max` —
   * and [#20335] to its counts and totals (`count`, `count_distinct`, `sum`,
   * `avg`), which take the `'number'` presenter (`AGGREGATE_ANSWER_KIND`).
   *
   * Which columns those are cannot be recovered from the rows — the driver has
   * to be told, because the mapping from column name to meaning is only
   * unambiguous while the statement is being built (a `min()` lands under its
   * alias; a date-BUCKETED column lands under the field name but holds a label).
   * Rows are mutated in place, as `formatOutput` does.
   */
  protected presentReadColumns(rows: any, columns: Map<string, ReadPresentationKind>): any {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.presentReadColumns.call(filterHelpersHost.of(this), rows, columns);
  }

  /**
   * The value expression to hand SQLite's `strftime()` for a bucketed column.
   *
   * Canonical UTC text (#3912) is passed straight through — `strftime` parses it,
   * `YYYY-MM-DD`, and the zone-naive `CURRENT_TIMESTAMP` form alike. A column
   * that may still hold PRE-canonical values gets {@link sqliteCanonicalDatetimeSql}
   * wrapped around it, which is likewise text, so `strftime` sees one shape
   * either way.
   *
   * Without that repair an epoch INTEGER reaches `strftime` as a bare number,
   * which SQLite reads as a Julian DAY — epoch ms is far outside the legal range,
   * so every row buckets as NULL and a trend chart collapses to one `(null)` bar
   * (#3773). The `typeof()` dispatch inside the repair is equally load-bearing in
   * the other direction: dividing a TEXT timestamp by 1000 coerces it to its
   * leading year (`'2026-01-10T…'/1000.0` = 2.026 seconds past the epoch),
   * bucketing live rows into 1970 — strictly worse than the NULL it replaces.
   */
  protected sqliteTemporalArg(
    field: string,
    table: string | null | undefined,
  ): { sql: string; bindings: any[] } {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.sqliteTemporalArg.call(filterHelpersHost.of(this), field, table);
  }

  /**
   * The left-hand side of a filter comparison on `column`, read in the same
   * canonical form {@link coerceFilterValue} puts the comparand in.
   *
   * `null` — the answer for every dialect, every non-datetime column, and every
   * SQLite datetime column that has been backfilled — means the plain identifier
   * is already correct, so the caller keeps the ordinary Knex builder call and
   * its indexable `col op ?` SQL. Only a column that may still hold PRE-canonical
   * values ({@link needsLegacyDatetimeRepair}) is wrapped.
   */
  protected filterColumnExpr(
    table: string | null | undefined,
    field: string,
    column: string,
  ): { sql: string; bindings: any[] } | null {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.filterColumnExpr.call(filterHelpersHost.of(this), table, field, column);
  }

  /**
   * Compile one VALUE comparison against a storage-normalised column expression
   * ({@link filterColumnExpr}), for the operators where the stored form actually
   * matters.
   *
   * Returns `false` — "not handled, carry on" — for everything else, so the
   * caller's normal Knex path still owns: null predicates (`IS NULL` reads the
   * raw column and is form-independent), the `LIKE` family (a substring match on
   * an instant is meaningless, and the raw column is what the user typed
   * against), an empty `in`/`nin` set (Knex's `1 = 0` / `1 = 1` shortcuts), and a
   * malformed `between` (so the caller still throws its descriptive error).
   */
  private applyNormalizedComparison(
    builder: any,
    join: 'and' | 'or',
    expr: { sql: string; bindings: any[] },
    op: string,
    value: unknown,
  ): boolean {
    // [#25521 cut 16] The body moved to `sql-driver-predicate-emitters.ts`; it reads no member of the driver.
    return applyNormalizedComparison(builder, join, expr, op, value);
  }

  /**
   * Public, dialect-correct temporal filter-value coercion for callers that
   * build SQL *outside* the normal `find()`/`applyFilters()` path — chiefly the
   * analytics native-SQL strategy, which compiles a raw `SELECT … WHERE col >= $N`
   * and binds the value directly, bypassing `coerceFilterValue`.
   *
   * Given a logical object (table) name, a field name and a filter value
   * (typically an ISO date/datetime string from a dashboard relative-date
   * token like `{12_months_ago}`), this returns the value in the column's
   * on-disk storage form:
   *   - SQLite `Field.datetime` → epoch milliseconds (INTEGER), so the
   *     comparison matches the stored integer rather than failing a
   *     TEXT-vs-INTEGER affinity compare.
   *   - `Field.date` (any dialect)   → `YYYY-MM-DD` text.
   *   - Native-timestamp dialects / non-temporal fields → value unchanged.
   *
   * This is a thin, intentionally narrow wrapper over the same `coerceFilterValue`
   * the driver already uses, so there is exactly one source of truth for the
   * storage convention and the analytics path can never drift from CRUD.
   *
   * Deliberately operator-blind — it translates FORM, never bound semantics.
   * A caller compiling an upper bound from a bare calendar day (`<= {today}`,
   * a `dateRange` end) must apply `nextUtcCalendarDay` from `@objectstack/core`
   * and emit `<` — the half-open translation the shared lowering
   * (`lowerFilterCondition`, `@objectstack/spec/data`) applies at the seams
   * before a filter reaches `find()` (ADR-0053 D-D1, amended; #3777). Folding
   * that in here would silently widen every `<=`-bound value whether or not the
   * caller flips its operator, which is exactly the ambiguity an
   * operator-sensitive rule avoids.
   */
  // [commit be5c60291] The contract declares this hook `unknown`-returning; the class
  // published a bare `any`, which is the same family as the promise-shaped
  // doors above and the one member of it that is synchronous. Pinned through
  // `ReturnType` rather than `Resolved` in
  // `sql-driver-doors-declared-types.test.ts`.
  public temporalFilterValue(objectName: string, field: string, value: any): unknown {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.temporalFilterValue.call(filterHelpersHost.of(this), objectName, field, value);
  }

  /**
   * The companion of {@link temporalFilterValue} for the same outside-the-builder
   * callers: given the SQL they were going to put on the LEFT of the comparison
   * (an already-quoted, possibly join-qualified column reference), return the SQL
   * they must use instead so the column reads in the storage form the coerced
   * comparand is in.
   *
   * Everything but a SQLite `Field.datetime` gets its `columnSql` back verbatim.
   * That one case gets the {@link sqliteEpochMsSql} CASE, because the column is
   * mixed INTEGER-epoch / ISO-TEXT and coercing only the value matches whichever
   * half the writer happened to produce (#3912). Coercing the value is therefore
   * necessary but NOT sufficient — a caller that binds `temporalFilterValue`
   * must wrap its column with this too, or it keeps half the bug.
   */
  public temporalFilterColumnSql(objectName: string, field: string, columnSql: string): string {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.temporalFilterColumnSql.call(filterHelpersHost.of(this), objectName, field, columnSql);
  }

  /**
   * [#7398] Is `localField` stored as a JSON TEXT column on `table`?
   *
   * Reads `jsonFields` — the per-table registry both `initObjects` and
   * `registerExternalObject` fill from {@link SqlDriver.isJsonField}, i.e.
   * `JSON_COLUMN_TYPES.has(type) || isMultiValueField(field)`. Asking THAT registry
   * rather than growing a second one is the whole point: `JSON_COLUMN_TYPES`
   * already carries a header calling itself the single source for the DDL
   * column-type switch and `isJsonField` "so the two can't drift", and a
   * filter-side copy of "which columns are JSON" would be a third list to keep
   * in step with the first two.
   *
   * It answers on the LOCAL field name, which is what the registry is keyed by
   * (both writers enumerate `obj.fields`), not the possibly-remapped remote
   * column an external `columnMap` produces.
   *
   * **A table with no entry answers `false`, deliberately.** A table this
   * driver was never told about — one created straight through knex, as the
   * conformance sweeps do — has no field types to consult, and inventing a
   * refusal from an absent registry would refuse filters on ordinary columns.
   * The gate fires only where the column type is KNOWN to be JSON.
   */
  protected isJsonColumn(table: string | null | undefined, localField: string): boolean {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.isJsonColumn.call(filterHelpersHost.of(this), table, localField);
  }

  /**
   * [#21236] Which class of JSON column `localField` is on `table`, or
   * `undefined` when it is not a JSON column here ({@link isJsonColumn}). The
   * JSON-column refusal's reason and repair turn on it
   * (`JsonColumnFieldClass`, `@objectstack/core`).
   *
   * `'single-value-media'` is a field BOTH registries name: {@link mediaFields}
   * (a single-value file-class field, on either arm of the ADR-0104 window) and
   * `jsonFields`. {@link isJsonField} put such a field in `jsonFields` only
   * because {@link mediaColumnIsJson} answered `true` when it registered, so
   * the window is asked once, by the predicate that already asks it, and this
   * method asks only the class. On a deployment whose columns have moved the
   * field is not a JSON column, and this answers `undefined`. Every other JSON
   * column (a multi-value field, a structured-JSON type) is
   * `'multi-value-or-json'`.
   *
   * `driver-turso`'s remote transport asks the same question through this
   * method, so both faces of one `TursoDriver` word one refusal.
   */
  protected jsonColumnFieldClass(table: string | null | undefined, localField: string): JsonColumnFieldClass | undefined {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.jsonColumnFieldClass.call(filterHelpersHost.of(this), table, localField);
  }

  /**
   * [#14079/#15683, commit 82cb69fed] Is `localField` a column on `table` a text operator
   * must not be aimed at — a SCALAR column DECLARED numeric, boolean or
   * temporal?
   *
   * Reads the registries `formatOutput`'s read-coercion and the temporal seam
   * already read — `numericFields` (`NUMERIC_SCALAR_TYPES`, non-`multiple`),
   * `booleanFields` (`boolean` / `toggle`) and, through
   * {@link SqlDriver.temporalFieldKind}, `datetimeFields` / `dateFields` /
   * `timeFields` — which `initObjects` and `registerExternalObject` both fill
   * from the declared field type. Asking THOSE rather than growing another
   * list is the same discipline {@link isJsonColumn} states for `jsonFields`:
   * one registry per column class, filled at the one place the declaration is
   * read. Spec-side the same four classes are `NON_TEXT_STORED_VALUE_TYPES`;
   * this driver's registries add its SQL aliases (`integer` / `int` / `float`)
   * on top, as that constant's docblock says drivers do.
   *
   * A table with no entry answers `false`, exactly like {@link isJsonColumn}:
   * a table this driver was never told about has no declared types, and the
   * gate fires only where the column class is KNOWN — never from a guess.
   *
   * [#15683] Temporal columns joined this predicate by RULING, not by storage.
   * On SQLite a `Field.date` / `Field.datetime` / `Field.time` column's stored
   * value IS text (canonical ISO, ADR-0053), so `GLOB '*2026*'` matched a date
   * by ISO substring here while live Postgres refused the same filter at query
   * time (SQLSTATE 42883 `operator does not exist: date ~~ unknown`, a
   * `DATABASE_ERROR` 500) — one filter, three answers across the family, with
   * MySQL never measured. The maintainer ruled it on 2026-09-05 (recorded on
   * #15683): 「a text operator over a column whose DECLARED type is temporal is
   * type-gated exactly like the numeric and boolean classes; the SQLite
   * ISO-text match is not a contract」. That match is RETIRED, deliberately: a
   * caller who wants "records in 2026" uses the range operators
   * (`$gte` / `$lt`, or `$between`), which every dialect answers the same way.
   *
   * ⚠️ The gate keys on the DECLARATION, never on the storage class — which is
   * why {@link temporalFieldKind} rather than a "does this column hold text"
   * test is the right question. `canonicalDatetimeFields` (whether a column has
   * been certified canonical) is a REPAIR concern and deliberately not read
   * here: an uncertified column is still a declared datetime, and gating on
   * certification would make the answer depend on repair state.
   *
   * ⚠️ A MULTI-VALUED column is excluded on EVERY limb, and the exclusion is
   * load bearing. `multiple: true` stores a JSON TEXT array ({@link
   * isJsonField}), where `$contains` is not a substring test at all — it is the
   * MEMBERSHIP spelling, the one operator #7398 left working on a JSON column
   * after refusing the equality family there, and downstream code depends on it
   * (`sql-driver-json-column-operator-refusal.test.ts` pins it on both lowering
   * families). Gating it turns a working membership filter into "matches
   * nothing" — the fail-CLOSED direction that suite's own table calls out.
   *
   * Each limb spells the exclusion where its own registry leaves it unsaid:
   *
   * - **numeric** — at the REGISTRY. `numericFields` is filled
   *   `NUMERIC_SCALAR_TYPES.has(type) && !isMultiValuedColumn(type, field)`
   *   (#17469 — was `!field.multiple`), so the condition never reaches this
   *   predicate.
   * - **temporal** [#15683] — HERE. `dateFields` / `datetimeFields` /
   *   `timeFields` serve the read-presentation seam, which DOES apply to a
   *   multi-valued column, so narrowing them would break a seam that is right.
   * - **boolean** [commit 82cb69fed] — HERE, and this limb had NEITHER until then.
   *   #14079 landed this predicate describing itself as "a declared numeric or
   *   boolean SCALAR" and annotated the numeric registry as non-`multiple`, so
   *   the omission was the gap between that stated scope and `booleanFields`'
   *   silence.
   *
   *   ⚠️ [commit d46deba19] `booleanFields` was SINCE narrowed at both fills, for a
   *   defect of its own (the read coercion collapsed a parsed array to a
   *   single, inverted `true`).
   *
   *   ⭐ [#17469] And the shape both of those cards were about no longer
   *   exists: `boolean` + `multiple: true` is refused at the authoring
   *   entrance and is not a JSON column here, so a boolean/toggle column can
   *   never BE a JSON column and this limb's carve-out has no reachable input.
   *   It is kept deliberately, as defence and as the statement of the rule for
   *   the limb — a text operator is legal against a JSON column — where the
   *   registry states only which columns take a coercion.
   *   `sql-driver-17586-multi-valued-boolean-read-inversion.test.ts` pins the
   *   partition the two now form (no JSON column is in `booleanFields`) and
   *   both halves of the #17469 ruling, so a divergence turns that file red
   *   rather than moving this answer.
   */
  protected isNonTextColumn(table: string | null | undefined, localField: string): boolean {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.isNonTextColumn.call(filterHelpersHost.of(this), table, localField);
  }

  private applyTextOperatorOverNonTextColumn(builder: any, logicalOp: 'and' | 'or', op: string): void {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts`, its docblock with it (see `FilterHelpersHost`).
    return FilterHelpersFacet.applyTextOperatorOverNonTextColumn.call(filterHelpersHost.of(this), builder, logicalOp, op);
  }

  /**
   * [#20444] The field's DECLARED value shape, or `undefined` when this driver
   * holds no declaration for it — see {@link valueShapeFields}. Keyed like
   * {@link isJsonColumn}: the registry key the builder's table resolves to and
   * the LOCAL field name. `driver-turso`'s remote transport asks the same
   * question through this method, so its two faces read one registry.
   */
  protected declaredValueShape(table: string | null | undefined, localField: string): ValueShapeFieldDef | undefined {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.declaredValueShape.call(filterHelpersHost.of(this), table, localField);
  }

  /**
   * [#20444] Compile `{ field: { $empty: true | false } }` — the
   * emptiness operator, answered by the field's DECLARED row of the ruled
   * 「is empty」 table (ruling B on #20311, record 5861435168; spelled as this
   * operator by ruling A on #20399, record 5865693155), through the spec's one
   * expansion, {@link expandEmptyOperator}:
   *
   * | declared row | `$empty: true` | `$empty: false` — the exact complement |
   * |---|---|---|
   * | `null_only` (every other type) | `col IS NULL` | `col IS NOT NULL` |
   * | `text` (the text-like types) | `(col IS NULL OR col = '')` | `(col IS NOT NULL AND col <> '')` |
   * | `multi_value` (a list-valued field) | `(col IS NULL OR L)` | `(col IS NOT NULL AND NOT L)` |
   *
   * `L` is {@link emptyJsonListPredicate}, the dialect's test for "this stored
   * JSON value is the empty list". An empty list is tested as a STORED VALUE,
   * never bound as a `$eq: []` comparand (ruling 乙 on #19757 still refuses an
   * empty list there).
   *
   * Every predicate is TOTAL — TRUE or FALSE on every row, never UNKNOWN —
   * because both polarities spell the NULL case out and `L` is never NULL for a
   * stored value. So a `$not` over `$empty` needs no guard (the shared
   * lowering's polarity table reads it as total) and `NOT (…)` is the
   * exact complement, with no three-valued-logic hole. Each predicate is one
   * knex group, so its `OR` can never re-associate with a sibling conjunct.
   *
   * Refused, before anything is emitted: a field with no declaration here
   * ({@link undeclaredEmptyOperatorFieldError}), and the multi-value row on a
   * dialect this driver does not model ({@link emptyListUnsupportedDialectError}).
   *
   * [#20446] `$empty` is in `FILTER_OPERATORS`, and the view operators
   * `is_empty` / `is_not_empty` lower to it, so a stored view rule reaches this
   * arm: the undeclared-field refusal above is what such a rule on the
   * built-in `id` (or any column this driver was never told the type of)
   * answers, where the old `$null` lowering compiled `IS NULL`.
   */
  private applyEmptyOperator(
    builder: any,
    logicalOp: 'and' | 'or',
    table: string | null | undefined,
    localField: string,
    field: string,
    empty: boolean,
    // The field's operator map — the node a refusal is resolved against (#8220).
    subtree: unknown,
  ): void {
    // [#25521 cut 16] The body moved to `sql-driver-predicate-emitters.ts` (see `PredicateEmitterHost`).
    const readDialectName = () => this.dialectName;
    const host: ThisParameterType<typeof applyEmptyOperator> = {
      declaredValueShape: (...a) => this.declaredValueShape(...a),
      get dialectName() { return readDialectName(); },
    };
    return applyEmptyOperator.call(host, builder, logicalOp, table, localField, field, empty, subtree);
  }

  /**
   * [#7398] The column-type half of the filter gate: refuse a DECLARED operator
   * that the column it was aimed at cannot give a meaningful answer for.
   *
   * The sibling of {@link assertCompilableComparand}, and called from the same
   * three positions, one per lowering entry: the operator-object branch of
   * {@link SqlDriver.applyFilterCondition}, that method's bare-value branch,
   * and the plain `{ field: value }` loop in {@link SqlDriver.applyFilters}.
   * The two gates ask different questions of the same comparison — that one
   * asks whether the COMPARAND can be bound, this one whether the COLUMN can be
   * compared — and #7398 is the square of that grid that had nothing on it.
   *
   * Placed BEFORE the comparand coercion and before
   * {@link SqlDriver.applyNormalizedComparison}, because a JSON column reaches
   * BOTH emitters and only one of them is the site the issue named. A
   * `multiple: true` datetime field on an external object (ADR-0015) has a
   * `filterColumnExpr` — `registerExternalObject` never marks its datetime
   * columns canonical, so `needsLegacyDatetimeRepair` stays true — and is
   * therefore served by the normalised `whereRaw` arms, not by the plain
   * `whereIn` / `where(field, op, v)` arms a managed `multiple: true` lookup
   * goes through. Measured on both before this gate existed: `$in` → 0 rows,
   * `$nin` → the excluded row, on each.
   */
  protected assertOperatorAppliesToColumn(
    table: string | null | undefined,
    localField: string,
    column: string,
    op: string,
    bare = false,
    // [#8197] The filter node this constraint was read from, so the refusal can
    // be resolved against the query's `where` root like every other withheld
    // one. Optional, and absent means WITHHELD — a subclass that overrides this
    // method without threading it degrades onto the fail-closed branch rather
    // than onto the disclosing one.
    subtree?: unknown,
  ): void {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.assertOperatorAppliesToColumn.call(filterHelpersHost.of(this), table, localField, column, op, bare, subtree);
  }

  /**
   * [#7929] Compile `filters` into `builder`, and write the server-side half of
   * any REDACTED refusal to the log on the way out.
   *
   * This method is the single production entry into the filter compiler — every
   * `find` / `count` / `aggregate` / `update` / `delete` path in this file
   * reaches {@link SqlDriver.applyFilterCondition} through it, and that method
   * recurses only into itself. So one `catch` here sees every refusal the three
   * `{ $field }` builders raise ({@link crossFieldComparisonError},
   * {@link bareFieldReferenceError}, {@link uncompilableFieldReferenceError})
   * without a per-throw-site call, and without a re-entrancy guard. [#8197] It
   * sees the target-field family the same way, including the two members raised
   * on the REDUCTION walk ({@link emptyFieldConstraintError}) rather than in the
   * emitter — that walk runs at the top of `applyFilterCondition`, inside this
   * frame.
   *
   * [#20039] Since the class was closed, EVERY refusal raised under this frame
   * arrives here as a withheld carrier — the walk's shape refusals, the
   * comparand gates, the operator vocabulary and the array-root refusal alike
   * (see {@link unsupportedFilterError} for the three direct callers left, none
   * of them under this frame). So the verdict below is the only thing that
   * decides what a compile refusal may name; no builder decides it by omission.
   *
   * The log is `this.logger` — the sink this driver already owns, which a host
   * injects and a test spies on. ⛔ Not `console.warn` from the module-level
   * builders: that would bypass an injected sink, which is the whole reason the
   * property exists.
   *
   * The rethrow is the original error, untouched: the caller-visible message,
   * `code` and `status` are the redacted refusal's own, and the diagnostic
   * stays on the symbol key where nothing that serialises an error can reach it.
   */
  protected applyFilters(builder: Knex.QueryBuilder, filters: any, options?: DriverOptions): void {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.applyFilters.call(filterHelpersHost.of(this), builder, filters, options);
  }

  /**
   * [#8220] Decide what a redacted refusal may say, now that the tree can
   * carry the read-scope provenance mark — and return the error to throw.
   *
   * A refusal raised from a subtree POSITIVELY marked `'author'` (by
   * `plugin-security`'s CRUD injection or `service-analytics`'
   * `ObjectQLStrategy.withReadScope` — the two boundaries that know which arm
   * of their merge the caller wrote) is swapped for its full author-facing
   * text: both columns, the operator, the list index, the boundary reason.
   * Same identity — `INVALID_FILTER` / 400 — different words.
   *
   * [#8197] Unchanged by the second family joining it, which is the point: the
   * target-field refusals ({@link refusalSubtree}) reach this method as the same
   * carrier with the same three keys, so there is ONE place that decides what a
   * redacted refusal may say and one default it can decide with. A second seam
   * would have been a second chance to get the fail direction wrong.
   *
   * ⚠️ Everything else stays REDACTED and goes to the server log, exactly as
   * #7929/B left it: a `'policy'` verdict, an UNMARKED tree (no boundary ever
   * vouched), an AMBIGUOUS one (the node is unreachable from this query's
   * `where` — e.g. rewritten between merge and refusal — or aliased under
   * conflicting marks), and an error that never carried its subtree at all.
   * The mark is permission to reveal, never a requirement to prove secrecy;
   * inverting that default — treating "mark missing" as "safe to disclose" —
   * silently restores the original disclosure on every unmarked policy
   * predicate and is the one shape the #7929 triage rejected. Do not
   * "simplify" the `=== 'author'` reading below into anything that discloses
   * on a missing mark.
   *
   * The disclosed error is a fresh `unsupportedFilterError` carrying NO
   * symbol keys: there is no diagnostic left to relocate, so the log seam has
   * nothing to write for it, and an outer frame that resolves an
   * already-resolved error passes it through untouched (the double-catch
   * shape {@link SqlDriver.withWithheldFilterLog} exists for).
   */
  protected resolveWithheldFilterRefusal(err: unknown, rootFilter: unknown): unknown {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.resolveWithheldFilterRefusal.call(filterHelpersHost.of(this), err, rootFilter);
  }

  /**
   * [#7929] Write the withheld half of a redacted refusal to the server log.
   *
   * A no-op for every other error, so the `catch` above stays a pass-through
   * for the refusals that were never redacted (they say everything they have to
   * say on the wire already).
   */
  protected logWithheldFilterDiagnostic(err: unknown): void {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.logWithheldFilterDiagnostic.call(filterHelpersHost.of(this), err);
  }

  /**
   * [#7929] Run `fn`, writing the server-side half of a redacted refusal before
   * rethrowing it.
   *
   * Applied at every KNEX GROUP CALLBACK as well as at {@link applyFilters},
   * and that is a measurement rather than belt-and-braces: knex invokes a
   * group callback LAZILY, when the statement is compiled — after
   * `applyFilters` has already returned — so the entry point's `catch` never
   * sees a refusal raised inside one. Measured before this method existed: a
   * `$or`-nested cross-field refusal reached the caller correctly redacted
   * while the server log stayed completely silent, which is the worst of both
   * halves. {@link logWithheldFilterDiagnostic} marks the error, so an error
   * that passes two of these frames is still logged once.
   */
  protected withWithheldFilterLog<T>(rootFilter: unknown, fn: () => T): T {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return (FilterHelpersFacet.withWithheldFilterLog<T>).call(filterHelpersHost.of(this), rootFilter, fn);
  }

  private compileFilters(builder: Knex.QueryBuilder, filters: any, options?: DriverOptions) {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.compileFilters.call(filterHelpersHost.of(this), builder, filters, options);
  }

  private applyContainsLike(builder: any, method: string, field: string, value: unknown): void {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts`, its docblock with it (see `FilterHelpersHost`).
    return FilterHelpersFacet.applyContainsLike.call(filterHelpersHost.of(this), builder, method, field, value);
  }

  /**
   * [commit e04a0aff2, director ruling 2026-09-12] Emit the MEMBERSHIP reading of
   * `$contains` / `$notContains` when the column they were aimed at is a JSON
   * column, and say whether it did.
   *
   * Returns `false` — leaving the caller on the substring emitter from before commit e04a0aff2 —
   * in exactly two cases, and the two are different in kind:
   *
   * 1. **The column is not a JSON column.** On a scalar string column
   *    `$contains` IS the substring test, unchanged and deliberately so: that
   *    is the sentence the spec docblock now states on the other side of the
   *    contract ({@link SqlDriver.isJsonColumn} is the population, taken from
   *    #17469's reading of what the driver uses TODAY and ⛔ not widened here).
   * 2. **The dialect has no membership construct** (`'unknown'` — a knex client
   *    this driver does not model). {@link jsonMembershipPredicate} answers
   *    `null` there and the old shape still runs.
   *
   * The negated spelling composes with the NULL rule rather than replacing it:
   * a row with no value satisfies `$notContains` (#5298,
   * {@link SqlDriver.applyNullSafeNegative}), and all three membership
   * constructs answer NULL — not FALSE — for a NULL column, so the
   * `col IS NULL OR NOT (…)` wrapper is doing real work and not decoration.
   * Measured over a 13-row fixture: `$contains` and `$notContains` partition
   * every row on all three dialects, NULL and empty-array rows included.
   */
  private applyJsonMembership(
    builder: any,
    method: string,
    table: string | null | undefined,
    localField: string,
    field: string,
    value: unknown,
    negate: boolean,
  ): boolean {
    // [#25521 cut 16] The body moved to `sql-driver-predicate-emitters.ts` (see `PredicateEmitterHost`).
    const readDialectName = () => this.dialectName;
    const host: ThisParameterType<typeof applyJsonMembership> = {
      applyNullSafeNegative: (...a) => this.applyNullSafeNegative(...a),
      get dialectName() { return readDialectName(); },
      isJsonColumn: (...a) => this.isJsonColumn(...a),
    };
    return applyJsonMembership.call(host, builder, method, table, localField, field, value, negate);
  }

  /**
   * [#5298] Emit a NEGATIVE-polarity value test so a row whose column is NULL
   * satisfies it: `(col IS NULL OR <test>)`.
   *
   * # Why the non-negated operators need this at all
   *
   * SQL is three-valued and a `WHERE` keeps only TRUE, so `d <> 'v1'` is
   * UNKNOWN — and therefore dropped — for every row where `d` is NULL, while
   * `driver-memory` and `formula` evaluate the same filter in two-valued JS
   * (`undefined !== 'v1'` is simply true) and return those rows. #5146 ruled
   * that divergence for `$not`; #5298 ruled it the same way for the three
   * operators that carry their negation in the operator itself — `$ne`,
   * `$nin`, `$notContains`. "The column has no value" satisfies a test for
   * "not this value", on every backend.
   *
   * It is a security fix as much as a consistency one: one RLS rule is
   * evaluated by the read-side SQL lowering AND the write-side `check`
   * evaluator, so a per-backend answer here means one permission rule admitting
   * two different row sets (`read-scope-sql.ts` carries the same change).
   *
   * # Why OR-expansion and not a dialect equivalent
   *
   * `IS DISTINCT FROM` (Postgres) / `IS NOT` (SQLite) / `<=>` (MySQL) each
   * express this in one operator, and all three were rejected: `NOT LIKE` has
   * no such form at all, so `$notContains` would need the OR shape anyway and
   * the driver would carry two shapes for one ruling; the SQLite spelling
   * depends on an engine version this repo does not pin (sql.js / libSQL move
   * independently); and measured `EXPLAIN QUERY PLAN` output is identical
   * either way — `<>`, `NOT IN` and `NOT LIKE` were already full scans before
   * this change, so there is no index to lose and none to win back. One shape,
   * every dialect.
   *
   * # Why a group and not a raw string
   *
   * The callback form keeps the predicate ONE unit for the enclosing builder,
   * so an `$or` branch attaches it as a single clause and the wrapping
   * parentheses are Knex's, not hand-built — the `IS NULL OR` must never
   * escape its own conjunct and widen a sibling.
   */
  private applyNullSafeNegative(
    builder: any,
    method: string,
    field: string,
    emitValueTest: (qb: any) => void,
  ): void {
    // [#25521 cut 16] The body moved to `sql-driver-predicate-emitters.ts`; it reads no member of the driver.
    return applyNullSafeNegative(builder, method, field, emitValueTest);
  }

  /**
   * Parameterized text match for the `$contains` family and `$icontains`, with
   * the comparand's metacharacters escaped so it matches LITERALLY — otherwise
   * a value of `%` matches every row (a filter-bypass, P0). `shape` positions
   * the wildcard: `contains` → `%v%`, `starts` → `v%`, `ends` → `%v`.
   *
   * **[#6518] The construct is chosen by DIALECT, and that is the whole point
   * of this method's existence.** Everything about which SQL is emitted lives in
   * {@link textMatchPredicate}; this method only picks `whereRaw` vs
   * `orWhereRaw`. See that function for the per-dialect table and the measured
   * evidence behind each cell — in one sentence: case sensitivity used to be
   * the DIALECT's answer (SQLite's `LIKE` folds ASCII, Postgres's does not,
   * MySQL's follows its collation) where #4706 Q2 = A says it is the
   * CONTRACT's, and `LOWER()` folds the whole Unicode range on Postgres/MySQL
   * where #4706 Q1 = A says `$icontains` folds ASCII only.
   *
   * **Second implementation, deliberately** (#5567):
   * `packages/services/service-analytics/src/like-pattern.ts` carries the same
   * LIKE transform — same escaped character class, same three shapes, same bound
   * `ESCAPE` — because `service-analytics` depends on no driver and this is a
   * private method taking a knex builder, so there is nothing for it to import.
   * That file's header explains the choice; it is held to the LIKE arm of
   * {@link textMatchPredicate}, character for character, by
   * `service-analytics`'s `like-metacharacter-escape.test.ts`. A third hand-copy
   * is the thing to refuse: import from one of the two, or add a consumer to
   * that test.
   *
   * **[#5234] `String(value)` is safe here because nothing unrenderable reaches
   * it.** {@link assertCompilableComparand} refuses an object comparand on this
   * family before any emitter runs, so the only values arriving are the ones
   * {@link isRenderableTextComparand} admits — a string, number, bigint,
   * boolean, `null`, `undefined` or `Date`, each of which `String()` renders
   * faithfully. Do NOT add a second, tolerant reading of an object here: the
   * `[object Object]` pattern this used to build was valid SQL matching a
   * literal nobody wrote, and `service-analytics` refuses the same shape at its
   * own two doors so one `$contains` still means one thing on every face.
   */
  private applyLike(
    builder: any,
    method: string,
    field: string,
    value: unknown,
    shape: TextMatchShape,
    negate = false,
    fold = false,
  ): void {
    // [#25521 cut 16] The body moved to `sql-driver-predicate-emitters.ts` (see `PredicateEmitterHost`).
    const readDialectName = () => this.dialectName;
    const host: ThisParameterType<typeof applyLike> = {
      get dialectName() { return readDialectName(); },
    };
    return applyLike.call(host, builder, method, field, value, shape, negate, fold);
  }

  /**
   * [#7536] Emit `$like` / `$ilike` — the caller's own pattern, against the
   * whole column value.
   *
   * The sibling of {@link SqlDriver.applyLike} and deliberately not a flag on
   * it: see {@link likePatternPredicate} for the table of what the two do
   * oppositely. This is the arm the wire could not reach between #5158 and
   * #7536, because the spec folded every `like` spelling onto `$contains`
   * before a driver ever saw it.
   */
  private applyLikePattern(
    builder: any,
    method: string,
    field: string,
    pattern: string,
    fold: boolean,
  ): void {
    // [#25521 cut 16] The body moved to `sql-driver-predicate-emitters.ts` (see `PredicateEmitterHost`).
    const readDialectName = () => this.dialectName;
    const host: ThisParameterType<typeof applyLikePattern> = {
      get dialectName() { return readDialectName(); },
    };
    return applyLikePattern.call(host, builder, method, field, pattern, fold);
  }

  /**
   * Compiles a Filter Protocol condition onto `builder`.
   *
   * `logicalOp` controls only how this condition attaches to `builder`
   * (`where` vs `orWhere`) — never how its contents combine. It is never
   * `'or'` on any in-repo path: the sole caller passes `'and'` and every
   * combinator recurses with `'and'`, because all keys in one filter object
   * AND at every depth. The `orWhere` that OR-s `$or`'s branches is applied
   * to each branch's own sub-builder; handing `'or'` down instead is exactly
   * what widened every `$or` filter (#3774 — see sql-driver-or-filter.test.ts).
   *
   * So the `logicalOp === 'or'` arms below are unreachable **by design**, not
   * dead weight to prune: the method is `protected`, i.e. subclass API, and
   * the flag is the seam an override needs to attach a condition into an OR
   * group. Do not "fix" them by making a branch propagate `'or'` again.
   *
   * # Boolean identities (#5134)
   *
   * Every combinator is decided by {@link reduceFilterNode} BEFORE anything is
   * emitted, because Knex renders no SQL for a group that received no clause —
   * so "the group is empty" and "the group is satisfied" used to compile to the
   * same query. That is not an identity, it is a dropped clause, and the two
   * identities point in opposite directions: empty `$and` is TRUE, empty `$or`
   * is FALSE, and `$not` of an empty (TRUE) group is FALSE. The old code
   * answered the whole table to all three; `$and` was right only because
   * "dropped" coincides with TRUE on the AND side.
   *
   * The reduction also makes every group this method opens provably NON-EMPTY:
   * a `'true'` combinator is skipped outright, `'true'` members of a `$and` and
   * `'false'` members of a `$or` are dropped as their identities, and a node
   * that reduces to `'false'` never reaches the loop at all. So Knex is never
   * again in a position to silently discard a group.
   *
   * # Zero-operator field constraints (#5240)
   *
   * `{ field: {} }` is REFUSED by that same reduction walk, in every position.
   * It used to be this method's last remaining way to emit nothing for a key
   * that looked like a predicate — so it read as TRUE here while the top-level
   * `applyFilters` path refused it and the two JS backends answered FALSE. One
   * declared shape, three answers; see {@link emptyFieldConstraintError}.
   *
   * # NULL-safe negation (#5146 `$not`, #5298 the negative operators)
   *
   * `$not` negates the operand it is handed. Every seamed read hands it an
   * operand the shared lowering (`lowerFilterCondition`, `@objectstack/spec/data`)
   * has already made TOTAL leaf by leaf — each leaf guarded in the direction its
   * own operator answers for a row with no value — because SQL's `NOT UNKNOWN`
   * is UNKNOWN and a `WHERE` drops it, which used to hide every row whose
   * compared column was NULL while `driver-memory` and `formula` returned those
   * same rows. [ADR-0053 D-D1 items 5 and 9, as amended — #20822] This driver's
   * own copy of that rewrite (`nullSafeNegationOperand` and its polarity
   * tables) is deleted; a caller that passes no seam gets the negation it wrote,
   * three-valued.
   *
   * #5298 extended the same ruling to the non-negated path: `$ne`, `$nin` and
   * `$notContains` emit `(col IS NULL OR <test>)` via
   * {@link SqlDriver.applyNullSafeNegative}. A POSITIVE comparison is still
   * compiled exactly as it always was — `{ a: 1 }` is `a = 1`, `$in` is `in (…)`
   * — so nothing on the majority path changed shape.
   */
  protected applyFilterCondition(
    builder: Knex.QueryBuilder,
    condition: any,
    logicalOp: 'and' | 'or' = 'and',
    tableHint?: string | null,
    // [#8220] The query's `where` ROOT, threaded so the lazily invoked group
    // callbacks below can resolve a refusal's provenance against the tree the
    // merge boundaries actually marked. Defaults to this frame's own
    // `condition` for any direct caller compiling a standalone tree.
    rootFilter?: unknown,
    // [ADR-0139 D3] The OUTER read's options, threaded down every combinator so
    // a composed `ReadableIds` leaf's subquery is tenant-walled by
    // {@link applyTenantScope} with exactly the options the outer read was
    // scoped with — captured by the lazily invoked group callbacks below,
    // never read from instance state.
    options?: DriverOptions,
  ): void {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.applyFilterCondition.call(filterHelpersHost.of(this), builder, condition, logicalOp, tableHint, rootFilter, options);
  }

  /**
   * [#5222] Declared metadata fields for `object`, under either key the two
   * registration paths use (`initObjects` keys by resolved TABLE name,
   * `registerExternalObject` by object name — same double lookup as
   * {@link paginationTieBreaker} / {@link resolveTenantField}). `undefined`
   * means this driver does not OWN the object's column set: never registered,
   * or federated/external (ADR-0015 — `registerExternalObject` deliberately
   * does not populate {@link managedObjectFields}), and cross-field comparison
   * refuses rather than guessing at columns it cannot enumerate.
   */
  protected declaredFieldsFor(object: string): Record<string, any> | undefined {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts` (see `FilterHelpersHost`).
    return FilterHelpersFacet.declaredFieldsFor.call(filterHelpersHost.of(this), object);
  }

  /**
   * [#5222] Compile `{ <target>: { <op>: { $field: <ref> } } }` into a
   * SAME-TABLE column-to-column comparison — the capability #5041 catalogued
   * and deliberately deferred — or refuse in the same ADR-0112 envelope
   * (`INVALID_FILTER`, 400) it installed.
   *
   * # The validation boundary (maintainer rulings, 2026-08-06, on #5222)
   *
   * 1. **Same-table columns only.** A dotted `$field` is refused: in memory
   *    `getPath` walks a dot path across related objects, and SQL has no
   *    equivalent short of JOIN planning (rejected as disproportionate) or an
   *    alias contract (rejected as nonexistent).
   * 2. **Declared-only enumeration, on BOTH operands.** The `$field` value
   *    lands in a SQL IDENTIFIER position; only names the object declared
   *    ({@link managedObjectFields}) are accepted, so an unknown column is a
   *    compile-time refusal, not a database error — and a table this driver
   *    has no declaration for (external/federated, ADR-0015) refuses
   *    wholesale. The TARGET field must be declared too: the type-class check
   *    below needs both declarations, and a comparison is one surface — it
   *    cannot be half-validated.
   * 3. **The tenant-isolation column is forbidden, on either side.** The
   *    ruling names the referent; both sides are closed because the operands
   *    of `=` commute — `{ org_id: { $eq: { $field: x } } }` is the same
   *    privilege-escalation comparison surface as
   *    `{ x: { $eq: { $field: org_id } } }` spelled backwards, and a ban only
   *    one swap away is not a ban.
   * 4. **Same comparison class** ({@link crossFieldComparisonClass}) — the
   *    conformance boundary: across classes SQLite's storage-class ordering
   *    and the memory evaluator's JS coercion genuinely diverge, so those
   *    shapes go to the refusal arm rather than shipping a per-backend answer.
   *
   * # The emitted SQL is TOTAL — never UNKNOWN — by construction
   *
   * Both columns can be NULL at once, and the memory evaluator answers every
   * such row two-valuedly (`matches-filter.ts` `evalOp`): the orderings need
   * both sides non-null; `$eq` with a null referent matches exactly the
   * null-target rows; `$ne` is `$eq`'s complement. Each arm below writes that
   * truth table into the predicate itself (`IS [NOT] NULL` conjuncts), which
   * buys the same property #5146 buys leaf-by-leaf for `$not`: a total
   * predicate's `NOT` is its exact complement, so the negation rewrite needs
   * no guard here (the shared lowering's polarity table reads a `{ $field }`
   * comparison as total) and every
   * combinator nesting composes. The cross-path conformance suite pins the
   * NULL rows on every operator, both polarities.
   *
   * Each side reads through {@link filterColumnExpr} when the column needs the
   * legacy-datetime/time storage repair (#3912/#3994), the same normalisation
   * every VALUE comparison applies — `??` identifier binding otherwise, so
   * quoting stays Knex's on every dialect.
   *
   * # `addDays` — the whole-day offset on the referenced column (#14104, ruled 2026-09-02)
   *
   * `{ completed_at: { $lte: { $field: 'due_date', addDays: { $field: 'grace_days' } } } }`
   * compiles to `completed_at <= (due_date + grace_days days)`, and a literal
   * (`addDays: 5`, `addDays: -3`) binds as a parameter where the column would
   * be. The offset rides the same arm and the same four rulings: the offset
   * column is a same-table, declared, non-tenant column of the NUMERIC class,
   * and the two compared columns are temporal columns of the SAME class
   * (`date`/`date` or `datetime`/`datetime` — day arithmetic has no meaning
   * on a number, a text or a `time`). {@link crossFieldOffsetExpr} spells the
   * addition per dialect; the offset value is `COALESCE(offset, 0)` and
   * truncated toward zero on every dialect, the memory evaluator's reading.
   *
   * The NULL semantics are the ruling's, written INTO the predicate the way
   * the #5222 arms write theirs: a NULL offset column contributes zero days
   * (`COALESCE`), and a NULL referenced column makes the comparison FALSE —
   * not NULL — for every operator, `$ne` included (`<ref> IS NOT NULL AND …`),
   * so `$not` re-admits exactly those rows, as it does in memory. The target
   * column keeps its ordinary reading (NULL fails the orderings and `$eq`,
   * satisfies `$ne` when the offset deadline exists). So with an offset the
   * `$eq`/`$ne` pair is NOT the both-NULL-matching pair the bare arm emits:
   * `completed_at = due_date + grace` is false when there is no due date. The
   * cross-path conformance corpus pins every cell on both paths.
   */
  protected applyCrossFieldComparison(
    builder: Knex.QueryBuilder,
    method: 'where' | 'orWhere',
    table: string | null,
    targetKey: string,
    targetLocalField: string,
    targetColumn: string,
    op: string,
    ref: string,
    // [#8220] The `{ $field }` comparand node itself, threaded so each refusal
    // below can carry the subtree the provenance resolver locates in the tree.
    refNode?: unknown,
  ): void {
    // [#25521 cut 13] The body moved to `sql-driver-cross-field-comparison.ts` (see `CrossFieldComparisonHost`).
    const host: ThisParameterType<typeof applyCrossFieldComparison> = {
      crossFieldOffsetExpr: (...a) => this.crossFieldOffsetExpr(...a),
      declaredFieldsFor: (...a) => this.declaredFieldsFor(...a),
      filterColumnExpr: (...a) => this.filterColumnExpr(...a),
      mapSortField: (...a) => this.mapSortField(...a),
      remoteColumn: (...a) => this.remoteColumn(...a),
      resolveTenantField: (...a) => this.resolveTenantField(...a),
    };
    return applyCrossFieldComparison.call(host, builder, method, table, targetKey, targetLocalField, targetColumn, op, ref, refNode);
  }

  /**
   * [#25808] `column <op> (now + days)` — a now-anchored comparand on a
   * temporal column, maintainer ruling 2026-10-26 (letter A): the current
   * instant, shifted by a whole-day offset read from an integer literal or a
   * NUMERIC column of the SAME record, compared against a `date` or `datetime`
   * column. The analytics shape it was ruled for: "opened more than
   * `review_sla_days` ago", where the SLA is a column of the row and the row's
   * own clock is `now`.
   *
   * The arithmetic is {@link SqlDriver.crossFieldOffsetExpr}'s — the `addDays`
   * arm of {@link SqlDriver.applyCrossFieldComparison}, with the anchor's
   * instant bound where the referenced column would be read. The offset column
   * is held to every rule that arm holds it to (same-table, declared, numeric,
   * never the tenant-isolation column; a NULL offset is zero days through the
   * same `coalesce`), so an offset that compiles there compiles here and no
   * other does. What differs is the base: it is a VALUE, never NULL, so the
   * `<base> is not null` conjunct the reference arm writes is dropped and the
   * predicate reads as the plain literal comparison would — an ordering and
   * `$eq` need the target to have a value, `$ne` holds when it has none or
   * differs (`@objectstack/formula`'s `evalOp` over the resolved anchor,
   * made total so `$not` re-admits exactly the complement).
   *
   * The instant is bound in the TARGET column's storage form, so the shifted
   * value compares against the column exactly as a stored value would — the
   * rule every literal comparand on a temporal column follows
   * (`coerceFilterValue`): a `datetime` column keeps the time of day (the
   * canonical UTC ISO text, through `mysqlDatetimeLiteral` on MySQL); a `date`
   * column takes the instant's UTC calendar day (`temporalStorageForm`, the
   * reading `{now}` and `{today}` take on a `date` column). PostgreSQL and
   * MySQL cast the bound text (`timestamptz` / `datetime(3)`, `date`) because
   * the dialect's day arithmetic needs a typed operand where a bare `?` beside
   * a column would have been inferred; SQLite's `date()` / `strftime()` read
   * the canonical text directly, as they read a stored value.
   */
  protected applyNowAnchorComparison(
    builder: Knex.QueryBuilder,
    method: 'where' | 'orWhere',
    table: string | null,
    targetKey: string,
    targetLocalField: string,
    targetColumn: string,
    op: string,
    anchor: NowAnchor,
    // The `{ $now, addDays }` node itself, for the provenance resolver (#8220).
    node?: unknown,
  ): void {
    // [#25521 cut 13] The body moved to `sql-driver-cross-field-comparison.ts` (see `CrossFieldComparisonHost`).
    const host: ThisParameterType<typeof applyNowAnchorComparison> = {
      crossFieldOffsetExpr: (...a) => this.crossFieldOffsetExpr(...a),
      declaredFieldsFor: (...a) => this.declaredFieldsFor(...a),
      filterColumnExpr: (...a) => this.filterColumnExpr(...a),
      mapSortField: (...a) => this.mapSortField(...a),
      nowAnchorBaseExpr: (...a) => this.nowAnchorBaseExpr(...a),
      remoteColumn: (...a) => this.remoteColumn(...a),
      resolveTenantField: (...a) => this.resolveTenantField(...a),
    };
    return applyNowAnchorComparison.call(host, builder, method, table, targetKey, targetLocalField, targetColumn, op, anchor, node);
  }

  /**
   * [#25808] The anchor's instant as a typed operand in `cls`'s storage form,
   * per dialect — see {@link SqlDriver.applyNowAnchorComparison}.
   */
  protected nowAnchorBaseExpr(at: Date, cls: 'date' | 'datetime'): { sql: string; bindings: any[] } {
    // [#25521 cut 13] The body moved to `sql-driver-cross-field-comparison.ts` (see `CrossFieldComparisonHost`).
    const readIsMysql = () => this.isMysql;
    const readIsSqlite = () => this.isSqlite;
    const host: ThisParameterType<typeof nowAnchorBaseExpr> = {
      get isMysql() { return readIsMysql(); },
      get isSqlite() { return readIsSqlite(); },
    };
    return nowAnchorBaseExpr.call(host, at, cls);
  }

  /**
   * [#14104] `base` shifted by `offset` whole days, spelled per dialect, in the
   * storage form the column is compared in — so the shifted value compares
   * against the target column exactly as a stored value of that column would.
   *
   * `offset` is a `??` column or a `?` literal; both sides read through
   * `coalesce(<offset>, 0)` (a NULL offset column contributes zero days) and
   * are truncated toward zero to whole days — `cast(… as integer)` on SQLite,
   * `trunc` on Postgres, `truncate` on MySQL — the reading
   * `@objectstack/formula`'s `resolveDayOffset` applies (`Math.trunc`).
   *
   * **SQLite adds on the driver's canonical TEXT form, deliberately.** A
   * `Field.date` is `YYYY-MM-DD` text and `date(col, 'N days')` returns the
   * same shape; a `Field.datetime` is the canonical `YYYY-MM-DDTHH:MM:SS.sssZ`
   * text (#3912) — or, for a column not yet backfilled, the
   * {@link sqliteCanonicalDatetimeSql} repair `base` already carries, which is
   * likewise text — and `strftime('%Y-%m-%dT%H:%M:%fZ', col, 'N days')` is the
   * SAME format string `nowColumnDefault` and the backfill write, so the shifted
   * value is byte-identical to a stored one and the comparison stays a plain
   * text compare. No julian-day arithmetic anywhere: `strftime` parses the
   * text and `'N days'` is its own modifier, so an epoch INTEGER (the pre-#3912
   * legacy form) never reaches the arithmetic unrepaired. `'-3 days'` is a legal
   * modifier, so a negative offset subtracts without a second spelling.
   *
   * Postgres: `date + integer` is a `date`, `timestamptz + make_interval(days
   * => n)` a `timestamptz`. MySQL: `date_add(col, interval n day)` keeps the
   * column's own type (`DATE` stays `DATE`, `DATETIME(3)` stays `DATETIME(3)`).
   */
  protected crossFieldOffsetExpr(
    base: { sql: string; bindings: any[] },
    offset: { sql: string; bindings: any[] },
    cls: 'date' | 'datetime',
  ): { sql: string; bindings: any[] } {
    // [#25521 cut 13] The body moved to `sql-driver-cross-field-comparison.ts` (see `CrossFieldComparisonHost`).
    const readIsMysql = () => this.isMysql;
    const readIsSqlite = () => this.isSqlite;
    const host: ThisParameterType<typeof crossFieldOffsetExpr> = {
      get isMysql() { return readIsMysql(); },
      get isSqlite() { return readIsSqlite(); },
    };
    return crossFieldOffsetExpr.call(host, base, offset, cls);
  }

  private applyFalseConstant(builder: any, logicalOp: 'and' | 'or'): void {
    // [#29520 codemod] The body moved to `sql-driver-filter-helpers.ts`, its docblock with it.
    return FilterHelpersFacet.applyFalseConstant(builder, logicalOp);
  }

  // ── Field mapping ───────────────────────────────────────────────────────────

  protected mapSortField(field: string): string {
    // [#29520 codemod] The body moved to `sql-driver-field-mapping.ts`.
    return FieldMappingFacet.mapSortField(field);
  }

  /**
   * The unique column this driver orders a paged read by, so that paging is a
   * partition of the result set rather than five independent queries that
   * happen to share a WHERE clause (objectui#3106, contract on
   * `IDataDriver.find`).
   *
   * `ORDER BY status LIMIT 50 OFFSET 50` names a key that does not identify a
   * row, and SQL promises nothing about how equal keys are arranged — nor that
   * two executions arrange them the same way. Page 2 can then repeat a row
   * page 1 already showed and skip one nobody ever sees. Every page looks
   * perfect on its own, which is why this is found by a user counting records
   * and not by reading a response.
   *
   * "Tie-breaker" stays the right word when the caller sent **no** `orderBy` at
   * all (objectstack#4363): on an empty sort key every row ties with every
   * other, so the same column that was breaking ties within a `status` group
   * ends up carrying the entire order. That is why one method answers both call
   * sites — the question is the same one, and a driver that could answer it for
   * a sorted page but not an unsorted one would be fixing the rarer half.
   *
   * Returns `null` — no ordering column, prior behavior exactly — unless this
   * driver **created** the table and therefore knows it carries the `id`
   * primary key (`initObjects` populates {@link managedObjectFields} for
   * exactly those). Guessing on a federated table (ADR-0015) would be worse
   * than doing nothing: an `id` column that isn't there raises an unknown-column
   * error, and the #3821 recovery ladder answers that by retrying with **no
   * ORDER BY at all** — trading a reshuffle among ties for the loss of the
   * caller's whole sort.
   *
   * Returns the LOGICAL field name; the call site maps it to a physical column
   * like any other sort key.
   */
  protected paginationTieBreaker(object: string): string | null {
    // [#29520 codemod] The body moved to `sql-driver-field-mapping.ts` (see `FieldMappingHost`).
    return FieldMappingFacet.paginationTieBreaker.call(fieldMappingHost.of(this), object);
  }

  /**
   * The complete ORDER BY for a `find()`: the caller's sort keys, followed by
   * {@link paginationTieBreaker} when the read needs one to be deterministic.
   * Logical field names — the call site maps each to a physical column.
   *
   * Three shapes, and the third is objectstack#4363:
   *
   * | `orderBy` | paged | result |
   * |---|---|---|
   * | non-empty | either | caller's keys + `id` |
   * | empty | `limit`/`offset` present | `id` alone |
   * | empty | neither present | **nothing** — the statement gets no ORDER BY |
   *
   * The last row is the deliberate carve-out, and it is why this asks about
   * pagination at all rather than sorting every read. An unpaged read hands
   * back the whole matching set: the caller sees every row whatever order they
   * arrive in, so there is no partial view to be wrong about, and an imposed
   * ORDER BY would only change plan selection for the majority of reads in the
   * system. The moment `limit`/`offset` appear the caller is being shown a
   * *slice*, and which rows fall in it stops being a matter of presentation.
   *
   * `limit` alone counts as paged, without waiting for an `offset`. Page one of
   * a walk is routinely `limit=50` with no offset at all, and a page one that
   * disagrees with the ordering pages two onward use is exactly the defect —
   * ordering only the later pages would leave the bug fully intact while
   * looking like a fix. `singleRowLookup` is how {@link findOne}'s own
   * `limit: 1` stays out of that reading; see {@link findRows}.
   *
   * The tie-breaker goes on in the LAST requested key's direction (`asc` when
   * there is none): determinism holds either way, but a same-direction suffix
   * is the one a compound index can still walk in a single pass.
   *
   * When the read is paged, unsorted, and {@link paginationTieBreaker} has no
   * column to offer, this warns once for that object. The behavior is unchanged
   * — the statement goes out exactly as it did before — but the contract states
   * determinism as a MUST, and a MUST that quietly does not hold is the same
   * invisible failure the rule exists to remove.
   */
  protected orderKeysFor(
    object: string,
    query: DriverQuery,
    opts?: { singleRowLookup?: boolean },
  ): Array<{ field: string; direction: 'asc' | 'desc' }> {
    // [#29520 codemod] The body moved to `sql-driver-field-mapping.ts` (see `FieldMappingHost`).
    return FieldMappingFacet.orderKeysFor.call(fieldMappingHost.of(this), object, query, opts);
  }

  /**
   * Physical column for a logical field on an external object that declares an
   * `external.columnMap` (ADR-0015). Returns `fallback` (the caller's existing
   * per-site resolution) when the object has no columnMap, so managed objects
   * and external objects without a columnMap are byte-for-byte unchanged.
   */
  protected remoteColumn(object: string | null | undefined, field: string, fallback: string): string {
    // [#29520 codemod] The body moved to `sql-driver-field-mapping.ts` (see `FieldMappingHost`).
    return FieldMappingFacet.remoteColumn.call(fieldMappingHost.of(this), object, field, fallback);
  }

  /**
   * Remap a write payload's logical field keys to physical remote columns for an
   * external object with a columnMap. No-op otherwise. Applied AFTER formatInput
   * (whose value coercion is keyed by logical field name).
   */
  protected applyWriteColumnMap(object: string, data: any): any {
    // [#29520 codemod] The body moved to `sql-driver-field-mapping.ts` (see `FieldMappingHost`).
    return FieldMappingFacet.applyWriteColumnMap.call(fieldMappingHost.of(this), object, data);
  }

  /**
   * How a declared aggregation lowers into SQL, or a refusal that says which
   * KIND of "no" this is (#5907).
   *
   * The `switch` this replaced answered both conditions with one bare `Error`
   * carrying no `code` and no `status`, so `mapDataError` fell to its default
   * branch and a caller's `median` typo arrived as an opaque 500 — the #1116 /
   * #1117 gap, at the aggregate door. The lowering table is now the single
   * source of what this face compiles, and {@link refuseAggregateFunction}
   * decides between the two refusals.
   *
   * [#6409] Returns the {@link SqlAggregateLowering} RECORD rather than the bare
   * SQL function name it used to. `count_distinct` lowers to
   * `COUNT(DISTINCT x)` — a keyword inside the argument list, not a different
   * function name — so a caller of this method needs both halves to emit the
   * call. Every entry answering `{ sql, distinct: false }` compiles to exactly
   * the text the previous `string` return produced.
   */
  protected mapAggregateFunc(func: string): SqlAggregateLowering {
    // [#29520 codemod] The body moved to `sql-driver-field-mapping.ts`.
    return FieldMappingFacet.mapAggregateFunc(func);
  }

  // ── Window function builder ─────────────────────────────────────────────────

  /**
   * Compile one {@link SqlWindowFunctionSpec} to `FUNC() OVER (…)`. Nothing the
   * caller sent reaches the statement as text: the function name and each sort
   * direction are looked up in closed tables ({@link SQL_WINDOW_FUNCTIONS},
   * {@link SQL_WINDOW_SORT_DIRECTIONS}) and refused when absent, and every
   * `partitionBy` / `orderBy` field is emitted as a quoted column reference
   * (`knex.ref`, the idiom the rest of this file quotes columns with).
   */
  protected buildWindowFunction(spec: SqlWindowFunctionSpec): string {
    // [#29520 codemod] The body moved to `sql-driver-window-function-builder.ts` (see `WindowFunctionBuilderHost`).
    return WindowFunctionBuilderFacet.buildWindowFunction.call(windowFunctionBuilderHost.of(this), spec);
  }

  // ── Column creation helper ──────────────────────────────────────────────────

  /**
   * The driver-native column DEFAULT for a `defaultValue: 'NOW()'` field.
   *
   * Postgres/MySQL use native `now()` — a real zone-aware TIMESTAMP that never
   * had the ambiguity below. On MySQL a `datetime` default carries the
   * column's fractional-seconds precision ({@link MYSQL_DATETIME_PRECISION}),
   * because MySQL refuses a mismatched one outright (#21241); it is also the
   * expression the builtin audit columns default with, routed through here
   * ({@link createAuditTimestampColumn}). SQLite has no timestamp type and `knex.fn.now()`
   * compiles to `CURRENT_TIMESTAMP`, which renders a timezone-NAIVE,
   * space-separated `'YYYY-MM-DD HH:MM:SS'` (no millis, no zone). `Date.parse`
   * reads such a zone-less string as LOCAL time, so a stored UTC wall-clock
   * shifts by the host offset on a non-UTC runtime — the same class of bug
   * ADR-0074 fixed for the builtin audit columns. Emit a canonical instead:
   *   - datetime → ISO-8601 with explicit `Z` (`2026-06-26T10:34:13.891Z`),
   *                matching `new Date().toISOString()` and the value
   *                `formatInput`'s `NOW()` safety-net writes;
   *   - date     → `YYYY-MM-DD` UTC calendar day (matches `toDateOnly`, so the
   *                stored default already equals what an explicit write stores);
   *   - time     → `HH:MM:SS.fff` UTC time-of-day (not a full timestamp).
   *
   * NOTE: a DDL default only governs NEWLY-created columns. An existing column
   * keeps its legacy `CURRENT_TIMESTAMP` default and still emits naive text on a
   * defaulted insert; `formatOutput` repairs those to canonical on read
   * (`normalizeSqliteDatetimeOutput` for datetime, `toDateOnly` for date), so
   * reads are uniform without a schema migration.
   */
  protected nowColumnDefault(type: string): Knex.Raw {
    // [#25521 cut 19] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const readIsMysql = () => this.isMysql;
    const readIsPostgres = () => this.isPostgres;
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof nowColumnDefault> = {
      get isMysql() { return readIsMysql(); },
      get isPostgres() { return readIsPostgres(); },
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
    };
    return nowColumnDefault.call(host, type);
  }

  /**
   * DDL for a builtin `created_at` / `updated_at` audit column.
   *
   * These are created directly rather than through {@link createColumn} (they are
   * not declared fields), but the objectql registry DOES declare them as
   * `Field.datetime` on every audited object — so they are filtered, sorted and
   * bucketed like one, and must take the same physical type or they inherit the
   * `TIMESTAMP` problems on MySQL: no milliseconds, and a 2038 ceiling on the
   * column every list view sorts by (#3942). `CURRENT_TIMESTAMP` has to carry
   * matching precision for a `DATETIME(3)` default, hence `now(3)` — spelled
   * {@link MYSQL_DATETIME_PRECISION}, the one source (#21241, below).
   *
   * ## SQLite takes the SAME canonical default a declared field gets (#11321)
   *
   * "Must take the same physical type as a declared `Field.datetime`" is the
   * paragraph above; the DEFAULT is the other half of that sentence, and on
   * SQLite it used to diverge. `knex.fn.now()` compiles to an unqualified
   * `CURRENT_TIMESTAMP`, which SQLite renders as a zone-NAIVE, space-separated,
   * second-precision `'YYYY-MM-DD HH:MM:SS'` — the exact string
   * {@link updatedAtStamp}'s docblock condemns, because `Date.parse` reads a
   * zone-less string as LOCAL time and silently shifts the instant by the host
   * offset. A declared `defaultValue: 'NOW()'` field in the SAME table already
   * gets the canonical ISO-8601 form from {@link nowColumnDefault}, so one table
   * carried two spellings of one conceptual value:
   *
   * ```
   * created_at  "2026-08-23 14:54:17"          <- builtin audit (naive)
   * when        "2026-08-23T14:54:17.796Z"     <- declared Field.datetime NOW()
   * ```
   *
   * Routed through {@link nowColumnDefault} rather than restating the
   * expression, so the two can never drift apart again — one source for "what
   * does NOW() mean in DDL on this dialect".
   *
   * Postgres is deliberately untouched: `knex.fn.now()` there is a real
   * zone-aware `TIMESTAMP` that never had the ambiguity.
   *
   * ## MySQL routes through the same source (#21241)
   *
   * A `DATETIME(3)` default must carry matching precision (#11224), and the
   * declared-field default is the other half of that sentence too: this
   * column carried its own `now(3)` while a declared `Field.datetime` NOW()
   * column of the same `DATETIME(3)` type fell through to a bare
   * `CURRENT_TIMESTAMP`, which MySQL refuses — so the table was never created.
   * Both the column's precision and its default now read
   * {@link MYSQL_DATETIME_PRECISION}, the default through
   * {@link nowColumnDefault}, exactly as the SQLite branch does. The emitted
   * DDL for this column is byte-identical (`datetime(3) default
   * CURRENT_TIMESTAMP(3)`).
   *
   * ⚠️ Scope: a DDL default governs only NEWLY-created tables. A table already
   * on disk keeps its legacy `CURRENT_TIMESTAMP` default; `formatOutput`'s read
   * repair (`repairNaiveUtcAuditTimestamp`) folds those rows to canonical on
   * read, which is why this needs no migration — the same disposition
   * {@link nowColumnDefault} already documents for declared fields. Measured:
   * schema-drift never compares this default, so an existing deployment does
   * NOT start reporting drift on `created_at`/`updated_at` — the audit columns
   * are skipped outright ({@link BUILTIN_COLUMNS}), and the only
   * `default_mismatch` producer is the #4560 runtime-token check.
   */
  protected createAuditTimestampColumn(table: Knex.CreateTableBuilder, name: string): void {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.createAuditTimestampColumn.call(columnCreationHost.of(this), table, name);
  }

  /**
   * The widest `varchar(n)` one utf8mb4 key part can hold on InnoDB: 3072 bytes
   * of index key ÷ 4 bytes per character (commit d0e3a885b).
   *
   * Measured on MySQL 8.0.46 (DYNAMIC row format, the 8.0 default) rather than
   * read off a doc page: `varchar(768) UNIQUE` creates, `varchar(769) UNIQUE`
   * is refused with `ER_TOO_LONG_KEY: Specified key was too long; max key
   * length is 3072 bytes`.
   *
   * The bound is per KEY, not per column, so a wide composite can exceed it
   * while every part is individually legal — this constant cannot prevent that,
   * and does not try to. It is the single-part ceiling below which emitting a
   * bounded column is known to help; {@link explainUnkeyableTextColumn} handles
   * whatever the server still refuses.
   */
  protected static readonly MAX_KEYABLE_VARCHAR_CHARS = 768;

  /**
   * The `varchar(n)` a KEYED text-family field should take, or `null` to leave
   * the column TEXT (commit d0e3a885b).
   *
   * `null` has exactly two causes, and both are deliberate non-events rather
   * than failures here:
   *
   *   - the field declares no `maxLength` — there is no bound to emit, and
   *     inventing one would impose a truncation boundary (or, under
   *     `STRICT_TRANS_TABLES`, an outright write refusal — measured:
   *     `ER_DATA_TOO_LONG`) that the author never declared;
   *   - the declared bound is wider than a single key part can be, where a
   *     `varchar(n)` column would simply trade `ER_BLOB_KEY_WITHOUT_LENGTH` for
   *     `ER_TOO_LONG_KEY`.
   *
   * Either way the column stays TEXT and, on MySQL, the index over it is
   * refused with the diagnostic {@link explainUnkeyableTextColumn} writes.
   */
  /**
   * knex's `table.string(name)` default, spelled out rather than inherited
   * (#11431). It is the width a string-family field with no usable
   * `maxLength` keeps — unchanged behaviour, and deliberately so: a field that
   * declares no bound has not asked for one, and inventing a narrower column
   * would impose a truncation boundary its author never wrote.
   */
  protected static readonly DEFAULT_STRING_VARCHAR_CHARS = 255;

  /**
   * The widest `varchar(n)` a column may declare, across every dialect this
   * driver speaks (#11431).
   *
   * Measured, not read off a doc page. MySQL 8.0.46, utf8mb4/InnoDB:
   * `varchar(16383)` creates and `varchar(16384)` is refused with
   * `ERROR 1074 Column length too big for column 'c' (max = 16383); use BLOB
   * or TEXT instead` — 65535 bytes ÷ 4 bytes per utf8mb4 character. Postgres
   * 16 accepts up to `varchar(10485760)` and refuses `10485761` with
   * `length for type varchar cannot exceed 10485760`; SQLite records the
   * declared type verbatim and enforces nothing.
   *
   * ⚠️ ONE ceiling for every dialect, deliberately, and it is the LOWEST of
   * the three. The alternative is one declaration with three physical shapes,
   * so the same app would take a `maxLength: 100000` url as a bounded column
   * on Postgres and refuse to create the table at all on MySQL — the
   * dialect-divergent enforcement this file's conformance matrices exist to
   * close, and the same call {@link keyableTextLength}'s neighbour already
   * made for the text family.
   *
   * ⚠️ What this constant is NOT: a guarantee the table will create. MySQL
   * also caps the SUM of a row's declared byte widths at 65535 (measured:
   * 15 × `varchar(1024)` creates, 16 × `varchar(1024)` is refused with
   * `ERROR 1118 Row size too large`), a limit no per-column decision can see.
   * Postgres has no such limit (it TOASTs; 40 × `varchar(4096)` creates
   * cleanly). No platform object comes near it — the widest declared bound on
   * a string-family field in this repo is 2000, and no object carries more
   * than six such fields — but an authored app can, and the server's own
   * refusal is the only thing that reports it today.
   */
  protected static readonly MAX_VARCHAR_CHARS = 16383;

  /**
   * The `varchar(n)` a STRING-family column should take, or `null` to make it
   * TEXT instead (#11431).
   *
   * Three outcomes, each a deliberate answer rather than a fallback:
   *
   *   - **no usable declaration** — `maxLength` absent, or not a positive
   *     integer — keeps {@link DEFAULT_STRING_VARCHAR_CHARS}. Unchanged
   *     behaviour for every field that never declared a bound, which is the
   *     overwhelming majority of them.
   *   - **a declaration this dialect can express** returns it verbatim, in
   *     BOTH directions. Wider than 255 is the reported defect; narrower is
   *     the same defect's other half — `maxLength: 20` took `varchar(255)`
   *     too, so the bound bound in neither direction.
   *   - **a declaration wider than {@link MAX_VARCHAR_CHARS}** returns `null`
   *     and the column becomes TEXT. Emitting `varchar(100000)` would be DDL
   *     MySQL refuses outright, and clamping it to the ceiling would reinstate
   *     exactly the defect being fixed — a column narrower than the
   *     declaration, refusing writes the declaration allows. TEXT refuses
   *     nothing the author declared; the bound is still enforced, at the
   *     write seam where `maxLength` enforcement actually lives (the record
   *     validator's `max_length` check), with a field-named ADR-0112 envelope
   *     instead of a raw `ER_DATA_TOO_LONG`.
   *
   * ⚠️ Deliberately mirrors {@link keyableTextLength} without sharing code
   * with it. The two families answer different questions — that one asks
   * "can this KEY?" and returns `null` for an unbounded field, this one asks
   * "how wide is this column?" and returns 255 — and the half commit d0e3a885b left open
   * may still reshape the text side. A shared helper would couple a settled
   * decision to an unsettled one.
   */
  protected declaredVarcharLength(field: any): number | null {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts`.
    return ColumnCreationFacet.declaredVarcharLength(field);
  }

  protected keyableTextLength(field: any): number | null {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts`.
    return ColumnCreationFacet.keyableTextLength(field);
  }

  /**
   * Turn MySQL's `ER_BLOB_KEY_WITHOUT_LENGTH` / `ER_TOO_LONG_KEY` into a message
   * that names the columns at fault and the remedy that actually applies
   * (commits d0e3a885b and ebcc34e89).
   *
   * ## TWO remedies, because the refusal has two causes
   *
   * | path | the fact | what fixes it |
   * |---|---|---|
   * | **create** | the field declares no usable `maxLength` | declare one — the next create emits `varchar(n)` |
   * | **upgrade** | the field declares one; the COLUMN predates it and is still TEXT | convert the column by hand |
   *
   * One message served both until commit ebcc34e89, and on the upgrade path both of its
   * halves were false: it diagnosed a missing declaration that was present, and
   * prescribed a declaration that was already made. That is not merely
   * imprecise — it fires once per boot on a production upgrade and reads as the
   * release that added the bound being broken, so the operator's next move is to
   * doubt a correct fix. The second cause exists at all because the additive
   * sync is additive: it adds columns and indexes and never rewrites a column's
   * type (#3728), by design — the rewrite needs an exclusive metadata lock
   * (see the `lock_wait_timeout` note this file opens with), which is a manual
   * floor rather than something a boot may decide to do.
   *
   * Worth the extra `columnInfo()` read because it only happens on the failure
   * path, and because the raw server error is actively misleading about where
   * the defect is: it names a COLUMN in a table the driver just created
   * successfully, so the natural reading is "the table is fine, the index is
   * odd" — when in truth the object is now registered-but-broken, its declared
   * uniqueness silently absent, and the fix lives in the field's metadata
   * rather than anywhere near the index.
   *
   * ⛔ What this deliberately does NOT do is substitute a prefix index
   * (`KEY (col(191))`) and carry on. For an ordinary index that would be a
   * transparent access-path choice, but for a UNIQUE one it silently REPLACES
   * the declared constraint with a different, stricter one: a prefix-unique
   * index enforces uniqueness over the PREFIX, so two genuinely different
   * values that happen to share it collide. Measured on MySQL 8.0.46 —
   * `UNIQUE KEY (token(191))`, then two distinct 200+ character tokens sharing
   * their first 191 characters: the second insert was rejected with
   * `ER_DUP_ENTRY` even though the tokens differ. On `sys_session.token` that
   * is a valid sign-in refused as a duplicate. A refusal the operator can read
   * is strictly better than a constraint that quietly means something else.
   */
  protected explainUnkeyableTextColumn(
    tableName: string,
    indexName: string,
    columns: string[],
    cause: unknown,
  ): Promise<string | null> {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.explainUnkeyableTextColumn.call(columnCreationHost.of(this), tableName, indexName, columns, cause);
  }

  /**
   * Suffix of the driver-owned HASH-SHADOW column (#11627). Mirrored by
   * `schema-drift.ts`'s {@link isHashShadowColumn}, which must recognise the
   * same column as driver-owned rather than orphaned.
   */
  protected static readonly HASH_SHADOW_SUFFIX = '__hash';

  /**
   * The shadow column that carries `indexName`, capped to MySQL's 64-character
   * identifier limit.
   *
   * Derived from the INDEX name rather than from the column list, deliberately:
   * one shadow serves one declared index, a composite index has no single
   * column to name it after, and the index name is already the differ's
   * identity for the constraint ({@link normalizeDeclaredIndex}) — so re-sync
   * finds the existing index by the same name and skips, and the shadow cannot
   * drift away from the index it belongs to.
   *
   * The overflow branch keeps a truncated prefix for readability and appends a
   * digest of the FULL name, so two long index names that share a prefix still
   * get different shadows.
   */
  protected static hashShadowColumnFor(indexName: string): string {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts`.
    return ColumnCreationFacet.hashShadowColumnFor(indexName);
  }

  /**
   * Carry a declared UNIQUE index on a SHADOW column holding a SHA-256 of its
   * key values, for the case MySQL cannot express directly (#11627).
   *
   * ## Why this exists
   *
   * On utf8mb4 InnoDB a key part may hold at most 3072 bytes — 768 characters
   * — so a full-value UNIQUE index over a longer column is INEXPRESSIBLE, not
   * merely expensive. An OAuth access token may legitimately be a multi-KB JWT.
   * Before this, `syncSchema` refused such an object outright (measured: 7 of
   * 44 platform objects on MySQL 8.0.46, Postgres 0/44), leaving it registered
   * with its declared uniqueness absent. {@link explainUnkeyableTextColumn}
   * names that refusal; this method removes the cause for the UNIQUE case.
   *
   * ## Why a GENERATED column, and not application-computed like the precedent
   *
   * `_objectstack_sequences.key_hash` ({@link createSequencesTable}) hashes in
   * application code because it is a cross-dialect PRIMARY KEY the driver
   * writes on every counter bump. This shadow is different in the one way that
   * matters: it exists ONLY on the dialect that refused the direct index, and
   * only to carry a constraint. A `STORED GENERATED` column lets the SERVER
   * compute it, which buys three properties application hashing cannot:
   *
   *   - **No write path changes at all.** Every INSERT and UPDATE — including
   *     ones this driver never sees, from `os migrate`, a DBA, or replication —
   *     maintains the shadow. An app-computed shadow is only as correct as the
   *     set of writers that remember it.
   *   - **Existing rows are hashed by the ALTER itself**, so there is no
   *     backfill step that could partially complete.
   *   - **The constraint cannot be bypassed**, because nothing can write a
   *     shadow that disagrees with its source columns.
   *
   * ## Semantics, measured on live MySQL 8.0.46 (utf8mb4 / InnoDB)
   *
   * `UNHEX(SHA2(v, 256))` is the FULL 256-bit digest stored as `VARBINARY(32)`
   * — 32 bytes, two orders of magnitude inside the 3072-byte ceiling, and
   * ⚠️ deliberately NOT truncated: a truncated digest would be the number the
   * collision bound is computed over, and there is no reason to pay that.
   *
   *   - **Distinct values that share a long prefix both insert.** This is the
   *     property that rules OUT the prefix-index alternative and the reason
   *     this route was chosen over it (maintainer ruling recorded in commit 107bb4ba4,
   *     2026-08-24): measured, two distinct tokens sharing their first 191
   *     characters are BOTH accepted here, where `UNIQUE KEY (token(191))`
   *     rejected the second as `ER_DUP_ENTRY` — a valid sign-in refused as a
   *     duplicate.
   *   - **A genuine duplicate is still rejected** (`ER_DUP_ENTRY`).
   *   - **NULL stays distinct.** `SHA2(NULL, 256)` is NULL, so a NULL-valued
   *     row has a NULL shadow and a UNIQUE index does not collide NULLs —
   *     matching what a direct UNIQUE over the column would have done.
   *   - **Composites use `CONCAT` with a `0x1f` separator**, and `CONCAT`
   *     returning NULL when ANY argument is NULL is exactly MySQL's
   *     composite-UNIQUE semantics (a tuple with any NULL conflicts with
   *     nothing). The separator keeps the encoding injective, so ('xy','')
   *     and ('x','y') do not alias.
   *
   * ## The collision bound, and what a collision would look like
   *
   * Uniqueness now holds over SHA-256 of the value rather than the value. With
   * a full 256-bit digest and n rows in one index, the birthday bound is
   * n^2 / 2^257. At n = 10^9 rows that is under 10^-59 — below any rate the
   * storage layer itself is trusted at. ⚠️ But the failure MODE is what
   * matters, not only its probability: a collision surfaces as `ER_DUP_ENTRY`
   * on the shadow, which is the SAME error a real duplicate raises, and MySQL
   * quotes the raw binary digest rather than the offending value. Left alone
   * that is an operator seeing an unexplainable duplicate — a wrong answer, not
   * a crash. {@link explainHashShadowDuplicate} exists so the driver can tell
   * the two apart by reading the source columns back, and name whichever it is.
   *
   * ## The NULL-safe organization key parts ride along (commit df1c75c4b)
   *
   * The shadow hashes the DECLARED key, not the raw columns. For a key part
   * `normalizeDeclaredIndex` marked NULL-safe (ADR-0120 D3 — the organization
   * key part of an org-scoped unique), the generation expression embeds the
   * same `COALESCE(col, '__global__')` the direct index would have carried, so
   * NULL-organization rows fold into the global bucket and DO collide with each
   * other. Without it, `CONCAT` returned NULL for every NULL-organization row
   * and the shadow silently reintroduced #5030's zero-constraint on exactly the
   * rows (single-tenant / admin-global defaults) the COALESCE exists for —
   * while the boot log reported the constraint as carried. Plain key parts keep
   * the CONCAT-NULL semantics above: an any-NULL tuple still conflicts with
   * nothing, matching MySQL's own composite-UNIQUE behaviour.
   *
   * Since ADR-0131 D1 no generator marks the tenant key part NULL-safe, so a
   * NEW shadow hashes the plain tenant column, which is what a direct index
   * would key. An existing shadow is never rebuilt for it: the additive sync
   * skips its index by name, and the differ reads its resolved COALESCE key
   * as the plain one on a certified table. Only a shadow whose index is
   * already gone (a `recreate_index`, a manual drop) meets the new key here,
   * as `stale`, and its column is derived, so regenerating it moves no data.
   *
   * Returns `true` when the shadow index now exists.
   */
  protected createHashShadowUniqueIndex(
    tableName: string,
    indexName: string,
    columns: string[],
    nullSafeColumns?: ReadonlySet<string>,
  ): Promise<boolean> {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.createHashShadowUniqueIndex.call(columnCreationHost.of(this), tableName, indexName, columns, nullSafeColumns);
  }

  /**
   * What is already sitting where this index's hash shadow goes (commit cd1348802)?
   *
   *  - `absent`   — nothing; create the column and the key together.
   *  - `reusable` — a generated column hashing EXACTLY the declared key. The
   *                 index that keyed it was dropped (a `recreate_index`, a
   *                 manual `DROP INDEX`, a half-applied migration); re-key it.
   *  - `stale`    — a generated column hashing a DIFFERENT key. The older (before commit df1c75c4b)
   *                 shadow over RAW columns is this case: reusing it would
   *                 re-enforce the OLD constraint under the new name — green,
   *                 silent, and wrong — so it is re-generated instead.
   *  - `foreign`  — a column of that name that is not generated at all. Not
   *                 ours; refuse rather than drop something that may hold data.
   *
   * "Same key" is decided by {@link canonicalIndexKey}, the differ's own
   * identity for an index key, so the question this asks and the question
   * `diffManagedIndexes` asks cannot answer differently.
   *
   * An unreadable catalog degrades to `absent` — exactly the behaviour that
   * shipped before this probe existed — rather than converting a transient
   * read failure into a refused constraint.
   */
  protected hashShadowColumnState(
    tableName: string,
    indexName: string,
    columns: string[],
    nullSafeColumns?: ReadonlySet<string>,
  ): Promise<'absent' | 'reusable' | 'stale' | 'foreign'> {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.hashShadowColumnState.call(columnCreationHost.of(this), tableName, indexName, columns, nullSafeColumns);
  }

  /**
   * Collect the #11627 hash shadow an index left behind when its name was
   * retired for good (#13056).
   *
   * ## The contract this makes true
   *
   * {@link isHashShadowColumn}'s docblock is why the ORPHAN-column pass skips a
   * shadow: dropping it blindly would take the UNIQUE index it carries with it.
   * That docblock also stated what happens instead — the column "is then
   * cleaned up by the index's own removal path" — and until this method there
   * was no such path. Measured: `dropIndexIfExists` issues one statement family
   * (`DROP CONSTRAINT` / `DROP INDEX` / `ALTER TABLE .. DROP INDEX`) and never
   * touches a column, so when metadata stopped declaring a shadow-carried
   * UNIQUE the differ reported the index as an orphan, the apply dropped it,
   * and the `VARBINARY(32)` STORED generated column survived with nothing
   * keying it — while the orphan-column pass declined to report it forever,
   * exactly as designed. A STORED generated column is recomputed and written on
   * every INSERT and on every UPDATE touching its sources, so a table that
   * accumulates retired declarations pays for them permanently.
   *
   * ## Ownership is ESTABLISHED, never assumed
   *
   * Two refusals, in the shape of commit cd1348802's `foreign` guard — a column we have
   * not proved is ours is left alone and named in the log, never dropped:
   *
   *  - a column of this name that is **not generated** may hold user data;
   *  - a column something **still keys** is not the orphan this collects. That
   *    second read is what turns "index first, then column" from an ordering
   *    comment into a checked precondition: it fails closed when the drop above
   *    silently did not take, and it declines to let a `DROP COLUMN` remove a
   *    second index as a side effect.
   *
   * An unreadable catalog degrades to "leave it alone" — the behaviour that
   * shipped before this method existed — rather than turning a transient read
   * failure into a dropped column, the same trade
   * {@link hashShadowColumnState} makes.
   *
   * Returns `true` only when a column was actually dropped.
   */
  protected dropOrphanedHashShadowColumn(
    tableName: string,
    indexName: string,
  ): Promise<boolean> {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.dropOrphanedHashShadowColumn.call(columnCreationHost.of(this), tableName, indexName);
  }

  /**
   * Tell a genuine uniqueness violation apart from a hash COLLISION on a
   * shadow-carried UNIQUE index (#11627), and name which one happened.
   *
   * ⚠️ Why this is not optional. Once uniqueness is enforced over SHA-256 of
   * the value, `ER_DUP_ENTRY` has two possible causes that MySQL reports
   * IDENTICALLY — it quotes the raw binary digest and the index name, and the
   * digest tells an operator nothing about which row conflicted. The likely
   * cause is the ordinary one (a real duplicate); the astronomically unlikely
   * one is a collision, and it would present as the platform refusing a write
   * that is, in fact, unique. That is a user-visible WRONG ANSWER rather than a
   * crash, so "vanishingly unlikely" is not on its own an adequate answer to
   * it.
   *
   * The disambiguation is one read on the failure path only (the same trade
   * {@link explainUnkeyableTextColumn} makes): re-select by the SOURCE columns.
   * A row that matches them is a real duplicate. NO row matching them, with the
   * shadow index nevertheless reporting a conflict, is a collision — and the
   * message says so, with the values, so it is reportable rather than baffling.
   *
   * Returns `null` when this failure is not a shadow-index conflict at all, so
   * the caller's existing handling is unchanged.
   */
  protected explainHashShadowDuplicate(
    tableName: string,
    values: Record<string, unknown>,
    cause: unknown,
  ): Promise<string | null> {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.explainHashShadowDuplicate.call(columnCreationHost.of(this), tableName, values, cause);
  }

  /**
   * Attach {@link explainHashShadowDuplicate}'s verdict to a failing write, or
   * return the error untouched (#11627).
   *
   * ⚠️ Wired into {@link create} only. `update` issues its statement through
   * three paths with no shared catch, and a duplicate on the columns this
   * route covers — an OAuth token, an issuer/account pair, a metadata identity
   * — arrives on INSERT in every flow this repo has. An UPDATE that collides
   * still fails correctly; it just still reports MySQL's binary digest. That
   * gap is deliberate and named rather than left to be discovered.
   */
  protected decorateHashShadowDuplicate(
    tableName: string,
    values: Record<string, unknown>,
    error: unknown,
  ): Promise<unknown> {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.decorateHashShadowDuplicate.call(columnCreationHost.of(this), tableName, values, error);
  }

  /**
   * The declared key parts a shadow-carried index hashes, read back from the
   * generation expression the server stores, so the disambiguating select
   * above filters on the same key the shadow was generated from. Per part:
   * the column identity, and whether the expression wraps it in the NULL-safe
   * `COALESCE(col, …)` form (ADR-0120 D3 via commit df1c75c4b) — the read side must
   * compare through the same fold the enforced key applies.
   */
  protected hashShadowSourceColumns(
    tableName: string,
    indexName: string,
  ): Promise<HashShadowKeyPart[]> {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.hashShadowSourceColumns.call(columnCreationHost.of(this), tableName, indexName);
  }

  /**
   * MySQL's per-ROW budget over the DECLARED byte widths of a table's columns
   * (#11565) — the number its own refusal quotes and the only part of that
   * refusal an operator can act on.
   *
   * Independent of the per-column `varchar` ceiling {@link MAX_VARCHAR_CHARS}
   * bounds: every declaration can be individually legal and the table still be
   * un-creatable. Measured on live MySQL 8.0.46 (utf8mb4 / InnoDB / DYNAMIC),
   * through this driver rather than in raw SQL, so the built-in `id`,
   * `created_at` and `updated_at` columns are inside the numbers:
   *
   * ```
   * 15 fields @ maxLength 1024  CREATE ok      63 fields @ maxLength 255  CREATE ok
   * 16 fields @ maxLength 1024  ER_TOO_BIG_ROWSIZE   64 fields @ maxLength 255  ER_TOO_BIG_ROWSIZE
   * ```
   *
   * Postgres has no equivalent — it TOASTs — so nothing here is dialect-neutral
   * behaviour that happens to be measured on MySQL. It is MySQL-only, and it is
   * selected as MySQL-only **by the error code**, never by a dialect getter.
   */
  protected static readonly MYSQL_ROW_BYTE_BUDGET = 65535;

  /**
   * utf8mb4's bytes-per-character, used ONLY when the server cannot be asked
   * (see {@link schemaBytesPerChar}). The real multiplier is a property of the
   * schema, not of the metadata: measured on 8.0.46, `64 x varchar(1024)` is
   * refused on a utf8mb4 database and CREATES on a latin1 one. That asymmetry
   * is the whole reason this arithmetic is only ever run to EXPLAIN a refusal
   * the server has already issued — see {@link explainRowSizeOverflow}.
   */
  protected static readonly ASSUMED_BYTES_PER_CHAR = 4;

  /**
   * What MySQL charges for one `varchar(chars)` column: the payload plus
   * varchar's own length prefix, which is 1 byte while the payload fits in 255
   * and 2 bytes after.
   *
   * Bracketed by measurement rather than read off a doc page — the boundary is
   * visible in the column counts a table can hold. On utf8mb4 a `varchar(63)`
   * payload is 252 bytes and 32 such columns fit InnoDB's 8126-byte page limit
   * (32 x 253 = 8096; at 254 bytes each they would not), so 252 takes ONE
   * prefix byte; a `varchar(64)` payload of 256 bytes takes two. A payload of
   * exactly 255 is the documented last one-byte width and is the one point
   * neither limit can discriminate — a column that narrow is never stored
   * off-page, so the page limit binds long before 256 vs 257 bytes could show.
   * Off by one byte there would move a number in a message, never a verdict.
   */
  protected static varcharPackLength(chars: number, bytesPerChar: number): number {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts`.
    return ColumnCreationFacet.varcharPackLength(chars, bytesPerChar);
  }

  /**
   * The `varchar(n)` width {@link SqlDriver.createColumn} emits for a field, or
   * `null` when the column it emits is not a varchar at all (#11565).
   *
   * A READ-ONLY mirror of that switch, not a second decision: the two families
   * that size a column from metadata delegate to the very helpers
   * `createColumn` calls ({@link declaredVarcharLength},
   * {@link keyableTextLength}), and the remaining branches are grouped by what
   * `createColumn` does with them, not restated per type.
   *
   * ⚠️ The branch that matters most for the row budget is the one that declares
   * nothing: `lookup` / `user` / `auto_number` and the catch-all all spell
   * `table.string(name)`, which is knex's `varchar(255)` — 1022 bytes on
   * utf8mb4. An object with sixty lookups therefore reaches the budget having
   * declared no `maxLength` anywhere, and a diagnostic that only looked at
   * declared bounds would name nothing at all on the most reachable shape.
   *
   * The agreement between this mirror and `createColumn` is PINNED rather than
   * asserted in prose: `sql-driver-11565-row-byte-budget.test.ts` builds one
   * field of every `FieldType` the spec declares, creates the table, and
   * compares this answer against `columnInfo()` column by column. A type added
   * to the spec enters that pin automatically.
   */
  protected varcharColumnChars(field: any, keyed?: { unique: boolean }): number | null {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.varcharColumnChars.call(columnCreationHost.of(this), field, keyed);
  }

  /**
   * Every varchar column this object's fields produce, widest first, with what
   * each costs against the row budget at a given bytes-per-character (#11565).
   *
   * The built-in `id` / `created_at` / `updated_at` columns are excluded for the
   * same reason `initObjects` skips them when iterating `obj.fields`: they are
   * not authored, so naming them in a diagnostic addressed to the author points
   * at something no declaration can change. They are NOT free — `id` alone is a
   * `varchar(255)` — which is why the message says the sum sits on top of them
   * rather than claiming to be the server's own total.
   */
  protected rowWidthProfile(
    fields: Record<string, any> | undefined,
    keyedColumns: ReadonlyMap<string, { unique: boolean }>,
    bytesPerChar: number,
  ): { columns: RowWidthContribution[]; totalBytes: number } {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.rowWidthProfile.call(columnCreationHost.of(this), fields, keyedColumns, bytesPerChar);
  }

  /**
   * The bytes-per-character the tables this driver creates actually get, read
   * from the server.
   *
   * Knex emits no `CHARACTER SET` clause, so a created table takes the
   * DATABASE's default charset — verified on 8.0.46: a table created with no
   * clause in a `CHARACTER SET latin1` database comes back
   * `TABLE_COLLATION = latin1_swedish_ci`. So `@@character_set_database` is the
   * right question, and `information_schema.CHARACTER_SETS.MAXLEN` answers the
   * multiplier for it (utf8mb4 → 4, utf8mb3 → 3, latin1/ascii → 1).
   *
   * One round-trip, and only ever on a path that is already throwing — the same
   * trade {@link explainUnkeyableTextColumn} makes with its `columnInfo()` read.
   * `null` when the read fails: a diagnostic must not turn into a second
   * failure, and the advice holds with the assumed multiplier.
   */
  protected schemaBytesPerChar(): Promise<{ bytesPerChar: number; charset: string } | null> {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.schemaBytesPerChar.call(columnCreationHost.of(this));
  }

  /**
   * Turn MySQL's `ER_TOO_BIG_ROWSIZE` into a message that names the columns
   * whose declared widths spent the row budget (#11565).
   *
   * ## Why a post-hoc translator and NOT a pre-flight
   *
   * The card that raised this preferred a pre-flight — sum the declared widths
   * before issuing DDL and refuse — on the grounds that a translator "only
   * knows the table failed". That premise does not survive contact with the
   * call site: this runs inside `initObjects`' own loop, where `obj.fields` and
   * the resolved `keyedColumns` are in scope, so it names EVERY contributing
   * field exactly as a pre-flight would. The advantage claimed for the
   * pre-flight is not an advantage it has here.
   *
   * What the two shapes do not share is their failure direction, and the
   * asymmetry is the whole argument:
   *
   *  - A pre-flight has to REPRODUCE the server's arithmetic. Wrong in the lax
   *    direction it is merely useless — the server still refuses, with today's
   *    bad message. Wrong in the STRICT direction it refuses an object MySQL
   *    would have accepted, which is a contract change: the same metadata now
   *    means two different things depending on the driver's own model.
   *  - A translator cannot over-refuse BY CONSTRUCTION. It speaks only after
   *    the server has already refused, so no arithmetic error it makes can
   *    change which objects are accepted — the worst case is a less precise
   *    sentence attached to a refusal that was going to happen anyway.
   *
   * And the arithmetic is genuinely hard to hold, all four parts measured on
   * 8.0.46 while choosing this shape:
   *
   *  1. **The charset multiplier is the schema's, not the metadata's.**
   *     `64 x varchar(1024)` is refused on utf8mb4 and CREATES on latin1.
   *     A pre-flight hard-coding 4 bytes/char over-refuses by 4x on a latin1
   *     deployment.
   *  2. **The length prefix moves** at a 255-byte payload boundary (see
   *     {@link varcharPackLength}).
   *  3. **The null bitmap counts.** `163 x varchar(100)` is refused when the
   *     columns are nullable and CREATES when they are `NOT NULL` — same
   *     declared widths, different verdict.
   *  4. **There is a SECOND, independent limit.** InnoDB's per-page limit
   *     (`Row size too large (> 8126)` on a 16K page) fires far below 65535
   *     for many NARROW columns, because a column whose maximum is under ~256
   *     bytes is never pushed off-page: measured, `varchar(63)` tops out at 32
   *     columns and `varchar(64)` at 196. Through this driver, an object of 40
   *     ordinary `maxLength: 63` fields is refused — a shape a 65535-byte
   *     pre-flight would have waved through, leaving the author with the
   *     unactionable server error the card was filed about.
   *
   * A pre-flight would also need a dialect predicate to know it is on MySQL.
   * This needs none: `ER_TOO_BIG_ROWSIZE` is a MySQL code, so the diagnostic is
   * MySQL-scoped by construction and costs nothing on every other dialect and
   * on the success path.
   *
   * @param addedColumns the columns an `ALTER TABLE` was adding, or `null` for
   *   a `CREATE TABLE`. The budget is the whole ROW either way — a column added
   *   years later is refused by the width of columns nobody is touching — so
   *   the offender list is the same and only the opening clause differs.
   */
  protected explainRowSizeOverflow(
    tableName: string,
    fields: Record<string, any> | undefined,
    keyedColumns: ReadonlyMap<string, { unique: boolean }>,
    addedColumns: string[] | null,
    cause: unknown,
  ): Promise<string | null> {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.explainRowSizeOverflow.call(columnCreationHost.of(this), tableName, fields, keyedColumns, addedColumns, cause);
  }

  private rethrowWithRowSizeExplanation(
    tableName: string,
    fields: Record<string, any> | undefined,
    keyedColumns: ReadonlyMap<string, { unique: boolean }>,
    addedColumns: string[] | null,
    e: any,
  ): Promise<never> {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts`, its docblock with it (see `ColumnCreationHost`).
    return ColumnCreationFacet.rethrowWithRowSizeExplanation.call(columnCreationHost.of(this), tableName, fields, keyedColumns, addedColumns, e);
  }

  /**
   * [#12738] Declare a JSON-valued column as the type that is semantically
   * correct **for this dialect** — the single seam both JSON routes in
   * {@link createColumn} go through.
   *
   * ## The ruling
   *
   * Maintainer, 2026-08-28 (recorded on #12738): each dialect declares the
   * semantically correct JSON column type. Server dialects keep their NATIVE
   * JSON type; the SQLite family declares `text`. Two directions were on the
   * table and BOTH were refused — unifying everything onto `json` (it hands
   * SQLite the affinity trap below) and changing the shared arm for all
   * dialects (it would strip Postgres's json/jsonb and MySQL's JSON, which are
   * correct and stay).
   *
   * ## Why SQLite is the exception, measured rather than argued
   *
   * SQLite has no JSON type. It derives a column's AFFINITY from substrings of
   * the declared type name, and `json` contains none of the markers (`INT`,
   * `CHAR`/`CLOB`/`TEXT`, `BLOB`, `REAL`/`FLOA`/`DOUB`), so it falls through to
   * **NUMERIC** and converts number-like input on the way in. Measured through
   * raw SQL on a column declared `json`: a bare `'0123'` is stored as the
   * INTEGER `123`. `text` takes TEXT affinity and converts nothing — and TEXT
   * is what SQLite's own JSON1 functions operate on, so this is the type the
   * database actually means.
   *
   * That exposure is the one commit 4045b954d had to defeat on this driver's SQLite half
   * by making the `Field.json` codec injective. This change removes it at the
   * ROOT for new columns instead of encoding around it.
   *
   * ⛔ Measured, not assumed — knex's own compilers, read and then run:
   * `ColumnCompiler.prototype.json = 'text'` is the BASE, and the sqlite3
   * dialect is the one that overrides it (`ColumnCompiler_SQLite3.prototype
   * .json = 'json'`). Compiled DDL for `t.json('v')`: `better-sqlite3` and
   * `sqlite3` → `` `v` json ``; `pg` → `"v" json`; `mysql2` → `` `v` json ``.
   * `t.text('v')` under sqlite → `` `v` text ``. So this branch is not a
   * preference between two spellings — it is the one dialect where knex's
   * answer names a type the engine does not have.
   *
   * ## Why `this.isSqlite` is the right discriminator
   *
   * It covers every SQLite face this monorepo ships, and the coverage was
   * verified rather than presumed:
   *
   *  - plain {@link SqlDriver} on `sqlite3` / `sqlite` / `better-sqlite3`
   *    (`SQLITE_EMIT_CLIENTS`);
   *  - `TursoDriver` in all three transport modes — local, embedded-replica
   *    and remote all configure `client: 'better-sqlite3'`;
   *  - `SqliteWasmDriver`, which passes a knex Client CONSTRUCTOR (so the
   *    string match answers `''`) and therefore **overrides `isSqlite` to
   *    `true`** for exactly this reason. A `config.client` string test written
   *    inline here would have silently missed it.
   *
   * ## What this does NOT do
   *
   * It changes what NEW columns are declared as. It never rewrites an existing
   * column: the schema sync is additive, and a legacy `json` column keeps its
   * declared type, its NUMERIC affinity, and the commit 4045b954d encoding that defeats
   * it. Nothing starts reporting drift over the difference either — the base-
   * type finding in `schema-drift.ts` is gated on
   * `multiValueColumnTypeIsLoadBearing(dialect)`, which is `postgres || mysql`
   * — and no read path consults the physical type: `isJsonField` answers from
   * METADATA, so decoding is identical on both spellings.
   *
   * @see turso-json-column-type-asymmetry.test.ts — the #12586 pin, INVERTED by
   *   this change per its own header (it now pins the convergence).
   */
  protected jsonColumn(table: Knex.CreateTableBuilder, name: string): any {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.jsonColumn.call(columnCreationHost.of(this), table, name);
  }

  protected createColumn(
    table: Knex.CreateTableBuilder,
    name: string,
    field: any,
    keyed?: { unique: boolean },
    tenantColumn: boolean = false,
  ): void {
    // [#29520 codemod] The body moved to `sql-driver-column-creation.ts` (see `ColumnCreationHost`).
    return ColumnCreationFacet.createColumn.call(columnCreationHost.of(this), table, name, field, keyed, tenantColumn);
  }

  /**
   * Emit the physical column DEFAULT a field's `defaultValue` calls for — or,
   * deliberately, none at all.
   *
   * The single place `defaultValue` becomes DDL. `createColumn` uses it for a
   * fresh column and {@link rebuildSqliteTablePatched} for a re-materialized
   * one, so a SQLite table rebuild cannot quietly hand back a column whose
   * default differs from the one metadata declares.
   *
   * Four cases, in order:
   *
   * 1. **`'NOW()'`** — the one runtime token with a database counterpart.
   *    Translated to the driver-native canonical default
   *    ({@link nowColumnDefault}) so the column gets a real, zone-explicit
   *    default instead of the literal string `'NOW()'` for whatever upstream
   *    code happens to write — and, on SQLite, instead of the timezone-naive
   *    `CURRENT_TIMESTAMP` that `knex.fn.now()` emits.
   * 2. **Any other runtime token** (`current_user`, and anything the spec adds
   *    to `DEFAULT_VALUE_TOKENS` later) — resolved by the ENGINE at insert time
   *    against the request context, with **no** database counterpart, so this
   *    emits NOTHING. That omission is the contract, not an oversight: the
   *    engine deliberately leaves a `current_user` field UNSET when there is no
   *    authenticated user (system/anonymous writes), and a column DEFAULT
   *    silently overrode that decision — writing the literal string
   *    `'current_user'` into `lookup('sys_user')` columns (#4560). Checking the
   *    spec's predicate rather than an open-coded name keeps a future token
   *    from leaking its own spelling the same way.
   * 3. **Objects** — Expression envelopes (`{ dialect, source }`), evaluated
   *    app-side; never a column DEFAULT.
   * 4. **Everything else** — a real literal, emitted verbatim.
   *
   * # What this deliberately does NOT read: `options[].default` (#7246)
   *
   * A select field's option-level `default: true` is now a real initial value —
   * `ObjectQL.applyFieldDefaults` falls back to the marked option when the field
   * declares no `defaultValue`. It gets NO physical column DEFAULT here, and
   * that asymmetry with case 4 is the decision, not an omission.
   *
   * The #4560 discipline does not forbid it: an option's `value` is a plain
   * literal, not a runtime token, so it *could* be emitted. The reasons not to:
   *
   *  - **One resolver owns the precedence.** `defaultValue` beats the option
   *    flag, and that ordering lives in the engine. A column DEFAULT is a
   *    second resolver that fires only where the engine did not, so keeping it
   *    out means there is exactly one place the question is answered.
   *  - **The shape has no scalar DDL form.** On `multiple: true` the default is
   *    an ARRAY of the marked options. Emitting would need a "…except for
   *    multi-selects" carve-out invisible to the author.
   *  - **It would divide deployments silently.** This method runs for a FRESH
   *    column ({@link createColumn}) and a re-materialized one
   *    ({@link rebuildSqliteTablePatched}) — never a retrofit of an existing
   *    table. Emitting would give new databases (and any SQLite rebuild) a
   *    DEFAULT that older databases on identical metadata lack, and
   *    `detectDrift`'s only `default_mismatch` producer is the #4560 token
   *    check — there is no general declared-literal-vs-physical comparison — so
   *    nothing would ever report the divergence.
   *  - **It would make SQL the odd driver out.** The engine fallback serves
   *    memory, mongodb, sql and turso identically from day one; a SQL-only
   *    second enforcement point is exactly the per-datasource split #4597 and
   *    #4560 were both about.
   *
   * The value the engine resolves is what every ObjectStack write path stores;
   * only a writer bypassing the engine entirely sees NULL, and that writer is
   * not reading `options` either. Pinned by
   * `sql-driver-option-default-ddl.test.ts`.
   */
  protected applyDeclaredColumnDefault(col: Knex.ColumnBuilder, field: any, type: string): void {
    // [#25521 cut 19] The body moved to `sql-driver-schema-sync.ts` (see `SchemaSyncHost`).
    const host: ThisParameterType<typeof applyDeclaredColumnDefault> = {
      nowColumnDefault: (...a) => this.nowColumnDefault(...a),
    };
    return applyDeclaredColumnDefault.call(host, col, field, type);
  }

  // ── Database helpers ────────────────────────────────────────────────────────

  /**
   * The on-disk path backing this SQLite datasource, or `null` when there is
   * none: a non-SQLite dialect, `:memory:` (and any other `:`-prefixed
   * pseudo-filename), or a function-valued `connection` where the host builds
   * each connection itself and the target is not ours to read.
   */
  protected sqliteFilename(): string | null {
    // [#29520 codemod] The body moved to `sql-driver-database-helpers.ts` (see `DatabaseHelpersHost`).
    return DatabaseHelpersFacet.sqliteFilename.call(databaseHelpersHost.of(this));
  }

  protected ensureDatabaseExists(): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-database-helpers.ts` (see `DatabaseHelpersHost`).
    return DatabaseHelpersFacet.ensureDatabaseExists.call(databaseHelpersHost.of(this));
  }

  protected createDatabase(): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-database-helpers.ts` (see `DatabaseHelpersHost`).
    return DatabaseHelpersFacet.createDatabase.call(databaseHelpersHost.of(this));
  }

  /**
   * Ask {@link SqlDriverConfig.fileColumnsMoved} once, and never again.
   *
   * Called from {@link initObjects} — the one async seam every schema-syncing
   * posture passes through, and the only place late enough for the flag row to
   * exist (it lives in `sys_migration`, a table schema sync itself creates) and
   * early enough to precede `registerObjectMetadata`, which freezes
   * {@link isJsonField}'s answer for every media column.
   *
   * ⛔ EVERY failure lands on the JSON arm, and none of them is reported as an
   * error: no resolver, a resolver that throws, a resolver that rejects, a
   * resolver that answers a non-`true` value. Not knowing whether this
   * deployment moved its columns is the ordinary state of every deployment
   * that exists today, so it must read as "not moved" in silence — a driver
   * that guessed the other way would write bare ids into a JSON column.
   *
   * The resolver reference is dropped after the first call, which is what makes
   * this memoized without a second boolean: a repeat `initObjects` (the batched
   * and deferred-DDL paths both call it more than once) finds nothing to ask.
   */
  /**
   * The kernel→driver supply seam for the ADR-0104 media arm (#15989).
   *
   * `ObjectQL.registerDriver` calls this with a closure over the engine's own
   * `haveFileColumnsMoved()`, which reads `sys_migration.columns_moved_at`.
   * It is the counterpart of {@link SqlDriverConfig.fileColumnsMoved} for the
   * ordinary composition, where nobody hand-writes that option: the driver is
   * constructed in an app's config long before any row can be read, so what
   * arrives here is the question and {@link resolveFileColumnsMoved} asks it
   * once, at `initObjects`.
   *
   * ## ⛔ A host declaration is never overruled — this fills an empty slot only
   *
   * If the config named `fileColumnsMoved` at all (a boolean of either
   * polarity, or a resolver of the host's own), this is a NO-OP. The host is
   * the more specific authority about its own storage, and the failure the
   * engine could cause by overruling a declared `false` is the one this whole
   * mechanism exists to prevent: bare ids written into a JSON column.
   *
   * ## It changes nothing that has already been asked
   *
   * After `initObjects` has run once the arm is resolved and frozen — every
   * media column's `isJsonField` answer is already in `jsonFields` — so a
   * resolver arriving later would be a promise this driver cannot keep. A
   * registration after the first `initObjects` therefore leaves the resolved
   * arm alone; the only thing it could do instead is change the write encoding
   * of a table whose columns were built for the other one.
   *
   * @returns whether the resolver was taken, so a caller can tell an
   *          installation from a refusal instead of inferring it.
   */
  setFileColumnsMovedResolver(resolve: () => boolean | Promise<boolean>): boolean {
    // [#29520 codemod] The body moved to `sql-driver-database-helpers.ts` (see `DatabaseHelpersHost`).
    return DatabaseHelpersFacet.setFileColumnsMovedResolver.call(databaseHelpersHost.of(this), resolve);
  }

  /** Has {@link resolveFileColumnsMoved} already run to completion? */
  private fileColumnsMovedAsked = false;

  /**
   * [ADR-0131 D1] The kernel→driver supply seam for "is this database
   * certified": a birth marker, or an organization-ownership ceremony marker
   * of the current shape generation. `ObjectQL.registerDriver` hands over a
   * closure over the engine's `isOrganizationOwnershipCertified()`, which reads
   * the ceremony's `sys_migration` row — a row in a table this driver serves,
   * read through the registry and the pipeline the engine owns, so the driver
   * receives the question, never the ledger's vocabulary.
   *
   * The answer decides one thing only: whether the differ reads an earlier
   * release's `COALESCE(<tenant>, …)` key part as the plain tenant column new
   * DDL keys ({@link detectTableIndexDrift}). Without a resolver, or when it
   * throws, the answer is "not certified": the two forms then stay distinct
   * constraints, and the differ REPORTS the 18.0 index as a destructive
   * `recreate_index`. That report is never applied unattended — the boot
   * reconcile applies `safe` entries only, the artifact gate refuses it, and
   * `os migrate apply` needs `--allow-destructive` — and its message names the
   * ownership ceremony as the remedy.
   */
  setTenantKeyCertifiedResolver(resolve: () => boolean | Promise<boolean>): void {
    // [#29520 codemod] The body moved to `sql-driver-database-helpers.ts` (see `DatabaseHelpersHost`).
    return DatabaseHelpersFacet.setTenantKeyCertifiedResolver.call(databaseHelpersHost.of(this), resolve);
  }

  private tenantKeyCertifiedResolver?: () => boolean | Promise<boolean>;
  /** Set once the resolver has answered yes — a certificate is never withdrawn. */
  private tenantKeyCertified?: true;
  /** The resolver's failure is reported once per driver. */
  private tenantKeyCertifiedReadFailureReported = false;

  /**
   * Asked lazily — only a table carrying the NULL-safe tenant key part needs
   * it. A yes is kept; a no is asked again next time, so an answer taken
   * before the ledger could be read never outlives that moment.
   */
  protected isTenantKeyCertified(): Promise<boolean> {
    // [#29520 codemod] The body moved to `sql-driver-database-helpers.ts` (see `DatabaseHelpersHost`).
    return DatabaseHelpersFacet.isTenantKeyCertified.call(databaseHelpersHost.of(this));
  }

  protected resolveFileColumnsMoved(): Promise<void> {
    // [#29520 codemod] The body moved to `sql-driver-database-helpers.ts` (see `DatabaseHelpersHost`).
    return DatabaseHelpersFacet.resolveFileColumnsMoved.call(databaseHelpersHost.of(this));
  }

  /**
   * Is a SINGLE-VALUE media column a JSON column on THIS deployment?
   *
   * The one place the ADR-0104 dual-encoding window is asked about, so the DDL
   * switch, the read-side deserializer registry, the `varchar` mirror and the
   * drift detector cannot answer it differently. `multiple: true` media is not
   * this question — it is a list of ids and a JSON column on every deployment.
   */
  protected mediaColumnIsJson(): boolean {
    // [#29520 codemod] The body moved to `sql-driver-database-helpers.ts` (see `DatabaseHelpersHost`).
    return DatabaseHelpersFacet.mediaColumnIsJson.call(databaseHelpersHost.of(this));
  }

  /**
   * Is this column a JSON column on this deployment?
   *
   * [#17469] (maintainer ruling 2026-09-13, decision batch #128 item 5, option
   * 1′) The `multiple` half asks `@objectstack/spec`'s `isMultiValueField`
   * rather than reading `field.multiple` raw, so the header above
   * ("Membership is owned by @objectstack/spec") is now true for BOTH halves of
   * this predicate. Before it, `!!field.multiple` arrayified the column for
   * ANY type, while the spec predicate answered "not multi-value" for the same
   * field — so a consumer shaping a query from the spec predicate composed `=`
   * against a JSON array column and the driver answered 400. One definition of
   * "multi-valued", and the shapes where the two used to disagree are refused
   * at the authoring entrance by `FieldSchema` in the same ruling.
   *
   * ⚠️ The spec predicate reads the AUTHORABLE type vocabulary. A
   * driver-internal alias (`string` / `integer` / `int` / `float`, the
   * introspected-column spellings) is not a `FieldType`, so a `multiple: true`
   * on one of those is no longer a JSON column — `object` / `array`, the
   * aliases whose value really is structured, are in {@link JSON_COLUMN_TYPES}
   * and keep their column unchanged.
   */
  protected isJsonField(type: string, field: any): boolean {
    // [#29520 codemod] The body moved to `sql-driver-database-helpers.ts` (see `DatabaseHelpersHost`).
    return DatabaseHelpersFacet.isJsonField.call(databaseHelpersHost.of(this), type, field);
  }

  // ── SQLite serialisation ────────────────────────────────────────────────────

  protected formatInput(object: string, data: any): any {
    // [#29520 codemod] The body moved to `sql-driver-sqlite-serialisation.ts` (see `SqliteSerialisationHost`).
    return SqliteSerialisationFacet.formatInput.call(sqliteSerialisationHost.of(this), object, data);
  }

  protected formatOutput(object: string, data: any): any {
    // [#29520 codemod] The body moved to `sql-driver-sqlite-serialisation.ts` (see `SqliteSerialisationHost`).
    return SqliteSerialisationFacet.formatOutput.call(sqliteSerialisationHost.of(this), object, data);
  }

  // ── Introspection internals ─────────────────────────────────────────────────

  /**
   * The table's column names in DECLARED order, read from the catalog's own
   * ordinal (#11163).
   *
   * knex's `columnInfo()` is an object KEYED BY COLUMN NAME, built from a
   * catalog query that carries no `ORDER BY` — so its key-insertion order is
   * whatever row order the server's plan yielded, which is unspecified on
   * every dialect. Measured: SQLite and PostgreSQL 16.13 happened to return
   * declared order; MySQL 8.0.46 returned ALPHABETICAL order, so a federated
   * object drafted from a MySQL remote got its fields alphabetized. The
   * ordinal is the fact and the row order is not, so every arm orders by the
   * catalog's ordinal rather than trusting a plan.
   *
   * Each arm reads the same catalog `columnInfo()` populates, with the same
   * scoping knex itself applies there (PG: `current_schema()`, or the named
   * `schema` exactly as knex's `withSchema()` scopes `columnInfo()` — #24707;
   * MySQL: `DATABASE()`; SQLite: `PRAGMA table_info`, whose `cid` is the
   * ordinal).
   */
  protected introspectColumnOrder(tableName: string, schema?: string): Promise<string[]> {
    // [#25521 cut 1] The body moved to `sql-driver-introspection.ts` (see `IntrospectionHost`).
    const readIsMysql = () => this.isMysql;
    const readIsPostgres = () => this.isPostgres;
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof introspectColumnOrder> = {
      get isMysql() { return readIsMysql(); },
      get isPostgres() { return readIsPostgres(); },
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
    };
    return introspectColumnOrder.call(host, tableName, schema);
  }

  /**
   * `schema` (PostgreSQL, #24707) reads the table in that schema rather than
   * in `current_schema()`. Omitted, the read is the bare-name one it always
   * was — the first schema on `search_path` — which is right for every caller
   * that names a table this driver manages. {@link introspectSchema} lists
   * tables across every schema on the path, so it names each table's own.
   */
  protected introspectColumns(tableName: string, schema?: string): Promise<IntrospectedColumn[]> {
    // [#25521 cut 1] The body moved to `sql-driver-introspection.ts` (see `IntrospectionHost`).
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof introspectColumns> = {
      introspectColumnOrder: (...a) => this.introspectColumnOrder(...a),
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
    };
    return introspectColumns.call(host, tableName, schema);
  }

  /**
   * ⚠️ A failed read is an ERROR, not a table without foreign keys (#7332 —
   * the ruling {@link introspectIndexes} carries, extended to this sibling by
   * #11161). This used to wrap the whole dialect dispatch in a bare `catch {}`
   * and return `[]`, so a query a live server rejects degraded to "this table
   * has no foreign keys" with no diagnostic — a positive assertion of absence
   * that downstream consumers act on. See {@link introspectIndexes} for the
   * full rationale; the option shape and default are deliberately identical.
   */
  protected introspectForeignKeys(
    tableName: string,
    opts: {
      /**
       * What a failed read means to THIS caller (#7332). `'throw'` (the
       * default) surfaces it; `'partial'` returns whatever was read before the
       * failure — correct only where a short read is self-correcting.
       */
      onFailure?: 'throw' | 'partial';
    } = {},
  ): Promise<IntrospectedForeignKey[]> {
    // [#25521 cut 1] The body moved to `sql-driver-introspection.ts` (see `IntrospectionHost`).
    const readIsMysql = () => this.isMysql;
    const readIsPostgres = () => this.isPostgres;
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof introspectForeignKeys> = {
      get isMysql() { return readIsMysql(); },
      get isPostgres() { return readIsPostgres(); },
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
    };
    return introspectForeignKeys.call(host, tableName, opts);
  }

  /**
   * ⚠️ A failed read is an ERROR, not a table without a primary key (#7332 —
   * the ruling {@link introspectIndexes} carries, extended to this sibling by
   * #11161). This used to wrap the whole dialect dispatch in a bare `catch {}`
   * and return `[]` — and `[]` does not read downstream as "the read failed":
   * it reads as *this table has no primary key*, a legal and meaningful answer
   * that federated-object codegen, the persisted `external_catalog`
   * (ADR-0015) and schema-drift comparison all act on. Measured on a live
   * PostgreSQL 16.13: a query against a non-existent relation raises
   * `undefined_table`, which the old catch converted to a confident empty key.
   * See {@link introspectIndexes} for the full rationale; the option shape and
   * default are deliberately identical.
   */
  protected introspectPrimaryKeys(
    tableName: string,
    opts: {
      /**
       * What a failed read means to THIS caller (#7332). `'throw'` (the
       * default) surfaces it; `'partial'` returns whatever was read before the
       * failure — correct only where a short read is self-correcting.
       */
      onFailure?: 'throw' | 'partial';
    } = {},
  ): Promise<string[]> {
    // [#25521 cut 1] The body moved to `sql-driver-introspection.ts` (see `IntrospectionHost`).
    const readIsMysql = () => this.isMysql;
    const readIsPostgres = () => this.isPostgres;
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof introspectPrimaryKeys> = {
      get isMysql() { return readIsMysql(); },
      get isPostgres() { return readIsPostgres(); },
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
    };
    return introspectPrimaryKeys.call(host, tableName, opts);
  }

  /**
   * Columns that ALONE carry a single-column unique constraint (#11202).
   *
   * ⚠️ A failed read is an ERROR, not a table without unique constraints
   * (#7332 — the ruling {@link introspectIndexes} carries, extended to this
   * sibling by #11161). This used to wrap the whole dialect dispatch in a bare
   * `catch {}` and return `[]`, silently converting a failed read into a
   * positive assertion of absence. See {@link introspectIndexes} for the full
   * rationale; the option shape and default are deliberately identical.
   *
   * ## The three arms answer ONE question, and it is the narrow one
   *
   * Maintainer ruling 2026-08-23 (option A→B), verbatim and untranslated:
   * 「10950 不考虑存量，其他接受你的建议」. The answer is **single-column
   * uniqueness only**: a column appears here iff some unique constraint covers
   * that column AND NOTHING ELSE. A member of `UNIQUE (a, b)` is deliberately
   * absent — neither `a` nor `b` is unique on its own, and this method's flat
   * `string[]` (folded by `introspectSchema` into a per-column `isUnique`) is
   * structurally unable to say "a and b are unique TOGETHER". Emitting both
   * made the flag assert something the constraint does not: that each column
   * alone is unique. Representing composite constraints is option B, which
   * waits for real demand and is NOT this method.
   *
   * The arms used to disagree about this, and the disagreement was invisible
   * because the loudest arm was dead: SQLite kept single-column unique indexes
   * only (`info.length === 1`), while the Postgres and MySQL arms returned
   * every member of every composite constraint — and the Postgres arm's query
   * was invalid SQL until #11161, so live Postgres had never once reported a
   * unique constraint through this method. Repairing that query is what made
   * three dialects start answering three different questions on live systems.
   *
   * All three now normalise their rows to {@link UniqueConstraintMember} and
   * decide through {@link singleColumnUniqueColumns} — one predicate, so a
   * fourth dialect cannot quietly acquire a fourth meaning.
   *
   * ## A PRIMARY KEY is not one of them (#11654)
   *
   * The residual cell of the same family, and the same convention applied one
   * step over: a column appears here iff a *declared UNIQUE constraint* covers
   * it alone. Postgres and MySQL got this for free — `CONSTRAINT_TYPE =
   * 'UNIQUE'` never matches a primary key. SQLite did not: it keys on
   * `PRAGMA index_list`, which reports the unique auto-index SQLite
   * materialises for a non-INTEGER key, so a `varchar` key was flagged while
   * an `INTEGER PRIMARY KEY` — a rowid alias with no auto-index at all — was
   * not. Three dialects, four answers, from the declared type of a key.
   *
   * The SQLite arm now skips `origin: 'pk'` rows. Unlike the composite case
   * above the excluded flag was not FALSE, only inconsistent — a key column
   * really is unique — which is why the exclusion has to be paid for by the
   * face that keeps the fact: `introspectPrimaryKeys` reports it through
   * `primaryKeys` and `IntrospectedColumn.primaryKey`, both unmoved by this.
   */
  protected introspectUniqueConstraints(
    tableName: string,
    opts: {
      /**
       * What a failed read means to THIS caller (#7332). `'throw'` (the
       * default) surfaces it; `'partial'` returns whatever was read before the
       * failure — correct only where a short read is self-correcting.
       */
      onFailure?: 'throw' | 'partial';
    } = {},
  ): Promise<string[]> {
    // [#25521 cut 1] The body moved to `sql-driver-introspection.ts` (see `IntrospectionHost`).
    const readIsMysql = () => this.isMysql;
    const readIsPostgres = () => this.isPostgres;
    const readIsSqlite = () => this.isSqlite;
    const readKnex = () => this.knex;
    const host: ThisParameterType<typeof introspectUniqueConstraints> = {
      get isMysql() { return readIsMysql(); },
      get isPostgres() { return readIsPostgres(); },
      get isSqlite() { return readIsSqlite(); },
      get knex() { return readKnex(); },
    };
    return introspectUniqueConstraints.call(host, tableName, opts);
  }

  // [#29520 codemod] Fills `SqlDriverStatics` (declared above the class) for the facet modules.
  static {
    Object.defineProperties(SqlDriverStatics, {
      ASSUMED_BYTES_PER_CHAR: { get: () => SqlDriver.ASSUMED_BYTES_PER_CHAR },
      DEFAULT_CONNECT_TIMEOUT_MS: { get: () => SqlDriver.DEFAULT_CONNECT_TIMEOUT_MS },
      DEFAULT_CREATE_TIMEOUT_MS: { get: () => SqlDriver.DEFAULT_CREATE_TIMEOUT_MS },
      DEFAULT_STRING_VARCHAR_CHARS: { get: () => SqlDriver.DEFAULT_STRING_VARCHAR_CHARS },
      DIALECT_CONNECT_TIMEOUT: { get: () => SqlDriver.DIALECT_CONNECT_TIMEOUT },
      MAX_KEYABLE_VARCHAR_CHARS: { get: () => SqlDriver.MAX_KEYABLE_VARCHAR_CHARS },
      MAX_VARCHAR_CHARS: { get: () => SqlDriver.MAX_VARCHAR_CHARS },
      MYSQL_EMIT_CLIENTS: { get: () => SqlDriver.MYSQL_EMIT_CLIENTS },
      MYSQL_ROW_BYTE_BUDGET: { get: () => SqlDriver.MYSQL_ROW_BYTE_BUDGET },
      MYSQL_TEXT_TEMPORAL_TYPES: { get: () => SqlDriver.MYSQL_TEXT_TEMPORAL_TYPES },
      PG_OID_DATE: { get: () => SqlDriver.PG_OID_DATE },
      PG_OID_DATE_ARRAY: { get: () => SqlDriver.PG_OID_DATE_ARRAY },
      PG_OID_TEXT_ARRAY: { get: () => SqlDriver.PG_OID_TEXT_ARRAY },
      POSTGRES_EMIT_CLIENTS: { get: () => SqlDriver.POSTGRES_EMIT_CLIENTS },
      POSTGRES_WIRE_CLIENTS: { get: () => SqlDriver.POSTGRES_WIRE_CLIENTS },
      POSTGRES_WIRE_ONLY_CLIENTS: { get: () => SqlDriver.POSTGRES_WIRE_ONLY_CLIENTS },
      SQLITE_AUTO_VACUUM_INCREMENTAL: { get: () => SqlDriver.SQLITE_AUTO_VACUUM_INCREMENTAL },
      SQLITE_EMIT_CLIENTS: { get: () => SqlDriver.SQLITE_EMIT_CLIENTS },
      SQLITE_FILE_REFUSALS: { get: () => SqlDriver.SQLITE_FILE_REFUSALS },
      SQLITE_JOURNAL_MODE_ENV: { get: () => SqlDriver.SQLITE_JOURNAL_MODE_ENV },
      autoVacuumOf: { value: (...args: Parameters<typeof SqlDriver.autoVacuumOf>) => SqlDriver.autoVacuumOf(...args) },
      clientSpelling: { value: (...args: Parameters<typeof SqlDriver.clientSpelling>) => SqlDriver.clientSpelling(...args) },
      emissionClients: { value: (...args: Parameters<typeof SqlDriver.emissionClients>) => SqlDriver.emissionClients(...args) },
      hashShadowColumnFor: { value: (...args: Parameters<typeof SqlDriver.hashShadowColumnFor>) => SqlDriver.hashShadowColumnFor(...args) },
      isSqliteBusyError: { value: (...args: Parameters<typeof SqlDriver.isSqliteBusyError>) => SqlDriver.isSqliteBusyError(...args) },
      journalModeOf: { value: (...args: Parameters<typeof SqlDriver.journalModeOf>) => SqlDriver.journalModeOf(...args) },
      varcharPackLength: { value: (...args: Parameters<typeof SqlDriver.varcharPackLength>) => SqlDriver.varcharPackLength(...args) },
      withConnectBound: { value: (...args: Parameters<typeof SqlDriver.withConnectBound>) => SqlDriver.withConnectBound(...args) },
      withMysqlCalendarDayAsText: { value: (...args: Parameters<typeof SqlDriver.withMysqlCalendarDayAsText>) => SqlDriver.withMysqlCalendarDayAsText(...args) },
      withPostgresCalendarDayAsText: { value: (...args: Parameters<typeof SqlDriver.withPostgresCalendarDayAsText>) => SqlDriver.withPostgresCalendarDayAsText(...args) },
      withUtcSession: { value: (...args: Parameters<typeof SqlDriver.withUtcSession>) => SqlDriver.withUtcSession(...args) },
    });
  }

  // [#29520 codemod] Installs each facet's host factory (`sql-driver-facet-hosts.ts`): a static block adds
  // no member to the class, so the published `.d.ts` does not move.
  static {
    aggregationHost.install((driver) => ({
      aggregandColumnClassOf: (...a) => driver.aggregandColumnClassOf(...a),
      aggregateBackendFault: (...a) => driver.aggregateBackendFault(...a),
      aliasIdentifierSql: (...a) => driver.aliasIdentifierSql(...a),
      applyFilters: (...a) => driver.applyFilters(...a),
      applyTenantScope: (...a) => driver.applyTenantScope(...a),
      get booleanFields() { return driver.booleanFields; },
      buildDateBucketExpr: (...a) => driver.buildDateBucketExpr(...a),
      coercionKey: (...a) => driver.coercionKey(...a),
      get config() { return driver.config; },
      get dateGranularityCapabilities() { return driver.dateGranularityCapabilities; },
      get dialectName() { return driver.dialectName; },
      foldEmptyAggregateAnswers: (...a) => driver.foldEmptyAggregateAnswers(...a),
      get fractionalNumericFields() { return driver.fractionalNumericFields; },
      get getBuilder() { return driver.getBuilder.bind(driver); },
      get knex() { return driver.knex; },
      mapAggregateFunc: (...a) => driver.mapAggregateFunc(...a),
      get numericFields() { return driver.numericFields; },
      presentReadColumns: (...a) => driver.presentReadColumns(...a),
      readPresentationKind: (...a) => driver.readPresentationKind(...a),
    }));
    bulkOperationsHost.install((driver) => ({
      applyFilters: (...a) => driver.applyFilters(...a),
      applyTenantScope: (...a) => driver.applyTenantScope(...a),
      applyWriteColumnMap: (...a) => driver.applyWriteColumnMap(...a),
      auditMissingTenant: (...a) => driver.auditMissingTenant(...a),
      autoNumberCounterKey: (...a) => driver.autoNumberCounterKey(...a),
      backendStatementFault: (...a) => driver.backendStatementFault(...a),
      collidingAutoNumberReservations: (...a) => driver.collidingAutoNumberReservations(...a),
      fillAutoNumberFields: (...a) => driver.fillAutoNumberFields(...a),
      formatInput: (...a) => driver.formatInput(...a),
      formatOutput: (...a) => driver.formatOutput(...a),
      get getBuilder() { return driver.getBuilder.bind(driver); },
      injectTenantOnInsert: (...a) => driver.injectTenantOnInsert(...a),
      get insertReturnsStoredRows() { return driver.insertReturnsStoredRows; },
      keepSuppliedUpdatedAt: (...a) => driver.keepSuppliedUpdatedAt(...a),
      get knex() { return driver.knex; },
      readBackInsertedRows: (...a) => driver.readBackInsertedRows(...a),
      resyncSequenceToDataMax: (...a) => driver.resyncSequenceToDataMax(...a),
      rotationShardsOf: (...a) => driver.rotationShardsOf(...a),
      rotationWriteTarget: (...a) => driver.rotationWriteTarget(...a),
      stampInsertTimestamps: (...a) => driver.stampInsertTimestamps(...a),
      stampsUpdatedAt: (...a) => driver.stampsUpdatedAt(...a),
      unresolvableFilterColumnRefusal: (...a) => driver.unresolvableFilterColumnRefusal(...a),
      update: (...a) => driver.update(...a),
      updateWithPresumedTimestamp: (...a) => driver.updateWithPresumedTimestamp(...a),
      updatedAtStamp: (...a) => driver.updatedAtStamp(...a),
      updatedAtStampIsPresumed: (...a) => driver.updatedAtStampIsPresumed(...a),
    }));
    classHeadHost.install((driver) => ({
      assertDialectEmits: (...a) => driver.assertDialectEmits(...a),
      buildDateBucketExpr: (...a) => driver.buildDateBucketExpr(...a),
      get config() { return driver.config; },
      get isMysql() { return driver.isMysql; },
      get isPostgres() { return driver.isPostgres; },
      get isSqlite() { return driver.isSqlite; },
      get knex() { return driver.knex; },
      get logger() { return driver.logger; },
      get openedEmptyInMemory() { return driver.openedEmptyInMemory; },
      set openedEmptyInMemory(v) { driver.openedEmptyInMemory = v; },
      get schemaMode() { return driver.schemaMode; },
    }));
    columnCreationHost.install((driver) => ({
      applyDeclaredColumnDefault: (...a) => driver.applyDeclaredColumnDefault(...a),
      declaredFieldsFor: (...a) => driver.declaredFieldsFor(...a),
      declaredVarcharLength: (...a) => driver.declaredVarcharLength(...a),
      explainHashShadowDuplicate: (...a) => driver.explainHashShadowDuplicate(...a),
      explainRowSizeOverflow: (...a) => driver.explainRowSizeOverflow(...a),
      hashShadowColumnState: (...a) => driver.hashShadowColumnState(...a),
      hashShadowSourceColumns: (...a) => driver.hashShadowSourceColumns(...a),
      get isMysql() { return driver.isMysql; },
      get isSqlite() { return driver.isSqlite; },
      jsonColumn: (...a) => driver.jsonColumn(...a),
      keyableTextLength: (...a) => driver.keyableTextLength(...a),
      get knex() { return driver.knex; },
      logDurabilityFailure: (...a) => driver.logDurabilityFailure(...a),
      get logger() { return driver.logger; },
      mediaColumnIsJson: (...a) => driver.mediaColumnIsJson(...a),
      nowColumnDefault: (...a) => driver.nowColumnDefault(...a),
      rowWidthProfile: (...a) => driver.rowWidthProfile(...a),
      schemaBytesPerChar: (...a) => driver.schemaBytesPerChar(...a),
      varcharColumnChars: (...a) => driver.varcharColumnChars(...a),
    }));
    crudHost.install((driver) => ({
      applyFilters: (...a) => driver.applyFilters(...a),
      applyTenantScope: (...a) => driver.applyTenantScope(...a),
      applyWriteColumnMap: (...a) => driver.applyWriteColumnMap(...a),
      assertBareKnexSafe: (...a) => driver.assertBareKnexSafe(...a),
      auditMissingTenant: (...a) => driver.auditMissingTenant(...a),
      backendStatementFault: (...a) => driver.backendStatementFault(...a),
      collidingAutoNumberReservations: (...a) => driver.collidingAutoNumberReservations(...a),
      createSequencesTable: (...a) => driver.createSequencesTable(...a),
      decorateHashShadowDuplicate: (...a) => driver.decorateHashShadowDuplicate(...a),
      ensureSequencesKeyHashShape: (...a) => driver.ensureSequencesKeyHashShape(...a),
      fillAutoNumberFields: (...a) => driver.fillAutoNumberFields(...a),
      findRows: (...a) => driver.findRows(...a),
      formatInput: (...a) => driver.formatInput(...a),
      formatOutput: (...a) => driver.formatOutput(...a),
      get getBuilder() { return driver.getBuilder.bind(driver); },
      injectTenantOnInsert: (...a) => driver.injectTenantOnInsert(...a),
      get insertReturnsStoredRows() { return driver.insertReturnsStoredRows; },
      get isSqlite() { return driver.isSqlite; },
      get knex() { return driver.knex; },
      mapSortField: (...a) => driver.mapSortField(...a),
      orderKeysFor: (...a) => driver.orderKeysFor(...a),
      readBackInsertedRows: (...a) => driver.readBackInsertedRows(...a),
      remoteColumn: (...a) => driver.remoteColumn(...a),
      resolveTenantField: (...a) => driver.resolveTenantField(...a),
      resyncSequenceToDataMax: (...a) => driver.resyncSequenceToDataMax(...a),
      rotationWriteTarget: (...a) => driver.rotationWriteTarget(...a),
      get sequencesHasKeyHash() { return driver.sequencesHasKeyHash; },
      set sequencesHasKeyHash(v) { driver.sequencesHasKeyHash = v; },
      get sequencesTableEnsurePromise() { return driver.sequencesTableEnsurePromise; },
      set sequencesTableEnsurePromise(v) { driver.sequencesTableEnsurePromise = v; },
      get sequencesTableReady() { return driver.sequencesTableReady; },
      set sequencesTableReady(v) { driver.sequencesTableReady = v; },
      stampInsertTimestamps: (...a) => driver.stampInsertTimestamps(...a),
      unresolvableFilterColumnRefusal: (...a) => driver.unresolvableFilterColumnRefusal(...a),
    }));
    databaseHelpersHost.install((driver) => ({
      get config() { return driver.config; },
      createDatabase: (...a) => driver.createDatabase(...a),
      get fileColumnsMoved() { return driver.fileColumnsMoved; },
      set fileColumnsMoved(v) { driver.fileColumnsMoved = v; },
      get fileColumnsMovedAsked() { return driver.fileColumnsMovedAsked; },
      set fileColumnsMovedAsked(v) { driver.fileColumnsMovedAsked = v; },
      get fileColumnsMovedDeclared() { return driver.fileColumnsMovedDeclared; },
      get fileColumnsMovedResolver() { return driver.fileColumnsMovedResolver; },
      set fileColumnsMovedResolver(v) { driver.fileColumnsMovedResolver = v; },
      get isMysql() { return driver.isMysql; },
      get isPostgres() { return driver.isPostgres; },
      get isSqlite() { return driver.isSqlite; },
      get knex() { return driver.knex; },
      get logger() { return driver.logger; },
      mediaColumnIsJson: (...a) => driver.mediaColumnIsJson(...a),
      get openedEmptyInMemory() { return driver.openedEmptyInMemory; },
      sqliteFilename: (...a) => driver.sqliteFilename(...a),
      get tenantKeyCertified() { return driver.tenantKeyCertified; },
      set tenantKeyCertified(v) { driver.tenantKeyCertified = v; },
      get tenantKeyCertifiedReadFailureReported() { return driver.tenantKeyCertifiedReadFailureReported; },
      set tenantKeyCertifiedReadFailureReported(v) { driver.tenantKeyCertifiedReadFailureReported = v; },
      get tenantKeyCertifiedResolver() { return driver.tenantKeyCertifiedResolver; },
      set tenantKeyCertifiedResolver(v) { driver.tenantKeyCertifiedResolver = v; },
    }));
    deferredDdlHost.install((driver) => ({
      get deferredDdl() { return driver.deferredDdl; },
      set deferredDdl(v) { driver.deferredDdl = v; },
      get deferredSchemaObjects() { return driver.deferredSchemaObjects; },
      get flushingDeferredDdl() { return driver.flushingDeferredDdl; },
      set flushingDeferredDdl(v) { driver.flushingDeferredDdl = v; },
      initObjects: (...a) => driver.initObjects(...a),
      previewDeferredSchemaWork: (...a) => driver.previewDeferredSchemaWork(...a),
      get tablesCreatedHere() { return driver.tablesCreatedHere; },
      get tablesFoundExisting() { return driver.tablesFoundExisting; },
    }));
    distinctHost.install((driver) => ({
      applyFilters: (...a) => driver.applyFilters(...a),
      applyTenantScope: (...a) => driver.applyTenantScope(...a),
      coercionKey: (...a) => driver.coercionKey(...a),
      distinctBackendFault: (...a) => driver.distinctBackendFault(...a),
      get getBuilder() { return driver.getBuilder.bind(driver); },
      presentReadValue: (...a) => driver.presentReadValue(...a),
      readPresentationKind: (...a) => driver.readPresentationKind(...a),
    }));
    fieldMappingHost.install((driver) => ({
      get fieldColumnByObject() { return driver.fieldColumnByObject; },
      get logger() { return driver.logger; },
      get managedObjectFields() { return driver.managedObjectFields; },
      get nondeterministicPagingWarned() { return driver.nondeterministicPagingWarned; },
      paginationTieBreaker: (...a) => driver.paginationTieBreaker(...a),
    }));
    filterHelpersHost.install((driver) => ({
      applyContainsLike: (...a) => driver.applyContainsLike(...a),
      applyCrossFieldComparison: (...a) => driver.applyCrossFieldComparison(...a),
      applyEmptyOperator: (...a) => driver.applyEmptyOperator(...a),
      applyFalseConstant: (...a) => driver.applyFalseConstant(...a),
      applyFilterCondition: (...a) => driver.applyFilterCondition(...a),
      applyJsonMembership: (...a) => driver.applyJsonMembership(...a),
      applyLike: (...a) => driver.applyLike(...a),
      applyLikePattern: (...a) => driver.applyLikePattern(...a),
      applyNormalizedComparison: (...a) => driver.applyNormalizedComparison(...a),
      applyNowAnchorComparison: (...a) => driver.applyNowAnchorComparison(...a),
      applyNullSafeNegative: (...a) => driver.applyNullSafeNegative(...a),
      applyTextOperatorOverNonTextColumn: (...a) => driver.applyTextOperatorOverNonTextColumn(...a),
      assertOperatorAppliesToColumn: (...a) => driver.assertOperatorAppliesToColumn(...a),
      get booleanFields() { return driver.booleanFields; },
      get canonicalDatetimeFields() { return driver.canonicalDatetimeFields; },
      get canonicalTimeFields() { return driver.canonicalTimeFields; },
      coerceFilterValue: (...a) => driver.coerceFilterValue(...a),
      coercionKey: (...a) => driver.coercionKey(...a),
      compileFilters: (...a) => driver.compileFilters(...a),
      get dateFields() { return driver.dateFields; },
      get datetimeFields() { return driver.datetimeFields; },
      filterColumnExpr: (...a) => driver.filterColumnExpr(...a),
      isJsonColumn: (...a) => driver.isJsonColumn(...a),
      get isMysql() { return driver.isMysql; },
      isNonTextColumn: (...a) => driver.isNonTextColumn(...a),
      get isSqlite() { return driver.isSqlite; },
      jsonColumnFieldClass: (...a) => driver.jsonColumnFieldClass(...a),
      get jsonFields() { return driver.jsonFields; },
      logWithheldFilterDiagnostic: (...a) => driver.logWithheldFilterDiagnostic(...a),
      get logger() { return driver.logger; },
      get managedObjectFields() { return driver.managedObjectFields; },
      mapSortField: (...a) => driver.mapSortField(...a),
      get mediaFields() { return driver.mediaFields; },
      needsLegacyDatetimeRepair: (...a) => driver.needsLegacyDatetimeRepair(...a),
      needsLegacyTimeRepair: (...a) => driver.needsLegacyTimeRepair(...a),
      get numericFields() { return driver.numericFields; },
      get objectByPhysicalTable() { return driver.objectByPhysicalTable; },
      presentReadValue: (...a) => driver.presentReadValue(...a),
      get readableIdsDriverName() { return driver.readableIdsDriverName; },
      get readableIdsRefusalLog() { return driver.readableIdsRefusalLog; },
      readableIdsSubquery: (...a) => driver.readableIdsSubquery(...a),
      remoteColumn: (...a) => driver.remoteColumn(...a),
      resolveWithheldFilterRefusal: (...a) => driver.resolveWithheldFilterRefusal(...a),
      sqliteCanonicalDatetimeSql: (...a) => driver.sqliteCanonicalDatetimeSql(...a),
      sqliteCanonicalTimeSql: (...a) => driver.sqliteCanonicalTimeSql(...a),
      storageDatetimeValue: (...a) => driver.storageDatetimeValue(...a),
      tableNameForBuilder: (...a) => driver.tableNameForBuilder(...a),
      temporalFieldKind: (...a) => driver.temporalFieldKind(...a),
      get timeFields() { return driver.timeFields; },
      toDateOnly: (...a) => driver.toDateOnly(...a),
      toTimeOnly: (...a) => driver.toTimeOnly(...a),
      get valueShapeFields() { return driver.valueShapeFields; },
      withWithheldFilterLog: (...a) => driver.withWithheldFilterLog(...a),
    }));
    internalHelpersHost.install((driver) => ({
      applyFilters: (...a) => driver.applyFilters(...a),
      applyTenantScope: (...a) => driver.applyTenantScope(...a),
      get getBuilder() { return driver.getBuilder.bind(driver); },
      isMultiTenantMode: (...a) => driver.isMultiTenantMode(...a),
      get knex() { return driver.knex; },
      get logger() { return driver.logger; },
      get physicalSchemaByObject() { return driver.physicalSchemaByObject; },
      get physicalTableByObject() { return driver.physicalTableByObject; },
      remoteColumn: (...a) => driver.remoteColumn(...a),
      resolveTenantField: (...a) => driver.resolveTenantField(...a),
      get tenantAuditWarned() { return driver.tenantAuditWarned; },
      get tenantFieldByTable() { return driver.tenantFieldByTable; },
    }));
    lifecycleHost.install((driver) => ({
      applyAutoVacuumIncremental: (...a) => driver.applyAutoVacuumIncremental(...a),
      applySqliteJournalMode: (...a) => driver.applySqliteJournalMode(...a),
      get config() { return driver.config; },
      get declaredJournalMode() { return driver.declaredJournalMode; },
      ensureDatabaseExists: (...a) => driver.ensureDatabaseExists(...a),
      get isSqlite() { return driver.isSqlite; },
      get knex() { return driver.knex; },
      get logger() { return driver.logger; },
      releaseRefusedSqliteConnection: (...a) => driver.releaseRefusedSqliteConnection(...a),
      resolveSqliteJournalMode: (...a) => driver.resolveSqliteJournalMode(...a),
      sqliteFilename: (...a) => driver.sqliteFilename(...a),
      get supportsWalJournal() { return driver.supportsWalJournal; },
      verifyWalReadable: (...a) => driver.verifyWalReadable(...a),
    }));
    managedDriftHost.install((driver) => ({
      introspectIndexes: (...a) => driver.introspectIndexes(...a),
      get isMysql() { return driver.isMysql; },
      get isPostgres() { return driver.isPostgres; },
      get isSqlite() { return driver.isSqlite; },
      get knex() { return driver.knex; },
      syncDeclaredIndexes: (...a) => driver.syncDeclaredIndexes(...a),
      uniqueIndexesFromFields: (...a) => driver.uniqueIndexesFromFields(...a),
    }));
    queryPlanHost.install((driver) => ({
      analyzeQuery: (...a) => driver.analyzeQuery(...a),
      applyFilters: (...a) => driver.applyFilters(...a),
      applyTenantScope: (...a) => driver.applyTenantScope(...a),
      get config() { return driver.config; },
      get getBuilder() { return driver.getBuilder.bind(driver); },
      get isMysql() { return driver.isMysql; },
      get isPostgres() { return driver.isPostgres; },
      get isSqlite() { return driver.isSqlite; },
      get knex() { return driver.knex; },
      mapSortField: (...a) => driver.mapSortField(...a),
    }));
    rotationHost.install((driver) => ({
      assertSchemaMutable: (...a) => driver.assertSchemaMutable(...a),
      get autoNumberFields() { return driver.autoNumberFields; },
      backfillCanonicalDatetimes: (...a) => driver.backfillCanonicalDatetimes(...a),
      backfillCanonicalJsonEncoding: (...a) => driver.backfillCanonicalJsonEncoding(...a),
      backfillCanonicalTimes: (...a) => driver.backfillCanonicalTimes(...a),
      get booleanFields() { return driver.booleanFields; },
      computeAndRecordTenantField: (...a) => driver.computeAndRecordTenantField(...a),
      computeTenantField: (...a) => driver.computeTenantField(...a),
      createAuditTimestampColumn: (...a) => driver.createAuditTimestampColumn(...a),
      createColumn: (...a) => driver.createColumn(...a),
      get dateFields() { return driver.dateFields; },
      get datetimeFields() { return driver.datetimeFields; },
      get deferredDdl() { return driver.deferredDdl; },
      get deferredSchemaObjects() { return driver.deferredSchemaObjects; },
      get dialectName() { return driver.dialectName; },
      ensureDatabaseExists: (...a) => driver.ensureDatabaseExists(...a),
      ensureRotation: (...a) => driver.ensureRotation(...a),
      ensureSequencesTable: (...a) => driver.ensureSequencesTable(...a),
      get fractionalNumericFields() { return driver.fractionalNumericFields; },
      isJsonField: (...a) => driver.isJsonField(...a),
      get isMysql() { return driver.isMysql; },
      get jsonFields() { return driver.jsonFields; },
      get knex() { return driver.knex; },
      legacyMysqlTimeColumns: (...a) => driver.legacyMysqlTimeColumns(...a),
      legacyMysqlTimestampColumns: (...a) => driver.legacyMysqlTimestampColumns(...a),
      logDurabilityFailure: (...a) => driver.logDurabilityFailure(...a),
      get logger() { return driver.logger; },
      get managedObjectFields() { return driver.managedObjectFields; },
      get managedObjectIndexes() { return driver.managedObjectIndexes; },
      get mediaFields() { return driver.mediaFields; },
      migrateMysqlDatetimeColumns: (...a) => driver.migrateMysqlDatetimeColumns(...a),
      migrateMysqlTimeColumns: (...a) => driver.migrateMysqlTimeColumns(...a),
      nowColumnDefault: (...a) => driver.nowColumnDefault(...a),
      get numericFields() { return driver.numericFields; },
      get numericValueFields() { return driver.numericValueFields; },
      get organizationObjectRegistered() { return driver.organizationObjectRegistered; },
      set organizationObjectRegistered(v) { driver.organizationObjectRegistered = v; },
      get physicalKeyIndexes() { return driver.physicalKeyIndexes; },
      reconcileAndWarnDrift: (...a) => driver.reconcileAndWarnDrift(...a),
      registerManagedObjectMetadata: (...a) => driver.registerManagedObjectMetadata(...a),
      registerObjectMetadata: (...a) => driver.registerObjectMetadata(...a),
      resolveFileColumnsMoved: (...a) => driver.resolveFileColumnsMoved(...a),
      resolveTenantField: (...a) => driver.resolveTenantField(...a),
      rethrowWithRowSizeExplanation: (...a) => driver.rethrowWithRowSizeExplanation(...a),
      get rotationStateByTable() { return driver.rotationStateByTable; },
      runWideningAlters: (...a) => driver.runWideningAlters(...a),
      get supportsRotation() { return driver.supportsRotation; },
      syncDeclaredIndexes: (...a) => driver.syncDeclaredIndexes(...a),
      syncTableIndexes: (...a) => driver.syncTableIndexes(...a),
      get tablesCreatedHere() { return driver.tablesCreatedHere; },
      get tablesFoundExisting() { return driver.tablesFoundExisting; },
      get tablesWithTimestamps() { return driver.tablesWithTimestamps; },
      get tenantFieldByTable() { return driver.tenantFieldByTable; },
      get tenantOptOutByTable() { return driver.tenantOptOutByTable; },
      get timeFields() { return driver.timeFields; },
      get undeclaredAuditTimestampFields() { return driver.undeclaredAuditTimestampFields; },
      get updatedAtColumnState() { return driver.updatedAtColumnState; },
      get valueShapeFields() { return driver.valueShapeFields; },
      warnBuiltinColumnCollisions: (...a) => driver.warnBuiltinColumnCollisions(...a),
    }));
    schemaIntrospectionHost.install((driver) => ({
      get knex() { return driver.knex; },
      get physicalSchemaByObject() { return driver.physicalSchemaByObject; },
      get physicalTableByObject() { return driver.physicalTableByObject; },
    }));
    schemaSyncSectionHost.install((driver) => ({
      assertSchemaMutable: (...a) => driver.assertSchemaMutable(...a),
      initObjects: (...a) => driver.initObjects(...a),
      get isSqlite() { return driver.isSqlite; },
      get knex() { return driver.knex; },
    }));
    sequenceSemanticsHost.install((driver) => ({
      applyTenantScope: (...a) => driver.applyTenantScope(...a),
      applyWriteColumnMap: (...a) => driver.applyWriteColumnMap(...a),
      assertConflictTargetBackedWithoutClause: (...a) => driver.assertConflictTargetBackedWithoutClause(...a),
      assertConflictTargetHonoured: (...a) => driver.assertConflictTargetHonoured(...a),
      assertMergeLandedInWrittenOrganization: (...a) => driver.assertMergeLandedInWrittenOrganization(...a),
      assertMergeLandedOnSuppliedIdentity: (...a) => driver.assertMergeLandedOnSuppliedIdentity(...a),
      auditMissingTenant: (...a) => driver.auditMissingTenant(...a),
      get autoNumberFields() { return driver.autoNumberFields; },
      collidingAutoNumberReservations: (...a) => driver.collidingAutoNumberReservations(...a),
      createSequencesTable: (...a) => driver.createSequencesTable(...a),
      defineSequencesTable: (...a) => driver.defineSequencesTable(...a),
      escapeLikePrefix: (...a) => driver.escapeLikePrefix(...a),
      fillAutoNumberFields: (...a) => driver.fillAutoNumberFields(...a),
      formatInput: (...a) => driver.formatInput(...a),
      formatOutput: (...a) => driver.formatOutput(...a),
      get getBuilder() { return driver.getBuilder.bind(driver); },
      injectTenantOnInsert: (...a) => driver.injectTenantOnInsert(...a),
      insertOnlyUpsertColumns: (...a) => driver.insertOnlyUpsertColumns(...a),
      get isMysql() { return driver.isMysql; },
      get isPostgres() { return driver.isPostgres; },
      get isSqlite() { return driver.isSqlite; },
      keepSuppliedUpdatedAt: (...a) => driver.keepSuppliedUpdatedAt(...a),
      get knex() { return driver.knex; },
      get logger() { return driver.logger; },
      maxAutonumberCounter: (...a) => driver.maxAutonumberCounter(...a),
      mergeLandsInWrittenOrganization: (...a) => driver.mergeLandsInWrittenOrganization(...a),
      observedUpdatedAtColumn: (...a) => driver.observedUpdatedAtColumn(...a),
      get organizationObjectRegistered() { return driver.organizationObjectRegistered; },
      get physicalTableByObject() { return driver.physicalTableByObject; },
      remoteColumn: (...a) => driver.remoteColumn(...a),
      resolveSequenceTenantId: (...a) => driver.resolveSequenceTenantId(...a),
      resolveTenantField: (...a) => driver.resolveTenantField(...a),
      resyncSequenceToDataMax: (...a) => driver.resyncSequenceToDataMax(...a),
      rotatedUpdateById: (...a) => driver.rotatedUpdateById(...a),
      rotationShardsOf: (...a) => driver.rotationShardsOf(...a),
      rotationWriteTarget: (...a) => driver.rotationWriteTarget(...a),
      sequenceKeyHash: (...a) => driver.sequenceKeyHash(...a),
      get sequencesHasKeyHash() { return driver.sequencesHasKeyHash; },
      set sequencesHasKeyHash(v) { driver.sequencesHasKeyHash = v; },
      stampInsertTimestamps: (...a) => driver.stampInsertTimestamps(...a),
      stampUpsertUpdatedAt: (...a) => driver.stampUpsertUpdatedAt(...a),
      stampsUpdatedAt: (...a) => driver.stampsUpdatedAt(...a),
      get tablesWithTimestamps() { return driver.tablesWithTimestamps; },
      updateWithPresumedTimestamp: (...a) => driver.updateWithPresumedTimestamp(...a),
      get updatedAtColumnState() { return driver.updatedAtColumnState; },
      updatedAtStamp: (...a) => driver.updatedAtStamp(...a),
      updatedAtStampIsPresumed: (...a) => driver.updatedAtStampIsPresumed(...a),
      upsertTenantGuard: (...a) => driver.upsertTenantGuard(...a),
    }));
    sqliteSerialisationHost.install((driver) => ({
      get booleanFields() { return driver.booleanFields; },
      get columnFieldByObject() { return driver.columnFieldByObject; },
      get dateFields() { return driver.dateFields; },
      get datetimeFields() { return driver.datetimeFields; },
      get fileColumnsMoved() { return driver.fileColumnsMoved; },
      get isMysql() { return driver.isMysql; },
      get isSqlite() { return driver.isSqlite; },
      get jsonFields() { return driver.jsonFields; },
      get mediaFields() { return driver.mediaFields; },
      get numericFields() { return driver.numericFields; },
      get numericValueFields() { return driver.numericValueFields; },
      storageDatetimeValue: (...a) => driver.storageDatetimeValue(...a),
      get timeFields() { return driver.timeFields; },
      toDateOnly: (...a) => driver.toDateOnly(...a),
      toTimeOnly: (...a) => driver.toTimeOnly(...a),
      get undeclaredAuditTimestampFields() { return driver.undeclaredAuditTimestampFields; },
    }));
    transactionsSectionHost.install((driver) => ({
      get activeTransactions() { return driver.activeTransactions; },
      set activeTransactions(v) { driver.activeTransactions = v; },
      get openTransactions() { return driver.openTransactions; },
    }));
    windowFunctionBuilderHost.install((driver) => ({
      get knex() { return driver.knex; },
      mapSortField: (...a) => driver.mapSortField(...a),
    }));
    windowFunctionsHost.install((driver) => ({
      aliasIdentifierSql: (...a) => driver.aliasIdentifierSql(...a),
      applyFilters: (...a) => driver.applyFilters(...a),
      applyTenantScope: (...a) => driver.applyTenantScope(...a),
      buildWindowFunction: (...a) => driver.buildWindowFunction(...a),
      formatOutput: (...a) => driver.formatOutput(...a),
      get getBuilder() { return driver.getBuilder.bind(driver); },
      get knex() { return driver.knex; },
      mapSortField: (...a) => driver.mapSortField(...a),
    }));
  }
}

/**
 * One (constraint, column) membership row, normalised across dialects —
 * the input to {@link singleColumnUniqueColumns} (#11202).
 */
export interface UniqueConstraintMember {
  /**
   * What makes this constraint a DISTINCT constraint within one answer, as
   * its identity parts.
   *
   * Spelled as parts rather than a pre-joined string so each arm has to state
   * what it is relying on: Postgres needs `[schema, name]` because its answer
   * spans the search path and auto-generated constraint names repeat across
   * schemas; MySQL and SQLite pin one schema/database in the query itself and
   * so need only the name. Two constraints whose parts are equal are treated
   * as one constraint.
   */
  constraint: readonly string[];
  /**
   * The column this member covers, or `null` for a member that is not a plain
   * column — a SQLite expression-index term. A `null` still occupies a member
   * slot; it simply cannot be flagged.
   */
  column: string | null;
}

/**
 * The one definition of what `introspectUniqueConstraints` reports: the
 * columns that ALONE carry a unique constraint (#11202).
 *
 * A constraint contributes its column iff it has exactly ONE member and that
 * member is a real column. Members of a composite constraint contribute
 * nothing — `UNIQUE (a, b)` says the PAIR is unique, and a per-column flag
 * cannot say that, so claiming it per column is a claim the constraint never
 * made.
 *
 * ## Both defensive choices fail toward NOT flagging, on purpose
 *
 * Members are counted as they arrive, without de-duplicating identical rows.
 * No in-tree arm can produce a duplicate (each query joins one
 * constraint-listing row to its own column rows), but if one ever did, the
 * inflated count would merely hide a genuine single-column unique. The
 * opposite policy — collapsing rows before counting — could merge two real
 * members and flag a composite one. An under-claimed flag is a missed
 * optimisation downstream; an over-claimed one is the defect being fixed
 * here, and it reaches `introspectSchema`'s per-column `isUnique`, the
 * federated-object draft (ADR-0015) and schema-drift comparison as fact.
 *
 * The returned columns are de-duplicated: a column carrying two separate
 * single-column unique constraints (or, on SQLite, both a `UNIQUE` clause and
 * a hand-made unique index) is one unique column, named once.
 */
export function singleColumnUniqueColumns(members: readonly UniqueConstraintMember[]): string[] {
  const byConstraint = new Map<string, (string | null)[]>();

  for (const member of members) {
    // JSON is used as the composite-key encoding because it is injective:
    // joining the parts with a separator would fuse `['a.b', 'c']` and
    // `['a', 'b.c']`, and a schema or constraint name really can contain the
    // separator (Postgres quotes such identifiers rather than rejecting them).
    const key = JSON.stringify(member.constraint);
    const existing = byConstraint.get(key);
    if (existing) existing.push(member.column);
    else byConstraint.set(key, [member.column]);
  }

  const uniqueColumns: string[] = [];
  for (const columns of byConstraint.values()) {
    if (columns.length !== 1) continue;
    const only = columns[0];
    if (only == null) continue;
    if (!uniqueColumns.includes(only)) uniqueColumns.push(only);
  }
  return uniqueColumns;
}
