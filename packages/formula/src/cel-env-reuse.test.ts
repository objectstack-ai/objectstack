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

/**
 * #34756 — the typed CHECK envs (`firstTypeMismatch`, `firstDateTextVerdict`,
 * `firstDateTextCall`) are built once per input, not once per call.
 *
 * The runtime authoring gate runs these over every expression of the whole
 * stack on each metadata publish. Measured on the showcase before the change:
 * 903 env builds for 97 distinct inputs per object publish, about 0.5 s of the
 * publish request on an idle box.
 */
describe('#34756 — one typed check env per input, not one per call', () => {
  const RECORD = { name: 'string', due: 'timestamp', ok: 'bool' } as const;

  it('repeated checks of one field map build no new environment', async () => {
    const { firstTypeMismatch, firstDateTextVerdict, firstDateTextCall } = await import('./cel-engine');
    const sources = ['record.name > 3', 'record.due < record.name', 'record.ok + 1', 'record.name == "x"'];
    const run = () => {
      for (const s of sources) {
        firstTypeMismatch(s, RECORD);
        firstTypeMismatch(s.replace(/record\./g, ''), RECORD, 'flattened');
        firstDateTextVerdict(s, RECORD);
        firstDateTextCall(s, RECORD);
      }
    };
    // Positive control: the first pass builds the envs it needs.
    expect(built(run)).toBeGreaterThan(0);
    expect(built(() => { for (let i = 0; i < 20; i++) run(); })).toBe(0);
  });

  it('the field types are part of the key: the same source keeps each map\'s own verdict', async () => {
    const { firstTypeMismatch } = await import('./cel-engine');
    const source = 'record.score > 3';
    for (let i = 0; i < 3; i++) {
      expect(firstTypeMismatch(source, { score: 'string' })).toMatchObject({
        operator: '>', celType: 'string', category: 'type-mismatch', field: 'score',
      });
      expect(firstTypeMismatch(source, { score: 'dyn' })).toBeNull();
      expect(firstTypeMismatch(source, { score: 'bool' })).toMatchObject({ celType: 'bool', field: 'score' });
    }
  });

  it('the scope and temporal typing are part of the key too', async () => {
    const { firstTypeMismatch, firstDateTextVerdict } = await import('./cel-engine');
    const fields = { d: 'timestamp' } as const;
    for (let i = 0; i < 3; i++) {
      // A date field minus a number: refused under the Timestamp typing…
      expect(firstTypeMismatch('record.d + 1', fields)).toMatchObject({ category: 'date-arith' });
      // …and read through the same field map in flattened scope, bare.
      expect(firstTypeMismatch('d + 1', fields, 'flattened')).toMatchObject({ category: 'date-arith' });
      // The record scope does not bind a bare name, so there is nothing typed to fault.
      expect(firstTypeMismatch('d + 1', fields)).toBeNull();
      // The same map and scope under the date-text typing: the operand is the field's text.
      expect(firstTypeMismatch('record.d + 1', fields)).toMatchObject({ operands: 'google.protobuf.Timestamp + int' });
      expect(firstDateTextVerdict('record.d + 1', fields)).toMatchObject({ kind: 'fault', operands: 'DateText + int' });
      expect(firstDateTextVerdict('record.d < "2026-01-01"', fields)).toMatchObject({ kind: 'type', type: 'bool' });
    }
  });
});
