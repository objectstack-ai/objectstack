/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5741 — Phase 2 of the row-predicate canon (objectui#5330) on the
 * `useCondition` TIER.
 *
 * `packages/core`'s `rowPredicateCanon.test.ts` pins the detector and the
 * `evalRowPredicate` tier. This file exists because the two tiers are genuinely
 * separate evaluation entries: the four generic action renderers, `record:alert`
 * and `DeclaredActionsBar` go through `usePredicateRecordContext` +
 * `useCondition`, NOT through `evalRowPredicate`. Pinning only the core tier
 * would have left them unmeasured while reading as covered.
 *
 * What this tier does with a retired spelling is this tier's EXISTING fault
 * policy, nothing new: the bag binds `record` and nothing else, so a bare field
 * or `data.*` — and a legacy `${data.x}` / `${x}` string, one bag for both
 * dialects — is an unknown variable. The throwing leg (`throwOnError`) hides and
 * reports once; the non-throwing leg fails soft to `true`. Both legs are pinned
 * on BOTH a matching and a non-matching row, because "the same verdict on both"
 * is what "no longer bound" looks like from outside.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useCondition, usePredicateRecordContext, PredicateScopeProvider } from '../useExpression';

const row = { status: 'in_review', amount: 10 };
const other = { status: 'draft', amount: 1 };

type Options = { throwOnError?: boolean; label?: string };

/** Drive the real pairing the action renderers use: bind the row, then evaluate. */
const evaluate = (pred: unknown, record: unknown = row, options?: Options) =>
  renderHook(() => {
    const ctx = usePredicateRecordContext(record);
    return useCondition(pred as never, ctx, options);
  }).result.current;

describe('[#5741] useCondition tier — the row is bound as `record.*` only', () => {
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  const messages = (): string[] => warn.mock.calls.map((c) => String(c[0]));

  it('binds the row as `{ record }` — no spread, no `data`', () => {
    const { result } = renderHook(() => usePredicateRecordContext(row));
    expect(result.current).toEqual({ record: row });
    expect(result.current.record).toBe(row);
    expect('data' in result.current).toBe(false);
    expect('status' in result.current).toBe(false);
  });

  it('`record.*` still discriminates, on both legs, silently', () => {
    expect(evaluate("record.status == 'in_review'")).toBe(true);
    expect(evaluate("record.status == 'in_review'", other)).toBe(false);
    expect(evaluate("record.status == 'in_review'", row, { throwOnError: true })).toBe(true);
    expect(evaluate("record.status == 'in_review'", other, { throwOnError: true })).toBe(false);
    expect(messages()).toHaveLength(0);
  });

  describe.each([
    ['bare shorthand', "status == 'in_review'", 'status'],
    ['`data.*`', "data.status == 'in_review'", 'data'],
    ['legacy `${data.x}`', '${data.status === "in_review"}', 'data'],
    ['legacy `${x}`', '${status === "in_review"}', 'status'],
  ])('a %s predicate no longer discriminates', (_what, pred, variable) => {
    it('throwing leg (`throwOnError`): hidden on BOTH rows, reported once, naming the variable', () => {
      // The label carries the predicate so the hook's warn-once key (label,
      // source) is unique per case — the registry is module-global.
      const label = `action "approve" (visible) [${pred}]`;
      expect(evaluate(pred, row, { throwOnError: true, label })).toBe(false);
      expect(evaluate(pred, other, { throwOnError: true, label })).toBe(false);
      const reports = messages().filter((m) => m.includes('was hidden/disabled: its predicate threw'));
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain(`${variable} is not defined`);
      expect(reports[0]).toContain(label);
    });

    it('non-throwing leg: fail-soft `true` on BOTH rows', () => {
      expect(evaluate(pred, row)).toBe(true);
      expect(evaluate(pred, other)).toBe(true);
    });

    it('and the Phase-1 deprecation warning is gone', () => {
      evaluate(pred, row);
      evaluate(pred, row, { throwOnError: true, label: `gone [${pred}]` });
      expect(messages().filter((m) => m.includes('DEPRECATED spelling'))).toHaveLength(0);
    });
  });

  it("a host's own ambient `data` is left standing: `data.*` reads the HOST object — constant, and silent", () => {
    // app-shell's `ExpressionProvider` mounts `data: {}`; a record page under it
    // hands this tier exactly this bag. Not a fault — `data.status` is an
    // undefined VALUE on the host's object — so no leg reports it, and the row
    // never enters the verdict. Pinned so the constant-false is a measured
    // consequence of the ruling, not a surprise.
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(PredicateScopeProvider, { scope: { data: {} }, children });
    const under = (pred: string, record: unknown, options?: Options) =>
      renderHook(() => useCondition(pred as never, usePredicateRecordContext(record), options), { wrapper })
        .result.current;
    expect(under("data.status == 'in_review'", row)).toBe(false);
    expect(under("data.status == 'in_review'", other)).toBe(false);
    expect(under("data.status == 'in_review'", row, { throwOnError: true })).toBe(false);
    // …while the row still reaches `record`, which this bag pins over the host.
    expect(under("record.status == 'in_review'", row)).toBe(true);
    expect(messages()).toHaveLength(0);
  });

  it('binds NOTHING when there is no row (a non-row `useCondition` call)', () => {
    const { result } = renderHook(() => usePredicateRecordContext(null));
    expect(result.current).toEqual({});
  });
});
