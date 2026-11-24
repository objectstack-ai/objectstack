// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34283] The boot advisory for roll-up `count`/`sum` columns that hold
 * `NULL` on stored rows — the follow-up of #34096.
 *
 * ## The hole
 *
 * An install door in a running process materialises the roll-ups it adds on
 * the rows already stored (`summary-install-materialise.ts`). A roll-up that
 * arrives with a RESTART does not pass that door: a code-defined app's new
 * version that boots with the field, a marketplace install whose hot register
 * failed and loaded at the next boot, a ledger entry rehydrated at
 * `kernel:ready`. The plugin seals every roll-up served at `kernel:bootstrapped`
 * as already computed, so those rows keep reading `NULL` until one of their
 * children is written — and every filter, sort, GROUP BY and formula over the
 * column drops them. `os migrate summary-nulls` is the backfill that fills
 * them; nothing told the operator to run it.
 *
 * ## What counts as a hole
 *
 * A `count`/`sum` has an empty-set value (`0`), so a stored `NULL` there is
 * never a correct reading: it is a hole whatever the child rows say, and no
 * aggregate is needed to judge it. A `NULL` `min`/`max`/`avg` is the
 * legitimate reading of "no child rows" and is the column `os migrate
 * summary-nulls` leaves alone unless named, so it is not announced:
 * {@link summaryNullIsBackfillable} is the one predicate, the backfill's own.
 *
 * ## Bounded, read-only, once
 *
 * The same posture as {@link announceStoredExpressionHoles}: one read of at
 * most {@link ADVISORY_SAMPLE_SIZE} rows (`id` and the roll-up columns) per
 * object owning a `count`/`sum` roll-up, nothing for an object owning none, so
 * it never scans a large table at boot; a roll-up added to an object with rows
 * is `NULL` on every row, so the first page finds it. It writes nothing:
 * rewriting rows at boot fires hooks and audit rows nobody ordered, which is
 * why the backfill is a command. One `warn` per boot names every hole and the
 * exact command; an object it cannot read is skipped at `debug` and never
 * fails the boot.
 */

import { ADVISORY_SAMPLE_SIZE } from './stored-expression-backfill.js';
import { summaryNullIsBackfillable, type SummaryDescriptor } from './summary-aggregate.js';

/** The engine surface the advisory reads through — no write verb, so it cannot write. `ObjectQL` is one. */
export interface SummaryHoleEngine {
  getConfigs?(): Record<string, unknown>;
  getOwnedSummaryDescriptors(parentObject: string): SummaryDescriptor[];
  find(object: string, options: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
}

export interface SummaryHoleLogger {
  warn(msg: string, meta?: unknown): void;
  debug?(msg: string, meta?: unknown): void;
}

/** One object whose sample holds a `NULL` `count`/`sum`: the roll-up → how many sampled rows hold it. */
export interface SummaryHoleSample {
  object: string;
  fields: Record<string, { fn: SummaryDescriptor['fn']; nullRows: number }>;
  sampled: number;
}

/** Unscoped by design, the context `os migrate summary-nulls` reads with: every organization's rows. */
const SYSTEM_CTX = { isSystem: true } as const;

/** The `count`/`sum` roll-ups `object` owns; an index that cannot be read contributes none. */
function backfillableRollups(engine: SummaryHoleEngine, object: string): SummaryDescriptor[] {
  try {
    return (engine.getOwnedSummaryDescriptors(object) ?? []).filter((d) => summaryNullIsBackfillable(d.fn));
  } catch {
    return [];
  }
}

/**
 * Read the first {@link ADVISORY_SAMPLE_SIZE} rows of each object owning a
 * `count`/`sum` roll-up and report the roll-ups that hold `NULL` there.
 * Writes nothing; an object it cannot read is handed to `onSkip`.
 */
export async function sampleSummaryHoles(
  engine: SummaryHoleEngine,
  onSkip?: (object: string, error: unknown) => void,
): Promise<{ samples: SummaryHoleSample[]; objectsRead: number; rowsRead: number }> {
  const samples: SummaryHoleSample[] = [];
  let objectsRead = 0;
  let rowsRead = 0;
  const objects = typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : [];
  for (const object of objects) {
    const rollups = backfillableRollups(engine, object);
    if (rollups.length === 0) continue;
    try {
      objectsRead++;
      const rows = await engine.find(object, {
        fields: ['id', ...rollups.map((d) => d.summaryField)],
        orderBy: [{ field: 'id', order: 'asc' }],
        limit: ADVISORY_SAMPLE_SIZE,
        context: { ...SYSTEM_CTX },
      });
      rowsRead += rows.length;
      const fields: SummaryHoleSample['fields'] = {};
      for (const row of rows) {
        for (const d of rollups) {
          // `null`, and the `undefined` a document driver returns for an absent
          // column: the backfill's own reading of a hole. A number — 0 included —
          // is a computed value and is never announced.
          if (row[d.summaryField] != null) continue;
          const entry = (fields[d.summaryField] ??= { fn: d.fn, nullRows: 0 });
          entry.nullRows++;
        }
      }
      if (Object.keys(fields).length > 0) samples.push({ object, fields, sampled: rows.length });
    } catch (err) {
      onSkip?.(object, err);
    }
  }
  return { samples, objectsRead, rowsRead };
}

/**
 * Warn once when a `count`/`sum` roll-up holds `NULL` on stored rows, naming
 * each and the `os migrate summary-nulls` line that fills them. An advisory:
 * it never fails a boot and writes nothing.
 */
export async function announceSummaryHoles(
  engine: SummaryHoleEngine,
  logger: SummaryHoleLogger,
): Promise<SummaryHoleSample[]> {
  const started = Date.now();
  let samples: SummaryHoleSample[];
  try {
    const read = await sampleSummaryHoles(engine, (object, err) => {
      logger.debug?.('[summary-holes] boot sample skipped', { object, error: (err as Error)?.message ?? String(err) });
    });
    samples = read.samples;
    logger.debug?.('[summary-holes] boot sample', {
      objectsRead: read.objectsRead,
      rowsRead: read.rowsRead,
      ms: Date.now() - started,
    });
  } catch (err) {
    // An advisory must never be the reason a boot fails.
    logger.debug?.('[summary-holes] boot sample failed', { error: (err as Error)?.message ?? String(err) });
    return [];
  }
  if (samples.length === 0) return samples;
  const named = samples
    .flatMap((s) => Object.entries(s.fields).map(
      ([field, { fn, nullRows }]) => `${s.object}.${field} (${fn}, ${nullRows} of the first ${s.sampled} rows)`,
    ))
    .join(', ');
  const scope = samples.map((s) => `--object ${s.object}`).join(' ');
  logger.warn(
    `[summary-holes] roll-up summary field(s) hold NULL on stored rows: ${named}. A count or sum is never NULL once `
      + 'computed (it reads 0 over no child rows), so nothing has computed these rows since the roll-up was added: '
      + 'every filter, sort, grouping and formula over these columns drops them, and they stay NULL '
      + `until one of their child rows is written. Run \`os migrate summary-nulls ${scope}\` (dry run) to see every such `
      + `row, then \`os migrate summary-nulls --apply ${scope}\` to fill them.`,
  );
  return samples;
}
