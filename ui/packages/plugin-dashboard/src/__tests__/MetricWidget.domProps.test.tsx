/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4357 — `MetricWidget` / `MetricCard` ended their prop lists with
 * `...props` and spread the whole thing onto the Shadcn `Card`. Reached through
 * `SchemaRenderer` (every KPI tile is), the renderer hands a component its
 * widget schema plus the schema's own keys, so SDUI metadata landed on the DOM:
 * React passes unknown lowercase attributes straight through and stringifies
 * object values.
 *
 * MEASURED at the `SchemaRenderer` call site (`packages/react/src/SchemaRenderer.tsx`,
 * the `React.createElement(Component, …)` block) — the props a widget receives
 * that are NOT DOM attributes, and the attribute each one emitted before the fix:
 *
 *   | prop             | emitted as                    | what it is                          |
 *   |------------------|-------------------------------|-------------------------------------|
 *   | `schema`         | `schema="[object Object]"`    | the node, injected on EVERY render  |
 *   | `events`         | `events="[object Object]"`    | SDUI action metadata                |
 *   | `props`          | `props="[object Object]"`     | the props container (spread already)|
 *   | `bind`           | `bind="data.revenue"`         | SDUI data-binding path              |
 *   | `ariaLabel`      | `arialabel="…"`               | camelCase twin of `aria-label`      |
 *   | `ariaDescribedBy`| `ariadescribedby="…"`         | camelCase twin of `aria-describedby`|
 *   | `dataSource`     | `datasource="[object Object]"`| the injected data-source ADAPTER    |
 *
 * The line the fix draws is "is this an HTML attribute name": the seven above are
 * not (the renderer already emits the two dashed `aria-*` forms itself), so they
 * are destructured out. The spread itself stays — it is genuine DOM/aria
 * passthrough.
 *
 * ⚠️ Since objectui#4425 the deny-list is not what decides the renderer's door:
 * a render through `SchemaRenderer` spreads only what `toDomProps` passes, so
 * `name` and the open tail of undeclared authored keys stop too (case (e) and
 * `MetricWidget.sduiDomWhitelist-4425.test.tsx`). The seven keys above stay
 * pinned here because they are still destructured, and still absent.
 *
 * `dataSource` is why case (g) exists and why it renders the dashboard WITH an
 * adapter. It is the only one of the seven that never appears in a schema —
 * `SchemaRenderer` strips the schema's own `dataSource` binding by name
 * (objectstack#5576) and this is the ADAPTER `DashboardRenderer` hands its
 * `SchemaRenderer` call, arriving through the renderer's trailing props. Every
 * fixture in this package renders without one, so it reads `undefined` and
 * writes nothing; every live dashboard has one, so the attribute was there in
 * production and in no test. A pin that only ever renders dataless dashboards
 * cannot see it.
 *
 * WHY THE ASSERTION IS `container.innerHTML` AND NOT THE HEADING. This defect's
 * cost was never a visible one; it was that it POISONED the assertion this area
 * attracts. #4163 pinned `not.toContain('[object Object]')` on
 * `DashboardGridLayout`, and #4032 wanted the same pin on the metric path but
 * could not write it — the card carried `schema="[object Object]"` before and
 * after any i18n fix, so the pin would have been red for a reason unrelated to
 * labels, and the tempting repair (loosen it) throws the real pin away. #4032
 * asserted on the card heading instead, with a comment pointing here. That
 * workaround is now removed: the container assertion below is the one that could
 * not be written, and `DashboardRenderer.metricI18n.test.tsx` asserts on the
 * container again.
 *
 * DIRECTIONS, written before the run: (a)–(d) and (g) RED before the fix —
 * (a)/(c)/(d)/(g) by `MetricWidget`, (b) by `MetricCard`; (e)/(f) GREEN on both
 * sides, they are the acceptance boundary (nothing else about the render may
 * move).
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import type { DashboardComponentSchema } from '@object-ui/types';
import { SchemaRenderer } from '@object-ui/react';
// Both widgets are resolved from the registry, populated as a side effect of
// the package barrel. Imported at MODULE scope (never in a hook) per AGENTS.md's
// flaky-test rule: the cost lands in the import phase, unbounded by any timeout.
import { DashboardRenderer } from '../index';

afterEach(cleanup);

/** Every SDUI key at once, so one render measures the whole surface. */
const SCHEMA_METADATA = {
  id: 'revenue',
  name: 'revenue_kpi',
  bind: 'data.revenue',
  events: { onClick: [{ action: 'navigate', params: { url: '/deals' } }] },
  ariaLabel: 'Revenue KPI',
  ariaDescribedBy: 'desc-1',
  role: 'group',
} as const;

/** Attribute names that must never appear — none of them is an HTML attribute. */
const LEAKED_ATTRIBUTES = ['schema', 'events', 'props', 'bind', 'arialabel', 'ariadescribedby', 'datasource'];

/**
 * A data-source adapter, shaped like the one a live dashboard injects. Only its
 * identity matters here: it must reach the widget and not the DOM.
 */
const ADAPTER = { name: 'fake', find: async () => ({ items: [] }), findOne: async () => null };

function renderSchema(schema: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
      <SchemaRenderer schema={schema as never} />
    </I18nProvider>,
  );
}

function card(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!el) throw new Error('nothing rendered');
  return el as HTMLElement;
}

function attributeNames(el: HTMLElement): string[] {
  return Array.from(el.attributes).map((a) => a.name);
}

describe('MetricWidget / MetricCard — schema-shaped props stay off the DOM (#4357)', () => {
  it('(a) MetricWidget: the metric container carries no stringified schema', () => {
    const { container } = renderSchema({
      type: 'plugin-dashboard:metric',
      label: 'Total Revenue',
      value: 1930000,
      ...SCHEMA_METADATA,
      props: { colorVariant: 'success' },
    });

    // THE pin — the assertion this defect used to block, on the container.
    expect(container.innerHTML).not.toContain('[object Object]');
    expect(attributeNames(card(container))).not.toContain('schema');
  });

  it('(b) MetricCard: same, through its own registry type', () => {
    const { container } = renderSchema({
      type: 'plugin-dashboard:metric-card',
      title: 'Total Revenue',
      value: 1930000,
      ...SCHEMA_METADATA,
    });

    expect(container.innerHTML).not.toContain('[object Object]');
    expect(attributeNames(card(container))).not.toContain('schema');
  });

  it('(c) neither component emits any of the seven measured non-DOM props', () => {
    for (const schema of [
      { type: 'plugin-dashboard:metric', label: 'Total Revenue', value: 1930000, ...SCHEMA_METADATA, props: { colorVariant: 'success' } },
      { type: 'plugin-dashboard:metric-card', title: 'Total Revenue', value: 1930000, ...SCHEMA_METADATA, props: {} },
    ]) {
      const { container } = renderSchema(schema);
      const names = attributeNames(card(container));
      for (const leaked of LEAKED_ATTRIBUTES) {
        expect(names, `${schema.type} emitted ${leaked}=`).not.toContain(leaked);
      }
      cleanup();
    }
  });

  it('(d) the dashboard KPI path — the container assertion #4032 could not write', () => {
    const schema = {
      type: 'dashboard',
      name: 'sales',
      widgets: [{ id: 'revenue', type: 'metric', title: 'Total Revenue', options: { value: 1930000 } }],
    } as unknown as DashboardComponentSchema;

    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
        <DashboardRenderer schema={schema} />
      </I18nProvider>,
    );

    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('(g) the dashboard KPI path WITH a data source — the production shape', () => {
    const schema = {
      type: 'dashboard',
      name: 'sales',
      widgets: [{ id: 'revenue', type: 'metric', title: 'Total Revenue', options: { value: 1930000 } }],
    } as unknown as DashboardComponentSchema;

    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
        <DashboardRenderer schema={schema} dataSource={ADAPTER as never} />
      </I18nProvider>,
    );

    // The node key the dashboard emits since objectui#10859 batch 8 (phase 2b).
    const tile = container.querySelector('[data-obj-type="plugin-dashboard:metric"]');
    if (!tile) throw new Error('metric tile not rendered');

    // Case (d) renders the same dashboard with no adapter and cannot see this:
    // `dataSource` is `undefined` there, so React writes nothing.
    expect(container.innerHTML).not.toContain('[object Object]');
    expect(attributeNames(tile as HTMLElement)).not.toContain('datasource');
    // The KPI still renders its number — the adapter is dropped, not the widget.
    expect(container.textContent).toContain('1,930,000');
  });

  it('(e) genuine DOM / aria passthrough survives — the spread is not removed, and `name` is not part of it', () => {
    const { container } = renderSchema({
      type: 'plugin-dashboard:metric',
      label: 'Total Revenue',
      value: 1930000,
      ...SCHEMA_METADATA,
      className: 'kpi-tile',
    });

    const el = card(container);
    // Authored DOM identity and ARIA, plus the renderer's own data attributes.
    expect(el.getAttribute('id')).toBe('revenue');
    // `name` is legal on form controls only. It reached this `div` while the
    // deny-list decided the spread; the `toDomProps` whitelist withholds it
    // (objectui#4425 — it was one of the leak-gate ledger's attributes).
    expect(el.hasAttribute('name')).toBe(false);
    expect(el.getAttribute('role')).toBe('group');
    expect(el.getAttribute('aria-label')).toBe('Revenue KPI');
    expect(el.getAttribute('aria-describedby')).toBe('desc-1');
    expect(el.getAttribute('data-obj-id')).toBe('revenue');
    expect(el.getAttribute('data-obj-type')).toBe('plugin-dashboard:metric');
    expect(el.className).toContain('kpi-tile');
  });

  it('(f) rendered output is otherwise byte-identical — label and formatted value', () => {
    const { container } = renderSchema({
      type: 'plugin-dashboard:metric',
      label: 'Total Revenue',
      value: 1930000,
      ...SCHEMA_METADATA,
    });

    expect(container.textContent).toContain('Total Revenue');
    // The KPI formatter's own contract: thousands separators, no decimals.
    expect(container.textContent).toContain('1,930,000');
  });
});
