// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Boot reconcile for the `__search` companion (#25634).
 *
 * The boot pass used to be `backfillSearchCompanion`: every row of every
 * companion-bearing object, on every boot, awaited inside
 * `kernel:bootstrapped` — which the kernel awaits before `kernel:listening`,
 * so readiness grew with table size (6.7 M `sys_inbox_message` rows, about
 * 4 min 50 s in production). An unchanged table paid the same walk again on
 * every restart, because a row's `__search` is `null` both when it was never
 * looked at and when it was looked at and has no CJK to project, so the data
 * alone cannot say a row is done.
 *
 * This module records instead, per object, that a walk COMPLETED: one
 * receipt row in the `sys_migration` deployment ledger. A later boot then
 * walks only the rows written since that walk started (`updated_at`) that
 * still carry no companion, which is what can still need one: rows written while the switch was off,
 * seed rows written before the hooks were bound, and rows a hook-bypassing
 * writer stamped. An unchanged object reads zero rows. Writes that bypass the
 * audit stamp too are the explicit rebuild's job (`rebuildSearchCompanion`).
 *
 * ## Why `sys_migration`, and why the id is spelled here
 *
 * It is the ledger the runtime already keeps for "has THIS deployment run
 * this data pass" (`@objectstack/platform-objects`' `sys-migration.object.ts`),
 * its API is read-only, and its row contract lives in `@objectstack/spec/system`
 * (`DataMigrationFlagSchema`). It is the destination the seed-tenancy repair's
 * receipt was ruled onto, written the same way: through the engine, against
 * the contract, with no dependency on the package that registers the object.
 * The id is a constant of this package, not of the spec, for the reason that
 * receipt states: one writer and one reader, both here, so publishing it into
 * the shared contract would declare a coordination point that does not exist.
 * Nothing about it is authorable — no metadata key, no setting.
 *
 * ## The field reading (the ledger's fields are gate-bearing for other ids)
 *
 *  - `verified_at: null` — there is no self-check; a timestamp would be a
 *    certificate nothing earned. `blocking: 0` — no consumer is gated on this
 *    id. Every ledger reader reads one row by its own id, so neither reaches
 *    another id's gate.
 *  - `advisory` — rows whose update failed in the last run. Their object's
 *    watermark is NOT advanced, so the next boot retries them.
 *  - `details` — JSON: `{ version, objects: { NAME: { sources, since } } }`.
 *    `since` is the start of the last completed walk, less a margin;
 *    `sources` is the display fields it projected. A different source set or
 *    a different `version` invalidates the entry and the object is walked in
 *    full again.
 *
 * ## No ledger, no receipt
 *
 * A kernel without `PlatformObjectsPlugin` has no `sys_migration`. The pass
 * then walks every row, as it always did, and says so once at `warn` — the
 * cost is visible, nothing is lost.
 */

import { DATA_MIGRATION_FLAG_OBJECT, type DataMigrationFlag } from '@objectstack/spec/system';
import { SEARCH_COMPANION_FIELD } from '@objectstack/objectql';
import {
  companionObjects,
  walkCompanionObject,
  type MinimalEngine,
  type MinimalLogger,
} from './companion-projection.js';

/** This pass's ledger row id. See the module comment for why it is spelled here. */
export const SEARCH_COMPANION_RECONCILE_MIGRATION_ID = 'pinyin-search-companion';

/**
 * Bump when the projection itself changes (what `computeSearchCompanionValue`
 * writes, or which rows the walk would touch): every receipt written under an
 * older version is ignored and every object is walked in full once.
 */
export const SEARCH_COMPANION_RECONCILE_VERSION = 1;

/**
 * How far before a walk's start its watermark is set. A row is stamped with
 * the writing node's clock, and that node may run behind this one; the
 * margin re-reads a few minutes of rows rather than missing any.
 */
export const RECONCILE_WATERMARK_MARGIN_MS = 10 * 60 * 1000;

/** The column the incremental walk filters on — the platform's audit stamp. */
const WATERMARK_FIELD = 'updated_at';

const LEDGER_CTX = { isSystem: true } as const;

interface ReceiptEntry {
  sources: string[];
  since: string;
}

interface ReceiptDetails {
  version: number;
  objects: Record<string, ReceiptEntry>;
}

export interface SearchCompanionReconcileOptions {
  /** Rows fetched per page. Default 1000. */
  batchSize?: number;
  /** Stop between pages (plugin shutdown). */
  signal?: AbortSignal;
  /** Clock, for tests. */
  now?: () => Date;
}

export interface SearchCompanionReconcileResult {
  /** Companion-bearing objects considered. */
  objects: number;
  /** Objects walked in full (no usable receipt entry). */
  full: number;
  /** Objects walked from their watermark. */
  incremental: number;
  scanned: number;
  pages: number;
  updated: number;
  /** Whether the receipt was written (false: no ledger, aborted, or the write failed). */
  recorded: boolean;
  aborted: boolean;
}

/**
 * Reconcile every companion-bearing object, reading only what changed since
 * its last completed walk. Never throws for a single object's failure; the
 * caller (the plugin's post-readiness task) logs anything it does throw.
 */
export async function reconcileSearchCompanion(
  engine: MinimalEngine,
  logger?: MinimalLogger,
  options?: SearchCompanionReconcileOptions,
): Promise<SearchCompanionReconcileResult> {
  const batchSize = Math.max(1, options?.batchSize ?? 1000);
  const now = options?.now ?? (() => new Date());
  const result: SearchCompanionReconcileResult = {
    objects: 0, full: 0, incremental: 0, scanned: 0, pages: 0, updated: 0, recorded: false, aborted: false,
  };

  const targets = companionObjects(engine);
  if (targets.length === 0) return result;

  const ledger = hasLedger(engine);
  if (!ledger) {
    logger?.warn?.(
      `[pinyin-search] ${DATA_MIGRATION_FLAG_OBJECT} is not registered on this kernel, so the companion ` +
        `reconcile cannot record a completed walk and reads EVERY row of every searchable object on every ` +
        `boot. Compose PlatformObjectsPlugin (it carries the ledger every served kernel gets) to make an ` +
        `unchanged restart read nothing.`,
    );
  }
  const previous = ledger ? await readReceipt(engine, logger) : undefined;
  const next: ReceiptDetails = {
    version: SEARCH_COMPANION_RECONCILE_VERSION,
    objects: { ...(previous?.objects ?? {}) },
  };
  let skipped = 0;

  for (const { schema, sources } of targets) {
    if (options?.signal?.aborted) {
      result.aborted = true;
      break;
    }
    result.objects++;
    const entry = previous?.objects[schema.name];
    const usable =
      entry !== undefined &&
      sameSources(entry.sources, sources) &&
      schema.fields?.[WATERMARK_FIELD] !== undefined;
    const startedAt = now().getTime();
    const walk = await walkCompanionObject(
      engine,
      schema,
      sources,
      {
        batchSize,
        signal: options?.signal,
        where: usable ? sinceLastWalk(entry!.since) : undefined,
      },
      logger,
    );
    if (usable) result.incremental++;
    else result.full++;
    result.scanned += walk.scanned;
    result.pages += walk.pages;
    result.updated += walk.updated;
    skipped += walk.skipped;

    if (walk.aborted) {
      result.aborted = true;
      break;
    }
    // Advance only past a walk that saw every row it was asked for and wrote
    // every row it meant to: a failed scan or a skipped row keeps the old
    // watermark, so the next boot reads those rows again.
    if (!walk.failed && walk.skipped === 0) {
      next.objects[schema.name] = {
        sources: [...sources],
        since: new Date(startedAt - RECONCILE_WATERMARK_MARGIN_MS).toISOString(),
      };
    }
    if (!usable || walk.updated > 0) {
      logger?.info?.('[pinyin-search] companion reconcile walked an object', {
        object: schema.name,
        mode: usable ? 'since-last-walk' : 'full',
        scanned: walk.scanned,
        pages: walk.pages,
        updated: walk.updated,
      });
    }
  }

  if (ledger && !result.aborted) {
    result.recorded = await writeReceipt(engine, next, skipped, now().toISOString(), logger);
  }
  return result;
}

/**
 * The rows that can still need a companion after a completed walk: written
 * since it started AND still without one. A row that has a blob never needs
 * a backfill. The `null` test alone is not enough (a non-CJK row is `null`
 * forever, so it would match on every boot), and the watermark alone is not
 * either: the walk's own writes go through the audit stamp, so every row it
 * filled carries a fresh `updated_at` and the next boot would read them all
 * again. Together they match only rows nothing has looked at.
 */
function sinceLastWalk(since: string): Record<string, unknown> {
  return { $and: [{ [WATERMARK_FIELD]: { $gte: since } }, { [SEARCH_COMPANION_FIELD]: null }] };
}

function hasLedger(engine: MinimalEngine): boolean {
  return (
    typeof engine.findOne === 'function' &&
    typeof engine.insert === 'function' &&
    engine.registry?.getObject?.(DATA_MIGRATION_FLAG_OBJECT) != null
  );
}

function sameSources(a: unknown, b: string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((s, i) => s === b[i]);
}

/**
 * The previous receipt's details, or `undefined` when there is none or it
 * cannot be used — every object is then walked in full, which is the safe
 * direction (the cost of a first boot, never a missed row).
 */
async function readReceipt(engine: MinimalEngine, logger?: MinimalLogger): Promise<ReceiptDetails | undefined> {
  let row: Record<string, unknown> | null;
  try {
    row = await engine.findOne!(DATA_MIGRATION_FLAG_OBJECT, {
      where: { id: SEARCH_COMPANION_RECONCILE_MIGRATION_ID },
      context: LEDGER_CTX,
    });
  } catch (err: any) {
    logger?.warn?.(
      `[pinyin-search] reading the companion reconcile receipt from ${DATA_MIGRATION_FLAG_OBJECT} failed — ` +
        `every searchable object is walked in full this boot`,
      { error: err?.message },
    );
    return undefined;
  }
  if (!row || typeof row.details !== 'string') return undefined;
  try {
    const parsed = JSON.parse(row.details) as ReceiptDetails;
    if (parsed?.version !== SEARCH_COMPANION_RECONCILE_VERSION || typeof parsed.objects !== 'object') {
      return undefined;
    }
    return parsed;
  } catch {
    logger?.warn?.(
      `[pinyin-search] the companion reconcile receipt in ${DATA_MIGRATION_FLAG_OBJECT} ` +
        `(id '${SEARCH_COMPANION_RECONCILE_MIGRATION_ID}') is not valid JSON — every searchable object is ` +
        `walked in full this boot and the receipt is rewritten`,
    );
    return undefined;
  }
}

/**
 * Upsert the receipt. A failure is reported, never raised: nothing is lost
 * (the companion values are already written), the next boot only pays a
 * full walk again — a cost, so `warn`, and said once.
 */
async function writeReceipt(
  engine: MinimalEngine,
  details: ReceiptDetails,
  skipped: number,
  now: string,
  logger?: MinimalLogger,
): Promise<boolean> {
  const flag: DataMigrationFlag = {
    id: SEARCH_COMPANION_RECONCILE_MIGRATION_ID,
    last_run_at: now,
    applied_at: now,
    verified_at: null,
    blocking: 0,
    advisory: skipped,
    details: JSON.stringify(details),
  };
  const row: Record<string, unknown> = { ...flag, updated_at: now };
  try {
    const existing = await engine.findOne!(DATA_MIGRATION_FLAG_OBJECT, {
      where: { id: flag.id },
      context: LEDGER_CTX,
    });
    if (existing?.id === flag.id) {
      await engine.update(DATA_MIGRATION_FLAG_OBJECT, row, { context: LEDGER_CTX });
    } else {
      await engine.insert!(DATA_MIGRATION_FLAG_OBJECT, { ...row, created_at: now }, { context: LEDGER_CTX });
    }
    return true;
  } catch (err: any) {
    logger?.warn?.(
      `[pinyin-search] the companion reconcile finished but its receipt could not be written to ` +
        `${DATA_MIGRATION_FLAG_OBJECT} — the next boot walks every searchable object in full again`,
      { error: err?.message },
    );
    return false;
  }
}
