/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13029 — the layout half of a navigation entry's API `dataSource`.
 *
 * The spec lets an entry declare `dataSource: { provider: 'api', read: { url },
 * path? }`, whose selected value its `visible` reads as `data`. Reading the
 * binding is the host's job (the console's is `useNavVisibility` in
 * `@object-ui/app-shell`), so this layer does two things, both pinned here:
 *
 *  - the item guard hands the evaluator the ENTRY beside its `visible`, on
 *    every path that shares the guard (the rows, the derived area visibility,
 *    the Favorites section), so a host evaluator can read the entry's binding;
 *  - the default evaluator, which reads no binding, hides an entry that
 *    declares one (an unknown navigation gate is closed). An entry without the
 *    key is drawn exactly as before.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer, hasVisibleNavigationItems } from '../NavigationRenderer';

const APP = '/apps/crm';

const BOUND: NavigationItem = {
  id: 'nav_onboarding',
  type: 'page',
  label: 'Onboarding',
  pageName: 'onboarding',
  visible: 'data.total == 1',
  dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'summary' },
};
const PLAIN: NavigationItem = { id: 'nav_home', type: 'page', label: 'Home', pageName: 'home', visible: true };

function renderNav(items: NavigationItem[], props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter initialEntries={[APP]}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={items} basePath={APP} {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('objectui#13029 — the item guard hands a host evaluator the entry it judges', () => {
  it('the evaluator receives each entry beside its `visible`, and its verdict decides the row', () => {
    const evaluateVisibility = vi.fn((_expr: unknown, entry?: NavigationItem) => entry?.id !== 'nav_home');
    renderNav([BOUND, PLAIN], { evaluateVisibility });
    expect(evaluateVisibility).toHaveBeenCalledWith('data.total == 1', BOUND);
    expect(evaluateVisibility).toHaveBeenCalledWith(true, PLAIN);
    expect(screen.getByRole('link', { name: 'Onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
  });

  it('the derived area visibility asks the same evaluator with the entry', () => {
    const evaluateVisibility = vi.fn((_expr: unknown, entry?: NavigationItem) => entry === BOUND);
    expect(hasVisibleNavigationItems([BOUND], { evaluateVisibility })).toBe(true);
    expect(evaluateVisibility).toHaveBeenCalledWith('data.total == 1', BOUND);
  });
});

describe('objectui#13029 — the default evaluator reads no binding, so it hides an entry that declares one', () => {
  it('a bound entry is not drawn, and an entry without the key is drawn on first paint', () => {
    renderNav([BOUND, PLAIN]);
    expect(screen.queryByRole('link', { name: 'Onboarding' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
  });

  it('an area holding only a bound entry derives hidden; one with a plain entry derives shown', () => {
    expect(hasVisibleNavigationItems([BOUND])).toBe(false);
    expect(hasVisibleNavigationItems([PLAIN])).toBe(true);
  });
});
