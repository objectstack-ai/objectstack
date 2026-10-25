/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * App Switcher — filters on `hidden`, and ⛔ must NOT filter on `_unpublished`
 * (objectstack#6955, the objectui half of the #4829 A1 ruling).
 *
 * This is the negative half of the same card that flips `UnpublishedAppBar` to
 * `_unpublished`. The tempting symmetry — "the banner moved to the new key, so
 * the launcher should too" — is explicitly wrong, and the reason is a layering
 * one, not a preference:
 *
 *   • `_unpublished` is enforced SERVER-SIDE. The REST metadata gate already
 *     withholds unpublished apps from non-builders, so an unpublished app that
 *     reaches this component at all is one the viewer is entitled to see —
 *     a builder, looking at their own in-progress app. Filtering it out here
 *     would hide the builder's app from the builder, in the one client surface
 *     they use to navigate to it, while the server was already handling every
 *     viewer who should not see it. Duplicating a server gate in the client
 *     buys nothing and can only ever be wrong in the strict direction.
 *
 *   • `hidden` is enforced NOWHERE ELSE, by design. It is an author-declared
 *     navigation-presentation choice ("Hidden apps stay fully routable and
 *     permission-checked" — framework PR #6942), so this filter IS its whole
 *     implementation. Dropping it would put the `account` app back in the
 *     top-level switcher.
 *
 * Hence: two keys, two different enforcement points, and this component reads
 * exactly one of them.
 */

import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Passthrough dropdown primitives so the menu CONTENT renders without an
// interaction — the same idiom as WorkspaceSwitcher.test.tsx. What is under
// measurement is which apps reach the list, not radix's open/close machinery.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DropdownMenu: (p: any) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: any) => <div>{p.children}</div>,
  // Scoped: the trigger renders the ACTIVE app's label too, so an unscoped
  // `getByText` would match twice. Every assertion below reads the LIST.
  DropdownMenuContent: (p: any) => <div data-testid="app-switcher-menu">{p.children}</div>,
  DropdownMenuItem: ({ onClick, children }: any) => <div onClick={onClick}>{children}</div>,
  DropdownMenuLabel: (p: any) => <div {...p} />,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChevronDown: () => <span />,
  Check: () => <span data-testid="active-check" />,
}));
// `getIcon` wraps lucide's DynamicIcon (a per-icon dynamic import); stub it so
// no unbounded module load races the assertions.
vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => <span /> }));

// Spread the real module rather than replacing it: other modules in this graph
// import further exports from it, and a bare factory would blank them out.
vi.mock('@object-ui/i18n', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/i18n');
  return {
    ...actual,
    useObjectTranslation: () => ({
      t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key,
    }),
    useObjectLabel: () => ({
      appLabel: ({ name, label }: { name: string; label?: string }) => label ?? name,
    }),
  };
});

// Keep the real route-segment matching (`appRouteSegment` / `matchAppBySegment`);
// only the keyed-i18n resolver is stubbed.
vi.mock('../../utils', async () => {
  const appRoute = await vi.importActual<typeof import('../../utils/appRoute')>('../../utils/appRoute');
  return {
    ...appRoute,
    resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : undefined),
  };
});

let apps: Array<Record<string, unknown>> = [];
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps }),
}));

import { AppSwitcher } from '../AppSwitcher';

function renderSwitcher(active = 'crm') {
  // The router is for the menu's link rows (「All apps」, objectui#12201).
  render(
    <MemoryRouter>
      <AppSwitcher activeAppName={active} onAppChange={vi.fn()} />
    </MemoryRouter>,
  );
  // The switcher LIST, not the trigger — see the DropdownMenuContent mock.
  return within(screen.getByTestId('app-switcher-menu'));
}

beforeEach(() => {
  apps = [];
});

describe('AppSwitcher — publish state is the server\'s job, navigation is this filter\'s', () => {
  it('⛔ lists an UNPUBLISHED app — `_unpublished` must not be filtered client-side', () => {
    apps = [
      { name: 'crm', label: 'CRM' },
      { name: 'draft_app', label: 'Draft App', _unpublished: true },
    ];
    const menu = renderSwitcher();
    // The viewer received this app from the server, so they are a builder and
    // entitled to navigate to it. Hiding it here would strand the builder's own
    // in-progress app; the UnpublishedAppBar (not this list) is what tells them
    // it is not live yet.
    expect(menu.getByText('Draft App')).toBeInTheDocument();
    expect(menu.getByText('CRM')).toBeInTheDocument();
  });

  it('keeps excluding nav-hidden apps — `hidden` has no other enforcement point', () => {
    apps = [
      { name: 'crm', label: 'CRM' },
      { name: 'account', label: 'Account', hidden: true },
    ];
    const menu = renderSwitcher();
    expect(menu.getByText('CRM')).toBeInTheDocument();
    expect(menu.queryByText('Account')).not.toBeInTheDocument();
  });

  it('excludes an app that is hidden even while unpublished — `hidden` still decides the list', () => {
    apps = [
      { name: 'crm', label: 'CRM' },
      { name: 'account', label: 'Account', hidden: true, _unpublished: true },
    ];
    const menu = renderSwitcher();
    expect(menu.queryByText('Account')).not.toBeInTheDocument();
  });

  it('keeps excluding inactive apps', () => {
    apps = [
      { name: 'crm', label: 'CRM' },
      { name: 'old', label: 'Old App', active: false },
    ];
    const menu = renderSwitcher();
    expect(menu.queryByText('Old App')).not.toBeInTheDocument();
  });
});
