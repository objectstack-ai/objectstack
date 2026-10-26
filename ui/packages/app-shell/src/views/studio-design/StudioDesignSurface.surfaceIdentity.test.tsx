// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7254 — the Interfaces workbench spoke two vocabularies at once.
 *
 * The rail heading said 「客户管理 · 导航」 while, one strip away, the
 * breadcrumb chip printed `dashboard · customer_dashboard` and the canvas
 * caption printed the same pair — raw metadata type and internal name, beside
 * a Chinese label, for a customer who has never seen either.
 *
 * The ruling: the top bar / breadcrumb / rail show the metadata LABEL; the
 * internal name belongs in a developer view or a tooltip. So these pins assert
 * both halves — the label and translated KIND are what is READ, and the
 * internal identity is still REACHABLE on the tooltip (removing it outright
 * would take the one handle a developer debugging a binding actually uses).
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

const NAV = [
  { id: 'nav_dash', type: 'dashboard', label: '客户仪表盘', dashboardName: 'b2r4_customer_dashboard' },
  // A leaf the author never labelled — the rail used to render an EMPTY row.
  { id: 'nav_obj', type: 'object', objectName: 'b2r4_customer' },
];

const mockClient = {
  list: vi.fn(async (type: string) =>
    type === 'app' ? [{ name: 'acme_app', label: '客户管理' }] : [],
  ),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: '客户管理', navigation: NAV } };
    if (type === 'dashboard') return { effective: { name, label: '客户仪表盘', widgets: [] } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';

afterEach(cleanup);

function renderZhPillar() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
        <InterfacesPillar packageId="com.acme.app" />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('Interfaces workbench — labels on screen, internal names on the tooltip', () => {
  it('the rail names an unlabelled leaf by its object name instead of rendering a blank row', async () => {
    renderZhPillar();
    // The dashboard leaf carries a label; the object leaf does not. (The
    // labelled one also appears in the breadcrumb/caption once the pillar
    // auto-selects it, hence `findAllByText`.)
    expect((await screen.findAllByText('客户仪表盘')).length).toBeGreaterThan(0);
    expect(await screen.findByText('b2r4_customer')).toBeInTheDocument();
  });

  it('the rail kind chip is translated, not the raw English metadata type', async () => {
    renderZhPillar();
    await screen.findAllByText('客户仪表盘');
    expect(screen.getAllByText('仪表板').length).toBeGreaterThan(0);
    expect(screen.queryByText('DASHBOARD')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
  });

  it('the breadcrumb reads label + translated kind, with the internal pair on its tooltip', async () => {
    renderZhPillar();
    fireEvent.click(await screen.findByTitle('dashboard · b2r4_customer_dashboard'));
    const crumb = await waitFor(() => screen.getByTestId('if-breadcrumb'), { timeout: 4000 });
    expect(crumb).toHaveTextContent('客户仪表盘');
    expect(crumb).toHaveTextContent('仪表板');
    // The pair is reachable, but not printed at the customer.
    // Prefixed, so the tooltip SAYS what the pair is — and so the rail item,
    // the breadcrumb and the caption stop sharing one addressable string.
    expect(crumb).toHaveAttribute('title', '内部标识: dashboard · b2r4_customer_dashboard');
    expect(crumb.textContent).not.toContain('b2r4_customer_dashboard');
  });

  it('the canvas caption follows the same rule', async () => {
    renderZhPillar();
    fireEvent.click(await screen.findByTitle('dashboard · b2r4_customer_dashboard'));
    const caption = await waitFor(() => screen.getByTestId('if-canvas-caption'), { timeout: 4000 });
    expect(caption).toHaveTextContent('客户仪表盘');
    expect(caption).toHaveAttribute('title', '内部标识: dashboard · b2r4_customer_dashboard');
    expect(caption.textContent).not.toContain('b2r4_customer_dashboard');
  });
});
