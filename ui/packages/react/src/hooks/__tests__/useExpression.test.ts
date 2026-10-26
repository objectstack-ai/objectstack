/**
 * Tests for useExpression and useCondition hooks
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { useExpression, useCondition, useRowPredicate, toPredicateInput, PredicateScopeProvider, usePredicateRecordContext } from '../useExpression';

describe('useExpression', () => {
  it('returns string value directly for non-expression strings', () => {
    const { result } = renderHook(() => useExpression('hello'));

    expect(result.current).toBe('hello');
  });

  it('returns number value directly', () => {
    const { result } = renderHook(() => useExpression(42));

    expect(result.current).toBe(42);
  });

  it('returns boolean value directly', () => {
    const { result } = renderHook(() => useExpression(true));

    expect(result.current).toBe(true);
  });

  it('returns null for null expressions', () => {
    const { result } = renderHook(() => useExpression(null));

    expect(result.current).toBeNull();
  });

  it('returns undefined for undefined expressions', () => {
    const { result } = renderHook(() => useExpression(undefined));

    expect(result.current).toBeUndefined();
  });

  it('evaluates expressions with ${...} syntax', () => {
    const context = { data: { name: 'John' } };
    const { result } = renderHook(() =>
      useExpression('${data.name}', context),
    );

    expect(result.current).toBe('John');
  });

  it('evaluates expressions with context data', () => {
    const context = { data: { age: 25 } };
    const { result } = renderHook(() =>
      useExpression('${data.age > 18}', context),
    );

    expect(result.current).toBe(true);
  });
});

describe('useCondition', () => {
  it('returns true for boolean true', () => {
    const { result } = renderHook(() => useCondition(true));

    expect(result.current).toBe(true);
  });

  it('returns false for boolean false', () => {
    const { result } = renderHook(() => useCondition(false));

    expect(result.current).toBe(false);
  });

  it('returns true for undefined', () => {
    const { result } = renderHook(() => useCondition(undefined));

    expect(result.current).toBe(true);
  });

  it('evaluates string conditions with context', () => {
    const context = { data: { status: 'active' } };
    const { result } = renderHook(() =>
      useCondition('${data.status === "active"}', context),
    );

    expect(result.current).toBe(true);
  });

  describe('{ throwOnError: true } — fail-closed opt-in (mirrors ActionEngine)', () => {
    // A bare reference to an undeclared identifier — not merely a property
    // access on an existing object — genuinely throws a ReferenceError from
    // the compiled expression, the same shape of failure ActionEngine's own
    // fail-closed regression test uses (a predicate referencing missing context).
    const THROWING = '${nonexistentIdentifier.field}';

    it('defaults to fail-OPEN (true) on a throwing predicate when not requested', () => {
      const { result } = renderHook(() => useCondition(THROWING, { data: {} }));
      expect(result.current).toBe(true);
    });

    it('fails CLOSED (false) on a throwing predicate when requested', () => {
      const { result } = renderHook(() =>
        useCondition(THROWING, { data: {} }, { throwOnError: true }),
      );
      expect(result.current).toBe(false);
    });

    it('still evaluates normally (no change) when the predicate does not throw', () => {
      const context = { data: { status: 'active' } };
      const { result } = renderHook(() =>
        useCondition('${data.status === "active"}', context, { throwOnError: true }),
      );
      expect(result.current).toBe(true);
    });

    it('warns ONCE with the label when a fail-closed predicate throws (#2358)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const SRC = '${undeclaredWarnProbe2358.field}';
        const { unmount } = renderHook(() =>
          useCondition(SRC, { data: {} }, { throwOnError: true, label: 'action "probe_2358" (visible)' }),
        );
        const matching = () =>
          warn.mock.calls.filter(c => String(c[0]).includes('probe_2358'));
        expect(matching()).toHaveLength(1);
        expect(String(matching()[0][0])).toMatch(/hidden\/disabled/);
        expect(String(matching()[0][0])).toContain(SRC);
        // Remount with the same predicate → deduped, no second warning.
        unmount();
        renderHook(() =>
          useCondition(SRC, { data: {} }, { throwOnError: true, label: 'action "probe_2358" (visible)' }),
        );
        expect(matching()).toHaveLength(1);
      } finally {
        warn.mockRestore();
      }
    });
  });
});

describe('useRowPredicate (canonical CEL row predicate — issue #1584)', () => {
  it('returns a boolean predicate as-is (short-circuit)', () => {
    expect(renderHook(() => useRowPredicate(true, { a: 1 })).result.current).toBe(true);
    expect(renderHook(() => useRowPredicate(false, { a: 1 })).result.current).toBe(false);
  });

  it('returns the fallback for an absent predicate (default true)', () => {
    expect(renderHook(() => useRowPredicate(undefined, { a: 1 })).result.current).toBe(true);
    expect(renderHook(() => useRowPredicate('', { a: 1 })).result.current).toBe(true);
    expect(renderHook(() => useRowPredicate(undefined, { a: 1 }, { fallback: false })).result.current).toBe(false);
  });

  it('evaluates a CEL predicate over the row (`record.*`; the bare shorthand retired in objectui#5741)', () => {
    expect(renderHook(() => useRowPredicate("record.status == 'active'", { status: 'active' })).result.current).toBe(true);
    expect(renderHook(() => useRowPredicate("record.status == 'active'", { status: 'closed' })).result.current).toBe(false);
    // A bare field is unbound: it faults into this hook's fallback (default
    // `true`) on EITHER row, so it no longer discriminates.
    expect(renderHook(() => useRowPredicate("status == 'active'", { status: 'closed' })).result.current).toBe(true);
    expect(renderHook(() => useRowPredicate("status == 'active'", { status: 'active' }, { fallback: false })).result.current).toBe(false);
  });

  it('supports the CEL `in` operator (legacy engine could not)', () => {
    expect(renderHook(() => useRowPredicate("record.role in ['admin', 'owner']", { role: 'owner' })).result.current).toBe(true);
    expect(renderHook(() => useRowPredicate("record.role in ['admin', 'owner']", { role: 'member' })).result.current).toBe(false);
  });

  it('merges the ambient predicate scope (features/user)', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(PredicateScopeProvider, { scope: { features: { canEdit: true } }, children });
    expect(
      renderHook(() => useRowPredicate('features.canEdit == true', { id: '1' }), { wrapper }).result.current,
    ).toBe(true);
  });

  it('fails CLOSED and warns on a broken predicate when warnOnError is set', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useRowPredicate('record.status ==', { status: 'x' }, { fallback: false, warnOnError: true, label: 'resume' }),
    );
    expect(result.current).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

/**
 * `usePredicateRecordContext` — the no-row half of the binding rule
 * (objectui#4075 / #4080).
 *
 * The row-PRESENT half (`record.*` resolving; the bare and `data.*` spellings
 * retired in objectui#5741 and faulting) is pinned behaviorally where the rule
 * is consumed: `action-record-predicate-root.test.tsx` for the four generic
 * renderers, `DeclaredActionsBar.test.tsx` for the bar. What is pinned HERE is
 * the return shape itself, one level below any renderer — the
 * distinction between "this surface has no row" and "this surface's row is
 * empty", which is the single point on which the helper and the inline copies
 * it replaced ever differed. Its consumers can only fail it through a rendered
 * verdict; a caller reading the bag directly (or a future "simplification" of
 * the helper) would not be caught by them at all.
 */
describe('usePredicateRecordContext — no row binds NOTHING (objectui#4075)', () => {
  it('with a row, binds `{ record: row }` and nothing else (objectui#5741)', () => {
    const row = { status: 'pending' };
    const { result } = renderHook(() => usePredicateRecordContext(row));
    expect(result.current).toEqual({ record: row });
    expect('data' in result.current).toBe(false);
    expect('status' in result.current).toBe(false);
  });

  it('returns an EMPTY bag for no row — not `{ record: {} }`', () => {
    for (const noRow of [null, undefined, 'a string', 42, [1, 2]]) {
      const { result } = renderHook(() => usePredicateRecordContext(noRow));
      expect(result.current, String(noRow)).toEqual({});
      // Spelled out: the ABSENCE of these two keys is the whole contract, and
      // `toEqual({})` above would still pass if they were present-and-undefined.
      expect('record' in result.current, String(noRow)).toBe(false);
      expect('data' in result.current, String(noRow)).toBe(false);
    }
  });

  it('so a host-supplied ambient `record` survives the merge `useCondition` does', () => {
    // The consequence the shape exists for. `useCondition` evaluates on
    // `{ ...scope, ...context }`, so an empty-row bag would shadow the scope's
    // `record` with `{}` and a correctly-authored predicate would read false.
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(PredicateScopeProvider, { scope: { record: { status: 'pending' } }, children });
    const { result } = renderHook(
      () => useCondition('${record.status === "pending"}', usePredicateRecordContext(undefined)),
      { wrapper },
    );
    expect(result.current).toBe(true);
  });
});

// #2661 — a CEL-dialect action/component predicate must reach the canonical
// engine through `toPredicateInput` → `useCondition`, not collapse to a legacy
// `${…}` string.
describe('toPredicateInput — CEL envelope preservation (#2661)', () => {
  it('preserves a { dialect: "cel" } envelope (does not wrap as ${…})', () => {
    expect(toPredicateInput({ dialect: 'cel', source: 'record.x == 1' }))
      .toEqual({ dialect: 'cel', source: 'record.x == 1' });
  });

  it('still wraps bare strings and non-cel envelopes as legacy ${…}', () => {
    expect(toPredicateInput('data.age >= 18')).toBe('${data.age >= 18}');
    expect(toPredicateInput({ dialect: 'template', source: 'data.age >= 18' })).toBe('${data.age >= 18}');
  });

  it('passes booleans / empties through', () => {
    expect(toPredicateInput(true)).toBe(true);
    expect(toPredicateInput('')).toBeUndefined();
    expect(toPredicateInput({ dialect: 'cel', source: '' })).toBeUndefined();
  });

  it('does NOT re-wrap a string that is already a `${…}` template (objectui#3871)', () => {
    // Through the react export, because that is the name every renderer calls.
    // Wrapping twice produced `'${${…}}'`, which the evaluator cannot parse, so
    // the action-face verdict stopped depending on the predicate — constant
    // `true` on the fail-soft legs, a throw (→ constant "hidden") on the
    // `throwOnError` ones. Full shape + verdict coverage lives next to the
    // implementation, in `packages/core/src/evaluator/__tests__/predicateInput.test.ts`.
    expect(toPredicateInput('${data.age >= 18}')).toBe('${data.age >= 18}');
  });

  it('evaluates a `${…}`-spelled predicate to its real verdict (objectui#3871)', () => {
    const { result } = renderHook(() =>
      useCondition(toPredicateInput('${record.status === "closed"}'), { record: { status: 'open' } }),
    );
    expect(result.current).toBe(false);
  });
});

describe('useCondition — CEL envelope routes to the canonical engine (#2661)', () => {
  it('evaluates a cel envelope from toPredicateInput on the CEL engine (CEL `in`)', () => {
    const { result } = renderHook(() =>
      useCondition(toPredicateInput({ dialect: 'cel', source: "'admin' in record.roles" }), {
        record: { roles: ['admin'] },
      }),
    );
    expect(result.current).toBe(true);
  });

  it('a cel envelope predicate that is false hides/disables (not defaulted true)', () => {
    const { result } = renderHook(() =>
      useCondition(toPredicateInput({ dialect: 'cel', source: 'record.status == "open"' }), {
        record: { status: 'closed' },
      }),
    );
    expect(result.current).toBe(false);
  });
});
