// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The boot's seed, judged (#32141).
 *
 * Every phase of `os verify` runs against the stack its boot left behind, and
 * that stack holds the rows the app's seed landed. A seed that DROPS rows
 * leaves the run proving less than it reads: on the showcase 26 rows were
 * refused at boot, CRUD skipped the eight objects that needed them, and the run
 * still printed `✓ verify passed`. Route & surface ownership §3 names exactly
 * that: a verifier that silently degrades reports success it never
 * established. So the seed is judged, and a drop is counted in the run's
 * verdict like every other runtime failure.
 *
 * ## What is read — the kernel's own two records, never the log
 *
 *  - `seed-summary`: one outcome per seed source, written by
 *    `recordSeedOutcome` (`@objectstack/runtime`) when the source's load
 *    finishes. The counts the `os serve` ready banner's `Seeds:` row renders.
 *  - `seed-settlement` (`readSeedSettlement`): how many sources are still
 *    writing, and which ones this boot suppressed on purpose.
 *
 * ## The verdict
 *
 * A source is clean exactly when `os serve`'s `objectstack:seed-settled`
 * message calls it clean (`composeSeedSettledMessage`): no rejected record, no
 * reference field dropped from a written row, no install that came up empty.
 * Each rejected record and each dropped reference counts as one failure, so the
 * number the run fails with is the number the seed loader's own `[Seeder]`
 * warning reports dropped (see {@link SeedSourceReport.rejected}). Two states count one
 * failure each, because the run cannot say whether the app's rows landed: a
 * seed still writing when the wait ends, and a seed that settled without
 * reporting an outcome (`AppPlugin`'s basic-insert fallback, taken when the
 * loader throws, records none).
 *
 * Two states count nothing, and the report says why: an app that declares no
 * seed (`none`), and a boot that deliberately ran no inline seed (`suppressed`
 * — a multi-tenant boot replays the rows per organization instead; this run
 * does not judge that replay, and the report says so rather than reading as a
 * clean seed).
 */

import { readSeedSettlement, type SeedSourceOutcome } from '@objectstack/runtime';
import type { SeedSettlementSnapshot } from '@objectstack/spec/contracts';

/**
 * What the boot's seed did.
 *
 *  - `loaded` — at least one source finished and reported its counts.
 *  - `none` — no seed pipeline registered: the app declares no seed.
 *  - `suppressed` — every source this boot knows of was deliberately not run
 *    inline (see {@link SeedReport.suppressed}); nothing reported counts.
 *  - `unsettled` — a source was still writing when the wait ended.
 *  - `unreported` — every source settled, none was suppressed, and none
 *    reported an outcome.
 */
export type SeedStatus = 'loaded' | 'none' | 'suppressed' | 'unsettled' | 'unreported';

/** One seed source's counts, as `recordSeedOutcome` recorded them. */
export interface SeedSourceReport {
  /** The config app id or marketplace manifest id that seeded. */
  source: string;
  /** True for a marketplace package, false for a config-declared app. */
  marketplace: boolean;
  inserted: number;
  updated: number;
  /** Rows already present (the load left them as they were). */
  skipped: number;
  /**
   * The seed loader's errored count (`summary.totalErrored`), the number its
   * own `[Seeder] … dropped record(s)` warning names: every record the engine
   * refused, plus every deferred reference the second pass could not resolve.
   * A refused record whose deferred reference also failed counts twice, so
   * this can exceed the rows actually missing (the showcase without its home
   * currency: 26 here, 19 of 138 records absent).
   */
  rejected: number;
  /** Reference fields dropped from rows that WERE written. */
  droppedRefs: number;
  /** A marketplace install whose seeded objects all came up empty. */
  emptyInstall: boolean;
}

/** The boot's seed, judged. Part of `os verify --json` as `seed`. */
export interface SeedReport {
  status: SeedStatus;
  /** One reason per source this boot deliberately did not run inline (`multi-tenant-replay`, `skip-seed-data`). */
  suppressed: string[];
  /** Sources still writing when the wait ended (non-zero only when `status` is `unsettled`). */
  inFlight: number;
  sources: SeedSourceReport[];
  totals: { inserted: number; updated: number; skipped: number; rejected: number; droppedRefs: number };
  /**
   * What this seed adds to the run's `hardFailures`: every rejected record,
   * every dropped reference, every empty install, plus one for an `unsettled`
   * or `unreported` seed.
   */
  hardFailures: number;
}

/** How long {@link readSeedOutcome} waits, by default, for a seed still writing to settle. */
export const DEFAULT_SEED_SETTLE_TIMEOUT_MS = 120_000;

/** The `seed-summary` service's slot — `recordSeedOutcome`'s, in `@objectstack/runtime`. */
const SEED_SUMMARY_SERVICE = 'seed-summary';

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/**
 * Judge a seed from the two records the kernel keeps. Pure: the waiting and the
 * reading are {@link readSeedOutcome}'s.
 *
 * @param settlement the `seed-settlement` tally, `undefined` when no seed pipeline registered
 * @param outcomes   the `seed-summary` list, `undefined` or empty when no source reported
 */
export function judgeSeedOutcome(
  settlement: SeedSettlementSnapshot | undefined,
  outcomes: readonly SeedSourceOutcome[] | undefined,
): SeedReport {
  const sources: SeedSourceReport[] = (outcomes ?? []).map((o) => ({
    source: String(o.source),
    marketplace: Boolean(o.marketplace),
    inserted: count(o.inserted),
    updated: count(o.updated),
    skipped: count(o.skipped),
    rejected: count(o.rejected),
    droppedRefs: count(o.droppedRefs),
    emptyInstall: Boolean(o.emptyInstall),
  }));
  const totals = { inserted: 0, updated: 0, skipped: 0, rejected: 0, droppedRefs: 0 };
  for (const s of sources) {
    totals.inserted += s.inserted;
    totals.updated += s.updated;
    totals.skipped += s.skipped;
    totals.rejected += s.rejected;
    totals.droppedRefs += s.droppedRefs;
  }
  const inFlight = settlement?.inFlight ?? 0;
  const suppressed = [...(settlement?.suppressed ?? [])];

  let status: SeedStatus;
  if (inFlight > 0) status = 'unsettled';
  else if (sources.length > 0) status = 'loaded';
  else if (settlement === undefined) status = 'none';
  else if (suppressed.length > 0) status = 'suppressed';
  else status = 'unreported';

  const hardFailures =
    totals.rejected +
    totals.droppedRefs +
    sources.filter((s) => s.emptyInstall).length +
    (status === 'unsettled' || status === 'unreported' ? 1 : 0);

  return { status, suppressed, inFlight, sources, totals, hardFailures };
}

/** The kernel surface {@link readSeedOutcome} reads. `VerifyStack.kernel` is one. */
interface SeedRecordsHost {
  getService?: (name: string) => unknown;
}

function readSeedSummary(kernel: SeedRecordsHost): SeedSourceOutcome[] | undefined {
  try {
    const list = kernel.getService?.(SEED_SUMMARY_SERVICE);
    return Array.isArray(list) ? (list as SeedSourceOutcome[]) : undefined;
  } catch {
    // `getService` throws on an unregistered name: no source reported.
    return undefined;
  }
}

/**
 * Read the booted stack's seed, waiting first for any source still writing.
 *
 * `AppPlugin` races its inline seed against `OS_INLINE_SEED_BUDGET_MS` and
 * lets the kernel boot on past it, so on a slow host the seed can still be
 * writing when `bootStack` returns. Its outcome is recorded only when it
 * finishes, so a read taken then would find nothing and judge a seed that has
 * not happened yet. The settlement tally is re-read until nothing is in flight
 * or `settleTimeoutMs` passes; a seed still writing then is judged `unsettled`.
 * Nothing waits on a seed that is not running: a suppressed source is not in
 * flight, and a boot with no seed has no tally.
 */
export async function readSeedOutcome(
  stack: { kernel: SeedRecordsHost },
  opts: { settleTimeoutMs?: number; pollMs?: number } = {},
): Promise<SeedReport> {
  const deadline = Date.now() + (opts.settleTimeoutMs ?? DEFAULT_SEED_SETTLE_TIMEOUT_MS);
  const pollMs = opts.pollMs ?? 50;
  let settlement = readSeedSettlement(stack.kernel);
  while (settlement && settlement.inFlight > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    settlement = readSeedSettlement(stack.kernel);
  }
  return judgeSeedOutcome(settlement, readSeedSummary(stack.kernel));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One source's (or the whole seed's) counts, as a phrase. */
function countsPhrase(c: { inserted: number; updated: number; skipped: number }): string {
  return `${c.inserted} inserted, ${c.updated} updated, ${c.skipped} already present`;
}

/** Render a {@link SeedReport} as the lines `os verify` prints under its CRUD block. */
export function formatSeedReport(report: SeedReport): string {
  const t = report.totals;
  const landed = t.inserted + t.updated + t.skipped;
  const lines: string[] = [];
  switch (report.status) {
    case 'none':
      lines.push('  – seed: the app declares none');
      break;
    case 'suppressed':
      lines.push(
        `  – seed: not run at boot (${[...new Set(report.suppressed)].join(', ')}) — ` +
          'this run does not judge the rows it describes',
      );
      break;
    case 'unsettled':
      lines.push(
        `  ✗ seed: ${plural(report.inFlight, 'source')} still writing when the wait ended — ` +
          "this run cannot say whether the app's seed rows landed",
      );
      break;
    case 'unreported':
      lines.push(
        '  ✗ seed: it ran and reported no outcome (the loader fell back to plain inserts) — ' +
          "this run cannot say whether the app's seed rows landed",
      );
      break;
    case 'loaded':
      break;
  }
  if (report.sources.length > 0) {
    const lost = t.rejected > 0 || t.droppedRefs > 0 || report.sources.some((s) => s.emptyInstall);
    if (!lost) {
      lines.push(`  ✓ seed: ${plural(landed, 'record')} landed (${countsPhrase(t)})`);
    } else {
      const parts: string[] = [];
      if (t.rejected > 0) parts.push(`${plural(t.rejected, 'record')} DROPPED`);
      if (t.droppedRefs > 0) parts.push(`${plural(t.droppedRefs, 'reference field')} dropped from written records`);
      const empty = report.sources.filter((s) => s.emptyInstall).map((s) => s.source);
      if (empty.length > 0) parts.push(`installed with no rows: ${empty.join(', ')}`);
      lines.push(
        `  ✗ seed: ${parts.join(', ')}; ${plural(landed, 'record')} landed — ` +
          "the boot did not load the seed the app declares (each loss is a [Seeder] warning in this run's log)",
      );
    }
    if (report.sources.length > 1) {
      for (const s of report.sources) {
        const label = s.marketplace ? `${s.source} (marketplace)` : s.source;
        const losses = [
          s.rejected > 0 ? `${s.rejected} dropped` : '',
          s.droppedRefs > 0 ? `${s.droppedRefs} reference field(s) dropped` : '',
          s.emptyInstall ? 'no rows' : '',
        ].filter(Boolean);
        lines.push(`      ${label}: ${countsPhrase(s)}${losses.length > 0 ? `; ${losses.join(', ')}` : ''}`);
      }
    }
  }
  return lines.join('\n');
}
