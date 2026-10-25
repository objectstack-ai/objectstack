// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8219 — the Studio 「界面」 page's top bar and nav rail, read the way
 * an author (and a screen reader) meets them.
 *
 * Two pins live here:
 *
 * 1. The header Publish button. With nothing to publish it is disabled, and a
 *    disabled control styled as the page's PRIMARY action (only dimmed by
 *    `disabled:opacity-50`) is still the loudest thing on the page while
 *    saying nothing about why it cannot be clicked — the reason sat in `title`
 *    only, which no one sees without hovering. Pinned: no draft ⇒ an outline
 *    button with the reason as visible text; a pending draft ⇒ the primary
 *    button, and no "nothing to publish" text.
 *
 * 2. The nav rail item's ACCESSIBLE NAME, measured with a role/name query (the
 *    same computation assistive tech uses) rather than read off `title`. The
 *    name comes from the button's content — the display label plus the
 *    translated kind — while the internal `type · name` pair on `title` is the
 *    accessible DESCRIPTION, which is where objectui#7254's ruling keeps it
 *    reachable. Labelled and unlabelled leaves are separate questions and are
 *    pinned separately: an unlabelled leaf is named by its internal name, the
 *    objectui#7254 fallback that replaced an empty row.
 *
 * The fetch stub answers the REST reads the surface makes; everything it does
 * not recognise answers an empty list.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

const PACKAGE_ID = 'com.acme.app';

vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [{ id: PACKAGE_ID, name: '客户管理', writable: true }]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const NAV = [
  { id: 'nav_dash', type: 'dashboard', label: '客户仪表盘', dashboardName: 'b2r4_customer_dashboard' },
  // A leaf the author never labelled.
  { id: 'nav_obj', type: 'object', objectName: 'b2r4_customer' },
];

let drafts: Array<{ type: string; name: string; packageId: string }> = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  drafts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === '/api/v1/meta/_drafts') return json(drafts);
      if (path === '/api/v1/meta/app') return json([{ name: 'acme_app', label: '客户管理' }]);
      if (path === '/api/v1/meta/app/acme_app/layers') {
        return json({
          code: null,
          overlay: null,
          overlayScope: null,
          effective: { name: 'acme_app', label: '客户管理', navigation: NAV },
        });
      }
      if (path.endsWith('/layers')) return json({ code: null, overlay: null, overlayScope: null, effective: null });
      if (/^\/api\/v1\/meta\/[^/]+\/[^/]+$/.test(path)) return json({}, 404);
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWorkbench() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/interfaces`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The header Publish button, once the pending-draft count has resolved. */
async function publishButton(): Promise<HTMLElement> {
  // The rail's labelled leaf appears once the app has loaded, by which time the
  // header's draft count has resolved too.
  await screen.findByRole('button', { name: '客户仪表盘 仪表板' });
  return screen.getByRole('button', { name: /^发布/ });
}

describe('Studio top bar — the Publish button with nothing to publish (objectui#8219)', () => {
  it('no draft: disabled, NOT the primary style, and the reason is visible text', async () => {
    renderWorkbench();
    const btn = await publishButton();
    expect(btn).toBeDisabled();
    expect(btn.className).not.toMatch(/\bbg-primary\b/);
    expect(btn.className).not.toMatch(/\btext-primary-foreground\b/);
    // An outline: a border that is actually drawn (the primary state carries a
    // transparent one only to keep the bar from shifting).
    expect(btn.className).toMatch(/\bborder\b/);
    expect(btn.className).not.toMatch(/\bborder-transparent\b/);
    // The reason is on screen, not only in the hover tooltip.
    const reason = screen.getByTestId('publish-none-reason');
    expect(reason).toHaveTextContent('没有待发布的草稿');
    expect(reason).toBeVisible();
    expect(btn).toHaveAccessibleDescription('没有待发布的草稿');
  });

  it('a pending draft: enabled, the primary button, and no "nothing to publish" text', async () => {
    drafts = [{ type: 'dashboard', name: 'b2r4_customer_dashboard', packageId: PACKAGE_ID }];
    renderWorkbench();
    await screen.findByRole('button', { name: '客户仪表盘 仪表板' });
    const btn = await vi.waitFor(() => {
      const b = screen.getByRole('button', { name: /^发布/ });
      if ((b as HTMLButtonElement).disabled) throw new Error('draft count not resolved yet');
      return b;
    });
    expect(btn).toBeEnabled();
    expect(btn.className).toMatch(/\bbg-primary\b/);
    expect(btn.className).toMatch(/\btext-primary-foreground\b/);
    expect(screen.queryByTestId('publish-none-reason')).not.toBeInTheDocument();
  });
});

describe('Studio nav rail — the accessible name of a nav item (objectui#8219)', () => {
  it('a labelled leaf is NAMED by its display label; the internal pair is only its description', async () => {
    renderWorkbench();
    const item = await screen.findByRole('button', { name: '客户仪表盘 仪表板' });
    expect(item).toHaveAccessibleName('客户仪表盘 仪表板');
    expect(item).toHaveAccessibleDescription('dashboard · b2r4_customer_dashboard');
    expect(
      screen.queryByRole('button', { name: 'dashboard · b2r4_customer_dashboard' }),
    ).not.toBeInTheDocument();
  });

  it('an unlabelled leaf is named by its internal name (the objectui#7254 fallback), never by the type · name pair', async () => {
    renderWorkbench();
    const item = await screen.findByRole('button', { name: 'b2r4_customer 对象' });
    expect(item).toHaveAccessibleName('b2r4_customer 对象');
    expect(item).toHaveAccessibleDescription('object · b2r4_customer');
    expect(screen.queryByRole('button', { name: 'object · b2r4_customer' })).not.toBeInTheDocument();
  });
});
