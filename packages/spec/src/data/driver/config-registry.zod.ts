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
import { getTursoConfigJsonSchema, TursoConfigSchema } from './turso.zod';

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
 * `config` against it.
 *
 * #4410 ran the same parse over each `readReplicas` entry. #4468 retired that
 * key: no driver ever opened a replica connection, so the entries were being
 * checked against a contract nothing would ever apply them to. Worth keeping in
 * view here — "we validate what we can construct" is a claim about drivers we
 * build, and a slot the platform never connects is outside it in the other
 * direction.
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
 *
 * ## The HOSTS read it too, since #6345 — and that is what closed the last fork
 *
 * #4410 unified the two tables *inside* the metadata path. It did not reach the
 * two BOOT HOSTS, which kept answering the same question differently about the
 * same `OS_DATABASE_DRIVER`: the CLI (`packages/cli/src/utils/storage-driver.ts`)
 * hand-wrote its spellings into `if` arms, and the standalone stack
 * (`packages/runtime/src/standalone-stack.ts`) hand-wrote a zod enum of canonical
 * spellings only. Measured on `main` before #6345: **10 of 21 spellings disagreed**
 * — `OS_DATABASE_DRIVER=pg` booted under `os start` and was refused by
 * `os migrate`, and `libsql` was accepted by the CLI alone. Both hosts now resolve
 * through {@link resolveDatabaseDriverId}, so the vocabulary is this table and
 * nothing else.
 *
 * ## Two faces, one table (the part a flat `Record` could not express)
 *
 * A driver id answers three separate questions, and #6345's measurement is that
 * they are NOT the same set:
 *
 *  1. **Selection** — may an operator write this spelling as
 *     `OS_DATABASE_DRIVER` / `--database-driver` / `datasource.driver`?
 *     {@link DriverVocabularyEntry.aliases}.
 *  2. **Config contract** — which schema validates that datasource's `config`?
 *     Every alias, selection or not, resolves one: {@link resolveDriverId}.
 *  3. **Local default** — does selecting this driver with no URL have anything
 *     to fall back on? {@link DriverVocabularyEntry.hasLocalDefault}. `false`
 *     earns a typed refusal on both hosts instead of each side inventing a
 *     different wrong default (postgres got `url: undefined` and connected to
 *     the `pg` client's own localhost; mongodb got an invented
 *     `mongodb://localhost:27017/objectstack`; the standalone side handed all
 *     of them a `file:` DSN).
 *
 * The maintainer's #6345 ruling fixes the selection face as **the union of what
 * the two hosts accepted the day the ruling was written**. `sql` and `wasm` are
 * in it because the CLI accepted them; `sqlite3`, `better-sqlite3`, `mariadb`
 * and `inmemory` are NOT, because neither host did — they are
 * {@link DriverVocabularyEntry.contractOnlyAliases}, which keeps
 * {@link resolveDriverId}'s answers for them byte-identical to what they were
 * before this table existed while refusing to widen a boot flag nobody asked to
 * widen.
 *
 * ## `mongo` → `mongodb`, and turso becoming a real builtin (#6345)
 *
 * The old canon was `mongo` while both hosts, the npm package
 * (`@objectstack/driver-mongodb`) and every URL scheme said `mongodb`. The
 * ruling renamed the canon rather than adding a mapping layer, so `id` here is
 * simultaneously the selection canon and the contract canon — there is no
 * `contractId` column, because after the rename it would have been `undefined`
 * on every row, and a column that is always empty is the inert declaration this
 * repo removes rather than ships. Stored `datasource.driver: 'mongo'` is
 * converged by the ADR-0087 conversion `datasource-driver-mongo-to-mongodb`;
 * `mongo` also stays an alias, so nothing that skipped the conversion breaks.
 *
 * `turso`/libSQL was the mirror image: both hosts dispatched it, and spec shipped
 * no contract, so it resolved to `undefined` and its `config` was the one
 * connection block on the platform with no gate. It now has
 * {@link TursoConfigSchema} and is a full row.
 */

/**
 * One driver's whole vocabulary — the single row the three exported faces below
 * are derived from, so a driver cannot be added to one and forgotten in another.
 */
export interface DriverVocabularyEntry {
  /**
   * The canonical id, for BOTH selection and config contract. `mongodb`, not
   * `mongo` (#6345).
   */
  readonly id: string;
  /**
   * Spellings an operator or author may SELECT this driver by, matched
   * case-insensitively. Includes {@link id}. This is the face both boot hosts
   * accept, and the ruling fixes it as the union of what they accepted before
   * #6345 — never widened by accident.
   */
  readonly aliases: readonly string[];
  /**
   * Spellings that resolve this driver's CONFIG CONTRACT but are not offered as
   * a selection, because no host has ever accepted them as one. Dropping them
   * would silently un-validate a stored `driver: 'sqlite3'` datasource's config;
   * promoting them to selections would widen a boot flag on no ruling. So they
   * are kept, and kept apart.
   */
  readonly contractOnlyAliases?: readonly string[];
  /**
   * Can this driver be selected with no database URL at all?
   *
   * `true` for the three local engines (memory has no target to name; the two
   * sqlite kinds fall back to `:memory:` / the unified default file). `false`
   * for every kind whose target is a server or an endpoint — there is nothing
   * truthful to guess, so both hosts refuse with a typed error naming what to
   * set (#6345 fork 2).
   */
  readonly hasLocalDefault: boolean;
}

/**
 * THE table. Everything else in this module is a projection of it.
 *
 * Row order is the order {@link BUILTIN_DRIVER_IDS} publishes, which is the
 * order the pre-#6345 tuple used, plus `turso` appended.
 */
const DRIVER_VOCABULARY = [
  { id: 'memory', aliases: ['memory', 'mingo', 'in-memory'], contractOnlyAliases: ['inmemory'], hasLocalDefault: true },
  { id: 'sqlite', aliases: ['sqlite', 'sql'], contractOnlyAliases: ['sqlite3', 'better-sqlite3'], hasLocalDefault: true },
  { id: 'sqlite-wasm', aliases: ['sqlite-wasm', 'wasm-sqlite', 'wasm'], hasLocalDefault: true },
  { id: 'postgres', aliases: ['postgres', 'postgresql', 'pg'], hasLocalDefault: false },
  { id: 'mysql', aliases: ['mysql', 'mysql2'], contractOnlyAliases: ['mariadb'], hasLocalDefault: false },
  { id: 'mongodb', aliases: ['mongodb', 'mongo'], hasLocalDefault: false },
  { id: 'turso', aliases: ['turso', 'libsql'], hasLocalDefault: false },
] as const satisfies readonly DriverVocabularyEntry[];

/**
 * The same rows widened to the declared interface — what the runtime
 * derivations below iterate. Kept separate from the `as const` literal because
 * that literal is what carries the exact id union into {@link BuiltinDriverId},
 * while a widened view is what lets an optional column be READ uniformly across
 * rows that do and do not declare it.
 */
const VOCABULARY_ROWS: readonly DriverVocabularyEntry[] = DRIVER_VOCABULARY;

/** Tuple-preserving projection of a vocabulary table onto its ids. */
type VocabularyIds<T extends readonly { readonly id: string }[]> = { -readonly [K in keyof T]: T[K]['id'] };

/**
 * Canonical driver ids the platform ships a config contract for — and, since
 * #6345, exactly the ids both boot hosts dispatch.
 *
 * Projected through {@link VocabularyIds} rather than a plain `.map()` so the
 * published shape stays the same TUPLE it was before the table existed: a
 * `readonly BuiltinDriverId[]` would have churned the api-surface baseline for
 * no reason, and this file's whole contract with the rest of the repo is that
 * only the intended ids moved.
 */
export const BUILTIN_DRIVER_IDS = DRIVER_VOCABULARY.map((entry) => entry.id) as VocabularyIds<
  typeof DRIVER_VOCABULARY
>;

export type BuiltinDriverId = (typeof DRIVER_VOCABULARY)[number]['id'];

/**
 * Accepted spellings of each canonical driver id, matched case-insensitively.
 *
 * These are DRIVER SELECTORS, not config keys: `driver: 'pg'` and
 * `driver: 'postgres'` build the same driver, so they must resolve to the same
 * config contract. (Unknown-key tolerance inside `config` is a different
 * question, and the answer there is a rejection with a rename hint.)
 *
 * Covers BOTH faces — selection aliases and contract-only ones — because its job
 * is "which contract judges this datasource's config", and a stored
 * `driver: 'sqlite3'` has a sqlite config whether or not a boot flag would
 * accept that spelling today.
 */
export const DRIVER_ID_ALIASES: Readonly<Record<string, BuiltinDriverId>> = Object.freeze(
  Object.fromEntries(
    VOCABULARY_ROWS.flatMap((entry) =>
      [...entry.aliases, ...(entry.contractOnlyAliases ?? [])].map((alias) => [alias, entry.id] as const),
    ),
  ) as Record<string, BuiltinDriverId>,
);

/**
 * The spellings a BOOT HOST accepts as a driver selection — every selection
 * alias of every builtin, sorted for a stable refusal message.
 *
 * Both hosts enumerate this in their "unsupported driver" errors, so the legal
 * values an operator is shown cannot drift from the values that actually work.
 */
export const DATABASE_DRIVER_SELECTION_ALIASES: readonly string[] = Object.freeze(
  VOCABULARY_ROWS.flatMap((entry) => [...entry.aliases]),
);

/**
 * Resolve an authored `datasource.driver` onto its canonical id, or `undefined`
 * when the platform ships no contract for it (a plugin-contributed driver).
 */
export function resolveDriverId(driver: unknown): BuiltinDriverId | undefined {
  if (typeof driver !== 'string') return undefined;
  return DRIVER_ID_ALIASES[driver.trim().toLowerCase()];
}

/** Selection-face lookup, built once so {@link resolveDatabaseDriverId} is a hash hit. */
const DATABASE_DRIVER_ALIASES: Readonly<Record<string, BuiltinDriverId>> = Object.freeze(
  Object.fromEntries(
    VOCABULARY_ROWS.flatMap((entry) => entry.aliases.map((alias) => [alias, entry.id] as const)),
  ) as Record<string, BuiltinDriverId>,
);

/**
 * Resolve an operator's DRIVER SELECTION (`OS_DATABASE_DRIVER`,
 * `--database-driver`, `StandaloneStackConfig.databaseDriver`) onto its
 * canonical id, or `undefined` when no builtin claims that spelling.
 *
 * Deliberately narrower than {@link resolveDriverId}: it refuses the
 * contract-only aliases ({@link DriverVocabularyEntry.contractOnlyAliases}),
 * because neither host accepted `OS_DATABASE_DRIVER=sqlite3` before #6345 and
 * converging the two hosts is not a licence to widen the flag for both.
 */
export function resolveDatabaseDriverId(driver: unknown): BuiltinDriverId | undefined {
  if (typeof driver !== 'string') return undefined;
  return DATABASE_DRIVER_ALIASES[driver.trim().toLowerCase()];
}

/** Canonical id → whether it can be selected with no database URL at all. */
const DRIVER_LOCAL_DEFAULT: Readonly<Record<BuiltinDriverId, boolean>> = Object.freeze(
  Object.fromEntries(
    VOCABULARY_ROWS.map((entry) => [entry.id, entry.hasLocalDefault] as const),
  ) as Record<BuiltinDriverId, boolean>,
);

/**
 * Does selecting this driver with no database URL have anything to fall back on?
 *
 * `false` means "refuse, do not guess" — the single fact both hosts consult so
 * fork 2's typed refusal covers the same four kinds on both sides. An id this
 * table does not know answers `true`: a plugin-contributed driver's defaults are
 * not ours to judge, and refusing one on our own authority would be the mirror
 * of the bug this exists to fix.
 */
export function driverHasLocalDefault(driver: unknown): boolean {
  const id = resolveDriverId(driver);
  return id ? DRIVER_LOCAL_DEFAULT[id] : true;
}

/** Canonical driver id → the schema its `datasource.config` must satisfy. */
export const DRIVER_CONFIG_SCHEMAS: Readonly<Record<BuiltinDriverId, z.ZodType>> = {
  memory: MemoryConfigSchema,
  sqlite: SqliteConfigSchema,
  'sqlite-wasm': SqliteWasmConfigSchema,
  postgres: PostgresConfigSchema,
  mysql: MysqlConfigSchema,
  mongodb: MongoConfigSchema,
  turso: TursoConfigSchema,
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
  mongodb: getMongoConfigJsonSchema,
  turso: getTursoConfigJsonSchema,
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
