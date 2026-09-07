// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// hotcrm#1579 step 5a — ONE hotcrm exemplar, ported onto the handle.
//
// hotcrm's `test/hooks-runtime-sales.test.ts` (`describe('opportunity_lifecycle')`)
// drives the hook body through a hand-written `ctx.api` over arrays
// (`test/helpers/hook-harness.ts`, 618 lines): `hook.handler(makeCtx({ event,
// input, previous, user }))`, then asserts on the mutated `input`. Every
// assertion below is that block's assertion; what changed is the instrument.
// Each case is one real write through the booted engine as a real member —
// the L2 body runs in the QuickJS runner the runtime bound at boot, `ctx.input`
// is the engine's flat-input proxy, `ctx.previous` is the pre-image the engine
// loaded, and the permission check the stand-in never had runs first.
//
// The fixture (`./handle.fixture.ts`) carries the derivation half of
// hotcrm's hook as the L2 body hotcrm ships. The `previous`-driven cases that
// used to be constructed by hand (`makeCtx({ previous })`) are now a seeded
// row plus an `update` — the engine supplies the pre-image.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { bootStack, type VerifyStack } from './harness.js';
import { handleFixtureStack, STAGES, STAGE_PROBABILITY, STAGE_FORECAST, today } from './handle.fixture.js';

const BOOT_TIMEOUT = 120_000;

let stack: VerifyStack;
let user: string; // hotcrm's `USER = { id: 'user_1' }` — an authenticated human edit

beforeAll(async () => {
  stack = await bootStack(handleFixtureStack);
  await stack.signIn();
  user = await stack.signUp('sales-rep@verify.test');
}, BOOT_TIMEOUT);

afterAll(async () => {
  await stack?.stop().catch(() => undefined);
});

const uniq = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

describe('opportunity_lifecycle (ported: hotcrm test/hooks-runtime-sales.test.ts)', () => {
  it('derives probability, expected_revenue and forecast_category from stage on insert', async () => {
    const input = await stack.hooks.run(
      'hnd_deal',
      'insert',
      { name: uniq('Deal'), amount: 10_000, stage: 'proposal' },
      { as: user },
    );
    expect(input.probability).toBe(60);
    expect(input.expected_revenue).toBe(6_000);
    expect(input.forecast_category).toBe('commit');
  });

  it.each(
    STAGES.map((stage) => [stage, STAGE_PROBABILITY[stage], STAGE_FORECAST[stage]] as const),
  )('stage %s ⇒ probability %i, forecast %s', async (stage, probability, forecast) => {
    const input = await stack.hooks.run(
      'hnd_deal',
      'insert',
      { name: uniq('Deal'), amount: 1_000, stage },
      { as: user },
    );
    expect(input.probability).toBe(probability);
    expect(input.expected_revenue).toBe((1_000 * probability) / 100);
    expect(input.forecast_category).toBe(forecast);
  });

  it('recomputes expected_revenue when only the amount changes', async () => {
    // hotcrm: previous = { stage: 'proposal', amount: 10_000, probability: 60 }
    const previous = await stack.hooks.run(
      'hnd_deal',
      'insert',
      { name: uniq('Deal'), amount: 10_000, stage: 'proposal' },
      { as: user },
    );
    await stack.hooks.run('hnd_deal', 'update', { id: previous.id, amount: 50_000 }, { as: user });
    const [input] = await stack.rows('hnd_deal', { id: previous.id });
    expect(input.expected_revenue).toBe(30_000); // 50k × 60%
  });

  it('stamps probability and expected_revenue on the closed_won transition', async () => {
    // hotcrm: previous = { stage: 'negotiation', amount: 25_000 }
    const previous = await stack.hooks.run(
      'hnd_deal',
      'insert',
      { name: uniq('Deal'), amount: 25_000, stage: 'negotiation' },
      { as: user },
    );
    await stack.hooks.run('hnd_deal', 'update', { id: previous.id, stage: 'closed_won' }, { as: user });
    const [input] = await stack.rows('hnd_deal', { id: previous.id });
    expect(input.probability).toBe(100);
    expect(input.expected_revenue).toBe(25_000);
    // `days_in_stage` is a formula over `stage_entry_date`; re-stamping IS the reset.
    expect(input.stage_entry_date).toBe(today());
  });

  it('starts the stage clock on insert so a never-moved deal is visible to the sweep', async () => {
    const input = await stack.hooks.run(
      'hnd_deal',
      'insert',
      { name: uniq('New Deal'), amount: 1_000, stage: 'prospecting' },
      { as: user },
    );
    expect(input.stage_entry_date).toBe(today());
  });

  it('leaves the stage clock alone when the stage did not change', async () => {
    const previous = await stack.hooks.run(
      'hnd_deal',
      'insert',
      { name: uniq('Deal'), amount: 1_000, stage: 'proposal' },
      { as: user },
    );
    // Age the clock through the engine as the system (a seed/backfill write),
    // then make a USER edit that does not touch the stage.
    await stack.hooks.run('hnd_deal', 'update', { id: previous.id, stage_entry_date: '2026-01-01' }, { as: user });
    await stack.hooks.run('hnd_deal', 'update', { id: previous.id, amount: 2_000 }, { as: user });
    const [input] = await stack.rows('hnd_deal', { id: previous.id });
    expect(input.stage_entry_date).toBe('2026-01-01');
    expect(input.expected_revenue).toBe(1_200); // 2k × 60%
  });
});
