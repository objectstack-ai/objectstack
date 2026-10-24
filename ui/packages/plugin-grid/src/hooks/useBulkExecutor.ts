/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useRef, useState } from 'react';
import type { BulkActionDef, DataSource } from '@object-ui/types';
import { RelatedCountStore } from '@object-ui/components';
import { executeBulkBatch } from '@object-ui/core';
import { normalizeMultiValuePatch, type MultiValueFieldDef } from './multiValueFields';

export interface BulkRowError {
  id: string;
  error: string;
}

export interface BulkProgress {
  total: number;
  done: number;
  failed: number;
  inFlight: boolean;
}

export interface BulkResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: BulkRowError[];
}

/**
 * Per-row snapshot of pre-mutation field values, captured so an `update`
 * batch can be reversed. Captures only the keys the patch touched (we cannot
 * faithfully undo a `delete` without a soft-delete provider, so the executor
 * skips snapshotting for non-update operations).
 */
export interface BulkSnapshotEntry {
  id: string;
  prev: Record<string, unknown>;
}

export interface BulkExecutorOptions {
  /** ObjectQL resource name (e.g. 'account'). */
  resource: string;
  /**
   * Object-schema `fields` map for `resource`. When provided, patches built
   * from `def.patch` + params are shape-normalized before hitting the data
   * source: a lone scalar aimed at a multi-value field (multiselect / tags /
   * checkboxes, or select / lookup / user / file / image with
   * `multiple: true`) is wrapped into a single-element array (#2204).
   */
  objectFields?: Record<string, MultiValueFieldDef>;
  /**
   * The data-source members the executor calls. The two BULK doors are
   * DERIVED from the `DataSource` contract (`DataSource['bulkUpdate']`,
   * `DataSource['bulkDelete']`) rather than restated, so they cannot drift
   * from the interface every in-tree adapter implements (objectui#9722).
   *
   * ## Why the bulk doors are derived and the two per-row doors are not
   *
   * The restatement this replaces still spelled the pre-objectui#9511
   * `ReadonlyArray<string | number>` for `bulkUpdate` / `bulkDelete`. Under
   * `strictFunctionTypes` those two are compared CONTRAVARIANTLY — they are
   * declared with property syntax here — so the narrowed `DataSource` was not
   * assignable to this face at all, and the one in-tree hand-off
   * (`ObjectGrid` → `BulkActionDialog`) only compiled because it erased the
   * check with an `as any`. Deriving is what makes that hand-off a real
   * check again, and what keeps it one.
   *
   * `update` / `delete` stay spelled out, deliberately: this executor
   * DISCARDS what they resolve to, so it must not demand `DataSource`'s
   * return types. Measured while repairing this card — `Pick`ing all four
   * members instead reddened four in-tree doubles in
   * `__tests__/useBulkExecutor.test.ts` on `delete`'s `Promise<boolean>`
   * alone, i.e. it NARROWS what a consumer may inject for a return value the
   * executor never reads. Their id and patch parameters are spelled to match
   * `DataSource` and are checked against it by the same hand-off.
   *
   * It stays a STRUCTURAL face either way: nothing here demands a whole
   * `DataSource`, so any compatible adapter is still injectable.
   *
   * ⚠️ `bulkUpdate` / `bulkDelete` remain optional because they are optional
   * on `DataSource` — an adapter with no server-side bulk primitive keeps
   * working through the per-row fallback below. The executor only ever hands
   * them ids it has already reduced to `string`, so the narrowed door costs
   * it nothing.
   */
  dataSource: {
    update: (resource: string, id: string, patch: Record<string, unknown>) => Promise<unknown>;
    delete: (resource: string, id: string) => Promise<unknown>;
    bulkUpdate?: DataSource['bulkUpdate'];
    bulkDelete?: DataSource['bulkDelete'];
  };
  /**
   * Per-record dispatcher for a PROMOTED bulk action — one declared object
   * action (named in the view's `bulkActions` and resolved against
   * `objectDef.actions`) applied to N selected records (objectui#3002).
   *
   * Such a def carries `operation: 'custom'` plus `def.actionDef`; the data
   * source has no idea what the action does, so the grid injects this to run it
   * through the action runner. Client fan-out — one dispatch per record — is
   * the only semantics the single-record action contract supports (`params` /
   * `recordIdParam` / `visible` are all per-record); a server-side "take every
   * id at once" variant would need its own spec key and endpoint contract.
   *
   * MUST reject on failure: the executor attributes per-row errors from the
   * rejection reason, so resolving on a failed action would report it as a
   * success (the exact #2960 failure mode this whole path exists to kill).
   *
   * When absent, `operation: 'custom'` keeps its historical meaning: no
   * mutation, the consumer wires `onComplete`.
   */
  runAction?: (
    def: BulkActionDef,
    row: Record<string, unknown>,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
  /**
   * Whole-selection dispatcher for a promoted def that opted into
   * `execution: 'aggregate'` (objectui#3139) — the "take every id at once"
   * variant the per-record contract above cannot express. Called EXACTLY ONCE
   * per run with every eligible row; the grid's implementation injects
   * `params._selectedIds` and dispatches the action a single time, so the
   * server can produce one aggregate artifact (zip, merged PDF…) for the
   * whole selection.
   *
   * MUST reject on failure, like `runAction`: the executor treats the one
   * call as all-or-nothing and attributes the rejection reason to every
   * selected id in the result, so resolving on a failed action would report
   * the entire selection as succeeded.
   *
   * When absent, an `execution: 'aggregate'` def FAILS LOUDLY rather than
   * quietly degrading to per-record fan-out — N dispatches against an
   * endpoint written for one `_selectedIds` call would be N misfires, not a
   * fallback. Wiring this without the def opting in changes nothing: the
   * def's own `execution` key selects the mode, never the capability.
   */
  runAggregate?: (
    def: BulkActionDef,
    rows: Array<Record<string, unknown>>,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
}

/**
 * Sequential executor for bulk actions. Iterates the selected records in
 * configurable batches. For `update` operations the hook prefers the
 * adapter's `bulkUpdate` primitive (one HTTP request per batch); when it's
 * absent or throws, it falls back to per-row `dataSource.update`/`delete`
 * via `Promise.allSettled` so a single failure never aborts the run.
 *
 * In addition to running, the hook also exposes:
 *   - `undo()`   — replay the prior values captured during the last update run
 *   - `retry(id)`— re-attempt a single failed row using the last run's params
 *
 * Bulk vs per-row tradeoff:
 * - Bulk halves network round-trips and lets the server enforce atomicity
 *   inside a single transaction (typical "mark all read" use case).
 * - Per-row preserves exact (id, error) attribution for the result CSV.
 * - The hook automatically falls back from bulk to per-row when bulkUpdate
 *   throws, so users still get actionable error detail on hard failures.
 *   Soft (`succeeded < total`) shortfalls surface as a single aggregate
 *   error entry per batch — see comments inline.
 *
 * A `custom` def with `execution: 'aggregate'` (objectui#3139) rides the same
 * bulk-first decision tree, but its "bulk call" is ONE `runAggregate` dispatch
 * for the entire selection (never chunked, all-or-nothing) and its per-row
 * "fallback" only re-throws the captured error for per-id attribution — it
 * never fans out per-record dispatches against a single-call endpoint.
 */
export function useBulkExecutor({ resource, dataSource, objectFields, runAction, runAggregate }: BulkExecutorOptions) {
  const [progress, setProgress] = useState<BulkProgress>({
    total: 0,
    done: 0,
    failed: 0,
    inFlight: false,
  });
  const [result, setResult] = useState<BulkResult | null>(null);
  // Captured pre-mutation state for the most recent successful update run.
  // We intentionally keep this in a ref so it survives re-renders without
  // forcing the dialog to re-mount its result UI.
  const snapshotRef = useRef<BulkSnapshotEntry[]>([]);
  const lastRunRef = useRef<{
    def: BulkActionDef;
    rows: Array<Record<string, unknown>>;
    params: Record<string, unknown>;
  } | null>(null);

  const reset = useCallback(() => {
    setProgress({ total: 0, done: 0, failed: 0, inFlight: false });
    setResult(null);
    snapshotRef.current = [];
    lastRunRef.current = null;
  }, []);

  const run = useCallback(
    async (
      def: BulkActionDef,
      rows: Array<Record<string, unknown>>,
      params: Record<string, unknown>,
    ): Promise<BulkResult> => {
      const total = rows.length;
      // An aggregate custom def (objectui#3139) is ONE call for the whole
      // selection by contract, so `batchSize` deliberately does not apply —
      // chunking would turn "one zip for N devices" into ceil(N/batchSize)
      // zips. `maxRecords` still gates the run (the dialog blocks over-limit
      // selections before this executes).
      const isAggregate =
        def.operation === 'custom' && def.execution === 'aggregate' && !!def.actionDef;
      const batchSize = isAggregate
        ? Math.max(1, rows.length)
        : Math.max(1, def.batchSize ?? 200);
      const errors: BulkRowError[] = [];
      let succeeded = 0;
      let failed = 0;

      setResult(null);
      setProgress({ total, done: 0, failed: 0, inFlight: true });

      const buildPatch = (): Record<string, unknown> =>
        normalizeMultiValuePatch({ ...(def.patch ?? {}), ...params }, objectFields);

      // Capture pre-mutation values for keys touched by the patch — only
      // for `update` operations. `delete` is irreversible from the client,
      // and `custom` actions don't necessarily mutate the record itself.
      const snapshot: BulkSnapshotEntry[] = [];
      if (def.operation === 'update') {
        const patchKeys = Object.keys(buildPatch());
        for (const row of rows) {
          const id = String(row.id ?? '');
          if (!id) continue;
          const prev: Record<string, unknown> = {};
          for (const k of patchKeys) {
            prev[k] = (row as Record<string, unknown>)[k];
          }
          snapshot.push({ id, prev });
        }
      }

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);

        // Collect ids up-front so both bulk and per-row paths share the
        // same id list (and the same "missing id" failures).
        const validIds: string[] = [];
        for (let k = 0; k < batch.length; k += 1) {
          const id = batch[k].id != null ? String(batch[k].id) : '';
          if (id) {
            validIds.push(id);
          } else {
            failed += 1;
            errors.push({ id: `index_${i + k}`, error: 'Missing record id' });
          }
        }

        if (validIds.length === 0) {
          setProgress({ total, done: succeeded, failed, inFlight: true });
          continue;
        }

        // Row lookup for the runner paths, which need the whole record (not
        // just its id) to attach as `_rowRecord` / hand to the aggregate call.
        const rowById = new Map<string, Record<string, unknown>>();
        for (const row of batch) {
          const id = row.id != null ? String(row.id) : '';
          if (id) rowById.set(id, row);
        }

        // Decide whether the adapter can collapse this whole batch into 1
        // call. Single-row batches skip bulk (no win, just overhead) — EXCEPT
        // in aggregate mode, where even one selected row must go through the
        // single aggregate call: the target endpoint reads `_selectedIds`,
        // which the per-record dispatch shape never carries.
        const allowBulk = validIds.length >= 2 || isAggregate;
        let bulkCall: ((ids: string[]) => Promise<number>) | undefined;
        let label = 'bulk';
        // The one real error from a failed aggregate call. The perRow
        // "fallback" below re-throws it per id for attribution — it must
        // never re-dispatch (see the `custom` case).
        let aggregateError: unknown;
        if (isAggregate && runAggregate) {
          bulkCall = async (ids) => {
            try {
              await runAggregate(def, ids.map((id) => rowById.get(id) ?? { id }), { ...params });
              // All-or-nothing: the single call resolving means it covered
              // every id. Partial success has no envelope on this path — a
              // server that cannot cover the whole selection must reject.
              return ids.length;
            } catch (e) {
              aggregateError = e;
              throw e;
            }
          };
          label = 'aggregate action';
        } else if (def.operation === 'update' && typeof dataSource.bulkUpdate === 'function') {
          bulkCall = (ids) => dataSource.bulkUpdate!(resource, ids, buildPatch());
          label = 'bulk update';
        } else if (def.operation === 'delete' && typeof dataSource.bulkDelete === 'function') {
          bulkCall = (ids) => dataSource.bulkDelete!(resource, ids);
          label = 'bulk delete';
        }

        const perRow = (id: string): Promise<unknown> => {
          switch (def.operation) {
            case 'delete':
              return dataSource.delete(resource, id);
            case 'update':
              return dataSource.update(resource, id, buildPatch());
            case 'custom':
              // Aggregate mode never fans out: the ONE bulkCall above either
              // covered every id or failed as a whole. Reaching here means it
              // threw (or `runAggregate` was never wired) — attribute the real
              // error to each id rather than re-dispatching N per-record calls
              // against an endpoint written for one `_selectedIds` call.
              if (isAggregate) {
                return Promise.reject(
                  aggregateError instanceof Error
                    ? aggregateError
                    : new Error(
                        aggregateError !== undefined
                          ? String(aggregateError)
                          : `Aggregate action ${def.name} has no dispatcher wired`,
                      ),
                );
              }
              // A PROMOTED def (`actionDef` present) runs its object action once
              // per record through the injected runner. Without one, this is
              // the historical callout shape — no mutation, caller wires
              // onComplete.
              return def.actionDef && runAction
                ? runAction(def, rowById.get(id) ?? { id }, { ...params })
                : Promise.resolve();
            default:
              return Promise.reject(new Error(`Unknown operation: ${def.operation}`));
          }
        };

        const outcome = await executeBulkBatch(
          { ids: validIds, originalSize: batch.length, offset: i, allowBulk, label },
          { bulkCall, perRow },
        );
        succeeded += outcome.succeeded;
        failed += outcome.failed;
        errors.push(...outcome.errors);
        setProgress({ total, done: succeeded, failed, inFlight: true });
      }

      const finalResult: BulkResult = { total, succeeded, failed, errors };
      // Only retain the snapshot for rows that actually succeeded — there's
      // no point trying to "undo" a row whose mutation never landed.
      const failedIds = new Set(errors.map(e => e.id));
      snapshotRef.current = snapshot.filter(s => !failedIds.has(s.id));
      lastRunRef.current = { def, rows, params };
      setProgress({ total, done: succeeded, failed, inFlight: false });
      setResult(finalResult);
      // Mutating any row in `resource` may have changed how many records
      // belong to a parent (e.g. deleting Contacts under an Account). Drop
      // every cached count for this resource so the next page render
      // re-probes. Cheap — counts are 1-int values.
      if (succeeded > 0) {
        RelatedCountStore.invalidate(resource);
      }
      return finalResult;
    },
    [resource, dataSource, objectFields, runAction, runAggregate],
  );

  /**
   * Reverse the most recent `update` run by replaying each captured snapshot
   * back through `dataSource.update`. No-op (returns null) when the last run
   * was a delete/custom operation or when no successful rows were recorded.
   */
  const undo = useCallback(async (): Promise<BulkResult | null> => {
    const snapshot = snapshotRef.current;
    if (!snapshot.length) return null;
    const total = snapshot.length;
    const errors: BulkRowError[] = [];
    let succeeded = 0;
    let failed = 0;

    setResult(null);
    setProgress({ total, done: 0, failed: 0, inFlight: true });

    const settled = await Promise.allSettled(
      snapshot.map(entry => dataSource.update(resource, entry.id, entry.prev)),
    );
    settled.forEach((res, idx) => {
      if (res.status === 'fulfilled') succeeded += 1;
      else {
        failed += 1;
        errors.push({
          id: snapshot[idx].id,
          error: res.reason instanceof Error ? res.reason.message : String(res.reason),
        });
      }
    });

    const undoResult: BulkResult = { total, succeeded, failed, errors };
    // Clear the snapshot — undoing twice would re-apply the old values
    // against rows that have already been reverted, which is rarely useful
    // and easy to do by accident from a sticky toast.
    snapshotRef.current = [];
    setProgress({ total, done: succeeded, failed, inFlight: false });
    setResult(undoResult);
    return undoResult;
  }, [resource, dataSource]);

  /**
   * Re-attempt a single previously-failed row using the same operation +
   * params as the original run. Returns true on success.
   */
  const retry = useCallback(
    async (rowId: string): Promise<boolean> => {
      const last = lastRunRef.current;
      if (!last) return false;
      const row = last.rows.find(r => String(r.id ?? '') === rowId);
      if (!row) return false;
      const patch = normalizeMultiValuePatch(
        { ...(last.def.patch ?? {}), ...last.params },
        objectFields,
      );
      try {
        switch (last.def.operation) {
          case 'delete':
            await dataSource.delete(resource, rowId);
            break;
          case 'update':
            await dataSource.update(resource, rowId, patch);
            break;
          case 'custom':
            // An aggregate run is a single all-or-nothing call — there is no
            // per-row slice to re-attempt. Re-running the whole action is the
            // retry (a total failure keeps the selection for exactly that).
            if (last.def.execution === 'aggregate') return false;
            // A promoted def re-dispatches the action for real; a plain callout
            // def has nothing to retry, so it reports success unchanged.
            if (!last.def.actionDef || !runAction) return true;
            await runAction(last.def, row, { ...last.params });
            break;
          default:
            return false;
        }
        // Drop this row from the result's errors list — caller updates the
        // outer result so the UI reflects the new state.
        setResult(prev => {
          if (!prev) return prev;
          const errors = prev.errors.filter(e => e.id !== rowId);
          return {
            ...prev,
            errors,
            succeeded: prev.succeeded + 1,
            failed: Math.max(0, prev.failed - 1),
          };
        });
        return true;
      } catch {
        return false;
      }
    },
    [resource, dataSource, objectFields, runAction],
  );

  return { run, undo, retry, progress, result, reset };
}
