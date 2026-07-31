// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `__search` companion-column projection (#2486).
 *
 * The column itself is DECLARED at object compile time by the SchemaRegistry
 * (`provisionSearchCompanion`, gated on `OS_SEARCH_PINYIN_ENABLED`); this
 * module only FILLS the value — the `plugin-sharing` primary-BU projection
 * pattern (column on the object, plugin maintains it via hooks).
 *
 * Write path: global `beforeInsert`/`beforeUpdate` hooks stamp
 * `data.__search` whenever a companion source field (the object's
 * display/name field) is present in the write — i.e. only when the source
 * actually changed, avoiding write amplification. Writes that bypass hooks
 * (bulk import, direct migration) leave the companion empty; the boot
 * backfill and the `rebuildSearchCompanion` reconcile entry cover that.
 */

import {
  SEARCH_COMPANION_FIELD,
  resolveSearchCompanionSources,
  containsCJK,
} from '@objectstack/objectql';
import { keysetWalk } from '@objectstack/types';
import { computeSearchCompanionValue } from './pinyin.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

export const PINYIN_SEARCH_HOOK_PACKAGE = 'plugin-pinyin-search:companion';

interface MinimalEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => any | Promise<any>,
    options?: { object?: string | string[]; priority?: number; packageId?: string },
  ): void;
  unregisterHooksByPackage(packageId: string): number;
  find(object: string, query?: any, options?: any): Promise<any[]>;
  update(object: string, data: any, options?: any): Promise<any>;
  registry?: {
    getObject(name: string): any;
    getAllObjects?(packageId?: string): any[];
  };
}

interface MinimalLogger {
  info?: (msg: any, ...rest: any[]) => void;
  warn?: (msg: any, ...rest: any[]) => void;
  debug?: (msg: any, ...rest: any[]) => void;
}

/**
 * Stamp `data.__search` on a before-save hook context when a companion source
 * field is part of the write. Recomputes from the NEW value; a non-CJK new
 * value clears the companion (null) so stale pinyin never recalls a renamed
 * record. Never throws — a normalization failure must not fail the write.
 */
async function stampCompanion(engine: MinimalEngine, ctx: any, logger?: MinimalLogger): Promise<void> {
  const object = ctx?.object;
  if (!object) return;
  const schema = engine.registry?.getObject?.(object);
  if (!schema?.fields?.[SEARCH_COMPANION_FIELD]) return;

  const data = ctx?.input?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;

  const sources = resolveSearchCompanionSources(schema);
  if (sources.length === 0) return;
  const touched = sources.filter((s) => Object.prototype.hasOwnProperty.call(data, s));
  if (touched.length === 0) return; // source unchanged → no recompute (no write amplification)

  try {
    data[SEARCH_COMPANION_FIELD] = await computeSearchCompanionValue(sources.map((s) => data[s]));
  } catch (err: any) {
    logger?.warn?.('[pinyin-search] companion normalization failed — write proceeds without it', {
      object,
      error: err?.message,
    });
  }
}

/**
 * Bind the global before-save hooks that keep `__search` in step. Idempotent
 * (unbinds the package first). Hooks are global (no object filter) with a
 * cheap early-out: objects without a provisioned companion column return
 * immediately. They run for system-context writes too — the projection must
 * stay correct regardless of who writes (seeds, imports, admin UI).
 */
export function bindSearchCompanionHooks(engine: MinimalEngine, logger?: MinimalLogger): void {
  if (typeof engine.registerHook !== 'function') return;
  if (typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(PINYIN_SEARCH_HOOK_PACKAGE);
  }
  const opts = { packageId: PINYIN_SEARCH_HOOK_PACKAGE, priority: 150 };
  const handler = (ctx: any) => stampCompanion(engine, ctx, logger);
  engine.registerHook('beforeInsert', handler, opts);
  engine.registerHook('beforeUpdate', handler, opts);
  logger?.info?.('[pinyin-search] companion hooks bound (beforeInsert/beforeUpdate, all objects)');
}

export interface CompanionBackfillOptions {
  /** Rows fetched per page during the scan. Default 1000. */
  batchSize?: number;
  /** Restrict to one object (reconcile entry); default: every provisioned object. */
  object?: string;
  /**
   * Recompute EVERY row's companion, not just missing ones — the periodic
   * reconcile/rebuild mode. Default false (backfill: only rows whose
   * companion is empty but whose source has CJK content).
   */
  force?: boolean;
}

export interface CompanionBackfillResult {
  objects: number;
  scanned: number;
  updated: number;
}

/**
 * Backfill / reconcile the companion column.
 *
 * Denormalized-on-write columns go stale when writes bypass hooks (bulk
 * import, direct migration) and are empty for rows that predate the switch
 * being enabled. This scans every object that carries the companion column
 * (paged, system context) and fills the gaps; with `force: true` it
 * recomputes unconditionally (the periodic reconcile / rebuild entry).
 * Idempotent; per-row failures are skipped so one bad row never aborts the
 * pass.
 */
export async function backfillSearchCompanion(
  engine: MinimalEngine,
  logger?: MinimalLogger,
  options?: CompanionBackfillOptions,
): Promise<CompanionBackfillResult> {
  const batchSize = Math.max(1, options?.batchSize ?? 1000);
  const all = options?.object
    ? [engine.registry?.getObject?.(options.object)].filter(Boolean)
    : engine.registry?.getAllObjects?.() ?? [];

  const result: CompanionBackfillResult = { objects: 0, scanned: 0, updated: 0 };

  for (const schema of all) {
    if (!schema?.name || !schema?.fields?.[SEARCH_COMPANION_FIELD]) continue;
    const sources = resolveSearchCompanionSources(schema);
    if (sources.length === 0) continue;
    result.objects++;

    // Seek by `id` (#4363). This walk UPDATES the rows it reads, and an offset
    // counts into a set those writes are changing, so rows slide past the
    // cursor and never get their companion blob — a backfill that reports a
    // clean pass while leaving records unsearchable.
    const walk = keysetWalk<any>(
      (q) => engine.find(schema.name, {
        ...q,
        fields: ['id', ...sources, SEARCH_COMPANION_FIELD],
        context: SYSTEM_CTX,
      }),
      { pageSize: batchSize },
    );

    try {
      for await (const rows of walk.pages()) {
      result.scanned += rows.length;

      for (const row of rows) {
        if (row?.id == null) continue;
        const hasBlob = typeof row[SEARCH_COMPANION_FIELD] === 'string' && row[SEARCH_COMPANION_FIELD] !== '';
        const hasCjkSource = sources.some((s) => containsCJK(row[s]));
        // Backfill mode: touch only rows missing a blob they should have.
        // Force mode: recompute everything (also clears stale blobs).
        if (!options?.force && (hasBlob || !hasCjkSource)) continue;
        try {
          const value = await computeSearchCompanionValue(sources.map((s) => row[s]));
          if (!options?.force && value == null) continue;
          if (value === row[SEARCH_COMPANION_FIELD]) continue;
          await engine.update(
            schema.name,
            { id: row.id, [SEARCH_COMPANION_FIELD]: value },
            { context: SYSTEM_CTX },
          );
          result.updated++;
        } catch (err: any) {
          logger?.warn?.('[pinyin-search] backfill row skipped', {
            object: schema.name,
            id: row.id,
            error: err?.message,
          });
        }
      }
      }
    } catch (err: any) {
      logger?.warn?.('[pinyin-search] backfill scan failed', { object: schema.name, error: err?.message });
      continue;
    }
  }

  if (result.updated > 0) {
    logger?.info?.('[pinyin-search] companion backfill complete', result);
  }
  return result;
}

/**
 * Periodic reconcile / rebuild entry: recompute the companion for every row
 * (optionally one object). Alias for `backfillSearchCompanion` with
 * `force: true` — exposed under its own name so operators/jobs have an
 * explicit "rebuild the pinyin index" handle.
 */
export function rebuildSearchCompanion(
  engine: MinimalEngine,
  logger?: MinimalLogger,
  options?: Omit<CompanionBackfillOptions, 'force'>,
): Promise<CompanionBackfillResult> {
  return backfillSearchCompanion(engine, logger, { ...options, force: true });
}
