/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4032, merged scope from the #4163 part-1 audit (comment of
 * 2026-08-11) — `@objectstack/spec`'s `GlobalFilterSchema` types TWO slots as
 * `I18nLabel`, and the dashboard filter bar read both as plain strings.
 *
 * Neither was a `tsc` error, which is why they outlived the compile-visible
 * half of #4163: objectui's own `DashboardFilterDef.label` was declared
 * `string`, and `complex.ts` RESTATED `globalFilters[].options[].label` as
 * `label?: string` instead of inheriting the spec's widening. Both were
 * narrower than the contract, so the coercion looked deliberate.
 *
 * DIRECTIONS, written before the reverse verification was run:
 *
 *  - **(c) filter label map → RED, as `[object Object]`.** The trigger text is
 *    a template interpolation (`` `${label}: ${All}` ``), so a map stringifies
 *    rather than disappearing. It reaches `aria-label` on the same element, and
 *    `placeholder` + `aria-label` in `TextFilter`.
 *  - **(c2) a map that resolves to NOTHING → RED, falls through to nothing.**
 *    The gate is `def.label || def.name`, and an object is always truthy — the
 *    same truthiness fact #4163 pinned on `DashboardGridLayout`'s header. `{}`
 *    must fall through to `def.name`.
 *  - **(d) option label map → RED, and worse than `[object Object]`.**
 *    `normalizeFilterOptions` in `@object-ui/core` coerces with
 *    `typeof label === 'string' && label ? label : String(value)`, so a map is
 *    DISCARDED and the control shows the raw stored value. This one is red in
 *    EVERY locale including `en` — the authored English is lost too, which is
 *    what makes it a data-loss bug rather than a translation gap.
 *  - **(e) plain-string labels → GREEN on both sides.** The acceptance
 *    boundary: every dashboard authored today must render byte-identically.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DashboardFilterDef } from '@object-ui/core';
import { resolveDashboardFilterDefs } from '@object-ui/core';
import { DashboardFilterBar } from '../DashboardFilterBar';

afterEach(cleanup);

function renderIn(language: string, defs: DashboardFilterDef[], values: Record<string, unknown> = {}) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: {} }}>
      <DashboardFilterBar defs={defs} values={values} onChange={vi.fn()} />
    </I18nProvider>,
  );
}

describe('DashboardFilterBar — inline per-locale filter labels (#4032 / #4163)', () => {
  it('(c) resolves a map-valued filter label in the trigger text and the aria-label', () => {
    const { container } = renderIn('zh', [
      {
        name: 'owner',
        field: 'owner',
        type: 'select',
        label: { en: 'Owner', 'zh-CN': '负责人' },
        options: [{ value: 'alice', label: 'Alice' }],
      } as unknown as DashboardFilterDef,
    ]);

    expect(container.innerHTML).not.toContain('[object Object]');
    const trigger = screen.getByTestId('dashboard-filter-owner');
    expect(trigger.getAttribute('aria-label')).toBe('负责人');
    expect(trigger.textContent).toContain('负责人');
  });

  it('(c2) a label map that resolves to nothing falls through to the filter name', () => {
    // The truthiness half — an object is always truthy, so `def.label ||
    // def.name` never reached `def.name` for ANY object, empty or not.
    const { container } = renderIn('zh', [
      { name: 'region', field: 'region', type: 'select', label: {}, options: [] } as unknown as DashboardFilterDef,
    ]);

    expect(container.innerHTML).not.toContain('[object Object]');
    expect(screen.getByTestId('dashboard-filter-region').getAttribute('aria-label')).toBe('region');
  });

  it('(c3) resolves a map label on the text filter — placeholder AND aria-label', () => {
    renderIn('zh', [
      { name: 'note', field: 'note', type: 'text', label: { en: 'Note', 'zh-CN': '备注' } } as unknown as DashboardFilterDef,
    ]);

    const input = screen.getByTestId('dashboard-filter-note');
    expect(input.getAttribute('placeholder')).toBe('备注');
    expect(input.getAttribute('aria-label')).toBe('备注');
  });

  it('(c4) resolves a map label on the date-range filter aria-label', () => {
    renderIn('zh', [
      { name: 'dateRange', field: 'created_at', type: 'dateRange', label: { en: 'Period', 'zh-CN': '期间' } } as unknown as DashboardFilterDef,
    ]);

    expect(screen.getByLabelText('期间')).toBeTruthy();
  });

  it('(d) keeps a map-valued OPTION label and resolves it per locale', () => {
    // Through the real normalizer, because the discard happens there — a def
    // hand-written in the object form would not exercise the reported defect.
    const defs = resolveDashboardFilterDefs({
      globalFilters: [
        {
          name: 'channel',
          field: 'sales_channel',
          type: 'select',
          options: [{ value: 'domestic', label: { en: 'Domestic', 'zh-CN': '国内' } }],
        },
      ],
    } as never);

    renderIn('zh', defs, { channel: 'domestic' });
    expect(screen.getByTestId('dashboard-filter-channel').textContent).toContain('国内');
  });

  it('(d2) an `en` UI keeps the AUTHORED english option text, not the stored value', () => {
    // The half that makes this data loss rather than a translation gap: before
    // the change this rendered `domestic`, the raw stored value, in en too.
    const defs = resolveDashboardFilterDefs({
      globalFilters: [
        {
          name: 'channel',
          field: 'sales_channel',
          type: 'select',
          options: [{ value: 'domestic', label: { en: 'Domestic', 'zh-CN': '国内' } }],
        },
      ],
    } as never);

    renderIn('en', defs, { channel: 'domestic' });
    expect(screen.getByTestId('dashboard-filter-channel').textContent).toContain('Domestic');
  });

  it('(e0) an UNLABELLED date filter keeps its translated fallback, not the reserved name', () => {
    // Regression pin for the shape of the fix, not for the reported defect.
    // The three controls do NOT share a fallback — `dateRange` falls back to a
    // translated "Date range", the others to `def.name` — so a resolver that
    // helpfully applied `|| def.name` itself would have made this control read
    // the reserved string `dateRange`. Caught while writing the helper; pinned
    // so the next simplification cannot re-collapse them.
    renderIn('en', [
      { name: 'dateRange', field: 'created_at', type: 'dateRange' } as unknown as DashboardFilterDef,
    ]);

    expect(screen.getByLabelText('Date range')).toBeTruthy();
    expect(screen.queryByLabelText('dateRange')).toBeNull();
  });

  it('(e) leaves plain-string labels and options exactly as authored', () => {
    // Non-vacuity + acceptance boundary for all of the above.
    const defs = resolveDashboardFilterDefs({
      globalFilters: [
        {
          name: 'stage',
          field: 'stage',
          type: 'select',
          label: 'Stage',
          // Both options in @objectstack/spec's `{ value, label }` pair form.
          // This case used to spell the second one as the bare string 'lost' to
          // also exercise a MIXED array; that shorthand is retired
          // (objectui#4356) — a bare member yields no option — and the
          // mixed-array DROP has its own pin in
          // `packages/core/src/utils/__tests__/dashboard-filters.test.ts`
          // (`keeps ONLY the object members of a MIXED array, and names only
          // the dropped ones`). What THIS case is for — a plain-string label
          // surviving the i18n path untouched — is unchanged.
          options: [{ value: 'won', label: 'Won' }, { value: 'lost', label: 'lost' }],
        },
      ],
    } as never);

    expect(defs[0].options).toEqual([
      { value: 'won', label: 'Won' },
      { value: 'lost', label: 'lost' },
    ]);

    renderIn('zh', defs, { stage: 'won' });
    const trigger = screen.getByTestId('dashboard-filter-stage');
    expect(trigger.getAttribute('aria-label')).toBe('Stage');
    expect(trigger.textContent).toContain('Won');
  });
});
