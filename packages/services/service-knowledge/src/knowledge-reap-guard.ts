// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IKnowledgeService } from '@objectstack/spec/contracts';
import type { KnowledgeSource } from '@objectstack/spec/ai';
import { documentIdFor, objectSourcesFor } from './knowledge-service.js';
import type { KnowledgeLogger } from './knowledge-service.js';

/**
 * Structural shape of a `LifecycleReapGuard` (ADR-0057 amendment).
 *
 * Declared here rather than imported from `@objectstack/objectql`: the guard
 * seam is reached by duck-typing (`ctx.getService('lifecycle')`), exactly as
 * `service-storage` reaches it, so this package keeps NO dependency — not even
 * a type-only one — on the query engine. The contract is the ADR's, and it is
 * the same three facts on both sides: given the object and the candidate rows,
 * return the ids you CONFIRM for deletion, having already done your external
 * cleanup for them. Ids you do not return are kept this sweep.
 */
type ReapGuard = (
  object: string,
  rows: Array<Record<string, unknown>>,
) => Promise<Array<string | number>>;

/** The slice of `IKnowledgeService` the guard consumes — existing members only. */
type KnowledgeReapGuardService = Pick<IKnowledgeService, 'listSources' | 'getAdapter'>;

/**
 * Reap guard that DE-INDEXES a row before the platform lifecycle sweep deletes
 * it (#4672).
 *
 * ## Why this exists
 *
 * A knowledge index built from an `object` source is a per-record projection
 * keyed by `sourceRecordId`. The sweep's retention reap (`LifecycleService`)
 * deletes rows by predicate, and ADR-0057 §3.3 forbids fanning that out as N
 * per-record events (cleanup must not re-feed the tables it is draining). So
 * the row disappears and the document keyed to it does not: an **orphan**.
 * Orphans are not merely wasted storage — they occupy `topK` slots ahead of the
 * permission filter, diluting real results, and an `isSystem` caller reads them
 * straight through.
 *
 * The guard closes that at the source. It is the ADR's own answer to this shape
 * ("a guard is a domain callback, not a second sweeper"), and it is structurally
 * identical to `service-storage`'s byte-reclaim guard: reclaim the external
 * resource the row points at, then confirm the row.
 *
 * ## Direction of failure
 *
 * `adapter.delete` failing means the document is still indexed. Confirming the
 * row anyway is precisely the orphan this guard exists to prevent, so a failure
 * **vetoes** the row: it is kept, this sweep, and retried on the next one. The
 * fail-safe direction is "row outlives its index entry", never the reverse.
 *
 * A row whose ids partially de-indexed (two sources on one object, one adapter
 * down) is vetoed too, and the successful `delete` is re-issued next sweep —
 * delete-by-id is idempotent, so the retry costs a call and changes nothing.
 *
 * Guards compose by intersection (#5535), so vetoing here never overrides
 * another registrar's verdict, and confirming here never overrides theirs.
 */
export function createKnowledgeReapGuard(
  service: KnowledgeReapGuardService,
  logger?: KnowledgeLogger,
): ReapGuard {
  return async (object, rows) => {
    const confirmed: Array<string | number> = [];
    // Resolved per call, never captured at registration: sources may be
    // registered or unregistered while the process runs, and a stale snapshot
    // would de-index against a source that no longer exists (or miss one that
    // now does) for the life of the kernel.
    const targets = objectSourcesFor(service.listSources(), object);

    for (const row of rows) {
      const id = row?.id as string | number | undefined | null;
      // No usable id → nothing to de-index BY, so nothing can be confirmed.
      // (`LifecycleService` drops these before calling a guard; stated here so
      // the guard is correct on its own terms, not by a caller's courtesy.)
      if (id === undefined || id === null || id === '') continue;
      const recordId = String(id);

      let deIndexed = true;
      for (const source of targets) {
        try {
          const adapter = service.getAdapter(source.adapter);
          await adapter.delete([documentIdFor(source.id, recordId)], {
            source,
            // Declared free-form diagnostics tag on the EXISTING
            // `AdapterContext.reason` union — an adapter that logs by reason
            // sees the reap for what it is, and no spec change is needed.
            reason: 'lifecycle-reap',
          });
        } catch (err) {
          deIndexed = false;
          logger?.warn?.(
            `[knowledge] reap guard: de-index failed for source '${source.id}' ` +
              `(object='${object}', record='${recordId}'): ${(err as Error)?.message ?? err}. ` +
              'Row kept this sweep and retried on the next one — deleting it now would ' +
              'orphan the index entry.',
          );
        }
      }
      if (deIndexed) confirmed.push(id);
    }

    return confirmed;
  };
}

/**
 * Objects this service must guard: every distinct object named by an `object`
 * source whose row-change sync is on.
 *
 * Same predicate as the guard's own target resolution, so an object is guarded
 * exactly when the guard would have work to do for it.
 */
export function guardedObjectsFor(sources: KnowledgeSource[]): string[] {
  const objects = new Set<string>();
  for (const source of sources) {
    if (source.source.kind !== 'object') continue;
    const object = source.source.object;
    // Asked through the SAME predicate the guard uses, never a second copy of
    // it: "is this object guarded?" and "what would the guard de-index for it?"
    // must never be able to answer differently.
    if (objectSourcesFor(sources, object).length > 0) objects.add(object);
  }
  return [...objects];
}
