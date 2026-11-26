// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37454 — 概览 Overview, the Studio menu's first row (ADR-0084 §
 * 概览 Overview, amended 2026-11-26).
 *
 *  1. On a package the first row of the menu, above every group and under no
 *     group's label, is 概览; it opens the package's overview and is the
 *     current row there. CONTROL: `~org` and `~all` draw no such row.
 *  2. While drafts wait for a publish it carries their count as a badge, and
 *     only then. CONTROL: a ledger of zero, and one not yet known, draw none.
 *  3. One click on the badge opens the overview's Pending tab; the row itself
 *     opens the Info tab.
 *  4. A search lists it when its name matches, and only then.
 *
 * The provider, the sidebar primitive and the router are real; only the
 * metadata reads are doubled, and the pending ledger is provided as the
 * surface provides it.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const SERVED = [
  { type: 'object', domain: 'data' },
  { type: 'app', domain: 'ui' },
  { type: 'flow', domain: 'automation' },
  { type: 'permission', domain: 'security' },
];

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => ({}),
    useMetadataTypes: () => ({ loading: false, error: null, entries: SERVED }),
    useGlobalDiagnostics: () => ({
      loading: false,
      error: null,
      countsByType: { object: 3, flow: 2, permission: 1 },
      packagesByType: { object: ['com.acme.app'], flow: ['com.acme.app'], permission: ['com.acme.app'] },
      reload: () => {},
    }),
  };
});

import { StudioMenu, StudioMenuProvider } from './StudioMenu';
import { StudioPendingDraftsContext } from './studioItemDraftStatus';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';

const PKG = 'com.acme.app';

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function renderAt(path: string, { segment = PKG, pending = null as number | null, locale = 'en' } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StudioPendingDraftsContext.Provider value={{ count: pending, entries: [], behindSave: false }}>
        <Routes>
          <Route
            path="*"
            element={
              <StudioMenuProvider>
                <StudioMenu segment={segment} locale={locale} />
              </StudioMenuProvider>
            }
          />
        </Routes>
      </StudioPendingDraftsContext.Provider>
      <Where />
    </MemoryRouter>,
  );
}

const menu = () => screen.getByTestId('studio-menu');
const row = () => screen.getByTestId('studio-menu-entry-overview');
const badge = () => screen.queryByTestId('studio-menu-overview-pending');

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('概览 is a package menu\'s first row (objectstack#37454)', () => {
  it('the first link of the menu, above every group and under none, opening the overview', () => {
    renderAt(`/studio/${PKG}/data`);
    const links = within(menu()).getAllByRole('link');
    expect(links[0]).toBe(row());
    expect(row()).toHaveAttribute('href', `/studio/${PKG}/overview`);
    expect(row().closest('[data-testid^="studio-menu-group-"]')).toBeNull();
    for (const group of within(menu()).getAllByTestId(/^studio-menu-group-/)) {
      expect(row().compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(row()).toHaveTextContent('Overview');
    // Not the open page here.
    expect(row()).not.toHaveAttribute('aria-current');
  });

  it('zh-CN: it reads 概览', async () => {
    await loadStudioCatalogue('zh-CN');
    renderAt(`/studio/${PKG}/data`, { locale: 'zh-CN' });
    expect(row()).toHaveTextContent('概览');
  });

  it('is the current row on the overview, its Pending tab included', () => {
    renderAt(`/studio/${PKG}/overview?tab=pending`);
    expect(row()).toHaveAttribute('aria-current', 'page');
    expect(row()).toHaveAttribute('data-active', 'true');
  });

  it.each([['~org'], ['~all']])('CONTROL: %s draws no 概览 row, even with drafts pending', (segment) => {
    renderAt(`/studio/${segment}/metadata`, { segment, pending: 2 });
    expect(screen.queryByTestId('studio-menu-entry-overview')).toBeNull();
    expect(badge()).toBeNull();
  });
});

describe('its badge: the pending count, only while drafts wait (objectstack#37454)', () => {
  it('three drafts pending: the badge reads 3 and says what it counts', () => {
    renderAt(`/studio/${PKG}/data`, { pending: 3 });
    expect(badge()).toHaveTextContent(/^3$/);
    expect(badge()).toHaveAttribute('aria-label', '3 changes wait for a publish');
  });

  it.each([
    ['nothing pending', 0],
    ['the ledger not known yet', null],
  ])('CONTROL: %s draws no badge, and the row stays', (_label, pending) => {
    renderAt(`/studio/${PKG}/data`, { pending });
    expect(row()).toBeInTheDocument();
    expect(badge()).toBeNull();
  });

  it('one click on the badge opens the overview\'s Pending tab; the row opens its Info tab', () => {
    renderAt(`/studio/${PKG}/data`, { pending: 3 });
    expect(badge()).toHaveAttribute('href', `/studio/${PKG}/overview?tab=pending`);
    fireEvent.click(badge()!);
    expect(screen.getByTestId('where')).toHaveTextContent(`/studio/${PKG}/overview?tab=pending`);

    fireEvent.click(row());
    expect(screen.getByTestId('where')).toHaveTextContent(new RegExp(`^/studio/${PKG.replace(/\./g, '\\.')}/overview$`));
  });
});

describe('a search lists 概览 when its name matches (objectstack#37454)', () => {
  it('"over" lists it; "flow" does not, and lists the flow entry', () => {
    renderAt(`/studio/${PKG}/data`, { pending: 1 });
    fireEvent.change(screen.getByTestId('studio-menu-search'), { target: { value: 'over' } });
    expect(row()).toBeInTheDocument();
    expect(screen.queryByTestId('studio-menu-no-matches')).toBeNull();

    fireEvent.change(screen.getByTestId('studio-menu-search'), { target: { value: 'flow' } });
    expect(screen.queryByTestId('studio-menu-entry-overview')).toBeNull();
    expect(screen.getByTestId('studio-menu-entry-type:flow')).toBeInTheDocument();
  });
});
