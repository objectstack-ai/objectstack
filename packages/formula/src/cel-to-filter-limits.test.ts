// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6132 — the dated switch, driven in BOTH positions.
 *
 * The maintainer's A′ ruling (2026-08-08, quoted verbatim on the issue):
 *
 * > **rc grace, GA flip:** during 17.0.0-rc.x an over-limit predicate on the
 * > pushdown path still compiles + emits a WARN naming the exceeded limit; at
 * > v17 GA the runtime flips to fail-closed refusal (the `parse-error` ⇒
 * > `RLS_DENY_FILTER` path).
 *
 * A switch whose other half is only ever proven by reading the source is not
 * proven, and this one guards a fail-closed security path, so both positions
 * run here against the same three measured shapes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LIMITS } from './cel-engine';
import {
  CEL_PUSHDOWN_LIMITS_MODE,
  celPushdownLimitsMode,
  setCelPushdownLimitsModeForTests,
} from './cel-pushdown-limits';
import { __resetPushdownLimitWarnings, compileCelToFilter, isPushdownableCel } from './cel-to-filter';

/** 80-term conjunction — the escalation's `maxAstNodes` shape; REACHED real pushdown SQL. */
const CONJ_80 = Array.from({ length: 80 }, (_, i) => `record.f${i} == ${i}`).join(' && ');
/** 40-level nest — the escalation's `maxDepth` shape. */
const NEST_40 = `${'('.repeat(40)}record.a == 1${')'.repeat(40)}`;
/** 200-element `$in` — the escalation's `maxListElements` shape. */
const IN_200 = `record.id in [${Array.from({ length: 200 }, (_, i) => `'u${i}'`).join(',')}]`;

const OVER_LIMIT = [
  { name: '80-term conjunction', source: CONJ_80, limit: 'maxAstNodes' as const },
  { name: '40-level nesting', source: NEST_40, limit: 'maxDepth' as const },
  { name: '200-element $in', source: IN_200, limit: 'maxListElements' as const },
];

/** The same three axes, sitting exactly AT the bound: these must stay admitted. */
const AT_LIMIT = [
  {
    name: `${DEFAULT_LIMITS.maxListElements}-element $in (AT maxListElements)`,
    source: `record.id in [${Array.from({ length: DEFAULT_LIMITS.maxListElements }, (_, i) => `'u${i}'`).join(',')}]`,
    expected: { record_id_in_len: DEFAULT_LIMITS.maxListElements },
  },
  {
    // 30 nested parens — under maxDepth (32) with room for the comparison itself.
    name: '30-level nesting (under maxDepth)',
    source: `${'('.repeat(30)}record.a == 1${')'.repeat(30)}`,
    expected: null,
  },
  {
    // 40 conjuncts ≈ 120 AST nodes — comfortably under maxAstNodes (256).
    name: '40-term conjunction (under maxAstNodes)',
    source: Array.from({ length: 40 }, (_, i) => `record.f${i} == ${i}`).join(' && '),
    expected: null,
  },
];

/**
 * The WARN's sink, reached the same way the compiler reaches it: through
 * `globalThis`. `@objectstack/formula` compiles with neither the DOM lib nor
 * `@types/node`, so the bare `console` global has no type in this package — and
 * spying on a differently-obtained object than the one under test would be a
 * green test over a silent sink.
 */
const maybeConsole = (globalThis as { console?: { warn: (message: string) => void } }).console;
if (!maybeConsole) throw new Error('this suite spies on the WARN sink and needs a host console');
const hostConsole = maybeConsole;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetPushdownLimitWarnings();
  warn = vi.spyOn(hostConsole, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('the shipped default is the rc grace window', () => {
  /**
   * The GA flip is one line in `cel-pushdown-limits.ts`. This assertion is what
   * makes flipping it a deliberate act: it goes red on the flip, and the commit
   * that flips it updates this expectation to `'fail-closed'` (the behaviour
   * already exercised below).
   */
  it('CEL_PUSHDOWN_LIMITS_MODE is `rc-grace` until v17.0.0 GA', () => {
    expect(CEL_PUSHDOWN_LIMITS_MODE).toBe('rc-grace');
    expect(celPushdownLimitsMode()).toBe('rc-grace');
  });
});

describe('switch = rc-grace (17.0.0-rc.x) — compiles, and WARNs naming the limit', () => {
  for (const { name, source, limit } of OVER_LIMIT) {
    it(`${name}: still compiles`, () => {
      const result = compileCelToFilter(source, { variables: { current_user: { id: 'u1' } } });
      expect(result.ok).toBe(true);
      expect(isPushdownableCel(source).ok).toBe(true);
    });

    it(`${name}: WARNs, naming ${limit}, its platform value, and what the source measures`, () => {
      compileCelToFilter(source, { variables: { current_user: { id: 'u1' } } });
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain('[cel-to-filter]');
      // WHICH bound, and the platform's value for it.
      expect(message).toContain(limit);
      expect(message).toContain(`limit ${DEFAULT_LIMITS[limit]}`);
      expect(message).toContain(`Exceeded ${limit} (${DEFAULT_LIMITS[limit]})`);
      // The source's own offending measure — a real number, strictly over the bound.
      const measured = /this predicate measures (\d+)/.exec(message)?.[1];
      expect(measured, `no measure in: ${message}`).toBeDefined();
      expect(Number(measured)).toBeGreaterThan(DEFAULT_LIMITS[limit]);
      // And what happens next, because a grace window that does not say it ends
      // is just a permissive default.
      expect(message).toContain('at v17 GA it will be REFUSED');
      expect(message).toContain('RLS_DENY_FILTER');
    });
  }

  it('the 200-element $in WARN reports the measure as exactly 200', () => {
    compileCelToFilter(IN_200, { variables: { current_user: { id: 'u1' } } });
    expect(String(warn.mock.calls[0]?.[0])).toContain('this predicate measures 200');
  });

  it('warns ONCE per source, not once per compile', () => {
    for (let i = 0; i < 5; i++) compileCelToFilter(CONJ_80, { variables: {} });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('the compiled filter is the real thing, not a stub', () => {
    const result = compileCelToFilter(IN_200, { variables: {} });
    expect(result.ok && result.filter).toEqual({ id: { $in: expect.arrayContaining(['u0', 'u199']) } });
  });
});

describe('switch = fail-closed (v17 GA) — refuses, and says which limit', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = setCelPushdownLimitsModeForTests('fail-closed');
  });
  afterEach(() => restore());

  for (const { name, source, limit } of OVER_LIMIT) {
    it(`${name}: refused as parse-error naming ${limit}`, () => {
      const result = compileCelToFilter(source, { variables: { current_user: { id: 'u1' } } });
      expect(result).toEqual({
        ok: false,
        // `parse-error` deliberately — it is the reason every consumer already
        // routes to its deny path (`RLSCompiler.compileExpression` → `null` →
        // `RLS_DENY_FILTER`). WHICH bound rides in `detail`.
        reason: 'parse-error',
        detail: `Exceeded ${limit} (${DEFAULT_LIMITS[limit]})`,
      });
    });

    it(`${name}: the shape gate refuses it too, with the same identity`, () => {
      expect(isPushdownableCel(source)).toEqual({
        ok: false,
        reason: 'parse-error',
        detail: `Exceeded ${limit} (${DEFAULT_LIMITS[limit]})`,
      });
    });

    it(`${name}: refusing does NOT warn — the refusal is the message`, () => {
      compileCelToFilter(source, { variables: {} });
      expect(warn).not.toHaveBeenCalled();
    });
  }

  it('a genuine syntax fault keeps its own detail — it is not relabelled as a bound', () => {
    const result = compileCelToFilter('record.stage ==', { variables: {} });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('parse-error');
    expect(result.ok === false && result.detail).not.toMatch(/^Exceeded /);
  });
});

describe('both positions — a predicate AT or under the bound is untouched', () => {
  for (const mode of ['rc-grace', 'fail-closed'] as const) {
    describe(`switch = ${mode}`, () => {
      let restore: () => void;
      beforeEach(() => {
        restore = setCelPushdownLimitsModeForTests(mode);
      });
      afterEach(() => restore());

      for (const { name, source } of AT_LIMIT) {
        it(`${name}: compiles, and does not warn`, () => {
          const result = compileCelToFilter(source, { variables: { current_user: { id: 'u1' } } });
          expect(result.ok, `refused: ${JSON.stringify(result)}`).toBe(true);
          expect(isPushdownableCel(source).ok).toBe(true);
          expect(warn).not.toHaveBeenCalled();
        });
      }

      it('the ordinary pushdown subset is identical in both positions', () => {
        expect(compileCelToFilter("record.region == 'EMEA'", { variables: {} })).toEqual({
          ok: true,
          filter: { region: 'EMEA' },
        });
        expect(compileCelToFilter('record.owner_id == current_user.id', { variables: { current_user: { id: 'u1' } } }))
          .toEqual({ ok: true, filter: { owner_id: 'u1' } });
        expect(warn).not.toHaveBeenCalled();
      });
    });
  }
});
