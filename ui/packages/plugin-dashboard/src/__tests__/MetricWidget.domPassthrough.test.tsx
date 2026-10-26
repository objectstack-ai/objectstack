/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4426 — the RUNTIME half of the KPI cards' DOM pass-through contract.
 *
 * Both components end their prop list with a `...domProps` spread onto the
 * Shadcn `Card`, and objectui#4357 (PR #4428) kept that spread deliberately: it
 * is their only accessibility pass-through. But neither props interface extended
 * `React.HTMLAttributes`, so what the runtime accepted the TYPE refused:
 *
 * ```
 * probe.tsx(11,5): error TS2322: Type '{ label: string; value: number; id: string;
 *   role: string; "aria-label": string; … }' is not assignable to type
 *   'IntrinsicAttributes & MetricWidgetProps & SchemaHostProps'.
 *     Property 'id' does not exist on type '…'.
 * ```
 *
 * A JS consumer, and every SDUI author going through `SchemaRenderer` (untyped
 * at that boundary), got the pass-through; a TypeScript consumer importing the
 * component directly needed a cast.
 *
 * ## What is asserted WHERE, and why the split is not arbitrary
 *
 * The defect was type-only — `id` / `role` / `aria-label` reached the card the
 * whole time — so the fix's own direction cannot be observed by anything vitest
 * runs. The compile-time assertions therefore live in `../domPassthroughPins.ts`,
 * a SOURCE module the package's `tsc --noEmit` compiles, next to the contract
 * they pin.
 *
 * That split is a PREFERENCE, not a constraint — do not read it as a rule against
 * compile-time assertions in this file. It was a constraint when #4426 was
 * written: this package's tests were then compiled by nothing, so an assertion
 * here would have read as coverage while being decoration (objectui#3181). That
 * debt is paid. `tsconfig.test.json` type-checks this package's tests, this file
 * included, and this package's `type-check` script chains it
 * (`tsc --noEmit && tsc -p tsconfig.test.json`) — which is what CI's Type Check
 * job runs. So a `@ts-expect-error` written here IS checked: when the error it
 * expects stops happening, `tsc` reports it UNUSED (TS2578). Write a
 * compile-time pin wherever it reads best — the sibling
 * `ObjectDataTable.emitBoundary-6373.test.tsx` keeps two directives in a test
 * file for exactly that reason.
 *
 * What IS real here, and only here: that those attributes actually land on the
 * element, and that `title` does NOT. Case (c) is the one that would catch the
 * tempting bad fix for the `title` collision — declaring the inherited DOM
 * `title` instead of omitting it would type-check, read as a supported tooltip,
 * and silently do nothing (objectui#3290 / objectui#3222's first-class failure).
 *
 * DIRECTIONS, written before the run: all three cases are GREEN on both sides of
 * #4426 at RUNTIME — the spread already forwarded these attributes, and this
 * change adds no runtime behaviour at all. They are a regression floor for the
 * spread `MetricWidget.domProps.test.tsx` case (e) protects from the other side,
 * not evidence of the type fix. The type fix's before/after direction is the
 * pins file, and is recorded in the PR.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { MetricWidget } from '../MetricWidget';
import { MetricCard } from '../MetricCard';

afterEach(cleanup);

function wrap(ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
      {ui}
    </I18nProvider>,
  );
}

describe('MetricWidget / MetricCard — the declared DOM pass-through reaches the element (#4426)', () => {
  it('(a) MetricWidget carries a direct consumer\'s DOM identity and ARIA', () => {
    const { container } = wrap(
      <MetricWidget
        label="Total Revenue"
        value={1930000}
        id="revenue"
        role="region"
        aria-label="Revenue KPI"
        aria-describedby="revenue-desc"
        tabIndex={0}
        data-testid="revenue-kpi"
        className="kpi-tile"
      />,
    );

    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('id')).toBe('revenue');
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-label')).toBe('Revenue KPI');
    expect(el.getAttribute('aria-describedby')).toBe('revenue-desc');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('data-testid')).toBe('revenue-kpi');
    expect(el.className).toContain('kpi-tile');
    // Zero runtime change: the KPI still renders exactly as before.
    expect(container.textContent).toContain('Total Revenue');
    expect(container.textContent).toContain('1,930,000');
  });

  it('(b) MetricCard does the same through its own props', () => {
    const { container } = wrap(
      <MetricCard
        title="Total Revenue"
        value="1,930,000"
        id="revenue-card"
        role="region"
        aria-label="Revenue KPI"
        aria-describedby="revenue-desc"
        tabIndex={0}
        data-testid="revenue-card"
      />,
    );

    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('id')).toBe('revenue-card');
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-label')).toBe('Revenue KPI');
    expect(el.getAttribute('aria-describedby')).toBe('revenue-desc');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('data-testid')).toBe('revenue-card');
    expect(container.textContent).toContain('Total Revenue');
  });

  it('(c) MetricCard\'s `title` is the heading and never becomes a DOM tooltip', () => {
    // The reason `MetricCardProps` OMITS the inherited `title` rather than
    // declaring it. If a later edit "aligns" the interface by declaring the DOM
    // `title`, this stays green — but the type would then promise a tooltip the
    // component drops on the floor, which is what the pins file forbids and what
    // this case documents from the runtime side.
    const { container } = wrap(<MetricCard title="Total Revenue" value={1} id="c" />);

    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute('title')).toBeNull();
    expect(container.textContent).toContain('Total Revenue');
  });
});
