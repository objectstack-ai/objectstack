// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29520 codemod] The "Column creation helper" section of `SqlDriver`: the
 * bodies of `decorateHashShadowDuplicate`, `schemaBytesPerChar`,
 * `rethrowWithRowSizeExplanation` moved out of `sql-driver.ts` whole by
 * `scripts/codemod-split-sql-driver.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the `SqlDriver`
 * method of the same name exactly as it stood: not re-indented, not
 * formatted, not edited. The method stays on the class with its docblock and
 * signature, so the published `dist/*.d.ts`, an instance spy and a subclass
 * override are what they were; the docblock there is the contract.
 *
 * The bodies reach the class through {@link ColumnCreationHost}: exactly the
 * `SqlDriver` members they read. Each method hands its body one literal of the
 * members that body reads, plus a `.call`: methods go as closures that call
 * them on the driver at call time (the builder factory as a bound reference),
 * so a subclass override or an instance spy is still the one reached; fields
 * and accessors go as GETTERS, read when the body reads them, as they were on
 * the class.
 *
 * The module imports `sql-driver.ts` for types only, so the two modules form
 * no evaluation cycle. `index.ts` re-exports nothing from this module.
 */

import type { SqlDriver } from './sql-driver.js';

/**
 * The `SqlDriver` members the functions below read — every one of them, and
 * no other. Each is typed AS the class member (an indexed access on the
 * class), so a change to a member's signature on the class is a change here
 * too. `readonly` members are the getters.
 */
export interface ColumnCreationHost {
  explainHashShadowDuplicate: SqlDriver['explainHashShadowDuplicate'];
  explainRowSizeOverflow: SqlDriver['explainRowSizeOverflow'];
  readonly knex: SqlDriver['knex'];
  logDurabilityFailure: SqlDriver['logDurabilityFailure'];
}

/** The body of `SqlDriver#decorateHashShadowDuplicate`; the method's docblock there is its contract. */
export async function decorateHashShadowDuplicate(this: Pick<ColumnCreationHost, 'explainHashShadowDuplicate' | 'logDurabilityFailure'>, tableName: string, values: Record<string, unknown>, error: unknown): Promise<unknown> {
    let explanation: string | null = null;
    try {
      explanation = await this.explainHashShadowDuplicate(tableName, values, error);
    } catch {
      // The disambiguation is a diagnostic. If it cannot be made, the original
      // failure is still the failure — never mask it with this one.
      return error;
    }
    if (!explanation) return error;
    this.logDurabilityFailure(explanation);
    return Object.assign(new Error(`${explanation} (server said: ${String((error as { message?: string })?.message ?? error)})`), {
      code: (error as { code?: string })?.code,
      cause: error,
    });
  }

/** The body of `SqlDriver#schemaBytesPerChar`; the method's docblock there is its contract. */
export async function schemaBytesPerChar(this: Pick<ColumnCreationHost, 'knex'>): Promise<{ bytesPerChar: number; charset: string } | null> {
    try {
      const res: any = await this.knex.raw(
        'select cs.CHARACTER_SET_NAME as charset, cs.MAXLEN as maxlen ' +
          'from information_schema.CHARACTER_SETS cs ' +
          'where cs.CHARACTER_SET_NAME = @@character_set_database',
      );
      const row = (Array.isArray(res) ? res[0]?.[0] : (res?.rows?.[0] ?? res?.[0])) ?? null;
      const maxlen = Number(row?.maxlen ?? row?.MAXLEN);
      const charset = String(row?.charset ?? row?.CHARSET ?? '');
      if (!Number.isInteger(maxlen) || maxlen <= 0 || !charset) return null;
      return { bytesPerChar: maxlen, charset };
    } catch {
      // Introspection is a nicety here; the advice below holds without it.
      return null;
    }
  }

/** The body of `SqlDriver#rethrowWithRowSizeExplanation`; the method's docblock there is its contract. */
export async function rethrowWithRowSizeExplanation(this: Pick<ColumnCreationHost, 'explainRowSizeOverflow' | 'logDurabilityFailure'>, tableName: string, fields: Record<string, any> | undefined, keyedColumns: ReadonlyMap<string, { unique: boolean }>, addedColumns: string[] | null, e: any): Promise<never> {
    const overflow = await this.explainRowSizeOverflow(tableName, fields, keyedColumns, addedColumns, e);
    if (!overflow) throw e;
    const said = String(e?.sqlMessage ?? e?.message ?? e);
    this.logDurabilityFailure(overflow, said);
    throw Object.assign(new Error(`${overflow} (server said: ${said})`), {
      code: (e as { code?: string }).code,
      cause: e,
    });
  }
