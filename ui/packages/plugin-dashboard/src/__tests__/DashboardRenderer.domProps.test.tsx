/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The DOM pass-through contract of `DashboardRenderer`'s widget-grid container
 * (objectui#4432, migration step 2 of objectui#4425 phase 2).
 *
 * ## What these pin that the sweep gate cannot
 *
 * `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx` is the
 * cross-package ratchet: it proves nothing UNEXPLAINED arrives, and its
 * `plugin-dashboard:dashboard` row expired with this fix. These cases are the
 * other half, in this package, next to the code:
 *
 *  - the exact attribute SET on the host element — so a key that stops being
 *    DELIVERED (`role`, `aria-label`, `data-obj-id`, `tabindex`) is as red as a
 *    key that leaks. The sweep structurally cannot see that direction: it looks
 *    for attributes that arrive, not for ones that go missing. Removing a spread
 *    can regress accessibility just as quietly as leaving it in place leaks.
 *  - the two items objectui#4432 named, each asserted as a PAIR so neither half
 *    can drift: the camelCase `arialabel` / `ariadescribedby` gone while the
 *    RESOLVED `aria-label` / `aria-describedby` — the spellings assistive
 *    technology actually reads — stay with their values.
 *  - the click channel, which is the one place the removed spread was
 *    OVERRIDING a computed prop rather than merely adding attributes.
 *
 * ## Why the adapter is attached
 *
 * `dataSource` is not a schema key: `SchemaRenderer` strips the node's own
 * `dataSource` BINDING by name (objectstack#5576), and the one that reaches a
 * widget is the injected ADAPTER a host hands the renderer. It therefore only
 * appears on a deployment that really loads data — which is why PR #4428 shipped
 * a six-key first pass measured against a schema-only fixture and missed exactly
 * that key. `DashboardRenderer` happens to destructure the adapter (so it was
 * never among this container's 13 leaked attributes), but a fixture that cannot
 * SEE the key cannot pin its absence either, so every render here goes through
 * `SchemaRendererProvider` WITH an adapter.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Side-effect import: the package barrel is what registers
// `plugin-dashboard:dashboard` (it was `view:dashboard` until objectui#9533
// converged the bare key; that spelling now resolves to a refusal tombstone,
// pinned in `dashboardBareKeyOwnership.test.tsx`).
// At MODULE scope (never inside a case) per AGENTS.md's flaky-test rule — the
// cost lands in the import phase, unbounded by any timeout.
import { DashboardRenderer } from '../index';

afterEach(cleanup);

/** The injected adapter. Answers empty so nothing lands in an error state. */
const ADAPTER = {
  find: async () => [],
  findOne: async () => null,
  aggregate: async () => [],
  count: async () => 0,
  getObject: async () => null,
  queryDataset: async () => ({ rows: [] }),
};

/**
 * One dashboard node carrying every family the renderer hands a widget:
 * authored SDUI metadata, the camelCase ARIA the resolver converts, the DOM
 * identity keys that must survive, an open tail of keys no component declares,
 * and a `props` container whose CONTENTS the renderer spreads separately.
 *
 * Deliberately the same canary vocabulary the sweep gate plants, so the two
 * gates report one vocabulary rather than two.
 */
const CANARY_NODE = {
  type: 'plugin-dashboard:dashboard',
  id: 'canary-node',
  name: 'canary_node',
  className: 'zz-authored-class',
  role: 'region',
  tabIndex: 0,
  bind: 'data.revenue',
  events: { onClick: [{ action: 'navigate', params: { url: '/x' } }] },
  ariaLabel: 'Canary label',
  ariaDescribedBy: 'canary-desc',
  zzcanary: 'CANARY-STR',
  zzcanaryobj: { nested: true },
  zzcanarynum: 42,
  zzcanaryCamel: 'CANARY-CAMEL',
  reference_to: 'contacts',
  props: { colorVariant: 'success', zzcanaryprop: 'CANARY-PROP' },
} as const;

/** Renders the dashboard through the real SDUI host and returns the grid. */
async function renderCanaryDashboard(): Promise<HTMLElement> {
  render(
    <SchemaRendererProvider dataSource={ADAPTER as never}>
      <SchemaRenderer schema={CANARY_NODE as never} dataSource={ADAPTER as never} />
    </SchemaRendererProvider>,
  );

  // Non-vacuity: the REAL grid must exist before anything is scanned. The
  // responsive flow layout is the branch this node takes (no `columns`), and
  // `auto-rows-min` is what identifies it.
  await waitFor(() => {
    if (!document.body.querySelector('.grid.auto-rows-min')) {
      throw new Error(
        'the widget grid never rendered, so scanning it would measure nothing. ' +
          `Body was:\n${document.body.innerHTML.slice(0, 600)}`,
      );
    }
  });

  const grid = document.body.querySelector<HTMLElement>('[data-obj-id="canary-node"]');
  if (!grid) {
    throw new Error(
      'no element carries data-obj-id — either the container stopped forwarding ' +
        "the renderer's own identity attributes, or it never rendered.",
    );
  }
  return grid;
}

function attributeNames(element: Element): string[] {
  return Array.from(element.attributes)
    .map((attribute) => attribute.name)
    .sort();
}

describe("DashboardRenderer's widget grid — only whitelisted DOM props (objectui#4432)", () => {
  it('carries EXACTLY the whitelisted DOM attributes — no more, no fewer', async () => {
    const grid = await renderCanaryDashboard();

    // Exact set equality, the sweep ledger's own discipline applied locally: a
    // new leak fails, and so does a DOM key that silently stops being
    // delivered. `class` and `style` are the container's OWN computed grid
    // layout, not pass-through.
    expect(attributeNames(grid)).toEqual([
      'aria-describedby',
      'aria-label',
      'class',
      'data-obj-id',
      'data-obj-type',
      'id',
      'role',
      'style',
      'tabindex',
    ]);

    // The whitelisted keys carry their real values — an empty pass-through
    // would satisfy the set above only by also losing these.
    expect(grid).toHaveAttribute('id', 'canary-node');
    expect(grid).toHaveAttribute('data-obj-type', 'plugin-dashboard:dashboard');
    expect(grid).toHaveAttribute('role', 'region');
    expect(grid).toHaveAttribute('tabindex', '0');
    expect(grid.className).toContain('zz-authored-class');
    // The component's own grid layout survived the reordered spread.
    expect(grid.className).toContain('auto-rows-min');
    expect(grid.getAttribute('style')).toContain('gap');
  });

  it('drops the SDUI metadata, the `props` container and the open tail', async () => {
    const grid = await renderCanaryDashboard();

    // The 13 attributes objectui#4432 measured, by name.
    for (const attribute of [
      'ariadescribedby',
      'arialabel',
      'bind',
      'colorvariant',
      'events',
      'name',
      'props',
      'reference_to',
      'zzcanary',
      'zzcanarycamel',
      'zzcanarynum',
      'zzcanaryobj',
      'zzcanaryprop',
    ]) {
      expect(grid, `the grid leaked ${attribute}`).not.toHaveAttribute(attribute);
    }

    // `schema` and `datasource` were never among the 13 — the renderer injects
    // the first and this component destructures the second — so pin them too,
    // or the whitelist could stop covering them without any case going red.
    expect(grid).not.toHaveAttribute('schema');
    expect(grid).not.toHaveAttribute('datasource');

    // The mechanism half: an object that reaches an attribute is `String()`-ed,
    // so a stringified object anywhere on the element means something non-DOM
    // got through under some other name.
    const stringified = Array.from(grid.attributes)
      .filter((attribute) => attribute.value.includes('[object Object]'))
      .map((attribute) => `${attribute.name}="${attribute.value}"`);
    expect(stringified).toEqual([]);
  });

  it('drops the camelCase ARIA and keeps the resolved spellings', async () => {
    const grid = await renderCanaryDashboard();

    // Meaningless to assistive technology — these are the AUTHORED keys, and
    // the resolver already emitted the hyphenated forms from them.
    expect(grid).not.toHaveAttribute('arialabel');
    expect(grid).not.toHaveAttribute('ariadescribedby');
    // The half that MUST survive: dropping these would be an accessibility
    // regression dressed as a leak fix.
    expect(grid).toHaveAttribute('aria-label', 'Canary label');
    expect(grid).toHaveAttribute('aria-describedby', 'canary-desc');
  });
});

/**
 * The one place the removed spread was OVERRIDING a computed prop rather than
 * only adding attributes: `onClick`.
 *
 * `onClick` is a declared DOM pass-through key of the SDUI widget contract AND
 * this container computes its own design-mode background handler. The old
 * trailing `{...props}` spread resolved that collision by letting the incoming
 * handler REPLACE the computed one, so a host that passed `onClick` silently
 * lost background deselection. Dropping the incoming handler would be the
 * mirror failure — a whitelisted key that never arrives. Both run now, and both
 * directions are asserted here so neither can be quietly restored.
 */
describe("the grid's click channel has one carrier (objectui#4432)", () => {
  const DASHBOARD = {
    type: 'dashboard',
    name: 'sales',
    widgets: [],
  } as never;

  it('a host onClick and the design-mode background handler BOTH fire', () => {
    const hostClicks: string[] = [];
    const selections: Array<string | null> = [];

    const { container } = render(
      <DashboardRenderer
        schema={DASHBOARD}
        designMode
        // `id` is annotated rather than inferred. This used to be load-bearing:
        // `DashboardRendererProps` carried a `[key: string]: any`, which made
        // `'ref' extends keyof Props` true, so React's `PropsWithoutRef`
        // resolved to `Pick<Props, string | number>` and every NAMED prop —
        // `onWidgetClick` included — collapsed to the index signature at the
        // JSX call site. The annotation restated the type the interface itself
        // still declared, so this callback was checked even though the element
        // around it was not (objectui#4040).
        //
        // objectui#4528 removed that index signature, so the annotation is now
        // REDUNDANT rather than load-bearing — `onWidgetClick` resolves to the
        // declared `(widgetId: string | null) => void` on its own, and
        // `DashboardRenderer.propsResolution.test.ts` pins exactly that. It is
        // kept because restating a declared type costs nothing and this call
        // site reads more clearly with the contract spelled out; deleting it
        // would also be correct.
        onWidgetClick={(id: string | null) => selections.push(id)}
        onClick={() => hostClicks.push('host')}
      />,
    );

    const grid = container.querySelector<HTMLElement>('.grid');
    if (!grid) throw new Error('the widget grid never rendered');
    fireEvent.click(grid);

    // The container affordance: a background click deselects.
    expect(selections).toEqual([null]);
    // The whitelisted key really arrives — this is the half the old spread got
    // right and a naive `toDomProps` migration would have dropped.
    expect(hostClicks).toEqual(['host']);
  });

  it('a non-function onClick is ignored instead of handed to React', () => {
    // SDUI spells click behaviour `events: { onClick: [ActionDef] }`, which is
    // DATA and is dropped by the whitelist. An authored literal `onClick`
    // string used to reach React through the spread and throw.
    const selections: Array<string | null> = [];

    const { container } = render(
      <DashboardRenderer
        schema={DASHBOARD}
        designMode
        // Annotated for the same reason as the case above.
        onWidgetClick={(id: string | null) => selections.push(id)}
        onClick={'navigate' as never}
      />,
    );

    const grid = container.querySelector<HTMLElement>('.grid');
    if (!grid) throw new Error('the widget grid never rendered');
    expect(() => fireEvent.click(grid)).not.toThrow();
    expect(selections).toEqual([null]);
  });
});
