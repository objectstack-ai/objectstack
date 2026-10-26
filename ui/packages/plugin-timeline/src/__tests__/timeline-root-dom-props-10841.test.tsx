/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10841: an authored `plugin-timeline:timeline` node does not write
 * its own schema onto the root element as attributes.
 *
 * ## The defect
 *
 * `SchemaRenderer` hands a registered renderer, as React props, every node key
 * its metadata strip leaves. `TimelineRenderer` collected every prop it did not name
 * and spread the lot onto the root element of each variant, so the authored
 * schema ended up in the DOM: `items="[object Object]"`, `variant="vertical"`,
 * `dateformat="long"`, `rowlabel`, `mindate`, `maxdate`, plus a React
 * unknown-prop warning per camelCase key. The renderer reads every one of those
 * keys off `schema`; the props copy was surplus.
 *
 * ## What each case pins, and its control
 *
 * One authored node per variant, through the REAL `SchemaRenderer` and the
 * real registry (the package entry is imported below, exactly as a host does),
 * so the prop bag under test is the one a host actually produces:
 *
 * - no attribute named after a schema key the node authors (`items` and
 *   `variant` by name, as the triage asked, and every other key of the node);
 * - every attribute on the root is `class`, `style`, or one the SDUI widget
 *   contract forwards: a key of `SDUI_DOM_PASS_THROUGH_KEYS` or the open
 *   `data-*` / `aria-*` families. The set is IMPORTED from `@object-ui/core`,
 *   the one place it is declared, so this pin cannot become a third copy;
 * - the CONTROL: what the contract forwards still lands. `data-testid` from the
 *   authored `testId`, `data-obj-id` / `data-obj-type`, `id`, `tabindex` from
 *   an authored `tabIndex` (a contract key a private allowlist once dropped),
 *   and on the vertical case `aria-label` / `role` / `style`. A fix that dropped
 *   the bag outright, or filtered it through a narrower list than the contract,
 *   would pass every absence above and fail here.
 * - no React unknown-prop / invalid-ARIA warning during the render.
 *
 * The grouped vertical branch runs when the items carry a `group` key.
 * objectui#6356 ruled `group` renderer-internal (only `ObjectTimeline` writes
 * it), so an authored `group` is off-spec. It still renders, and it is the only
 * way to hand that branch the prop bag `SchemaRenderer` builds; `ObjectTimeline`
 * itself passes `schema` and nothing else, which the last case pins as the
 * route that never leaked.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { SDUI_DOM_PASS_THROUGH_KEYS } from '@object-ui/core';
// Registers `plugin-timeline:timeline` and `view:timeline`, as a host does.
import '../index';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The DOM-side spellings React warns with when a prop is not a DOM attribute. */
const DOM_PROP_WARNING = /React does not recognize|Invalid ARIA attribute|Unknown event handler property|for a non-boolean attribute/;

/**
 * The attribute names the contract's named keys become on an element. Event
 * handlers (`on*`) never become attributes, so an `onclick` attribute would be
 * a leak, not a forward; `className` lands as `class`.
 */
const CONTRACT_ATTRIBUTES = new Set(
  SDUI_DOM_PASS_THROUGH_KEYS.filter((key) => !key.startsWith('on')).map((key) =>
    key === 'className' ? 'class' : key.toLowerCase(),
  ),
);

/** Attributes the root may carry: the contract's, `style` by name, and the two open families. */
const isAllowedRootAttribute = (name: string) =>
  CONTRACT_ATTRIBUTES.has(name) || name === 'style' || name.startsWith('data-') || name.startsWith('aria-');

/**
 * Authored keys whose job IS to reach the DOM, so their spelling on the root is
 * not a leak: the contract's named keys and `style` land as themselves, and
 * `testId` / `ariaLabel` are re-emitted by `SchemaRenderer` as `data-testid` /
 * `aria-label`.
 */
const DOM_INTENT_KEYS = new Set<string>(['type', 'style', 'testId', 'ariaLabel', ...SDUI_DOM_PASS_THROUGH_KEYS]);

function renderNode(node: Record<string, unknown>) {
  const warnings: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
  const { container } = render(<SchemaRenderer schema={node as never} />);
  expect(container.children, 'the node did not render exactly one root element').toHaveLength(1);
  const root = container.firstElementChild as HTMLElement;
  return { root, domWarnings: warnings.filter((w) => DOM_PROP_WARNING.test(w)) };
}

function expectNoSchemaKeyAttributes(root: HTMLElement, node: Record<string, unknown>) {
  // Named by the triage (objectui#10841, execution note 2).
  expect(root.hasAttribute('items'), `root carries items="${root.getAttribute('items')}"`).toBe(false);
  expect(root.hasAttribute('variant'), `root carries variant="${root.getAttribute('variant')}"`).toBe(false);
  // Every other key this node authors, in the lowercase form a DOM attribute takes.
  for (const key of Object.keys(node)) {
    if (DOM_INTENT_KEYS.has(key)) continue;
    expect(root.hasAttribute(key.toLowerCase()), `authored key \`${key}\` landed on the root as an attribute`).toBe(false);
  }
  const stray = Array.from(root.attributes).map((a) => a.name).filter((n) => !isAllowedRootAttribute(n));
  expect(stray, 'the root carries attributes outside the forwarded DOM set').toEqual([]);
}

function expectLocatorsLand(root: HTMLElement, node: { id: string; testId: string; tabIndex: number }) {
  expect(root.getAttribute('data-testid'), 'the authored `testId` no longer reaches the root').toBe(node.testId);
  expect(root.getAttribute('tabindex'), 'the contract key `tabIndex` no longer reaches the root').toBe(String(node.tabIndex));
  expect(root.getAttribute('id')).toBe(node.id);
  expect(root.getAttribute('data-obj-id')).toBe(node.id);
  expect(root.getAttribute('data-obj-type')).toBe('plugin-timeline:timeline');
}

describe('TimelineRenderer root element carries no authored schema key (objectui#10841)', () => {
  it('vertical, flat: no schema-key attribute; id, style, role, tabindex, aria-label and data-* still land', () => {
    const node = {
      type: 'plugin-timeline:timeline',
      id: 'rail-vertical',
      testId: 'rail-vertical-tid',
      tabIndex: 0,
      ariaLabel: 'Project history',
      role: 'region',
      style: { padding: 2 },
      variant: 'vertical',
      dateFormat: 'long',
      items: [{ time: '2024-01-15', title: 'Kickoff' }],
    };
    const { root, domWarnings } = renderNode(node);

    // The flat branch's own root: the `Timeline` `<ol>` rail.
    expect(root.tagName).toBe('OL');
    expect(root.textContent).toContain('Kickoff');

    expectNoSchemaKeyAttributes(root, node);
    expectLocatorsLand(root, node);
    expect(root.getAttribute('aria-label')).toBe('Project history');
    expect(root.getAttribute('role')).toBe('region');
    expect(root.style.padding).toBe('2px');
    expect(domWarnings, 'React warned about a prop spread onto the DOM').toEqual([]);
  });

  it('vertical, grouped: no schema-key attribute; data-testid and tabindex still land', () => {
    const node = {
      type: 'plugin-timeline:timeline',
      id: 'rail-grouped',
      testId: 'rail-grouped-tid',
      tabIndex: 0,
      variant: 'vertical',
      dateFormat: 'short',
      items: [{ time: '2024-01-15', title: 'Kickoff', group: 'January' }],
    };
    const { root, domWarnings } = renderNode(node);

    // The grouped branch's own root: a `div` holding one section per bucket.
    expect(root.tagName).toBe('DIV');
    expect(root.querySelector('section header')?.textContent).toContain('January');

    expectNoSchemaKeyAttributes(root, node);
    expectLocatorsLand(root, node);
    expect(domWarnings, 'React warned about a prop spread onto the DOM').toEqual([]);
  });

  it('horizontal: no schema-key attribute; data-testid and tabindex still land', () => {
    const node = {
      type: 'plugin-timeline:timeline',
      id: 'rail-horizontal',
      testId: 'rail-horizontal-tid',
      tabIndex: 0,
      variant: 'horizontal',
      dateFormat: 'short',
      items: [{ time: '2024-01-15', title: 'Q1' }],
    };
    const { root, domWarnings } = renderNode(node);

    expect(root.tagName).toBe('DIV');
    expect(root.textContent).toContain('Q1');

    expectNoSchemaKeyAttributes(root, node);
    expectLocatorsLand(root, node);
    expect(domWarnings, 'React warned about a prop spread onto the DOM').toEqual([]);
  });

  it('gantt: no schema-key attribute (scale, rowLabel, minDate, maxDate included); data-testid and tabindex still land', () => {
    const node = {
      type: 'plugin-timeline:timeline',
      id: 'rail-gantt',
      testId: 'rail-gantt-tid',
      tabIndex: 0,
      variant: 'gantt',
      dateFormat: 'short',
      scale: 'month',
      rowLabel: 'Workstreams',
      minDate: '2024-01-01',
      maxDate: '2024-03-01',
      items: [{ label: 'Backend', items: [{ title: 'API', startDate: '2024-01-02', endDate: '2024-01-20' }] }],
    };
    const { root, domWarnings } = renderNode(node);

    // The drawn chart, not one of the gantt refusals (those carry `role="alert"`).
    expect(root.getAttribute('role')).toBeNull();
    expect(root.textContent).toContain('Workstreams');
    expect(root.textContent).toContain('Backend');

    expectNoSchemaKeyAttributes(root, node);
    expectLocatorsLand(root, node);
    expect(domWarnings, 'React warned about a prop spread onto the DOM').toEqual([]);
  });

  it('control: the object-bound `timeline` route hands the renderer `schema` alone, and its rail carries no schema key', async () => {
    const adapter = {
      find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Spring launch', start_date: '2024-01-02' }] }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'campaign',
        fields: { name: { type: 'text' }, start_date: { type: 'datetime' } },
      }),
    };
    const { container } = render(
      <SchemaRendererProvider dataSource={adapter as never}>
        <SchemaRenderer
          schema={{
            type: 'timeline',
            objectName: 'campaign',
            variant: 'vertical',
            timeline: { startDateField: 'start_date', titleField: 'name' },
          } as never}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(container.querySelector('ol')).not.toBeNull());
    const rail = container.querySelector('ol') as HTMLElement;
    expect(rail.textContent).toContain('Spring launch');
    expect(Array.from(rail.attributes).map((a) => a.name)).toEqual(['class']);
  });
});
