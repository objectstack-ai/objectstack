/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every navigation menu is a valid list (objectui#11690).
 *
 * axe (wcag2a + wcag2aa) on a Setup page measured `list` / `listitem` over the
 * sidebar: with drag-to-reorder on — the desktop default then — each row was
 * wrapped in the sortable `<div>`, so every `<ul>` held divs and every `<li>`
 * sat in a div. A separator and a nested group were the same fault with
 * reorder off: neither rooted at an `<li>`.
 *
 * The menu reorder is retired (objectui#12059); the one sortable list left is
 * the pinned section. The four shapes below are every way the renderer draws a
 * menu (grouped or group-free, the pinned section sortable or not), each
 * carrying a pinned entry and a separator and the grouped ones a nested group,
 * so the pin covers every arm a `<ul>` can hold.
 *
 * `color-contrast` is off: it needs layout happy-dom does not compute, and it
 * is outside the card.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer } from '../NavigationRenderer';

const BASE = '/apps/crm';

const leaf = (id: string, pinned = false): NavigationItem =>
  ({ id, type: 'object', objectName: id, label: id.toUpperCase(), ...(pinned ? { pinned } : {}) }) as NavigationItem;
const separator = (id: string): NavigationItem => ({ id, type: 'separator' }) as NavigationItem;

const GROUPED: NavigationItem[] = [
  leaf('t1', true),
  separator('sep_top'),
  leaf('t2'),
  {
    id: 'grp_a',
    type: 'group',
    label: 'Group A',
    children: [
      leaf('a1', true),
      separator('sep_a'),
      leaf('a2'),
      { id: 'grp_inner', type: 'group', label: 'Inner', children: [leaf('i1'), leaf('i2')] },
    ],
  },
];
const FLAT: NavigationItem[] = [leaf('f1', true), leaf('f2', true), separator('sep_flat'), leaf('f3')];

describe('NavigationRenderer draws valid lists (objectui#11690)', () => {
  it.each([
    ['grouped, pinned sort on', GROUPED, true],
    ['grouped, pinned sort off', GROUPED, false],
    ['group-free, pinned sort on', FLAT, true],
    ['group-free, pinned sort off', FLAT, false],
  ] as const)('%s: every menu holds only items, and axe finds nothing', async (_shape, items, pinnedSort) => {
    const { container } = render(
      <MemoryRouter initialEntries={[BASE]}>
        <SidebarProvider defaultOpen>
          <NavigationRenderer
            items={items as NavigationItem[]}
            basePath={BASE}
            onPinnedReorder={pinnedSort ? () => {} : undefined}
            enablePinning
            onPinToggle={() => {}}
          />
        </SidebarProvider>
      </MemoryRouter>,
    );

    const menus = [...container.querySelectorAll('ul')];
    expect(menus.length).toBeGreaterThan(0);
    for (const menu of menus) {
      expect([...menu.children].map((c) => c.tagName)).toEqual([...menu.children].map(() => 'LI'));
    }

    const res = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(res.violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.html) }))).toEqual([]);
    // Control: a zero above is a reading only if the list rules found lists to judge.
    expect(res.passes.map((p) => p.id)).toEqual(expect.arrayContaining(['list', 'listitem']));
  });
});
