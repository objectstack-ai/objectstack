/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7547 — switcher chrome around a single entry.
 *
 * `showViewSwitcher` reaches this component already decided, and both faces
 * that decide it compute the same wrong number: `app-shell/ObjectView` and
 * `app-shell/InterfaceListPage` count the LENGTH of
 * `appearance.allowedVisualizations`. That is the whitelist BEFORE this
 * component intersects it with the ADR-0047 capability gate — so a view
 * whitelisting `['grid', 'timeline']` with no timeline block whitelisted two,
 * resolved one, and drew the border / dropdown / separator cluster around a
 * Grid entry that could not switch to anything.
 *
 * Neither face can compute it: the gate that answers "does this type resolve?"
 * lives here, in `availableViews`. So the predicate is applied at the one site
 * holding both halves (`viewSwitcherOffered`), which is also why one change
 * covers BOTH doors.
 *
 * ⚠️ THE DISCRIMINATING PAIR IS THE POINT. A fix that simply stopped drawing
 * the switcher would pass every "no chrome" case below, so each of them is
 * matched by a control that whitelists the SAME two types and DECLARES the
 * second one's binding — chrome must still be drawn there. The two arms differ
 * in exactly one thing: whether the whitelisted second type resolves.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `{showViewSwitcher && (` at the render site and the "no chrome" arms
 * go RED (the cluster reappears around one entry) while every control stays
 * GREEN in either world — a resolvable second type was always offered.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

const makeDataSource = () =>
  ({
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
  }) as any;

const BASE = {
  type: 'list-view',
  objectName: 'task',
  viewType: 'grid',
  columns: ['name'],
} as const;

/**
 * Is switcher chrome on the page, in EITHER of its two forms?
 *
 * `ViewSwitcherDropdown` renders a segmented control for 2–4 visualizations and
 * a collapsed "List (chevron)" dropdown otherwise — which is why the one-entry
 * case this card is about drew the DROPDOWN form: a menu affordance whose menu
 * holds a single item. Asking for both forms is what keeps these cases about
 * "was a switcher offered", not about which shape it took.
 */
const anySwitcher = () =>
  screen.queryByTestId('view-switcher-segmented') ?? screen.queryByTestId('view-switcher-dropdown');

/**
 * Mount a view with the switcher ENABLED by the host — the state both app-shell
 * faces stamp — and report whether the switcher chrome was drawn.
 */
const chromeDrawn = (view: Record<string, unknown>) => {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...BASE, ...view } as never} dataSource={dataSource} showViewSwitcher />
    </SchemaRendererProvider>,
  );
  return Boolean(anySwitcher());
};

describe('the switcher is drawn for the RESOLVED list, not the whitelist (objectui#7547)', () => {
  it('draws NO chrome for `[grid, timeline]` with no timeline block', () => {
    // THE DEFECT, verbatim from the card. Two whitelisted, one resolvable.
    expect(
      chromeDrawn({ appearance: { allowedVisualizations: ['grid', 'timeline'] } }),
    ).toBe(false);
  });

  it('CONTROL: the SAME whitelist WITH a declared timeline axis keeps its chrome', () => {
    // The discriminating half. Nothing about this pair differs except whether
    // the second whitelisted type resolves, so a fix that just stopped drawing
    // the cluster cannot pass both.
    expect(
      chromeDrawn({
        appearance: { allowedVisualizations: ['grid', 'timeline'] },
        timeline: { startDateField: 'due_date' },
      }),
    ).toBe(true);
  });

  it('draws NO chrome for `[grid, kanban]` with no groupBy', () => {
    expect(
      chromeDrawn({ appearance: { allowedVisualizations: ['grid', 'kanban'] } }),
    ).toBe(false);
  });

  it('CONTROL: the same whitelist WITH a declared kanban lane keeps its chrome', () => {
    expect(
      chromeDrawn({
        appearance: { allowedVisualizations: ['grid', 'kanban'] },
        kanban: { groupByField: 'stage' },
      }),
    ).toBe(true);
  });

  it('draws NO chrome when every whitelisted extra type is unbound', () => {
    // Three whitelisted, still one resolvable — the length test read three.
    expect(
      chromeDrawn({ appearance: { allowedVisualizations: ['grid', 'kanban', 'calendar'] } }),
    ).toBe(false);
  });

  it('CONTROL: chrome for two resolvable types is untouched by this card', () => {
    expect(
      chromeDrawn({
        appearance: { allowedVisualizations: ['grid', 'kanban', 'calendar'] },
        kanban: { groupByField: 'stage' },
        calendar: { startDateField: 'due_date' },
      }),
    ).toBe(true);
  });

  it('CONTROL: the host can still switch the cluster OFF entirely', () => {
    // `viewSwitcherOffered` narrows the author's intent; it never widens it.
    const dataSource = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView
          schema={
            {
              ...WIDE_TOOLBAR,
              ...BASE,
              appearance: { allowedVisualizations: ['grid', 'kanban'] },
              kanban: { groupByField: 'stage' },
            } as never
          }
          dataSource={dataSource}
        />
      </SchemaRendererProvider>,
    );
    expect(anySwitcher()).toBeNull();
  });

  it('draws NO chrome for a whitelist of one, as before', () => {
    expect(chromeDrawn({ appearance: { allowedVisualizations: ['grid'] } })).toBe(false);
  });
});
