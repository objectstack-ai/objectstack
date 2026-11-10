// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #32141 — the boot's seed, judged: each state the two kernel records can be
 * in, and what it adds to the run's verdict.
 *
 * The records are written here by their real producers (`declareSeedSource`
 * and `recordSeedOutcome` from `@objectstack/runtime`) on a minimal service
 * registry, so the reader is held to the shapes the seeder actually writes. The
 * boot-level halves are pinned through the CLI: a fixture whose seed drops a
 * record (`packages/cli/test/verify-seed-outcome.test.ts`) and the showcase
 * (`packages/qa/dogfood/test/showcase-verify-seed.dogfood.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { declareSeedSource, recordSeedOutcome, type SeedSourceOutcome } from '@objectstack/runtime';
import { formatSeedReport, judgeSeedOutcome, readSeedOutcome } from './seed-outcome.js';

/** The service registry surface the producers and the reader use, and nothing else. */
function serviceRegistry() {
  const services = new Map<string, unknown>();
  return {
    registerService(name: string, value: unknown) {
      if (services.has(name)) throw new Error(`duplicate service ${name}`);
      services.set(name, value);
    },
    getService(name: string) {
      if (!services.has(name)) throw new Error(`no service ${name}`);
      return services.get(name);
    },
  };
}

const outcome = (over: Partial<SeedSourceOutcome> = {}): SeedSourceOutcome => ({
  source: 'com.example.app',
  inserted: 5,
  updated: 0,
  skipped: 0,
  rejected: 0,
  ...over,
});

describe('judgeSeedOutcome — what each seed state adds to the verdict', () => {
  it('a clean load adds nothing and reports what landed', () => {
    const report = judgeSeedOutcome({ pending: 0, inFlight: 0, suppressed: [] }, [outcome({ inserted: 138 })]);
    expect(report.status).toBe('loaded');
    expect(report.totals).toEqual({ inserted: 138, updated: 0, skipped: 0, rejected: 0, droppedRefs: 0 });
    expect(report.hardFailures).toBe(0);
    expect(formatSeedReport(report)).toContain('✓ seed: 138 records landed');
  });

  it('every rejected record counts, and the text names the number', () => {
    const report = judgeSeedOutcome({ pending: 0, inFlight: 0, suppressed: [] }, [outcome({ inserted: 112, rejected: 26 })]);
    expect(report.status).toBe('loaded');
    expect(report.hardFailures).toBe(26);
    expect(formatSeedReport(report)).toContain('✗ seed: 26 records DROPPED');
  });

  it('a reference field dropped from a written record counts, as `os serve` reads it unclean', () => {
    const report = judgeSeedOutcome({ pending: 0, inFlight: 0, suppressed: [] }, [outcome({ droppedRefs: 3 })]);
    expect(report.hardFailures).toBe(3);
    expect(formatSeedReport(report)).toContain('3 reference fields dropped from written records');
  });

  it('a marketplace install that came up empty counts once', () => {
    const report = judgeSeedOutcome(undefined, [
      outcome(),
      outcome({ source: 'pkg.one', marketplace: true, inserted: 0, emptyInstall: true }),
    ]);
    expect(report.hardFailures).toBe(1);
    expect(formatSeedReport(report)).toContain('installed with no rows: pkg.one');
  });

  it('a seed still writing counts once: the run cannot say whether its rows landed', () => {
    const report = judgeSeedOutcome({ pending: 1, inFlight: 1, suppressed: [] }, undefined);
    expect(report.status).toBe('unsettled');
    expect(report.hardFailures).toBe(1);
  });

  it('a seed that settled without an outcome counts once', () => {
    const report = judgeSeedOutcome({ pending: 0, inFlight: 0, suppressed: [] }, []);
    expect(report.status).toBe('unreported');
    expect(report.hardFailures).toBe(1);
  });

  it('a suppressed seed adds nothing and says it was not judged', () => {
    const report = judgeSeedOutcome({ pending: 1, inFlight: 0, suppressed: ['multi-tenant-replay'] }, undefined);
    expect(report.status).toBe('suppressed');
    expect(report.hardFailures).toBe(0);
    expect(formatSeedReport(report)).toContain('not run at boot (multi-tenant-replay)');
  });

  it('an app with no seed adds nothing', () => {
    const report = judgeSeedOutcome(undefined, undefined);
    expect(report.status).toBe('none');
    expect(report.hardFailures).toBe(0);
  });
});

describe('readSeedOutcome — reads the records the real producers write', () => {
  it('waits for a seed still writing, then judges what it recorded', async () => {
    const kernel = serviceRegistry();
    const source = declareSeedSource(kernel);
    setTimeout(() => {
      // AppPlugin's order: the outcome first, then the settle.
      recordSeedOutcome(kernel, outcome({ inserted: 7, rejected: 2 }));
      source.settle();
    }, 30);
    const report = await readSeedOutcome({ kernel }, { pollMs: 5 });
    expect(report.status).toBe('loaded');
    expect(report.totals.rejected).toBe(2);
    expect(report.hardFailures).toBe(2);
  });

  it('judges a seed still writing when the wait ends as unsettled', async () => {
    const kernel = serviceRegistry();
    declareSeedSource(kernel);
    const report = await readSeedOutcome({ kernel }, { settleTimeoutMs: 20, pollMs: 5 });
    expect(report.status).toBe('unsettled');
    expect(report.inFlight).toBe(1);
    expect(report.hardFailures).toBe(1);
  });

  it('does not wait on a suppressed source', async () => {
    const kernel = serviceRegistry();
    declareSeedSource(kernel).suppress('multi-tenant-replay');
    const started = Date.now();
    const report = await readSeedOutcome({ kernel }, { settleTimeoutMs: 5_000 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(report.status).toBe('suppressed');
  });

  it('reads a kernel with no seed pipeline as no seed', async () => {
    const report = await readSeedOutcome({ kernel: serviceRegistry() });
    expect(report.status).toBe('none');
  });
});
