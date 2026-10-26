/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Who owns app-navigation label localization (objectui#5197).
 *
 * The answer is: the server-side `/meta` boundary, alone. `translateApp` in
 * `@objectstack/spec` rewrites each navigation node's `label` by id before the
 * metadata reaches this renderer, so what arrives here is already localized
 * and must be rendered verbatim.
 *
 * Until #5197 the renderer also accepted two id-keyed client-side resolvers
 * (`resolveGroupLabel` / `resolveItemLabel`). They could never fire — the
 * `isCustomized` guard compared the authored label against the branch's
 * comparison target, and on those branches the target was the node's own `id`
 * (`grp_workspace`) while the label was its text (`Workspace`), which never
 * match. They are gone, and since objectui#11201 (ruling B) so is the guard:
 * the `object` / `dashboard` convention resolvers it gated are no longer
 * consulted for any label. These tests pin what is left:
 *
 *  - a normal tree renders exactly the labels it was given (the removal is not
 *    user-visible, because the server path was the one answering all along);
 *  - a present `object` / `dashboard` label renders verbatim, the convention
 *    resolvers unasked — including a label equal to the machine name
 *    (restated by objectui#11201; these rows pinned the retired
 *    translate-if-equal-to-name convention until then). Since objectui#11299
 *    those resolvers are not props at all, so these rows supply them the way
 *    the last test supplies `resolveGroupLabel` / `resolveItemLabel`: as the
 *    retired names a consumer that never updated could still pass, which
 *    nothing may consume;
 *  - id-keyed client-side resolution stays absent — the last test fails if
 *    anyone re-introduces it.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { SidebarProvider } from '@object-ui/components';
import { NavigationRenderer } from '../NavigationRenderer';

/** A conventionally-id'd tree: ids are slugs, labels are human text. */
const workspaceTree: NavigationItem[] = [
  {
    id: 'grp_workspace',
    type: 'group',
    label: 'Workspace',
    children: [
      { id: 'nav_users', type: 'url', label: 'Users', url: '/users' },
      { id: 'nav_pipeline', type: 'report', label: 'Pipeline report' },
    ],
  },
  { id: 'group_sales', type: 'group', label: 'Sales', children: [
    { id: 'nav_leads', type: 'url', label: 'Leads', url: '/leads' },
  ] },
];

function renderNav(items: NavigationItem[], props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider defaultOpen>
        <NavigationRenderer items={items} basePath="/apps/crm" {...props} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('NavigationRenderer — nav label ownership', () => {
  it('renders a normal tree with the labels exactly as authored', () => {
    renderNav(workspaceTree);

    expect(screen.getByText('Workspace')).toBeTruthy();
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('Users')).toBeTruthy();
    expect(screen.getByText('Pipeline report')).toBeTruthy();
    expect(screen.getByText('Leads')).toBeTruthy();
    // No id ever leaks into the rail as a label.
    expect(screen.queryByText('grp_workspace')).toBeNull();
    expect(screen.queryByText('nav_users')).toBeNull();
  });

  it('renders server-localized labels verbatim — the /meta boundary already ran', () => {
    // Exactly what `translateApp` hands the shell for a zh-CN session: ids
    // untouched, labels rewritten. The renderer must not second-guess them.
    renderNav([
      {
        id: 'grp_workspace',
        type: 'group',
        label: '工作区',
        children: [{ id: 'nav_users', type: 'url', label: '用户', url: '/users' }],
      },
    ]);

    expect(screen.getByText('工作区')).toBeTruthy();
    expect(screen.getByText('用户')).toBeTruthy();
  });

  it('renders a present object label equal to the machine name verbatim, resolveObjectLabel unasked (objectui#11201)', () => {
    // Restated by objectui#11201 (ruling B). Until then this row pinned the
    // opposite: a label spelled like its target's machine name was looked up
    // through `resolveObjectLabel` and rendered the translation.
    const resolveObjectLabel = vi.fn((_objectName: string, _fallback: string) => 'Accounts');
    renderNav(
      [{ id: 'nav_accounts', type: 'object', label: 'account', objectName: 'account' }],
      { resolveObjectLabel },
    );

    expect(resolveObjectLabel).not.toHaveBeenCalled();
    expect(screen.getByText('account')).toBeTruthy();
    expect(screen.queryByText('Accounts')).toBeNull();
  });

  it('still lets an authored object label win over resolveObjectLabel', () => {
    const resolveObjectLabel = vi.fn((_objectName: string, _fallback: string) => 'Projects (translated)');
    renderNav(
      [{ id: 'nav_projects', type: 'object', label: 'Projects', objectName: 'project' }],
      { resolveObjectLabel },
    );

    // An author who wrote a custom label must never have it overridden by an
    // object translation — since objectui#11201 for any spelling, not only
    // for one that differs from the machine name.
    expect(resolveObjectLabel).not.toHaveBeenCalled();
    expect(screen.getByText('Projects')).toBeTruthy();
  });

  it('renders both present dashboard labels verbatim, resolveDashboardLabel unasked (objectui#11201)', () => {
    // Restated by objectui#11201 (ruling B). Until then the first entry, whose
    // label is its dashboard's machine name, rendered the resolver's
    // translation instead.
    const resolveDashboardLabel = vi.fn((_dashboardName: string, _fallback: string) => 'Sales overview (translated)');
    renderNav(
      [
        { id: 'nav_so', type: 'dashboard', label: 'sales_overview', dashboardName: 'sales_overview' },
        { id: 'nav_custom', type: 'dashboard', label: 'Executive summary', dashboardName: 'exec' },
      ],
      { resolveDashboardLabel },
    );

    expect(resolveDashboardLabel).not.toHaveBeenCalled();
    expect(screen.getByText('sales_overview')).toBeTruthy();
    expect(screen.queryByText('Sales overview (translated)')).toBeNull();
    expect(screen.getByText('Executive summary')).toBeTruthy();
  });

  it('does not accept id-keyed client-side label resolvers', () => {
    // The ruling on #5197: nav localization has ONE owner, the server `/meta`
    // boundary. This renders with the retired prop names still supplied — a
    // consumer that never updated, or a future re-introduction. Nothing may
    // consume them.
    //
    // Note this assertion also held BEFORE the removal, because the guard made
    // those hooks unreachable; that degeneracy is the finding, not a gap. Its
    // job is forward-looking: re-adding id-keyed resolution (the rejected
    // option A) turns this red.
    const resolveGroupLabel = vi.fn((_groupId: string, _fallback: string) => 'GROUP FROM CLIENT PACK');
    const resolveItemLabel = vi.fn((_itemId: string, _fallback: string) => 'ITEM FROM CLIENT PACK');

    renderNav(workspaceTree, { resolveGroupLabel, resolveItemLabel });

    expect(resolveGroupLabel).not.toHaveBeenCalled();
    expect(resolveItemLabel).not.toHaveBeenCalled();
    expect(screen.queryByText('GROUP FROM CLIENT PACK')).toBeNull();
    expect(screen.queryByText('ITEM FROM CLIENT PACK')).toBeNull();
    expect(screen.getByText('Workspace')).toBeTruthy();
    expect(screen.getByText('Users')).toBeTruthy();
  });
});
