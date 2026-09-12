// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SeedSettlementSnapshot, SeedSuppressionReason } from '@objectstack/spec/contracts';
import { printServerReady, type ServerReadyOptions, type SeedSourceSummary } from './format.js';

/**
 * #17329 rider — the over-budget banner says seeding is still running, instead
 * of saying nothing at all.
 *
 * ## The omission this closes, measured
 *
 * `printSeedSummary` can only render sources that FINISHED: the `seed-summary`
 * service is written by `recordSeedOutcome`, which the seeder calls at the end
 * of a load. Past the inline seed budget the load has not finished when the
 * banner prints, so `seeds` is `undefined` and the row is ABSENT. Measured on a
 * showcase boot at `OS_INLINE_SEED_BUDGET_MS=1`, with a probe reading the
 * kernel at the instant the banner fired:
 *
 * ```text
 * [PROBE] seed-settlement at banner time: {"pending":1,"inFlight":1,"suppressed":[]}
 *   ✓ Server is ready
 *   …                              ← zero `Seeds:` rows
 *   Press Ctrl+C to stop
 * ```
 *
 * …which is byte-identical to a boot of an app that declares no seeds at all.
 * The row's absence was carrying a claim the boot then contradicted, and the
 * louder the seed went on to fail, the more complete the omission looked at the
 * moment it was read.
 *
 * ⛔ Human-facing only. It does NOT replace the `objectstack:seed-settled` ipc
 * message — a shell script cannot wait on prose, which is exactly why holding
 * the banner until seeding settles was refused as the repair.
 */
describe('printServerReady seed-settlement row (#17329)', () => {
  const base: ServerReadyOptions = {
    externalBaseOrigin: 'http://localhost:3000',
    configFile: 'objectstack.config.ts',
    isDev: true,
    pluginCount: 1,
  };
  let lines: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lines = [];
    // stderr, not stdout (#7915) — the whole banner is a diagnostic.
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
  });
  afterEach(() => spy.mockRestore());

  const seedLines = () => lines.filter((l) => l.includes('Seeds:'));
  const snap = (inFlight: number, suppressed: SeedSuppressionReason[] = []): SeedSettlementSnapshot => ({
    pending: inFlight + suppressed.length, inFlight, suppressed,
  });
  const s = (o: Partial<SeedSourceSummary> & { source: string }): SeedSourceSummary => ({
    inserted: 0, updated: 0, skipped: 0, rejected: 0, ...o,
  });

  it('⭐ the over-budget boot no longer prints a transcript with NO seed row', () => {
    // The exact reading above: a source in flight and no summary to render.
    printServerReady({ ...base, seeds: undefined, seedSettlement: snap(1) });

    expect(seedLines(), 'the banner is still silent about a seed that is still writing').toHaveLength(1);
    expect(seedLines()[0]).toContain('pending');
    expect(seedLines()[0]).toContain('1 source still writing');
    expect(
      lines.some((l) => l.includes('seeding continues in the background')),
      'nothing tells the reader more output is coming after `Press Ctrl+C to stop`',
    ).toBe(true);
  });

  it('⛔ ABLATION — the same boot WITHOUT the reading is the byte-identical transcript', () => {
    // The control that makes the leg above a measurement: drop the settlement
    // reading and the banner reverts to the defect — no seed row at all, and
    // therefore indistinguishable from an app that declares no seeds.
    printServerReady({ ...base, seeds: undefined, seedSettlement: undefined });
    expect(seedLines()).toHaveLength(0);
    expect(lines.some((l) => l.includes('seeding continues'))).toBe(false);
    // …and it really is the "declared no seeds" transcript, not an empty run.
    expect(lines.some((l) => l.includes('Press Ctrl+C to stop'))).toBe(true);
  });

  it('pluralises honestly when several sources are still writing', () => {
    printServerReady({ ...base, seedSettlement: snap(3) });
    expect(seedLines()[0]).toContain('3 sources still writing');
  });

  it('stays out of the way on the ordinary settled boot', () => {
    // The in-budget path: everything landed before the banner, the existing
    // `Seeds:` row says so, and this rider must add nothing.
    printServerReady({
      ...base,
      seeds: [s({ source: 'showcase', inserted: 132 })],
      seedSettlement: snap(0),
    });
    expect(seedLines()).toHaveLength(1);
    expect(seedLines()[0]).toContain('showcase 132 rows');
    expect(seedLines()[0]).not.toContain('pending');
    expect(lines.some((l) => l.includes('seeding continues'))).toBe(false);
  });

  it('reports BOTH when one source finished and another is still writing', () => {
    // ⛔ Not either/or. A bundle with two config apps can be half-done, and
    // printing only the finished half is the same omission in miniature.
    printServerReady({
      ...base,
      seeds: [s({ source: 'showcase', inserted: 132 })],
      seedSettlement: snap(1),
    });
    expect(seedLines()).toHaveLength(2);
    expect(seedLines()[0]).toContain('showcase 132 rows');
    expect(seedLines()[1]).toContain('pending');
  });

  describe('suppressed sources are named, never reported as pending', () => {
    it.each([
      ['multi-tenant-replay' as const],
      ['skip-seed-data' as const],
    ])('%s says nothing further is due', (reason) => {
      // ⛔ "still writing" would promise a completion that is never coming —
      // the same defect pointed the other way. These rows are written per org
      // later, or not at all.
      printServerReady({ ...base, seedSettlement: snap(0, [reason]) });
      expect(seedLines()).toHaveLength(1);
      expect(seedLines()[0]).toContain('not run this boot');
      expect(seedLines()[0]).toContain(reason);
      expect(seedLines()[0]).not.toContain('pending');
      expect(lines.some((l) => l.includes('seeding continues'))).toBe(false);
    });

    it('deduplicates a cause shared by several sources', () => {
      printServerReady({
        ...base,
        seedSettlement: snap(0, ['multi-tenant-replay', 'multi-tenant-replay']),
      });
      expect(seedLines()).toHaveLength(1);
      expect(seedLines()[0].match(/multi-tenant-replay/g) ?? []).toHaveLength(1);
    });

    it('and a boot that is BOTH suppressed and still writing says both', () => {
      printServerReady({ ...base, seedSettlement: snap(2, ['skip-seed-data']) });
      expect(seedLines()).toHaveLength(2);
      expect(seedLines()[0]).toContain('2 sources still writing');
      expect(seedLines()[1]).toContain('not run this boot (skip-seed-data)');
    });
  });
});
