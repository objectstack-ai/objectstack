// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SQLite driver configuration — the `config` slot of a `datasource` whose
 * `driver` resolves to `sqlite` (native `better-sqlite3`, with the dev-only
 * step-down to wasm then in-memory, #2229) or to `sqlite-wasm` (pure-JS).
 *
 * The one key that matters is `filename`, and it is exactly the key the silent
 * strip used to hide: an author who wrote `path:` got no error, the connection
 * fell back to `:memory:`, and their data vanished on restart with every signal
 * saying the datasource was configured.
 *
 * `file` and `database` once also worked, purely because the factory read them
 * as undeclared `??` fallbacks. That tolerance has graduated into the declared
 * ADR-0087 conversion `datasource-config-driver-key-aliases` (#4456): stored
 * rows are rewritten to `filename` at load, the factory reads one spelling,
 * and authoring rejects both with the rename hint below.
 */

import { z } from 'zod';

import { lazySchema } from '../../shared/lazy-schema';
import { strictObject } from '../../shared/strict-object';
import {
  driverConfigJsonSchema,
  placeholderFree,
  READ_ONLY_BELONGS_ON_DATASOURCE,
  SCHEMA_MODE_BELONGS_ON_DATASOURCE,
  SqlAutoMigrateSchema,
} from './common.zod';

const FILENAME_ALIASES = {
  file: 'filename',
  filepath: 'filename',
  path: 'filename',
  database: 'filename',
  db: 'filename',
  url: 'filename',
  connectionstring: 'filename',
} as const;

const sqliteHistory =
  'Until #4410 nothing validated `datasource.config` at all — a misspelled `filename` was '
  + 'accepted in silence and the database silently became an ephemeral `:memory:` one, so the '
  + 'data was gone on the next boot with nothing having reported a problem.';

const IN_MEMORY_GUIDANCE =
  '`memory` is not a sqlite key. An ephemeral database is `filename: \':memory:\'`; for the '
  + 'mingo in-memory engine (a different driver entirely) set `driver: \'memory\'`.';

export const SqliteConfigSchema = lazySchema(() => strictObject(
  {
    surface: "this sqlite datasource's config",
    aliases: FILENAME_ALIASES,
    guidance: {
      schemaMode: SCHEMA_MODE_BELONGS_ON_DATASOURCE,
      readOnly: READ_ONLY_BELONGS_ON_DATASOURCE,
      memory: IN_MEMORY_GUIDANCE,
      persist:
        '`persist` is a `sqlite-wasm` key — the native sqlite driver writes through on every '
        + "statement and has nothing to schedule. Set `driver: 'sqlite-wasm'` to use it.",
    },
    history: sqliteHistory,
  },
  {
  /**
   * Database file path, or `:memory:` for an ephemeral in-process database.
   * A relative path resolves against the server's working directory.
   * Placeholder-free since #8336: an unresolved `${DATA_DIR}` would silently
   * create and open a literal `./${DATA_DIR}/…` path — a database in the
   * wrong place with every signal saying it is configured.
   */
  filename: placeholderFree(z.string(), 'filename').default(':memory:')
    .describe('Database file path, or ":memory:" for an ephemeral database')
    .meta({ title: 'Filename' }),

  /** Dev-only, loosen-only schema self-heal (#2186). */
  autoMigrate: SqlAutoMigrateSchema.optional(),
})
  .describe('SQLite connection configuration'));

export type SqliteConfig = z.input<typeof SqliteConfigSchema>;
/** Post-parse shape of {@link SqliteConfig} — defaults applied, transforms run (ADR-0122). */
export type SqliteConfigParsed = z.infer<typeof SqliteConfigSchema>;

/** JSON-Schema projection of {@link SqliteConfigSchema}, memoized. */
export const getSqliteConfigJsonSchema = driverConfigJsonSchema(SqliteConfigSchema);

/**
 * When a file-backed wasm database is flushed back to disk. `debounced:<ms>`
 * batches writes; `:memory:` databases ignore this entirely.
 */
export const SqliteWasmPersistModeSchema = z.union([
  z.literal('on-disconnect'),
  z.literal('on-write'),
  z.string().regex(/^debounced:\d+$/, 'Expected `debounced:<milliseconds>`'),
]).describe('When to flush a file-backed wasm database to disk');

export type SqliteWasmPersistMode = z.input<typeof SqliteWasmPersistModeSchema>;

export const SqliteWasmConfigSchema = lazySchema(() => strictObject(
  {
    surface: "this sqlite-wasm datasource's config",
    aliases: FILENAME_ALIASES,
    guidance: {
      schemaMode: SCHEMA_MODE_BELONGS_ON_DATASOURCE,
      readOnly: READ_ONLY_BELONGS_ON_DATASOURCE,
      memory: IN_MEMORY_GUIDANCE,
      autoMigrate:
        '`autoMigrate` is honoured by the native sqlite / postgres / mysql drivers only — the '
        + 'wasm driver is constructed without it, so writing it here would change nothing.',
    },
    history: sqliteHistory,
  },
  {
  /**
   * Database file path, or `:memory:` for an ephemeral in-process database.
   * A file-backed wasm database persists according to {@link SqliteWasmPersistModeSchema}.
   * Placeholder-free since #8336, same as the native sqlite `filename`.
   */
  filename: placeholderFree(z.string(), 'filename').default(':memory:')
    .describe('Database file path, or ":memory:" for an ephemeral database')
    .meta({ title: 'Filename' }),

  /**
   * Flush policy for a file-backed database. Defaults to `on-write` when a
   * filename is given; `:memory:` never persists.
   */
  persist: SqliteWasmPersistModeSchema.optional().meta({ title: 'Persist mode' }),
})
  .describe('SQLite (WASM) connection configuration'));

export type SqliteWasmConfig = z.input<typeof SqliteWasmConfigSchema>;
/** Post-parse shape of {@link SqliteWasmConfig} — defaults applied, transforms run (ADR-0122). */
export type SqliteWasmConfigParsed = z.infer<typeof SqliteWasmConfigSchema>;

/** JSON-Schema projection of {@link SqliteWasmConfigSchema}, memoized. */
export const getSqliteWasmConfigJsonSchema = driverConfigJsonSchema(SqliteWasmConfigSchema);
