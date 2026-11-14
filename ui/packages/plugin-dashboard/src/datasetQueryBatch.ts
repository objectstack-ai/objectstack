/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One dashboard render's dataset queries, sent together (objectstack#32165).
 *
 * Every dataset-bound widget of a dashboard asks its own query from its own
 * effect, through the dashboard's data source. Those effects run in one commit,
 * so the queries they ask in one task can be sent as one batch request
 * (`queryDatasetBatch`, the adapter's door to
 * `POST /analytics/dataset/query/batch`) instead of one request each.
 *
 * The coalescer is that window and nothing more. A widget keeps its own code
 * path, its own promise and its own refetch: it calls `queryDataset` with the
 * arguments it always sent and gets back exactly what the single door would
 * give it, an answer or the error that query is refused with. Which queries
 * share a request is the data source's business: the coalescer hands it
 * every query of one caller package, one exact qualifier and one preview
 * intent asked in one window (a batch request names its package once, so two
 * packages' queries never share one), and
 * the data source splits by its own bounds. A query alone in its window (a
 * widget mounted alone, a one-widget refetch) goes through the single door
 * unchanged, and so does every query of a data source with no batch door.
 */

import { createContext, useMemo } from 'react';

/** `queryDataset`'s third argument, as the dashboard callers pass it. */
export interface DatasetQueryOptions {
  /** The exact qualifier `?package=` (ADR-0150 D5). */
  packageId?: string;
  /** The reader's package, `?callerPackage=` (ADR-0150 D3): the dashboard's own served package. */
  callerPackage?: string;
  previewDrafts?: boolean;
}

/** One query's outcome in a batch, in `Promise.allSettled`'s shape. */
export type DatasetQueryOutcome =
  | { status: 'fulfilled'; value: unknown }
  | { status: 'rejected'; reason: unknown };

/**
 * A data source a dashboard can batch through: the single door every dataset
 * caller uses, and, optionally, the batch door, which answers one outcome per
 * query in the order given and never rejects itself.
 */
export interface DatasetBatchCapableSource {
  queryDataset(dataset: string | Record<string, unknown>, selection: unknown, options?: DatasetQueryOptions): Promise<unknown>;
  queryDatasetBatch?(
    queries: Array<{ dataset: string | Record<string, unknown>; selection: unknown }>,
    options?: DatasetQueryOptions,
  ): Promise<DatasetQueryOutcome[]>;
}

/** The door a dashboard's dataset callers ask instead of the data source, for that data source. */
export interface DatasetQueryCoalescer {
  /** The data source this coalescer batches for; a caller holding another one asks that one. */
  readonly source: DatasetBatchCapableSource;
  /** Resolves to whatever the source's single door resolves to for this query; the caller names that type. */
  queryDataset<R = unknown>(dataset: string | Record<string, unknown>, selection: unknown, options?: DatasetQueryOptions): Promise<R>;
}

interface PendingQuery {
  /** The caller's own arguments, handed to the single door exactly as sent. */
  args: [string | Record<string, unknown>, unknown, DatasetQueryOptions?];
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * The coalescer for `source`. With no batch door on `source` it is the single
 * door itself. Otherwise the queries asked before the current task ends (a
 * microtask, which every widget effect of one commit runs ahead of) are sent
 * together, grouped by caller package, exact qualifier and preview intent: a
 * batch request reads each of them once, for every query it carries.
 */
export function createDatasetQueryCoalescer(source: DatasetBatchCapableSource): DatasetQueryCoalescer {
  if (typeof source.queryDatasetBatch !== 'function') {
    return { source, queryDataset: <R>(...args: PendingQuery['args']) => source.queryDataset(...args) as Promise<R> };
  }
  let pending: PendingQuery[] = [];

  const flush = () => {
    const asked = pending;
    pending = [];
    const groups = new Map<string, PendingQuery[]>();
    for (const query of asked) {
      const options = query.args[2];
      const key = JSON.stringify([options?.callerPackage ?? null, options?.packageId ?? null, options?.previewDrafts ?? null]);
      const group = groups.get(key);
      if (group) group.push(query); else groups.set(key, [query]);
    }
    for (const group of groups.values()) {
      if (group.length === 1) {
        const [only] = group;
        source.queryDataset(...only.args).then(only.resolve, only.reject);
        continue;
      }
      const options = group[0].args[2];
      Promise.resolve()
        .then(() => source.queryDatasetBatch!(
          group.map(({ args: [dataset, selection] }) => ({ dataset, selection })),
          options,
        ))
        .then((outcomes) => {
          group.forEach((query, index) => {
            const outcome = outcomes?.[index];
            if (outcome?.status === 'fulfilled') query.resolve(outcome.value);
            else if (outcome?.status === 'rejected') query.reject(outcome.reason);
            else query.reject(new Error(`Dataset query batch answered no outcome for query ${index + 1} of ${group.length}.`));
          });
        })
        .catch((reason) => { for (const query of group) query.reject(reason); });
    }
  };

  return {
    source,
    queryDataset: <R>(...args: PendingQuery['args']) => new Promise<R>((resolve, reject) => {
      if (pending.length === 0) queueMicrotask(flush);
      pending.push({ args, resolve: resolve as (value: unknown) => void, reject });
    }),
  };
}

/**
 * The coalescer a dashboard provides to the dataset callers it renders. Absent
 * (`null`) outside a dashboard, where each caller asks its data source itself.
 * A caller asks it only for a query against the coalescer's own `source`.
 */
export const DatasetQueryCoalescerContext = createContext<DatasetQueryCoalescer | null>(null);

/**
 * The coalescer for a dashboard's resolved data source, or `null` when that
 * source has no `queryDataset` at all.
 *
 * Memoised for cost only (ui AGENTS.md #10): nothing keys on the coalescer's
 * identity. A recomputed one starts a fresh window, and queries already in the
 * old one are still sent and still settle.
 */
export function useDatasetQueryCoalescer(source: unknown): DatasetQueryCoalescer | null {
  return useMemo(() => {
    const candidate = source as Partial<DatasetBatchCapableSource> | null | undefined;
    return candidate && typeof candidate.queryDataset === 'function'
      ? createDatasetQueryCoalescer(candidate as DatasetBatchCapableSource)
      : null;
  }, [source]);
}
