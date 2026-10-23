// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25223 cut 8] The addressed-write readers of `SecurityPlugin`, moved out of
 * `security-plugin.ts`:
 *
 * - `addressedByIdWriteId` and `addressedPredicateWrite`, which say whether an
 *   UPDATE or DELETE is the by-id or the predicate write the caller addressed,
 *   read from the engine's own dispatch predicates (#21771, #21829).
 * - `readableRowsScopeForPredicateWrite`, the read door's answer for the
 *   caller's own predicate, as the id scope a predicate write's matched set is
 *   narrowed to (#21829).
 * - `extractSingleId`, the single scalar id an update or delete names.
 * - `readRowById`, the by-id row read every provenance and pre-image gate
 *   shares, whose `null` means absent and only absent (#7505).
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `SecurityPlugin` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same exclusions, the same engine dispatch
 * verdicts, the same read under the caller's context with the same cap and
 * the same refusal above it, the same fail-closed errors when no engine is
 * wired, and a store fault still propagates as raised.
 *
 * ## How the moved bodies reach the class
 *
 * The shape cuts 1 to 7 used (`security-plugin-object-inputs.ts`, whose header
 * carries the reasoning). The class keeps all five private methods — the
 * published `dist/*.d.ts` lists each one's name, docblock and position. Three
 * of the bodies read no member (`addressedByIdWriteId`,
 * `addressedPredicateWrite`, `extractSingleId`), so their methods call their
 * functions directly, as cut 1's `extractTargetField` does. The other two read
 * `ql` alone, and each method's body is a literal of that one
 * {@link AddressedWritesHost} member plus a `.call`. Every caller still reaches
 * these methods through the plugin, so a test double or spy set on the plugin
 * is still the one the gates reach. Two of the methods were async and their
 * functions still are; each of those methods now returns its function's
 * promise.
 *
 * `ql` is not declared `readonly` (`start()` assigns it after construction),
 * so it goes as a GETTER, by the rule cut 1 set, and each read happens when the
 * body makes it.
 *
 * ## What stays in `security-plugin.ts`, and how it is read
 *
 * Three members of the same family stay in the class whole, because each body
 * is no longer than its stub would be: `declaresControlledByParent`,
 * `callerCannotReadAddressedRow` and `getCallerPreImage`. `extractSingleId`
 * has no docblock of its own: its docblock is the first of the two that sit
 * above `declaresControlledByParent`'s, and it stays there.
 *
 * Four module-level values the predicate write's read question reads stay
 * there too, and are imported here by value. `readUnlessRefused`, the
 * three-way classification of a caller-context read, is exported for this
 * module: `absentUnderCallerRead` and `unreadableUnderCallerRead` there ask it
 * too. `PREDICATE_WRITE_READABLE_ID_CAP`, `predicateWriteReadableCapError` and
 * `copyOfCallerPredicate` were exported by cut 3, for the predicate-write
 * master set in `security-plugin-cbp-write-gate.ts`, which imports them from
 * there. Each is read only inside a function body, at call time, never while
 * either module evaluates, so the two-way import is safe under ESM, and the
 * published bundle holds one module.
 *
 * The imports only these bodies read moved here: the engine's delete dispatch
 * predicate and its input type from `@objectstack/metadata-core`, and the
 * operation-private key strip from `@objectstack/core`. The update dispatch
 * predicate and its data type are imported from `@objectstack/metadata-core`,
 * as `security-plugin.ts` imports them.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { SecurityPlugin } from './security-plugin.js';
import {
  copyOfCallerPredicate,
  PREDICATE_WRITE_READABLE_ID_CAP,
  predicateWriteReadableCapError,
  readUnlessRefused,
} from './security-plugin.js';
import { withoutOperationPrivateKeys } from '@objectstack/core';
import {
  resolveEngineDeleteDispatch,
  resolveEngineUpdateDispatch,
  type EngineDeleteDispatchInput,
  type EngineUpdateDispatchData,
} from '@objectstack/metadata-core';

/**
 * The `SecurityPlugin` member the functions below read — the one, and no
 * other; each function's `this` is the `Pick` of the members IT reads. It is
 * typed AS the class member (an indexed access on the class), so a change to
 * its signature on the class is a change here too. See the module header for
 * why it is a getter.
 */
export interface AddressedWritesHost {
  readonly ql: SecurityPlugin['ql'];
}

/** The body of `SecurityPlugin#addressedByIdWriteId`; the method's docblock there is its contract. */
export function addressedByIdWriteId(
  opCtx: any,
  nested: boolean,
  referentialFieldClear: boolean,
): unknown {
  if (nested || referentialFieldClear) return undefined;
  if (opCtx.operation === 'update') {
    const data = opCtx.data;
    if (data == null || typeof data !== 'object') return undefined;
    const route = resolveEngineUpdateDispatch(data as EngineUpdateDispatchData, opCtx.options);
    return route.kind === 'by-id' ? route.id : undefined;
  }
  if (opCtx.operation === 'delete') {
    const route = resolveEngineDeleteDispatch(opCtx.options as EngineDeleteDispatchInput | undefined);
    return route.kind === 'by-id' ? route.id : undefined;
  }
  return undefined;
}

/** The body of `SecurityPlugin#addressedPredicateWrite`; the method's docblock there is its contract. */
export function addressedPredicateWrite(
  opCtx: any,
  nested: boolean,
  referentialFieldClear: boolean,
): boolean {
  if (nested || referentialFieldClear) return false;
  if (opCtx.operation === 'update') {
    const data = opCtx.data;
    if (data == null || typeof data !== 'object') return false;
    return resolveEngineUpdateDispatch(data as EngineUpdateDispatchData, opCtx.options).kind === 'multi';
  }
  if (opCtx.operation === 'delete') {
    return resolveEngineDeleteDispatch(opCtx.options as EngineDeleteDispatchInput | undefined).kind === 'multi';
  }
  return false;
}

/** The body of `SecurityPlugin#readableRowsScopeForPredicateWrite`; the method's docblock there is its contract. */
export async function readableRowsScopeForPredicateWrite(
  this: Pick<AddressedWritesHost, 'ql'>,
  opCtx: any,
): Promise<Record<string, unknown> | null> {
  if (typeof this.ql?.find !== 'function') {
    // The read question cannot be asked, and a write that cannot be narrowed
    // must not run un-narrowed. Unreachable in a real deployment — `start()`
    // registers no security middleware at all without a query engine — but a
    // non-conforming engine double fails closed rather than writing wide.
    throw new Error(
      `[Security] Cannot narrow the predicate ${opCtx.operation} on '${opCtx.object}' to the rows the ` +
        `caller can read: no query engine is available to ask.`,
    );
  }
  const callerWhere = (opCtx.options as { where?: unknown } | undefined)?.where;
  const answer = await readUnlessRefused(() =>
    this.ql.find(opCtx.object, {
      ...(callerWhere != null ? { where: copyOfCallerPredicate(callerWhere) } : {}),
      fields: ['id'],
      limit: PREDICATE_WRITE_READABLE_ID_CAP + 1,
      // [#7145] The caller's envelope minus the operation-private keys: the
      // write's own stamps (`__writeScope`, …) are not inputs to a read, and
      // a copy keeps the read's stamps off the write's context.
      context: withoutOperationPrivateKeys((opCtx.context ?? {}) as Record<string, unknown>),
    }),
  );
  if (answer.refused) return null;
  const rows: unknown[] = Array.isArray(answer.value) ? answer.value : [];
  if (rows.length > PREDICATE_WRITE_READABLE_ID_CAP) {
    throw predicateWriteReadableCapError(opCtx.object, opCtx.operation);
  }
  const ids = rows
    .map((r) => (r && typeof r === 'object' ? (r as { id?: unknown }).id : undefined))
    .filter((id) => id !== undefined && id !== null);
  return { id: { $in: ids } };
}

/**
 * The body of `SecurityPlugin#extractSingleId`. Its contract is the docblock
 * there that sits above `declaresControlledByParent`'s.
 */
export function extractSingleId(
  opCtx: any,
): string | number | bigint | null {
  const isScalar = (v: unknown): v is string | number | bigint =>
    v !== null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint');
  const data = opCtx?.data;
  if (data && typeof data === 'object' && !Array.isArray(data) && isScalar(data.id)) {
    return data.id;
  }
  const where = opCtx?.options?.where;
  if (where && typeof where === 'object' && 'id' in where && isScalar((where as any).id)) {
    return (where as any).id;
  }
  return null;
}

/** The body of `SecurityPlugin#readRowById`; the method's docblock there is its contract. */
export async function readRowById(
  this: Pick<AddressedWritesHost, 'ql'>,
  object: string,
  id: unknown,
  context: any,
): Promise<Record<string, unknown> | null> {
  // Not a read at all: there is no id to look one up by. Every call site
  // already screens this; the guard is defence, and `null` is honest here
  // because nothing was ever asked of the store.
  if (id == null) return null;
  if (typeof this.ql?.findOne !== 'function') {
    // The third collapsed fact, and it is not absence either: the probe
    // could not run. Unreachable in a real deployment — `start()` registers
    // no security middleware at all without a query engine, so no gate can
    // reach this line — but a non-conforming engine double must fail closed
    // rather than manufacture a 404 for a row nobody looked for.
    throw new Error(
      `[Security] Cannot verify record '${String(id)}' on '${object}': no query engine is available to read it.`,
    );
  }
  const row = await this.ql.findOne(object, { where: { id }, context });
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
}
