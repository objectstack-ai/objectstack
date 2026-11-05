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
  'Until this shape was closed, nothing validated `datasource.config` at all — a misspelled `filename` was '
  + 'accepted in silence and the database silently became an ephemeral `:memory:` one, so the '
  + 'data was gone on the next boot with nothing having reported a problem.';

/** The one name SQLite opens as an ephemeral, fileless database. */
const IN_MEMORY_FILENAME = ':memory:';

/**
 * Why a SQLite `filename` names no database at all, or `undefined` when it
 * names one: exactly `:memory:`, or a file path.
 *
 * Two values are refused, both judgeable from the string alone:
 *
 *   - `''` — no name, no file.
 *   - a name that starts with `:` and is not exactly `:memory:` — the New
 *     datasource dialog's prefilled `:memory:` with a path typed after it,
 *     `:memory:/srv/data/parts.db`. Every layer reads a leading `:` as
 *     fileless (driver-sql's `sqliteFilename`, its absent-file probe, the wasm
 *     driver's ephemeral check), so no file is ever opened: native sqlite opens
 *     the name as a relative path whose directory does not exist and every
 *     statement fails, and sqlite-wasm opens a throwaway in-memory database
 *     whose writes are gone at the next connect.
 *
 * Whether a path can be opened or created is NOT judged here: the schema cannot
 * touch the file system. The datasource admin doors add that judgement at
 * runtime (`@objectstack/service-datasource`'s `sqlite-database-filename.ts`),
 * after this parse, and read these two arms from here rather than restating
 * them.
 */
function sqliteFilenameRefusal(value: string): string | undefined {
  if (value === IN_MEMORY_FILENAME) return undefined;
  if (value === '') {
    return `'' is empty and names no database file. Use '${IN_MEMORY_FILENAME}' for an ephemeral `
      + 'in-memory database, or the path of a database file.';
  }
  if (value.startsWith(':')) {
    return `'${value}' is neither '${IN_MEMORY_FILENAME}' nor a file path. `
      + `A name that starts with ':' is not read as a file, so this datasource would store nothing: `
      + `use exactly '${IN_MEMORY_FILENAME}' for an ephemeral in-memory database, or the path of a database file `
      + 'with nothing in front of it.';
  }
  return undefined;
}

/**
 * The `filename` key both SQLite drivers share: placeholder-free (#8336), and
 * naming a database ({@link sqliteFilenameRefusal}). Defaults to `:memory:`.
 */
function sqliteFilename() {
  return placeholderFree(z.string(), 'filename')
    .superRefine((value, ctx) => {
      const refusal = sqliteFilenameRefusal(value);
      if (refusal) ctx.addIssue({ code: 'custom', message: refusal });
    })
    .default(IN_MEMORY_FILENAME)
    .describe('Database file path, or ":memory:" for an ephemeral database')
    .meta({ title: 'Filename' });
}

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
   * Empty, or `:`-prefixed other than exactly `:memory:`, is refused (#30400):
   * see {@link sqliteFilenameRefusal}.
   */
  filename: sqliteFilename(),

  /** Dev-only, loosen-only schema self-heal (#2186). */
  autoMigrate: SqlAutoMigrateSchema.optional().meta({ title: 'Auto-migrate schema' }),
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
   * Placeholder-free since #8336, and refused empty or `:`-prefixed other
   * than exactly `:memory:` (#30400), same as the native sqlite `filename`.
   */
  filename: sqliteFilename(),

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
