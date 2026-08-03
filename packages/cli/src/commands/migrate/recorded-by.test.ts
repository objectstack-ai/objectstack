// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate recorded-by` command shape (#4556).
 *
 * The conversion itself is proven against the real journal runner in
 * `@objectstack/metadata-protocol`'s `migrations/recorded-by-sentinel.test.ts`.
 * What is pinned here is the thing a unit test of the plan cannot see: that
 * this subcommand honours #2186 — a bare `os migrate <topic>` must never
 * mutate the database by surprise, so writing is opt-in behind `--apply`.
 */

import { describe, it, expect } from 'vitest';
import MigrateRecordedBy from './recorded-by.js';
import {
  RECORDED_BY_SENTINEL,
  RECORDED_BY_SENTINEL_PLAN_ID,
  createRecordedBySentinelPlan,
} from '@objectstack/metadata-protocol';

describe('os migrate recorded-by', () => {
  it('is a dry run by default — --apply is opt-in (#2186)', () => {
    expect(MigrateRecordedBy.flags.apply.default).toBe(false);
  });

  it('requires explicit confirmation to write — --yes is opt-in', () => {
    expect(MigrateRecordedBy.flags.yes.default).toBe(false);
  });

  it('describes what it converts, so `os migrate --help` is self-explanatory', () => {
    expect(MigrateRecordedBy.description).toContain('recorded_by');
    expect(MigrateRecordedBy.description).toContain('NULL');
  });

  it('drives the plan the metadata package owns — no second copy of the conversion', () => {
    const plan = createRecordedBySentinelPlan();
    expect(plan.id).toBe(RECORDED_BY_SENTINEL_PLAN_ID);
    // A rediscovered run goes FORWARD: unwinding would put the fake foreign
    // key back, which is the thing this plan exists to remove.
    expect(plan.onCrash).toBe('resume');
    expect(RECORDED_BY_SENTINEL).toBe('system');
  });
});
