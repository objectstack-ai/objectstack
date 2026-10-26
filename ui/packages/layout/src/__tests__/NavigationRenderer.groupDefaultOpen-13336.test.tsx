/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13336 — a navigation group opens on first view unless it declares
 * otherwise; its length does not decide.
 *
 * Before: a group with no `expanded` and eight or more children started
 * collapsed, so Setup's 13-entry Configuration group was closed although only
 * Advanced declares `expanded: false`. Now the initial state is: open when the
 * current route is inside the group; else the group's `expanded` (or legacy
 * `defaultOpen`) when declared; else open.
 *
 * Read through the disclosure's `aria-expanded` and through the children
 * being in the DOM (Radix unmounts a closed `CollapsibleContent`).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer } from '../NavigationRenderer';

const BASE = '/apps/setup';

const entries = (prefix: string, count: number): NavigationItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_${i + 1}`,
    type: 'object',
    objectName: `${prefix}_${i + 1}`,
    label: `${prefix} ${i + 1}`,
  })) as NavigationItem[];

/** Setup's shape: a long undeclared group, and a short one declared closed. */
const ITEMS: NavigationItem[] = [
  { id: 'grp_configuration', type: 'group', label: 'Configuration', children: entries('config', 13) },
  { id: 'grp_advanced', type: 'group', label: 'Advanced', expanded: false, children: entries('advanced', 3) },
] as NavigationItem[];

function renderNav(items: NavigationItem[], path = BASE) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={items} basePath={BASE} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const disclosure = (label: string) => screen.getByRole('button', { name: label });

afterEach(cleanup);

describe('NavigationRenderer — a group opens unless it declares otherwise (objectui#13336)', () => {
  it('an undeclared group of 13 children opens, every child reachable', () => {
    renderNav(ITEMS);
    expect(disclosure('Configuration')).toHaveAttribute('aria-expanded', 'true');
    for (let i = 1; i <= 13; i += 1) {
      expect(screen.getByRole('link', { name: `config ${i}` })).toHaveAttribute('href', `${BASE}/config_${i}`);
    }
  });

  it('a group declaring `expanded: false` stays collapsed', () => {
    renderNav(ITEMS);
    expect(disclosure('Advanced')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'advanced 1' })).not.toBeInTheDocument();
  });

  it('the legacy `defaultOpen: false` is honoured the same way', () => {
    renderNav([
      { id: 'grp_legacy', type: 'group', label: 'Legacy', defaultOpen: false, children: entries('legacy', 2) },
    ] as NavigationItem[]);
    expect(disclosure('Legacy')).toHaveAttribute('aria-expanded', 'false');
  });

  it('a group holding the active route opens, even when it declares `expanded: false`', () => {
    renderNav(ITEMS, `${BASE}/advanced_2`);
    expect(disclosure('Advanced')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'advanced 2' })).toBeInTheDocument();
  });
});
