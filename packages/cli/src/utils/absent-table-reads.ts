// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
 * This is the one place a door asks. It wraps {@link SchemaStack.tableAbsent}
 * and nothing else: ⛔ it is not a second mechanism and it recognises no refused
 * read, so a table that exists but lacks a column (`add_columns`), or any other
 * refused read, is still issued and still reported as it always was. A write
 * mode boots plain, so `tableAbsent` is `false` there and every read is real.
 */
export interface AbsentTableReads {
  /**
   * Did the boot measure `object`'s table absent? Ask BEFORE the read; a `true`
   * answer is recorded, so {@link notice} can name the table that was not read.
   */
  absent(object: string): boolean;
  /** The line naming every table that was answered without a read, or `null` when none was. */
  line(): string | null;
  /**
   * Say so: on stdout in human mode, on stderr under `--json`, where stdout
   * stays one parseable document. Silent when nothing was answered this way.
   */
  notice(json: boolean): void;
}

export function absentTableReads(stack: Pick<SchemaStack, 'tableAbsent'>): AbsentTableReads {
  const notRead = new Set<string>();
  const line = (): string | null =>
    notRead.size > 0
      ? `${notRead.size} object(s) have no table in this database yet, so nothing is stored in ` +
        `them and they were not read: ${[...notRead].sort().join(', ')}.`
      : null;
  return {
    absent: (object) => {
      if (!stack.tableAbsent(object)) return false;
      notRead.add(object);
      return true;
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
        find: (object, query, options) =>
          reads.absent(object) ? Promise.resolve([]) : driver.find(object, query, options),
      };
    },
    ...(typeof engine.listDatasourceDefs === 'function'
      ? { listDatasourceDefs: () => engine.listDatasourceDefs!() }
      : {}),
  };
}
