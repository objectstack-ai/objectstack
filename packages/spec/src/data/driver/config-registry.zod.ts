// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { z } from 'zod';

import { getMemoryConfigJsonSchema, MemoryConfigSchema } from './memory.zod';
import { getMongoConfigJsonSchema, MongoConfigSchema } from './mongo.zod';
import { getMysqlConfigJsonSchema, MysqlConfigSchema } from './mysql.zod';
import { getPostgresConfigJsonSchema, PostgresConfigSchema } from './postgres.zod';
import {
  getSqliteConfigJsonSchema,
  getSqliteWasmConfigJsonSchema,
  SqliteConfigSchema,
  SqliteWasmConfigSchema,
} from './sqlite.zod';

/**
 * The driver-id → `datasource.config` shape registry (#4410).
 *
 * ## Why this exists
 *
 * `DatasourceSchema` went `.strict()` in #4207 with `config` deliberately left
 * open — per-driver by construction, a sqlite `filename` and a postgres `host`
 * share no shape. The module comment justified the hole by saying "the driver's
 * own `configSchema` is what validates it". Nothing did: the two bundled driver
 * specs set `configSchema: {}`, no code read the field, and the three per-driver
 * zod schemas were not even exported from the package. So the one slot an author
 * writes by hand was the one slot with no gate, and `config: { hostname: … }`
 * connected to localhost while reporting success.
 *
 * This registry closes that: it maps every driver id the platform can actually
 * BUILD onto the schema for that driver's config, and `DatasourceSchema` parses
 * `config` (and each `readReplicas` entry) against it.
 *
 * ## Where the boundary is
 *
 * An id this registry does not know stays unvalidated, and that is deliberate
 * rather than a remaining hole: `driver` is an open namespace — a plugin ships
 * `com.vendor.snowflake` with its own config shape, and rejecting keys against a
 * shape we do not have would be worse than the silence it replaces. The honest
 * line is "we validate what we can construct", and
 * {@link BUILTIN_DRIVER_IDS} is exactly the set the shared
 * `createDefaultDatasourceDriverFactory` builds.
 *
 * ## Why the alias table lives HERE
 *
 * The factory had its own copy. Two tables meant the id that selects a driver
 * and the id that selects its config schema could disagree — validating a `pg`
 * datasource against nothing while building it as postgres — so the factory now
 * imports {@link resolveDriverId} instead of keeping a second list.
 */

/** Canonical driver ids the platform ships a config contract for. */
export const BUILTIN_DRIVER_IDS = [
  'memory',
  'sqlite',
  'sqlite-wasm',
  'postgres',
  'mysql',
  'mongo',
] as const;

export type BuiltinDriverId = (typeof BUILTIN_DRIVER_IDS)[number];

/**
 * Accepted spellings of each canonical driver id, matched case-insensitively.
 *
 * These are DRIVER SELECTORS, not config keys: `driver: 'pg'` and
 * `driver: 'postgres'` build the same driver, so they must resolve to the same
 * config contract. (Unknown-key tolerance inside `config` is a different
 * question, and the answer there is a rejection with a rename hint.)
 */
export const DRIVER_ID_ALIASES: Readonly<Record<string, BuiltinDriverId>> = {
  memory: 'memory',
  inmemory: 'memory',
  'in-memory': 'memory',
  mingo: 'memory',
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
  'better-sqlite3': 'sqlite',
  'sqlite-wasm': 'sqlite-wasm',
  'wasm-sqlite': 'sqlite-wasm',
  postgres: 'postgres',
  postgresql: 'postgres',
  pg: 'postgres',
  mysql: 'mysql',
  mysql2: 'mysql',
  mariadb: 'mysql',
  mongo: 'mongo',
  mongodb: 'mongo',
};

/**
 * Resolve an authored `datasource.driver` onto its canonical id, or `undefined`
 * when the platform ships no contract for it (a plugin-contributed driver).
 */
export function resolveDriverId(driver: unknown): BuiltinDriverId | undefined {
  if (typeof driver !== 'string') return undefined;
  return DRIVER_ID_ALIASES[driver.trim().toLowerCase()];
}

/** Canonical driver id → the schema its `datasource.config` must satisfy. */
export const DRIVER_CONFIG_SCHEMAS: Readonly<Record<BuiltinDriverId, z.ZodType>> = {
  memory: MemoryConfigSchema,
  sqlite: SqliteConfigSchema,
  'sqlite-wasm': SqliteWasmConfigSchema,
  postgres: PostgresConfigSchema,
  mysql: MysqlConfigSchema,
  mongo: MongoConfigSchema,
};

/**
 * The config schema for an authored `driver` value, following aliases.
 * `undefined` means "no contract shipped" — the caller must leave the config
 * alone rather than invent a verdict for it.
 */
export function getDriverConfigSchema(driver: unknown): z.ZodType | undefined {
  const id = resolveDriverId(driver);
  return id ? DRIVER_CONFIG_SCHEMAS[id] : undefined;
}

/** Canonical driver id → the memoized JSON-Schema projection of its config shape. */
const DRIVER_CONFIG_JSON_SCHEMAS: Readonly<Record<BuiltinDriverId, () => Record<string, unknown>>> = {
  memory: getMemoryConfigJsonSchema,
  sqlite: getSqliteConfigJsonSchema,
  'sqlite-wasm': getSqliteWasmConfigJsonSchema,
  postgres: getPostgresConfigJsonSchema,
  mysql: getMysqlConfigJsonSchema,
  mongo: getMongoConfigJsonSchema,
};

/**
 * JSON-Schema projection of a built-in driver's config contract — what
 * `DriverDefinitionSchema.configSchema` publishes and what the Studio
 * connection form renders.
 *
 * Takes a CANONICAL id (not an alias) so a caller enumerating drivers cannot
 * quietly get `undefined` for a spelling it thought was covered; use
 * {@link resolveDriverId} first when the id came from authored metadata.
 */
export function getDriverConfigJsonSchemaById(id: BuiltinDriverId): Record<string, unknown> {
  return DRIVER_CONFIG_JSON_SCHEMAS[id]();
}

/** One problem found in a `datasource.config`, path-relative to the config object. */
export interface DriverConfigIssue {
  /** Property path inside `config` (empty for a whole-object problem). */
  path: (string | number)[];
  message: string;
}

/**
 * Validate a `datasource.config` against its driver's contract.
 *
 * Returns `{ known: false }` for a driver the platform ships no contract for,
 * so callers can distinguish "checked and clean" from "nothing to check
 * against" — a distinction the silent-strip failure mode depends on nobody
 * making. Never throws.
 */
export function validateDriverConfig(
  driver: unknown,
  config: unknown,
): { known: false } | { known: true; issues: DriverConfigIssue[] } {
  const schema = getDriverConfigSchema(driver);
  if (!schema) return { known: false };
  const result = schema.safeParse(config ?? {});
  if (result.success) return { known: true, issues: [] };
  return {
    known: true,
    issues: result.error.issues.map((issue) => ({
      path: [...issue.path] as (string | number)[],
      message: issue.message,
    })),
  };
}
