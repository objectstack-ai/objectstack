/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37575: a navigation row whose props draw nothing new is not
 * redrawn.
 *
 * The console's sidebar draws one row per entry (about seventy on the showcase
 * app), each with the host's ⋯ menu and a tooltip, and the shell re-renders the
 * sidebar every time a boot read lands. Every one of those re-renders redrew
 * every row: on a list page's first load that was about eight passes over
 * ~2,700 components before first paint. A row is now memoised, and the three
 * target resolvers, which the host rebuilds whenever its metadata store
 * changes, are compared by what they answer for the row: its label, its icon
 * and its tile colour.
 *
 * The count is the host's `renderItemAction`, which a row calls each time it
 * draws.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarMenuAction, SidebarProvider } from '@object-ui/components';
import { NavigationRenderer, type NavigationRendererProps } from '../NavigationRenderer';

const BASE = '/apps/crm';

const ITEMS: NavigationItem[] = [
  { id: 'nav_leads', type: 'object', objectName: 'crm_lead' },
  { id: 'nav_accounts', type: 'object', objectName: 'account' },
  { id: 'nav_help', type: 'url', url: 'https://example.com/help', target: '_blank', label: 'Help' },
  {
    id: 'grp_sales',
    type: 'group',
    label: 'Sales',
    children: [{ id: 'nav_deals', type: 'object', objectName: 'deal' }],
  },
] as NavigationItem[];

const LABELS: Record<string, string> = { crm_lead: 'Leads', account: 'Accounts', deal: 'Deals' };

/** A fresh set of resolvers over `labels`: new functions, the same answers when `labels` is the same. */
function resolvers(labels: Record<string, string>) {
  return {
    resolveTargetLabel: (target: { kind: string; objectName?: string }) =>
      target.kind === 'object' && target.objectName ? labels[target.objectName] : undefined,
    resolveTargetIcon: (target: { kind: string; objectName?: string }) =>
      target.kind === 'object' && target.objectName ? `icon-${target.objectName}` : undefined,
    resolveTargetColor: (target: { kind: string; objectName?: string }) =>
      target.kind === 'object' && target.objectName === 'deal' ? 'emerald' : undefined,
  } as Pick<NavigationRendererProps, 'resolveTargetLabel' | 'resolveTargetIcon' | 'resolveTargetColor'>;
}

afterEach(cleanup);

function setup() {
  const drawn: string[] = [];
  // The host keeps its callbacks stable across renders, as `UnifiedSidebar` does.
  const renderItemAction: NavigationRendererProps['renderItemAction'] = (item) => {
    drawn.push(item.id);
    return <SidebarMenuAction data-testid={`host-action-${item.id}`} aria-label={`Host ${item.id}`} />;
  };
  const evaluateVisibility = () => true;
  const checkPermission = () => true;
  const onAction = () => {};
  const view = (props: Partial<NavigationRendererProps>) => (
    <MemoryRouter initialEntries={[BASE]}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer
          items={ITEMS}
          basePath={BASE}
          onAction={onAction}
          evaluateVisibility={evaluateVisibility}
          checkPermission={checkPermission}
          renderItemAction={renderItemAction}
          {...props}
        />
      </SidebarProvider>
    </MemoryRouter>
  );
  return { drawn, view };
}

describe('NavigationRenderer: a row with nothing new to draw is not redrawn (objectstack#37575)', () => {
  it('a re-render with the same props redraws no row', () => {
    const { drawn, view } = setup();
    const r = resolvers(LABELS);
    const { rerender } = render(view(r));
    expect(drawn.sort()).toEqual(['nav_accounts', 'nav_deals', 'nav_help', 'nav_leads']);
    drawn.length = 0;
    rerender(view(r));
    expect(drawn).toEqual([]);
  });

  it('new resolvers that answer the same for every row redraw no leaf row', () => {
    const { drawn, view } = setup();
    const { rerender } = render(view(resolvers(LABELS)));
    drawn.length = 0;
    rerender(view(resolvers({ ...LABELS })));
    expect(drawn).toEqual([]);
    expect(screen.getByText('Leads')).toBeInTheDocument();
  });

  it('a resolver that answers one row differently redraws that row only, with the new label', () => {
    const { drawn, view } = setup();
    const { rerender } = render(view(resolvers(LABELS)));
    drawn.length = 0;
    rerender(view(resolvers({ ...LABELS, account: 'Customers' })));
    expect(drawn).toEqual(['nav_accounts']);
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.queryByText('Accounts')).toBeNull();
  });

  it('an entry inside a group is compared on its own answers, and redrawn when they change', () => {
    const { drawn, view } = setup();
    const { rerender } = render(view(resolvers(LABELS)));
    drawn.length = 0;
    rerender(view(resolvers({ ...LABELS })));
    expect(drawn).toEqual([]);
    rerender(view(resolvers({ ...LABELS, deal: 'Opportunities' })));
    expect(drawn).toEqual(['nav_deals']);
    expect(screen.getByText('Opportunities')).toBeInTheDocument();
  });

  it('a prop other than the resolvers is still compared by identity: a new evaluator redraws every row', () => {
    const { drawn, view } = setup();
    const r = resolvers(LABELS);
    const { rerender } = render(view(r));
    drawn.length = 0;
    rerender(view({ ...r, evaluateVisibility: () => true }));
    expect(drawn.sort()).toEqual(['nav_accounts', 'nav_deals', 'nav_help', 'nav_leads']);
  });
});
