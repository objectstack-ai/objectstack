// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ISchemaDiffService - Schema Introspection & Diff Contract
 *
 * Compares the desired metadata state (ObjectStack object definitions)
 * against the current database schema and generates DDL migration plans.
 *
 * Pipeline: Introspect Current → Diff vs Desired → Generate Migrations → Apply
 *
 * This service is dialect-aware and generates DDL appropriate for the
 * target database (PostgreSQL, SQLite/Turso, MySQL, etc.).
 */

import type { DeployDiff, MigrationPlan } from '../system/deploy-bundle.zod.js';
import type { SQLDialect } from '../data/driver-sql.zod.js';

// ==========================================================================
// Types
// ==========================================================================

/**
 * Introspected schema representation of the current database state.
 */
export interface IntrospectedSchema {
  /** Object/table names and their column definitions */
  tables: Record<string, IntrospectedTable>;
  /** Database dialect */
  dialect: string;
  /** Introspection timestamp (ISO 8601) */
  introspectedAt: string;
}

/**
 * Introspected table (current database state).
 */
export interface IntrospectedTable {
  /** Table name */
  name: string;
  /** Column definitions */
  columns: IntrospectedColumn[];
  /**
   * Index definitions — OPTIONAL, and absence is meaningful.
   *
   * An ABSENT key means the producer did not read indexes (the in-tree SQL
   * driver does not: wiring the read adds one index query per table to every
   * `introspectSchema()` call — the whole-warehouse federation path included —
   * and needs its own `onFailure` failure-policy ruling; see
   * `SqlDriver.introspectIndexes`). An EMPTY ARRAY is a positive claim that
   * the table HAS no indexes. A producer that did not look must OMIT the key
   * rather than emit `[]`, so a schema differ can tell "not asked" from
   * "none exist".
   *
   * History (#11122): declared required from the start yet emitted by no
   * producer ever, so a consumer typed against the promise read `undefined`
   * with no compiler complaint. Withdrawn to optional per maintainer ruling
   * 2026-08-23 (option B — 「其他同意你的意见」); wiring the index read is
   * explicitly NOT this change, and becomes a new card if real consumer
   * demand appears.
   */
  indexes?: IntrospectedIndex[];
}

/**
 * Introspected column definition.
 */
export interface IntrospectedColumn {
  /** Column name */
  name: string;
  /** SQL data type */
  type: string;
  /** Whether the column is nullable */
  nullable: boolean;
  /**
   * The column's default, RAW as the driver reported it — `unknown`, not the
   * `string` this key used to promise (#11122).
   *
   * The in-tree SQL driver passes `knex.columnInfo().defaultValue` through
   * unchanged. Measured on live in-memory SQLite (2026-08-23): `null` for a
   * column with no default; a dialect-decorated STRING when one exists
   * (SQLite quotes — `'abc'`, and spells a boolean default `'1'`; Postgres
   * additionally appends a `::type` cast). Other producers report native
   * values (an in-tree fixture carries `true` for a boolean column), and
   * per-dialect CONTENT is deliberately not claimed here. Consumers must
   * narrow before use — or compare through a helper such as driver-sql's
   * `physicalDefaultIsToken` — never assume a string.
   */
  defaultValue?: unknown;
  /** Whether this column is a primary key */
  primaryKey: boolean;
}

/**
 * Introspected index definition.
 */
export interface IntrospectedIndex {
  /** Index name */
  name: string;
  /** Columns included in the index */
  columns: string[];
  /** Whether the index enforces uniqueness */
  unique: boolean;
}

/**
 * Migration apply result.
 */
export interface MigrationApplyResult {
  /** Whether all migrations applied successfully */
  success: boolean;
  /** Number of statements executed */
  statementsExecuted: number;
  /** Total execution duration in milliseconds */
  durationMs: number;
  /** Error message if a statement failed */
  error?: string;
  /** Index of the failed statement (if any) */
  failedAtIndex?: number;
}

// ==========================================================================
// Service Interface
// ==========================================================================

export interface ISchemaDiffService {
  /**
   * Introspect the current database schema.
   * Reads table definitions, columns, indexes from the live database.
   *
   * @param driver - Data driver to introspect
   * @returns Current schema representation
   */
  introspect(driver: unknown): Promise<IntrospectedSchema>;

  /**
   * Compute the diff between current schema and desired object definitions.
   *
   * @param current - Introspected current schema
   * @param desired - Desired ObjectStack object definitions
   * @returns Schema diff describing all changes
   */
  diff(current: IntrospectedSchema, desired: Record<string, unknown>[]): DeployDiff;

  /**
   * Generate SQL migration statements from a schema diff.
   * Output is dialect-specific (PostgreSQL, SQLite, etc.).
   *
   * @param diff - Schema diff to generate migrations for
   * @param dialect - Target SQL dialect
   * @returns Ordered migration plan
   */
  generateMigrations(diff: DeployDiff, dialect: SQLDialect): MigrationPlan;

  /**
   * Apply a migration plan to the database.
   * Executes statements in order within a transaction (when supported).
   *
   * @param driver - Data driver to apply migrations to
   * @param plan - Migration plan to execute
   * @returns Apply result with success status and timing
   */
  applyMigrations(driver: unknown, plan: MigrationPlan): Promise<MigrationApplyResult>;
}
