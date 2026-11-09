// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30377] Recompute, on enable, the roll-up `summary` columns a package
 * contributes BY EXTENSION.
 *
 * ## The hole
 *
 * A disabled package's `objectExtensions` fields are withheld from the served
 * object fold (#30304), and the roll-up index is built from that fold
 * (`ObjectQL.buildSummaryIndex`). So while the package is disabled its summary
 * is not in the index, and a write of the summary's CHILD recomputes nothing.
 * When the child belongs to an ENABLED package those writes land, and the
 * stored summary column keeps the value it had at the disable. Re-enabling
 * serves the field again, stale, until the next write of a child names the
 * parent, which for most parents is never.
 *
 * ## Why a recompute on enable, and not an index over the storage fold
 *
 * The recompute writes the parent through `ObjectQL.update`, whose field map is
 * the SERVED fold: a withheld column is refused there as a field the object
 * does not have (`INVALID_FIELD`), on purpose (#30304). An index built from the
 * storage fold would turn every such child write into a `SummaryRecomputeError`
 * on a write that had committed, unless the write path learned a second,
 * storage-level door for one kind of column. The column is not served while
 * its package is disabled, so nothing can read it stale before the enable;
 * recomputing it at the enable makes it current at the first moment it is
 * served, through the one write path and the one aggregate
 * ({@link aggregateSummaryValue}) the engine already uses.
 *
 * Only the summaries the package adds by extension are walked. A summary on an
 * object the package OWNS stays in the index while it is disabled (its objects
 * are refused on the data plane, not withheld from the fold), so it kept
 * tracking its children and needs nothing here.
 *
 * ## What a walk writes
 *
 * Every parent row is read (`id` + the package's roll-up columns, keyset
 * order), each roll-up is recomputed, and a row is updated only where a value
 * differs, so an enable over unchanged children writes nothing. One failed row
 * does not stop the walk: it is recorded, and the walk ends by logging every
 * failure at `error` (a summary left stale while every write reports success is
 * the durability class).
 */

import { keysetWalk, type KeysetPageQuery } from '@objectstack/types';
import { withTransientRetry, type RetryOptions } from '@objectstack/core';

import { aggregateSummaryValue, type SummaryDescriptor } from './summary-aggregate.js';

/** The engine surface a refresh reads and writes through. `ObjectQL` is one. */
export interface SummaryEnableRefreshEngine {
  readonly registry: {
    getObjectExtensionsOf(packageId: string): Array<{ extend: string } & Record<string, unknown>>;
    getObject(name: string): { name?: string } | undefined;
  };
  getOwnedSummaryDescriptors(parentObject: string): SummaryDescriptor[];
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  aggregate(object: string, query: any, options?: any): Promise<any[]>;
  update(object: string, data: Record<string, unknown>, options?: any): Promise<any>;
  summaryRetryOptions?: RetryOptions;
}

export interface SummaryEnableRefreshLogger {
  warn(msg: string, meta?: unknown): void;
  error?(msg: string, meta?: unknown): void;
}

/** One roll-up column a refresh walked. */
export interface SummaryEnableRefreshField {
  object: string;
  field: string;
  /** Parent rows whose stored value differed and was rewritten. */
  rewritten: number;
}

/** One parent row (or one whole object, `recordId` absent) a refresh could not bring current. */
export interface SummaryEnableRefreshFailure {
  object: string;
  recordId?: string;
  error: string;
}

export interface SummaryEnableRefreshReport {
  packageId: string;
  /** Parent rows read, over every object walked. */
  scannedRecords: number;
  fields: SummaryEnableRefreshField[];
  failures: SummaryEnableRefreshFailure[];
}

const SYSTEM_CTX = { isSystem: true } as const;
const SCAN_PAGE_SIZE = 500;

/**
 * The roll-up descriptors `packageId` contributes by extension, grouped by
 * the parent object that owns them, as the engine's own index holds them.
 */
export function summaryDescriptorsExtendedBy(
  engine: SummaryEnableRefreshEngine,
  packageId: string,
): Map<string, SummaryDescriptor[]> {
  const byParent = new Map<string, SummaryDescriptor[]>();
  for (const extension of engine.registry.getObjectExtensionsOf(packageId)) {
    const fields = extension.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    const summaries = new Set(
      Object.entries(fields as Record<string, unknown>)
        .filter(([, def]) => (def as { type?: unknown } | null)?.type === 'summary')
        .map(([name]) => name),
    );
    if (summaries.size === 0) continue;
    const parent = engine.registry.getObject(extension.extend)?.name ?? extension.extend;
    const owned = engine.getOwnedSummaryDescriptors(parent).filter((d) => summaries.has(d.summaryField));
    if (owned.length > 0) byParent.set(parent, [...(byParent.get(parent) ?? []), ...owned]);
  }
  return byParent;
}

/** A stored roll-up value equals a recomputed one (a driver may hand a number back as a numeric string). */
function sameSummaryValue(stored: unknown, computed: unknown): boolean {
  if (stored === computed) return true;
  if (stored == null || computed == null) return stored == null && computed == null;
  const a = Number(stored);
  return !Number.isNaN(a) && a === Number(computed);
}

/** Recompute every parent row of the roll-ups `packageId` contributes by extension; see the module comment. */
export async function refreshSummariesExtendedBy(
  engine: SummaryEnableRefreshEngine,
  logger: SummaryEnableRefreshLogger,
  packageId: string,
): Promise<SummaryEnableRefreshReport> {
  const report: SummaryEnableRefreshReport = { packageId, scannedRecords: 0, fields: [], failures: [] };
  for (const [object, descriptors] of summaryDescriptorsExtendedBy(engine, packageId)) {
    const outcomes = descriptors.map((d) => ({ object, field: d.summaryField, rewritten: 0 }));
    report.fields.push(...outcomes);
    const walk = keysetWalk<Record<string, unknown>>(
      (q: KeysetPageQuery) => engine.find(object, {
        ...q,
        fields: ['id', ...descriptors.map((d) => d.summaryField)],
        context: { ...SYSTEM_CTX },
      }),
      { pageSize: SCAN_PAGE_SIZE },
    );
    try {
      for await (const page of walk.pages()) {
        for (const row of page) {
          report.scannedRecords++;
          const id = row.id;
          if (id == null || id === '') continue;
          try {
            let patch: Record<string, unknown> = {};
            await withTransientRetry(async () => {
              patch = {};
              for (const desc of descriptors) {
                const value = await aggregateSummaryValue(engine, desc, String(id), { ...SYSTEM_CTX });
                if (!sameSummaryValue(row[desc.summaryField], value)) patch[desc.summaryField] = value;
              }
              if (Object.keys(patch).length === 0) return;
              await engine.update(object, { id, ...patch }, { context: { ...SYSTEM_CTX } });
            }, engine.summaryRetryOptions ?? {});
            for (const outcome of outcomes) if (outcome.field in patch) outcome.rewritten++;
          } catch (err) {
            report.failures.push({ object, recordId: String(id), error: (err as Error)?.message ?? String(err) });
          }
        }
      }
    } catch (err) {
      report.failures.push({ object, error: (err as Error)?.message ?? String(err) });
    }
  }
  if (report.failures.length > 0) {
    const msg =
      `[summary-refresh] package "${packageId}" was enabled, but ${report.failures.length} roll-up recompute(s) of the `
      + `summaries it adds by extension failed (${report.failures.slice(0, 5).map((f) => f.recordId ? `${f.object}/${f.recordId}` : f.object).join(', ')}`
      + `${report.failures.length > 5 ? ', …' : ''}). CONSEQUENCE: those parents serve the value their summary held when the `
      + `package was disabled, until the next write of one of their children. FIX: re-run the recompute `
      + `(ObjectQL.refreshSummariesEnabledBy("${packageId}")) once the cause below is cleared: ${report.failures[0].error}`;
    // Sanctioned logger shape (PR #9750): reach for `error`, fall back to `warn`.
    if (typeof logger.error === 'function') logger.error(msg, { packageId, failures: report.failures });
    else logger.warn(msg, { packageId, failures: report.failures });
  }
  return report;
}

/** The refreshes an engine's enables started and that have not settled. */
const pendingRefreshes = new WeakMap<object, Set<Promise<unknown>>>();

/**
 * The `onPackageEnabled` listener: start {@link refreshSummariesExtendedBy}
 * and keep it until it settles, so a door can wait for it
 * ({@link summaryRefreshesSettled}). Never throws and never rejects: an
 * unexpected failure is logged at `error`.
 */
export function startSummaryRefreshOnEnable(
  engine: SummaryEnableRefreshEngine,
  logger: SummaryEnableRefreshLogger,
  packageId: string,
): void {
  let pending = pendingRefreshes.get(engine);
  if (!pending) { pending = new Set(); pendingRefreshes.set(engine, pending); }
  const run: Promise<unknown> = refreshSummariesExtendedBy(engine, logger, packageId)
    .catch((err) => {
      const msg = `[summary-refresh] package "${packageId}" was enabled, but the recompute of the summaries it adds by `
        + `extension could not run (${(err as Error)?.message ?? err}); they serve the value they held at the disable.`;
      if (typeof logger.error === 'function') logger.error(msg);
      else logger.warn(msg);
    })
    .finally(() => { pending!.delete(run); });
  pending.add(run);
}

/** Resolves once every refresh {@link startSummaryRefreshOnEnable} started on `engine` has settled. */
export async function summaryRefreshesSettled(engine: object): Promise<void> {
  const pending = pendingRefreshes.get(engine);
  while (pending && pending.size > 0) await Promise.all([...pending]);
}
