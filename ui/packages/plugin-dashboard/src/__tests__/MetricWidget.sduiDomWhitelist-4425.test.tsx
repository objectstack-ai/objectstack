/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4425 — the KPI cards' two doors, pinned from both sides.
 *
 * The phase-2 ruling on objectui#4425 made `toDomProps` (`@object-ui/core`) the
 * SDUI widget contract: a registered widget's host element receives only what
 * that whitelist passes. `MetricWidget` and `MetricCard` used a deny-list
 * instead (`../schemaHostProps`, objectui#4357), and the leak gate in
 * `packages/app-shell` measured what a deny-list cannot close — the OPEN TAIL of
 * authored keys neither component declares, plus `name`, all landing on the
 * `Card` as attributes. On `metric-card` that tail included an authored
 * `label`, which put the would-be heading on the DOM as `label="Revenue"`.
 *
 * Both components now decide their host spread with `hostDomProps`, by door:
 *
 *   - RENDERER door (`SchemaRenderer`, which injects `schema`): the whitelist.
 *     Cases (a)–(c).
 *   - DIRECT React door: the declared `HTMLAttributes` pass-through
 *     (objectui#4426), unchanged — narrowing it while the exported interfaces
 *     still extend `HTMLAttributes` would type-check attributes the runtime
 *     drops. Case (d), with the renderer door as its control in (e).
 *
 * Why the host's attribute set is checked against a SHAPE rather than only a
 * list of canaries: the defect was an unbounded set, and a list of keys to look
 * for is a deny-list again. (a) asserts that every attribute on the host is
 * one the whitelist can produce, and names the planted canaries only so a red
 * says which family came back.
 *
 * DIRECTIONS, measured by ablating `hostDomProps` (each leg recorded on the
 * pull request):
 *
 *   - spreading the raw rest on both doors — which IS the pre-change runtime,
 *     the deny-list's destructure followed by an open spread — turns (a), (c)
 *     and (e) red, and the leak gate's two KPI targets with them. (b) and (d)
 *     stay green: the deliberate pass-through always arrived, and the direct
 *     door is the one this card leaves alone.
 *   - whitelisting both doors turns (d) red and nothing else. No older pin
 *     sees that door's beyond-the-whitelist half —
 *     `MetricWidget.domPassthrough.test.tsx` asserts only keys the whitelist
 *     also passes — so (d) is the one line holding the exported interfaces to
 *     what the runtime delivers.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRenderer } from '@object-ui/react';
// Module scope, per AGENTS.md's flaky-test rule: the barrel registers both
// components as a side effect, and the direct-door cases import them by name.
import { MetricWidget, MetricCard } from '../index';

afterEach(cleanup);

/** A data-source adapter shaped like the one a live dashboard injects. */
const ADAPTER = { name: 'fake', find: async () => ({ items: [] }), findOne: async () => null };

/** Deliberate pass-through, authored the SDUI way. Each must reach the host. */
const DELIBERATE = {
  id: 'revenue',
  testId: 'revenue-kpi',
  ariaLabel: 'Revenue KPI',
  className: 'kpi-tile',
} as const;

/** What must NOT reach the host, by family. */
const SDUI_METADATA = {
  bind: 'data.revenue',
  events: { onClick: [{ action: 'navigate', params: { url: '/deals' } }] },
  ariaDescribedBy: 'desc-1',
} as const;
const OPEN_TAIL = {
  name: 'revenue_kpi',
  zzcanary: 'CANARY-STR',
  zzcanaryobj: { nested: true },
  reference_to: 'contacts',
} as const;
const AUTHORED_PROPS = { colorVariant: 'success', zzcanaryprop: 'CANARY-PROP' } as const;

/** The attribute each planted key would have produced, had it leaked. */
const MUST_NOT_REACH = [
  'schema', 'bind', 'events', 'props', 'arialabel', 'ariadescribedby', 'datasource',
  'name', 'zzcanary', 'zzcanaryobj', 'reference_to', 'colorvariant', 'zzcanaryprop',
];

/**
 * The shape of everything `toDomProps` can put on a `div` once React has
 * rendered it: its named keys (`id`, `className` → `class`, `role`,
 * `tabIndex` → `tabindex`, `autoFocus` → `autofocus`) and the two open families.
 * The three React handlers it keeps never become attributes.
 */
const WHITELIST_SHAPED = /^(id|class|role|tabindex|autofocus|aria-.+|data-.+)$/;

function wrap(ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: {} }}>
      {ui}
    </I18nProvider>,
  );
}

function renderNode(node: Record<string, unknown>) {
  return wrap(<SchemaRenderer schema={node as never} dataSource={ADAPTER as never} />);
}

function host(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!el) throw new Error('nothing rendered');
  return el as HTMLElement;
}

const names = (el: HTMLElement) => Array.from(el.attributes).map((a) => a.name);

describe('objectui#4425 — the KPI cards on the renderer door spread only the `toDomProps` whitelist', () => {
  it.each([
    ['plugin-dashboard:metric', { label: 'Total Revenue', value: 1930000 }, 'Total Revenue'],
    // `label` on a card is an undeclared key: the heading is `title`.
    ['plugin-dashboard:metric-card', { title: 'Total Revenue', value: 1930000, label: 'Revenue' }, 'Total Revenue'],
  ] as const)('(a) %s: every host attribute is whitelist-shaped, and no planted key arrives', (type, own, heading) => {
    const { container } = renderNode({
      type,
      ...own,
      ...DELIBERATE,
      ...SDUI_METADATA,
      ...OPEN_TAIL,
      props: { ...AUTHORED_PROPS },
    });
    const el = host(container);

    expect(names(el).filter((name) => !WHITELIST_SHAPED.test(name))).toEqual([]);
    expect(names(el).filter((name) => MUST_NOT_REACH.includes(name))).toEqual([]);
    expect(container.innerHTML).not.toContain('[object Object]');
    expect(container.innerHTML).not.toContain('CANARY');
    // The card still draws itself: heading and value.
    expect(container.textContent).toContain(heading);
  });

  it.each(['plugin-dashboard:metric', 'plugin-dashboard:metric-card'])(
    '(b) %s: the deliberate pass-through still reaches the host',
    (type) => {
      const { container } = renderNode({
        type,
        label: 'Total Revenue',
        title: 'Total Revenue',
        value: 1,
        ...DELIBERATE,
        ...OPEN_TAIL,
      });
      const el = host(container);

      expect(el.getAttribute('id')).toBe('revenue');
      expect(el.getAttribute('data-testid')).toBe('revenue-kpi');
      expect(el.getAttribute('aria-label')).toBe('Revenue KPI');
      expect(el.getAttribute('data-obj-type')).toBe(type);
      expect(el.className).toContain('kpi-tile');
    },
  );

  it('(c) an authored `label` on a metric card is never a DOM attribute', () => {
    // The triage line on objectui#4425: "Never a DOM attribute". Whether it
    // should instead render as the heading or be refused at authoring is that
    // card's open question, so this pins the attribute half only.
    const { container } = renderNode({ type: 'plugin-dashboard:metric-card', value: 42, label: 'Revenue' });

    expect(host(container).hasAttribute('label')).toBe(false);
    expect(container.innerHTML).not.toContain('label="Revenue"');
  });
});

describe('objectui#4425 — the direct React door keeps its declared `HTMLAttributes` pass-through', () => {
  it('(d) attributes the interfaces declare beyond the whitelist still reach the element', () => {
    const widget = wrap(
      <MetricWidget label="Total Revenue" value={1} id="w" title="Revenue, trailing 12 months" lang="fr" />,
    );
    const widgetEl = host(widget.container);
    expect(widgetEl.getAttribute('id')).toBe('w');
    expect(widgetEl.getAttribute('title')).toBe('Revenue, trailing 12 months');
    expect(widgetEl.getAttribute('lang')).toBe('fr');
    cleanup();

    // `MetricCardProps` omits the DOM `title` (it is the heading), so the card's
    // beyond-the-whitelist witness is `lang` alone.
    const card = wrap(<MetricCard title="Total Revenue" value={1} id="c" lang="fr" />);
    const cardEl = host(card.container);
    expect(cardEl.getAttribute('id')).toBe('c');
    expect(cardEl.getAttribute('lang')).toBe('fr');
    expect(cardEl.hasAttribute('title')).toBe(false);
  });

  it('(e) CONTROL — the same keys authored on the node are withheld on the renderer door', () => {
    // The pair that shows (d) is a property of the DOOR, not of the keys: the
    // same `title` / `lang` that the direct door forwards stop here.
    const { container } = renderNode({
      type: 'plugin-dashboard:metric',
      label: 'Total Revenue',
      value: 1,
      title: 'Revenue, trailing 12 months',
      lang: 'fr',
    });
    const el = host(container);
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.hasAttribute('lang')).toBe(false);
  });
});
