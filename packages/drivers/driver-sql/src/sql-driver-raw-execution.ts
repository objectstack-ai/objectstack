// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25521 cut 2] The raw-execution path of `SqlDriver`: `execute`, its refusal
 * terminal `rawStatementFault`, and `noteRuntimeIndexDdl`, which records the
 * index DDL `execute` ran in the `runtimeCreatedIndexes` ledger. They moved out
 * of `sql-driver.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name as it stood, re-indented one level and otherwise
 * unedited: the same statement handling, the same redacted refusal line, the
 * same ledger rules.
 *
 * ## How the moved bodies reach the class
 *
 * The shape `sql-driver-introspection.ts` (cut 1) applies, after #23050. The
 * class keeps every method, because the published `dist/*.d.ts` lists each
 * one's name, docblock and position. `TursoDriver` overrides `execute` and
 * calls `super.execute`, and calls `rawStatementFault` from its remote
 * transport. Each body is now one literal of exactly the
 * {@link RawExecutionHost} members that method reads, plus a `.call`. `execute`
 * is no longer `async`: it returns the moved function's own promise, so a
 * caller awaits the same promise the body settles, with no extra wrapper.
 *
 * `execute` reads `rawStatementFault` and `noteRuntimeIndexDdl` through
 * closures that call them on the driver at call time. So a subclass override
 * (a test subclass overrides `rawStatementFault` and calls `super`) or a test
 * spy on the instance is still the one the body reaches.
 *
 * The fields `knex`, `logger` and `runtimeCreatedIndexes` go as GETTERS, so
 * each read happens when the body makes it, as it did on the class. The
 * ledger itself stays a field of the class: schema sync reads it as well.
 *
 * The module-level declarations the bodies read stay in `sql-driver.ts`:
 * `OWN_STATEMENT_FAULT`, `rawStatementFaultError`, the three index-DDL patterns
 * and the two identifier helpers. They are exported from there and imported
 * here. Other packages' tests cite `rawStatementFaultError` in `sql-driver.ts`
 * by path, and `OWN_STATEMENT_FAULT` has readers that did not move. The module
 * cycle is evaluation-safe because each value import is read only inside a
 * function body, never while the two modules are first evaluated. `index.ts`
 * re-exports nothing from this module, so the published surface does not move.
 */

import type { DriverOptions } from '@objectstack/spec/data';
import { redactStatementFromMessage } from '@objectstack/types';
import type { Knex } from 'knex';
import type { SqlDriver } from './sql-driver.js';
import {
  CREATE_INDEX_DDL,
  DROP_INDEX_DDL,
  INDEX_DDL_PREFIX,
  lastIdentifierSegment,
  OWN_STATEMENT_FAULT,
  rawStatementFaultError,
  unquoteSqlIdentifier,
} from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header
 * for which members are getters.
 */
export interface RawExecutionHost {
  readonly knex: SqlDriver['knex'];
  readonly logger: SqlDriver['logger'];
  noteRuntimeIndexDdl: SqlDriver['noteRuntimeIndexDdl'];
  rawStatementFault: SqlDriver['rawStatementFault'];
  readonly runtimeCreatedIndexes: SqlDriver['runtimeCreatedIndexes'];
}

/** The body of `SqlDriver#rawStatementFault`; the method's docblock there is its contract. */
export function rawStatementFault(this: Pick<RawExecutionHost, 'logger'>, command: string, error: unknown): Error {
  const declared = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof declared === 'number') return error as Error;

  const detail = (error as { message?: unknown } | null | undefined)?.message;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  // [#21385] ⛔ `command` is not written. It is the text the caller sent, and a
  // raw statement may spell its values inline as well as bind them; the
  // dialect's text leads with the same statement, compiled, and is cut below.
  this.logger.warn(
    '[sql-driver] DATABASE_ERROR — the backend refused a raw statement' +
      (typeof code === 'string' && code.length > 0 ? ` (${code})` : '') +
      '. The dialect diagnostic, with the statement and its bound literals cut: ' +
      redactStatementFromMessage(typeof detail === 'string' ? detail : String(error), OWN_STATEMENT_FAULT),
  );
  return rawStatementFaultError(error);
}

/** The body of `SqlDriver#execute`; the method's docblock there is its contract. */
export async function execute(this: Pick<RawExecutionHost, 'knex' | 'noteRuntimeIndexDdl' | 'rawStatementFault'>, command: any, params?: any[], options?: DriverOptions): Promise<unknown> {
  if (typeof command !== 'string') {
    return command;
  }

  const builder =
    options?.transaction
      ? this.knex.raw(command, params || []).transacting(options.transaction as Knex.Transaction)
      : this.knex.raw(command, params || []);

  let result: unknown;
  try {
    result = await builder;
  } catch (error) {
    // [#16019] The raw path's terminal — see {@link SqlDriver.rawStatementFault}.
    throw this.rawStatementFault(command, error);
  }
  // Only after the statement actually succeeded — an index we failed to
  // create is not one we own (#4884).
  if (INDEX_DDL_PREFIX.test(command)) this.noteRuntimeIndexDdl(command);
  return result;
}

/** The body of `SqlDriver#noteRuntimeIndexDdl`; the method's docblock there is its contract. */
export function noteRuntimeIndexDdl(this: Pick<RawExecutionHost, 'runtimeCreatedIndexes'>, sql: string): void {
  const created = CREATE_INDEX_DDL.exec(sql);
  if (created) {
    const table = lastIdentifierSegment(created[2]);
    let names = this.runtimeCreatedIndexes.get(table);
    if (!names) this.runtimeCreatedIndexes.set(table, (names = new Set<string>()));
    names.add(unquoteSqlIdentifier(created[1]));
    return;
  }
  const dropped = DROP_INDEX_DDL.exec(sql);
  if (!dropped) return;
  // SQLite / Postgres `DROP INDEX` names no table, so forget the name
  // wherever it is recorded — the ledger must never outlive the index.
  const name = lastIdentifierSegment(dropped[1]);
  for (const names of this.runtimeCreatedIndexes.values()) names.delete(name);
}
