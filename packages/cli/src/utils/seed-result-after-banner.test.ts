// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedSettlementSnapshot } from '@objectstack/spec/contracts';
// The repo's ONE code/prose separator: the wiring pin below asks what the CODE
// of `os serve` composes, and a comment saying it does is not an answer.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';
import { createSeedResultAfterBanner } from './seed-result-after-banner.js';
import type { SeedSourceSummary } from './format.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = maskComments(readFileSync(resolve(HERE, '../commands/serve.ts'), 'utf8'));

const snap = (inFlight: number): SeedSettlementSnapshot => ({ pending: inFlight, inFlight, suppressed: [] });
const s = (o: Partial<SeedSourceSummary> & { source: string }): SeedSourceSummary => ({
  inserted: 0, updated: 0, skipped: 0, rejected: 0, ...o,
});

describe('#33233 the seed result prints after the banner, when the banner promised it', () => {
  const harness = () => {
    const printed: (readonly SeedSourceSummary[])[] = [];
    const seedResult = createSeedResultAfterBanner((sources) => { printed.push(sources); });
    return { printed, seedResult };
  };

  it('over budget: the banner said pending, so the settle prints the result — once', () => {
    const { printed, seedResult } = harness();
    const atBanner = snap(1);
    expect(seedResult.noteBanner(atBanner)).toBe(atBanner);
    expect(printed, 'printed before the seed settled').toEqual([]);

    seedResult.settled([s({ source: 'crm', inserted: 42 })]);
    seedResult.settled([s({ source: 'crm', inserted: 42 })]);
    expect(printed).toEqual([[s({ source: 'crm', inserted: 42 })]]);
  });

  it('in budget: the banner already carries the Seeds row, so nothing prints after it', () => {
    const { printed, seedResult } = harness();
    seedResult.noteBanner(snap(0));
    seedResult.settled([s({ source: 'crm', inserted: 42 })]);
    expect(printed).toEqual([]);
  });

  it('no seed pipeline: no promise, no print', () => {
    const { printed, seedResult } = harness();
    expect(seedResult.noteBanner(undefined)).toBeUndefined();
    seedResult.settled([]);
    expect(printed).toEqual([]);
  });

  it('a print that throws is swallowed — it must not cost the ipc message beside it, or the server', () => {
    const seedResult = createSeedResultAfterBanner(() => { throw new Error('stderr closed'); });
    seedResult.noteBanner(snap(1));
    expect(() => seedResult.settled([])).not.toThrow();
  });

  it('`os serve` composes it: the banner notes its snapshot, and the one settle message also reports the result', () => {
    // The helper is only the fix if the command wires it; one nobody calls
    // keeps every case above green and the banner's promise broken.
    expect(SERVE).toMatch(/createSeedResultAfterBanner\(printSeedResultAfterBanner\)/);
    expect(SERVE).toMatch(/seedSettlement: seedResult\.noteBanner\(readSeedSettlement\(kernel\)\)/);
    expect(SERVE).toMatch(/announceSettled: \(message\) => \{\s*seedResult\.settled\(message\.sources\);\s*settlementChannels\.announceSettled\(message\);/);
    expect(SERVE).toMatch(/createSeedSettlementAnnouncer\(\{\s*\.\.\.settlementChannels,/);
  });
});
