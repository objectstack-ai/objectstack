// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';

/**
 * #24536 — `celEngine.compile` and `celEngine.evaluate` reuse ONE environment
 * each instead of building the CEL stdlib on every call.
 *
 * Measured on `origin/main` c03b17d784 before the change: every `evaluate`
 * built a fresh `Environment` and registered the whole stdlib into it, about
 * 140 µs of an evaluation that costs about 7 µs on a built environment, and
 * objectql's `applyFormulaPlan` reaches `evaluate` once per row per formula
 * field. `compile` did the same.
 *
 * The count is taken on cel-js's own constructor, so it sees every
 * environment this package builds, through any path.
 */

let environmentsBuilt = 0;

vi.mock('@marcbachmann/cel-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@marcbachmann/cel-js')>();
  class CountingEnvironment extends actual.Environment {
    constructor(...args: ConstructorParameters<typeof actual.Environment>) {
      super(...args);
      environmentsBuilt += 1;
    }
  }
  return { ...actual, Environment: CountingEnvironment };
});

const { celEngine } = await import('./cel-engine');
const { toEvalPermissions } = await import('./eval-permissions');

/** Environments built while `run` executes. */
function built(run: () => void): number {
  const before = environmentsBuilt;
  run();
  return environmentsBuilt - before;
}

const SOURCE = "joinNonEmpty([record.name, coalesce(record.industry, '')], ' - ')";

describe('#24536 — one environment per engine entry point, not one per call', () => {
  it('the counter sees an environment being built (positive control)', async () => {
    const { buildEnv } = await import('./cel-engine');
    expect(built(() => buildEnv(() => new Date(0)))).toBe(1);
  });

  it('repeated evaluations of one source build no new environment', () => {
    const expr = { dialect: 'cel' as const, source: SOURCE };
    // The first evaluation may build the shared environment; none after it does.
    celEngine.evaluate(expr, { record: { name: 'Acme', industry: 'Tech' } });
    const n = built(() => {
      for (let i = 0; i < 50; i++) {
        const r = celEngine.evaluate(expr, { record: { name: `Acme ${i}`, industry: i % 2 ? 'Tech' : null } });
        expect(r).toEqual({ ok: true, value: i % 2 ? `Acme ${i} - Tech` : `Acme ${i}` });
      }
    });
    expect(n).toBe(0);
  });

  it('what varies per evaluation (now, timezone, subject, permissions) builds no environment either', () => {
    const user = { id: 'usr_1', positions: [] };
    const permissions = toEvalPermissions({ crm_lead: { allowRead: true } });
    const run = (i: number) => {
      celEngine.evaluate({ dialect: 'cel', source: 'today()' }, {
        now: new Date(Date.UTC(2026, 0, 1 + i, 23)), timezone: i % 2 ? 'Asia/Shanghai' : 'UTC',
      });
      celEngine.evaluate({ dialect: 'cel', source: "current_user.can('crm_lead', 'read')" }, { user, permissions });
      celEngine.evaluate({ dialect: 'cel', source: "current_user.hasCapability('x')" }, { user, systemPermissions: ['x'] });
      celEngine.evaluate({ dialect: 'cel', source: 'record.amount / 100' }, { record: { amount: 250 } });
    };
    run(0);
    expect(built(() => { for (let i = 1; i < 20; i++) run(i); })).toBe(0);
  });

  it('repeated compiles build no new environment', () => {
    celEngine.compile(SOURCE);
    const n = built(() => {
      for (let i = 0; i < 50; i++) expect(celEngine.compile(SOURCE).ok).toBe(true);
      expect(celEngine.compile('nope(').ok).toBe(false);
    });
    expect(n).toBe(0);
  });
});

describe('#24536 — the per-source program cache answers every row as a fresh parse would', () => {
  it('a rewrite decided by the ROW is part of the key: alternating rows keep their own answers', () => {
    // #7168: `record.due` is wrapped in `date(…)` only on a row whose
    // `previous.due` is a Date, so the two rows run two different programs.
    const expr = { dialect: 'cel' as const, source: 'record.due == previous.due' };
    const dateRow = { record: { due: '2026-06-20' }, previous: { due: new Date('2026-06-20T00:00:00Z') } };
    const textRow = { record: { due: '2026-06-20' }, previous: { due: '2026-06-20' } };
    const textOther = { record: { due: '2026-06-20' }, previous: { due: '2026-06-21' } };
    for (let i = 0; i < 3; i++) {
      expect(celEngine.evaluate(expr, dateRow)).toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(expr, textRow)).toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(expr, textOther)).toEqual({ ok: true, value: false });
    }
  });

  it('the overload retry runs its own rewritten program, row by row', () => {
    const expr = { dialect: 'cel' as const, source: 'record.rating >= 4' };
    for (let i = 0; i < 3; i++) {
      expect(celEngine.evaluate(expr, { record: { rating: '5.0' } })).toEqual({ ok: true, value: true });
      expect(celEngine.evaluate(expr, { record: { rating: 3 } })).toEqual({ ok: true, value: false });
      expect(celEngine.evaluate(expr, { record: { rating: '3.5' } })).toEqual({ ok: true, value: false });
    }
  });

  it.each([
    ['a parse fault', 'record.a +'],
    ['a check fault', "1 + 'a'"],
    ['a runtime fault', 'record.a.b.c'],
    ['an unknown function', 'nope(record.a)'],
  ])('%s is reported the same on every evaluation', (_label, source) => {
    const expr = { dialect: 'cel' as const, source };
    const first = celEngine.evaluate(expr, { record: { a: 1 } });
    expect(first.ok).toBe(false);
    for (let i = 0; i < 3; i++) expect(celEngine.evaluate(expr, { record: { a: 1 } })).toEqual(first);
  });
});
