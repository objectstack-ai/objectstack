/**
 * ObjectUI — batchTransaction emulation
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Client-side emulation of {@link DataSource.batchTransaction} for adapters
 * that lack a server-side transactional batch endpoint. This is the single,
 * tested home for the non-atomic fallback (ObjectStack objectui #2679 /
 * objectstack-ai/objectstack#1604 / ADR-0034 item 4): components call `runBatchTransaction`
 * unconditionally and never orchestrate cross-object writes themselves.
 *
 * The emulation runs operations sequentially — NOT the old `bulk('create')`
 * grouping — because sequential execution is what makes `{ $ref: i }`
 * resolution and ordered semantics correct (a child create must observe the
 * parent's freshly-minted id). Line-item counts are small, so the extra
 * round-trips are acceptable.
 */

import type { BatchTransactionOperation, DataSource } from '@object-ui/types';

/** Best-effort id extraction across the record shapes adapters return. */
function idOf(rec: any): string | undefined {
  if (rec == null) return undefined;
  return rec.id ?? rec._id ?? rec.recordId;
}

/**
 * Replace top-level `{ $ref: i }` values in an op payload with the id produced
 * by operation `i`. Only backward references are valid — a forward or
 * unresolved ref throws (the builders only ever emit `{ $ref: 0 }` pointing at
 * an already-executed parent, so this is a guard, not a normal path).
 */
function resolveRefs(
  data: Record<string, any>,
  results: any[],
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as any).$ref === 'number'
    ) {
      const refIndex = (value as any).$ref as number;
      const id = idOf(results[refIndex]);
      if (id === undefined) {
        throw new Error(
          `batchTransaction: field "${key}" references operation ${refIndex}, ` +
            `which has not produced an id (forward or invalid $ref)`,
        );
      }
      out[key] = id;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Emulate an atomic batch over a plain DataSource by executing its `create`/
 * `update`/`delete` primitives in order.
 *
 * NOT atomic: on failure it best-effort compensates by deleting the records
 * it created (reverse order — children before parent), then rethrows the
 * original error. Updates and deletes that already ran cannot be undone; a
 * compensation delete that itself fails is swallowed (`Promise.allSettled`).
 * This is the documented reason a server-backed `batchTransaction` is
 * strictly better — a true transaction simply never commits.
 *
 * MutationEvents are deliberately NOT emitted here: the underlying
 * `create`/`update`/`delete` primitives already emit per-op on adapters that
 * support `onMutation`, so emitting here too would double-fire.
 */
export async function emulateBatchTransaction<T = any>(
  dataSource: DataSource<T>,
  operations: BatchTransactionOperation[],
): Promise<{ results: any[] }> {
  const results: any[] = [];
  const created: Array<{ object: string; id: string }> = [];

  try {
    for (const op of operations) {
      const action = op.action ?? 'create';
      if (action === 'create') {
        const record = await dataSource.create(
          op.object,
          resolveRefs(op.data ?? {}, results) as Partial<T>,
        );
        results.push(record);
        const id = idOf(record);
        if (id) created.push({ object: op.object, id });
      } else if (action === 'update') {
        if (op.id == null) {
          throw new Error(`batchTransaction: update on "${op.object}" requires an id`);
        }
        results.push(
          await dataSource.update(
            op.object,
            op.id,
            resolveRefs(op.data ?? {}, results) as Partial<T>,
          ),
        );
      } else {
        if (op.id == null) {
          throw new Error(`batchTransaction: delete on "${op.object}" requires an id`);
        }
        results.push(await dataSource.delete(op.object, op.id));
      }
    }
    return { results };
  } catch (err) {
    // Best-effort compensation: undo the creates we made, newest first, so a
    // child is removed before the parent it points at. Failures are ignored —
    // there is nothing more we can do client-side.
    if (created.length > 0) {
      await Promise.allSettled(
        [...created].reverse().map((c) => dataSource.delete(c.object, c.id)),
      );
    }
    throw err;
  }
}

/**
 * Persist an ordered cross-object batch, preferring the adapter's native
 * (potentially atomic) `batchTransaction` and falling back to
 * {@link emulateBatchTransaction} when the adapter does not implement it.
 *
 * This is the single entry point UI components should call — they stay
 * ignorant of whether the underlying save is truly atomic.
 */
export function runBatchTransaction<T = any>(
  dataSource: DataSource<T>,
  operations: BatchTransactionOperation[],
): Promise<{ results: any[] }> {
  return typeof dataSource.batchTransaction === 'function'
    ? dataSource.batchTransaction(operations)
    : emulateBatchTransaction(dataSource, operations);
}
