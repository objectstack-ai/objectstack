// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AppPreview / AppNavCanvas vs `AppSchema` (objectui#3275).
 *
 * `AppSchema.navigation` is a DISCRIMINATED UNION on `type` whose every branch
 * is `.strict()`. Both surfaces ignored that and guessed instead:
 *
 *   kind  ← `it.object` / `it.dashboard` / `it.report`  (none are keys)
 *   route ← `it.path ?? it.href ?? it.route ?? it.url`  (only `url` is a key,
 *                                                        only on `type: 'url'`)
 *   home  ← `landingRoute ?? landing ?? defaultRoute ?? '/'`
 *
 * `landing` was removed outright in objectstack#4001; the rest were never
 * declared anywhere. So a spec-VALID app rendered every entry as a generic
 * badge with no target and an invented `Landing: /`, while a draft full of
 * rejected keys rendered a complete-looking nav — which is why objectui#3266
 * watched the app designer degrade the moment its sample was corrected.
 *
 * The route column now comes from `resolveHref`, the shell's own nav → URL
 * mapping (`NavigationRenderer` documents it as the single source of truth,
 * and `useNavPins` / `SearchResultsPage` already share it). A link shown in
 * the preview is therefore the link the runtime will follow — the preview
 * cannot drift from the shell because it is no longer guessing separately.
 *
 * The landing entry is DERIVED (first navigation item that yields a route),
 * never authored: spec 17.0.0 retired `homePageId` (objectstack#4667 / #4709),
 * as it retired `landing` before it (objectstack#4001). Reading either back
 * would show the author a landing page the runtime will not honour.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { AppPreview } from './AppPreview';

afterEach(cleanup);

/** Parses clean against `ObjectStackSchema` — mirrors the gallery's sample. */
const VALID_DRAFT = {
  name: 'crm',
  label: 'CRM',
  icon: 'briefcase',
  navigation: [
    { id: 'home', type: 'page', label: 'Home', pageName: 'crm_welcome' },
    { id: 'accounts', type: 'object', label: 'Accounts', objectName: 'account' },
    {
      id: 'orders',
      type: 'object',
      label: 'Sales Orders',
      objectName: 'sales_order',
      viewName: 'open_orders',
    },
    { id: 'dashboard', type: 'dashboard', label: 'Dashboard', dashboardName: 'sales_overview' },
    {
      id: 'admin',
      type: 'group',
      label: 'Admin',
      children: [
        { id: 'docs', type: 'url', label: 'Docs', url: 'https://docs.example.com', target: '_blank' },
      ],
    },
  ],
} satisfies Record<string, unknown>;

/** Pre-spec shape: hand-written routes, inferred kinds, removed `landing`. */
const STALE_DRAFT = {
  name: 'crm',
  label: 'CRM',
  landing: '/apps/crm/home',
  nav: [
    { label: 'Accounts', path: '/apps/crm/accounts', object: 'account' },
    { label: 'Dashboard', path: '/apps/crm/dash', dashboard: 'sales_overview' },
  ],
} satisfies Record<string, unknown>;

/** Read-only preview mode: no `onSelectionChange` ⇒ the NavRow list, not the canvas. */
function renderPreview(draft: Record<string, unknown>) {
  return render(<AppPreview type="app" name="crm" draft={draft} />);
}

describe('AppPreview reads the navigation discriminated union', () => {
  it('badges each entry with its `type`, including the dashboard entry', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.getByText('page')).toBeTruthy();
    expect(screen.getAllByText('object')).toHaveLength(2);
    // The badge objectui#3266 watched degrade from `dashboard` to a generic item.
    expect(screen.getByText('dashboard')).toBeTruthy();
    expect(screen.getByText('group')).toBeTruthy();
    expect(screen.getByText('url')).toBeTruthy();
  });

  it('shows the metadata record each entry names', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.getByText('crm_welcome')).toBeTruthy();
    expect(screen.getByText('account')).toBeTruthy();
    expect(screen.getByText('sales_order')).toBeTruthy();
    expect(screen.getByText('sales_overview')).toBeTruthy();
  });

  it('renders the route the shell will navigate to, via resolveHref', () => {
    renderPreview(VALID_DRAFT);
    // Derived, not authored: `viewName` becomes a /view/ segment and the
    // dashboard entry becomes /dashboard/<name> — exactly what NavigationRenderer
    // produces, so the preview cannot advertise a route the runtime won't serve.
    expect(screen.getByText('/apps/crm/account')).toBeTruthy();
    expect(screen.getByText('/apps/crm/sales_order/view/open_orders')).toBeTruthy();
    expect(screen.getByText('/apps/crm/dashboard/sales_overview')).toBeTruthy();
    expect(screen.getByText('/apps/crm/page/crm_welcome')).toBeTruthy();
  });

  it('renders a `url` entry with its own absolute URL, not an /apps/ prefix', () => {
    renderPreview(VALID_DRAFT);
    // Appears twice: once as the entry target, once as the resolved route —
    // resolveHref returns an external url verbatim rather than prefixing it.
    const hits = screen.getAllByText('https://docs.example.com');
    expect(hits.length).toBeGreaterThan(0);
    expect(screen.queryByText('/apps/crm/https://docs.example.com')).toBeNull();
  });

  it('flags an entry that has no `type` discriminator', () => {
    renderPreview({
      name: 'crm',
      label: 'CRM',
      navigation: [{ id: 'mystery', label: 'Mystery' }],
    });
    expect(screen.getByText('no type')).toBeTruthy();
  });
});

describe('AppPreview derives the landing entry from the navigation order', () => {
  it('names the first navigation item that yields a route', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.getByText(/opens the first navigation item/i)).toBeTruthy();
    // Resolved to the entry's label — NOT rendered as a route.
    expect(screen.getByText('→ Home')).toBeTruthy();
  });

  it('never renders the landing entry as a path', () => {
    const { container } = renderPreview(VALID_DRAFT);
    expect(container.textContent).not.toContain('Landing: /home');
    expect(container.textContent).not.toContain('/apps/crm/home');
  });

  it('ignores a retired `homePageId` instead of honouring it', () => {
    // The runtime rejects the key outright (spec 17.0.0). A stored app that
    // still carries it must NOT be previewed as landing there — that would
    // promise a landing page the shell will not deliver.
    renderPreview({ ...VALID_DRAFT, homePageId: 'orders' });
    expect(screen.getByText('→ Home')).toBeTruthy();
    expect(screen.queryByText('→ Sales Orders')).toBeNull();
  });

  it('says so when no navigation item yields a route', () => {
    renderPreview({ name: 'crm', label: 'CRM', navigation: [] });
    expect(screen.getByText(/no navigation item yields a route/i)).toBeTruthy();
  });
});

describe('AppPreview renders nothing from keys AppSchema rejects', () => {
  it('does not render the removed `landing` as a route', () => {
    renderPreview(STALE_DRAFT);
    expect(screen.queryByText('/apps/crm/home')).toBeNull();
    // Every entry in STALE_DRAFT lacks `type`, so none of them yields a route
    // and there is no landing entry to name — the point being that the stale
    // `landing` value is not what fills the gap.
    expect(screen.getByText(/no navigation item yields a route/i)).toBeTruthy();
  });

  it('does not infer a kind from `object` / `dashboard`', () => {
    renderPreview(STALE_DRAFT);
    // Both entries lack `type`; neither may borrow a kind from an off-spec key.
    expect(screen.queryByText('object')).toBeNull();
    expect(screen.queryByText('dashboard')).toBeNull();
    expect(screen.getAllByText('no type')).toHaveLength(2);
  });

  it('does not render a hand-written `path` as the entry route', () => {
    renderPreview(STALE_DRAFT);
    expect(screen.queryByText('/apps/crm/accounts')).toBeNull();
    expect(screen.queryByText('/apps/crm/dash')).toBeNull();
  });
});

describe('AppNavCanvas (design mode) reads the same union', () => {
  /**
   * The target each card names. objectui#12519 moved it from the row into the
   * card's `title` ("LABEL · TARGET"), so the row fits the Studio's 240 px rail.
   */
  const cardTargets = () =>
    screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') !== null)
      .map((b) => b.getAttribute('title')?.split(' · ')[1])
      .filter(Boolean);

  /** Design mode: passing `editing` + `onSelectionChange` selects the canvas. */
  function renderCanvas(draft: Record<string, unknown>) {
    return render(
      <AppPreview
        type="app" name="crm"
        draft={draft}
        editing
        selection={null}
        onSelectionChange={() => {}}
      />,
    );
  }

  it('badges the dashboard entry `dashboard`, not a generic item', () => {
    renderCanvas(VALID_DRAFT);
    expect(screen.getByText('dashboard')).toBeTruthy();
    expect(screen.queryByText('item')).toBeNull();
  });

  it('shows each entry target from its own branch key', () => {
    renderCanvas(VALID_DRAFT);
    expect(cardTargets()).toEqual(
      expect.arrayContaining(['sales_overview', 'account', 'crm_welcome', 'sales_order']),
    );
  });

  it('badges an entry with no `type` as `untyped` rather than inventing one', () => {
    renderCanvas({ name: 'crm', label: 'CRM', navigation: [{ id: 'x_y', label: 'Mystery', object: 'account' }] });
    expect(screen.getByText('untyped')).toBeTruthy();
    expect(screen.queryByText('object')).toBeNull();
  });

  it('labels an entry from `label` only, never from a `path`', () => {
    renderCanvas({
      name: 'crm',
      label: 'CRM',
      navigation: [{ id: 'a_b', type: 'object', path: '/apps/crm/accounts', objectName: 'account' }],
    });
    // No `label` ⇒ the text the entry inherits (objectui#11196): with no
    // metadata, its target's machine name, shown as the label and named as
    // the target in the card's title — never the off-spec path, and no
    // longer a positional row.
    expect(screen.getAllByText('account')).toHaveLength(1);
    expect(cardTargets()).toEqual(['account']);
    expect(screen.queryByText('Item 1')).toBeNull();
    expect(screen.queryByText('/apps/crm/accounts')).toBeNull();
  });

  it('keeps the group child visible under its parent', () => {
    const { container } = renderCanvas(VALID_DRAFT);
    expect(within(container).getByText('Docs')).toBeTruthy();
    expect(cardTargets()).toContain('https://docs.example.com');
  });
});
