// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { isMissingTableError } from '@objectstack/types';
import { printInfo } from './format.js';
import type { SchemaStack } from './schema-migrate.js';
import type { SecretReferenceEngineLike } from './secret-reference-union.js';

/**
 * "Not asked": a read-only command does not read a table its own boot measured
 * absent.
 *
 * The read-only boot (`deferSchemaDdl`) holds the schema sync back, and the
 * held-back sync lists every table the database lacks as `create_table`. A
 * command that then read such a table asked the database a question whose
 * answer the boot had already measured, and turned the refusal into a query
 * fault and exit 1 on a project whose database does not exist yet. A table that
 * does not exist stores nothing, so the true answer to a read of it is no rows.
 *
 * This is the one place a door asks. It wraps {@link SchemaStack.tableAbsent}:
 * ⛔ it recognises no refused read of an ordinary table, so a table that exists
 * but lacks a column (`add_columns`), or any other refused read, is still issued
 * and still reported as it always was. A write mode boots plain, so
 * `tableAbsent` is `false` there and every read is real.
 *
 * ## The one table the boot cannot measure: a rotation-managed object
 *
 * An object declared with `lifecycle.storage.strategy: 'rotation'`
 * (`sys_activity`) is physically time-sharded: its rows live in
 * `<table>__r<key>` tables and its base name is a read VIEW over them. The
 * deferred sync asks the driver `hasTable(<base>)`, and a view is not a table,
 * so on SQLite it lists the base as `create_table` on a database that serves it
 * perfectly well, and `tableAbsent` answers `true` for a table that holds rows.
 * Believing it would answer "nothing to rewrite" over rows the command exists
 * to reach. So for a rotation-managed object the measurement is not consulted:
 * the read is issued, and only its missing-table refusal, recognised with the
 * shared `isMissingTableError` predicate for that object alone, reads as no
 * rows. The caller says which objects those are with `schemaOf`.
 */
export interface AbsentTableReads {
  /**
   * Did the boot measure `object`'s table absent? Ask BEFORE the read; a `true`
   * answer is recorded, so {@link notice} can name the table. Always `false`
   * for a rotation-managed object, which the boot cannot measure.
   */
  absent(object: string): boolean;
  /**
   * Issue `read` for `object`, or answer no rows for it without issuing it
   * ({@link absent}), or, for a rotation-managed object only, answer no rows
   * for the refusal of a table that is not there.
   */
  rows<T>(object: string, read: () => Promise<T[]>): Promise<T[]>;
  /** The line naming every table that was read as no rows, or `null` when none was. */
  line(): string | null;
  /**
   * Say so: on stdout in human mode, on stderr under `--json`, where stdout
   * stays one parseable document. Silent when nothing was answered this way.
   */
  notice(json: boolean): void;
}

/** Is this registered object schema declared rotation-managed? */
export function isRotationManaged(schema: unknown): boolean {
  const storage = (schema as { lifecycle?: { storage?: { strategy?: unknown } } } | null | undefined)
    ?.lifecycle?.storage;
  return storage?.strategy === 'rotation';
}

export function absentTableReads(
  stack: Pick<SchemaStack, 'tableAbsent'>,
  /** The registered schema of an object, when the caller can look one up. */
  schemaOf?: (object: string) => unknown,
): AbsentTableReads {
  const notRead = new Set<string>();
  const rotationManaged = (object: string): boolean => {
    try {
      return isRotationManaged(schemaOf?.(object));
    } catch {
      return false;
    }
  };
  const absent = (object: string): boolean => {
    if (rotationManaged(object) || !stack.tableAbsent(object)) return false;
    notRead.add(object);
    return true;
  };
  const line = (): string | null =>
    notRead.size > 0
      ? `${notRead.size} object(s) have no table in this database yet, so nothing is stored in ` +
        `them and they were read as no rows: ${[...notRead].sort().join(', ')}.`
      : null;
  return {
    absent,
    rows: async (object, read) => {
      if (absent(object)) return [];
      if (!rotationManaged(object)) return read();
      try {
        return await read();
      } catch (error) {
        if (!isMissingTableError(error, object)) throw error;
        notRead.add(object);
        return [];
      }
    },
    line,
    notice: (json) => {
      const text = line();
      if (!text) return;
      if (json) console.error(text);
      else printInfo(text);
    },
  };
}

/**
 * The engine slice the secret reference union reads through (`os secret
 * orphans` and `os secret rewrap`): the same slice, with every driver read of
 * an absent table answered with no rows.
 *
 * Read-only by construction, like the union's own port: only `find` is carried
 * onto the driver, so the write verbs of `--delete` and `--apply` (which boot
 * plain, where nothing is absent) are taken from the unwrapped driver. The
 * optional `listDatasourceDefs` stays optional: its ABSENCE is a declared gap in
 * the union, so it is carried over only when the engine has it.
 */
export function secretUnionReadView(
  engine: SecretReferenceEngineLike,
  reads: AbsentTableReads,
): SecretReferenceEngineLike {
  return {
    getConfigs: () => engine.getConfigs(),
    getDriverForObject: (objectName) => {
      const driver = engine.getDriverForObject(objectName);
      if (!driver) return driver;
      return {
        find: (object, query, options) => reads.rows(object, () => driver.find(object, query, options)),
      };
    },
    ...(typeof engine.listDatasourceDefs === 'function'
      ? { listDatasourceDefs: () => engine.listDatasourceDefs!() }
      : {}),
  };
}
