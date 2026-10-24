/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13134 — the phone card list scrolls in a box of its own.
 *
 * Below the 768px breakpoint ObjectGrid draws stacked cards instead of the
 * table. The table scrolls in its own body; the card list had no scroll box at
 * all and was drawn straight into its host, and the console's host (`ListView`'s
 * view area) is `overflow-hidden`. So a card list taller than the screen was
 * clipped with nothing to scroll, and the console could not leave room at the
 * list's end for its floating create button: padding inside a clipping box
 * makes no scroll room.
 *
 * What this file pins is the shape a layout engine needs, since happy-dom has
 * none (every rect is 0x0): the cards sit inside one box that is the
 * scroller (`h-full`, `overflow-y-auto`) and marks itself `data-fab-clearance`
 * for a host to pad. The host's half (the padding, and only while its button
 * is drawn) is pinned beside the host, in app-shell's
 * `ObjectView.mobileFabListClearance-13134.test.tsx`. The geometry itself
 * (which box scrolls at 390x844, where the last card lands) is a browser
 * reading, recorded on the pull request.
 *
 * Direction predicted before the first run: the phone case RED on the base
 * tree (no `data-fab-clearance` box), the desktop case GREEN on both trees
 * (the table never carried the marker).
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: px });
}

afterEach(() => {
  setWidth(ORIGINAL_INNER_WIDTH);
  cleanup();
});

const PROJECTS = [
  { id: 'p1', name: 'Website Relaunch', account: 'Northwind', health: 'green' },
  { id: 'p2', name: 'Data Platform', account: 'Contoso', health: 'yellow' },
  { id: 'p3', name: 'Compliance Audit', account: 'Fabrikam', health: 'red' },
  { id: 'p4', name: 'Mobile App', account: 'Contoso', health: 'green' },
  { id: 'p5', name: 'Legacy Sunset', account: 'Northwind', health: 'green' },
];

async function renderGrid(width: number) {
  const ds = {
    find: vi.fn(async () => ({ data: PROJECTS, total: PROJECTS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        account: { type: 'text', label: 'Account' },
        health: { type: 'text', label: 'Health' },
      },
    }),
  } as any;
  const schema: any = {
    type: 'object-grid',
    objectName: 'showcase_project',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'account', label: 'Account' },
      { field: 'health', label: 'Health' },
    ],
    pagination: { pageSize: 50 },
  };
  setWidth(width);
  const view = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en' }}>
        <ActionProvider>
          <SchemaRendererProvider dataSource={ds}>
            <ObjectGrid schema={schema} dataSource={ds} />
          </SchemaRendererProvider>
        </ActionProvider>
      </LocalizationProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByText('Legacy Sunset')).toBeInTheDocument());
  return view;
}

const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

describe('the phone card list scrolls in a box of its own (objectui#13134)', () => {
  it('at 390px every card sits inside one marked scroller that a host can pad', async () => {
    const { container } = await renderGrid(390);

    const marked = container.querySelectorAll('[data-fab-clearance]');
    expect(marked).toHaveLength(1);
    const scroller = marked[0];

    // It is the scroll box itself, so padding at its end is scroll room.
    expect(tokens(scroller)).toEqual(expect.arrayContaining(['h-full', 'overflow-y-auto']));
    // Every card, the last one included, scrolls inside it.
    for (const row of PROJECTS) {
      expect(scroller).toContainElement(screen.getByText(row.name));
    }
    // With no host to pad it, it adds no room of its own: the end room is the
    // host's to give, only while the host draws something over the list.
    expect(tokens(scroller).filter((t) => /^(?:p|pb|py)-/.test(t))).toEqual([]);
  });

  it('at 1280px the table draws, and nothing carries the marker', async () => {
    const { container } = await renderGrid(1280);
    expect(container.querySelector('[data-fab-clearance]')).toBeNull();
  });
});
