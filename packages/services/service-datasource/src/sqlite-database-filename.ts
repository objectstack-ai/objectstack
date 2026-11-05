// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveDriverId } from '@objectstack/spec/data';

/** The one name SQLite opens as an ephemeral, fileless database. */
const IN_MEMORY = ':memory:';

/**
 * [#30331] Why a SQLite datasource's `config.filename` names no database the
 * datasource can use, or `undefined` when it does. The value is either exactly
 * `:memory:` or a file path that exists or can be created; anything else is
 * refused with the value and the reason. Precondition: `config` already
 * passed its driver contract (see "Which arms live here").
 *
 * Judged where the test, the create and the update doors all judge `config`
 * (`DatasourceAdminService.assertValidConfig`), so a draft that tests red is
 * also refused at Save, and one that tests green can be saved.
 *
 * ## Why `:memory:/…` passed
 *
 * Measured on `main` 8589756a, with `:memory:/tmp/x/parts.db` (the dialog's
 * `:memory:` value with a typed path after it):
 *
 *   - Every layer reads a name that starts with `:` as fileless (driver-sql's
 *     `sqliteFilename` and `resolveSqliteAbsentFileTarget`, the wasm driver's
 *     ephemeral check), so the draft probe's missing-file refusal (#27512)
 *     skipped it and `SqlDriver.connect()` made no directory for it.
 *   - `sqlite` (better-sqlite3) then opens the name as a relative path under
 *     the server's working directory, whose `:memory:/…` directory does not
 *     exist: `connect()` only warns, every query fails with "Cannot open
 *     database because the directory does not exist", and its health check
 *     answers `false`, which the probe did not read as a failure.
 *   - `sqlite-wasm` opens an ephemeral in-memory database: reads and writes
 *     succeed, and everything is gone at the next connect or restart.
 *
 * ## What counts as usable
 *
 * The file judgement is driver-sql's write-free one,
 * `resolveSqliteAbsentFileTarget`, under `'empty-in-memory'`: it throws the
 * `SqliteDatabaseFileError` naming the file for a path that can be neither
 * opened nor created (#24961), and answers for an absent one without creating
 * it. An absent but creatable path is usable: Save keeps creating it on
 * connect, and the draft probe keeps refusing to (#27512).
 *
 * `sqlite` and `sqlite-wasm` only: both open `config.filename`. `turso` names
 * its target as a url, which libSQL parses itself.
 *
 * ## Which arms live here
 *
 * The filesystem arm only. The two arms the string alone decides (`''`, and a
 * name that starts with `:` without being exactly `:memory:`) are refined on
 * `SqliteConfigSchema.filename` / `SqliteWasmConfigSchema.filename` (#30400),
 * so the build door and `PUT /api/v1/meta/datasource/:name` refuse them too.
 * `assertValidConfig` runs that driver-contract parse first and calls this only
 * when it is clean, so those two values arrive here never: ⛔ do not restate
 * them; the spec is the one copy.
 */
export async function sqliteDatabaseFilenameIssue(driver: string, config: unknown): Promise<string | undefined> {
  const id = resolveDriverId(driver);
  if (id !== 'sqlite' && id !== 'sqlite-wasm') return undefined;
  const filename = (config as { filename?: unknown } | null | undefined)?.filename;
  // Absent is the schema's own `:memory:` default; a non-string is the
  // driver contract's refusal, already given.
  // `''` and a `:`-prefixed name other than exactly `:memory:` are the driver
  // contract's own refusals (#30400, `SqliteConfigSchema.filename`), reported
  // by the parse that runs before this; `resolveSqliteAbsentFileTarget` reads
  // both as fileless and answers nothing for them.
  if (typeof filename !== 'string' || filename === IN_MEMORY) return undefined;
  const { resolveSqliteAbsentFileTarget } = await import('@objectstack/driver-sql');
  try {
    resolveSqliteAbsentFileTarget(filename, 'empty-in-memory');
  } catch (err) {
    return `config.filename: ${err instanceof Error ? err.message : String(err)}`;
  }
  return undefined;
}
