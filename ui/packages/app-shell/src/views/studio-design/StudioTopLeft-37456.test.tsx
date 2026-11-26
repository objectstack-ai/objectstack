// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37456 — Studio's top left, as the author meets it (ADR-0084,
 * amended 2026-11-26, `#amendment-2026-11-26-frame`):
 *
 *  1. Two rows: Studio's (its mark and display name, and the collapse
 *     control), then the package row (the way back first, then the switcher).
 *  2. The switcher names the open package by its app where the package ships
 *     one, by its own name where it does not.
 *  3. A read-only package shows a lock beside its name, whose tooltip says
 *     why; a writable one shows none (control).
 *  4. The list: kernel packages left out, a `.custom` pair folded under its
 *     base, the open package checked; picking another opens it, re-picking the
 *     open one or a declined leave stays; a search narrows it.
 *  5. 新建软件包 New package is the last row, for an author only, and opens
 *     the create-package dialog.
 *  6. Collapsed, the column is a rail: the expand control, the way back and
 *     the app's logo, no brand name.
 *  7. A page with no title row still offers the panel control; a page with
 *     one draws it there and nowhere else.
 *
 * The provider, the sidebar primitive and the popover are real; the package
 * list and the served apps are doubled.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// The switcher's create dialog reaches celAuthoring's dynamic lint import; pay
// that load during collection, never inside a clocked case (check:test-source-alias).
import '@objectstack/lint';

const reads = vi.hoisted(() => ({
  pkgs: [] as Array<{ id: string; name: string; writable: boolean; namespace: string | null; kernel?: true }>,
  apps: [] as Array<Record<string, unknown>>,
}));

vi.mock('./packages-io.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, fetchPackages: async () => reads.pkgs };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: reads.apps }) };
});

vi.mock('../metadata-admin/PackagesPage.js', () => ({
  CreatePackageDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" data-testid="create-package-dialog" /> : null,
}));

import { StudioMenuProvider } from './StudioMenu';
import { StudioTopLeft } from './StudioTopLeft';
import { StudioTitleRowProvider, StudioTitleRowEnd } from './studioTitleRow';
import { StudioTitleRowFallback } from './StudioTitleRowFallback';

const SALES = 'com.acme.sales';

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: px });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: px < 768,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function clearCookies() {
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

interface Opts {
  scopePending?: { count: number; onOpen: () => void } | null;
  packageId?: string | null;
  readOnly?: boolean;
  canCreate?: boolean;
  allow?: boolean;
}

function renderTopLeft(opts: Opts = {}) {
  const navigate = vi.fn();
  const beforeNavigate = vi.fn(() => opts.allow ?? true);
  const packageId = opts.packageId === undefined ? SALES : opts.packageId;
  render(
    <MemoryRouter>
      <StudioMenuProvider>
        <StudioTopLeft
          packageId={packageId}
          scope={packageId === null ? 'org' : undefined}
          openEntry={null}
          readOnly={opts.readOnly ?? false}
          canCreate={opts.canCreate ?? false}
          apps={[]}
          locale="en"
          beforeNavigate={beforeNavigate}
          navigate={navigate}
          packagePath={(id) => `/studio/${id}`}
          scopePending={opts.scopePending ?? null}
        />
      </StudioMenuProvider>
    </MemoryRouter>,
  );
  return { navigate, beforeNavigate };
}

const openSwitcher = async () => {
  fireEvent.click(screen.getByTestId('studio-pkg-switcher'));
  return screen.findByTestId('studio-pkg-switcher-menu');
};

beforeEach(() => {
  setWidth(1280);
  clearCookies();
  reads.pkgs = [
    { id: SALES, name: 'Sales package', writable: false, namespace: 'crm' },
    { id: `${SALES}.custom`, name: 'Sales customizations', writable: true, namespace: 'crm' },
    { id: 'com.acme.hr', name: 'HR', writable: true, namespace: 'hr' },
    { id: 'sys.kernel', name: 'Kernel', writable: false, namespace: null, kernel: true },
  ];
  reads.apps = [{ name: 'crm', label: 'Sales', _packageId: SALES, icon: 'briefcase' }];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Studio top left — two rows (objectstack#37456)', () => {
  it('draws Studio’s row, then the package row with the way back first', () => {
    renderTopLeft();
    const brand = screen.getByTestId('studio-brand-row');
    expect(within(brand).getByTestId('studio-brand-name')).toHaveTextContent(/^App Studio$/);
    expect(within(brand).getByTestId('studio-menu-toggle')).toBeInTheDocument();
    const row = screen.getByTestId('studio-package-row');
    const buttons = within(row).getAllByRole('button');
    expect(buttons[0]).toBe(screen.getByTestId('studio-package-back'));
    expect(buttons[1]).toBe(screen.getByTestId('studio-pkg-switcher'));
    // The brand row comes before the package row.
    expect(brand.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the package by its app, and by its own name where it ships none', async () => {
    renderTopLeft();
    expect(screen.getByTestId('studio-pkg-switcher-name')).toHaveTextContent('Sales');
    cleanup();
    renderTopLeft({ packageId: 'com.acme.hr' });
    await waitFor(() => expect(screen.getByTestId('studio-pkg-switcher-name')).toHaveTextContent('HR'));
  });

  it('shows the lock beside a read-only package’s name, with the reason (control: none when writable)', () => {
    renderTopLeft({ readOnly: true });
    const lock = screen.getByTestId('studio-pkg-readonly');
    expect(lock).toHaveAttribute('title', expect.stringMatching(/read-only/i));
    expect(lock).toHaveAccessibleName('Read-only');
    cleanup();
    renderTopLeft({ readOnly: false });
    expect(screen.queryByTestId('studio-pkg-readonly')).toBeNull();
  });
});

describe('Studio top left — the package switcher (objectstack#37456)', () => {
  it('lists the openable packages, pair folded under its base, the open one checked', async () => {
    renderTopLeft();
    const menu = await openSwitcher();
    await waitFor(() => expect(within(menu).getAllByTestId('studio-switcher-row')).toHaveLength(2));
    const rows = within(menu).getAllByTestId('studio-switcher-row');
    expect(rows.map((r) => r.getAttribute('data-package'))).toEqual([SALES, 'com.acme.hr']);
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    expect(rows[0]).toHaveTextContent('Sales');
    expect(rows[0]).toHaveTextContent(`${SALES}.custom`);
    expect(rows[1]).not.toHaveAttribute('aria-current');
  });

  it('opens the picked package, and stays on a re-pick or a declined leave', async () => {
    const { navigate } = renderTopLeft();
    let menu = await openSwitcher();
    await waitFor(() => expect(within(menu).getAllByTestId('studio-switcher-row')).toHaveLength(2));
    fireEvent.click(within(menu).getAllByTestId('studio-switcher-row')[0]!);
    expect(navigate).not.toHaveBeenCalled();
    menu = await openSwitcher();
    fireEvent.click(within(menu).getAllByTestId('studio-switcher-row')[1]!);
    expect(navigate).toHaveBeenCalledWith('/studio/com.acme.hr');
    cleanup();

    const declined = renderTopLeft({ allow: false });
    menu = await openSwitcher();
    await waitFor(() => expect(within(menu).getAllByTestId('studio-switcher-row')).toHaveLength(2));
    fireEvent.click(within(menu).getAllByTestId('studio-switcher-row')[1]!);
    expect(declined.beforeNavigate).toHaveBeenCalled();
    expect(declined.navigate).not.toHaveBeenCalled();
  });

  it('narrows the list by the search, and says when nothing matches', async () => {
    renderTopLeft();
    const menu = await openSwitcher();
    await waitFor(() => expect(within(menu).getAllByTestId('studio-switcher-row')).toHaveLength(2));
    fireEvent.change(within(menu).getByTestId('studio-pkg-switcher-search'), { target: { value: 'hr' } });
    expect(within(menu).getAllByTestId('studio-switcher-row').map((r) => r.getAttribute('data-package'))).toEqual(['com.acme.hr']);
    fireEvent.change(within(menu).getByTestId('studio-pkg-switcher-search'), { target: { value: 'zzz' } });
    expect(within(menu).queryAllByTestId('studio-switcher-row')).toHaveLength(0);
    expect(within(menu).getByTestId('studio-pkg-switcher-empty')).toBeInTheDocument();
  });

  it('ends with New package for an author, which opens the create dialog (control: none otherwise)', async () => {
    renderTopLeft({ canCreate: true });
    let menu = await openSwitcher();
    const last = within(menu).getByTestId('studio-pkg-switcher-new');
    expect(last).toHaveTextContent('New package');
    fireEvent.click(last);
    expect(await screen.findByTestId('create-package-dialog')).toBeInTheDocument();
    cleanup();
    renderTopLeft({ canCreate: false });
    menu = await openSwitcher();
    expect(within(menu).queryByTestId('studio-pkg-switcher-new')).toBeNull();
  });

  it('names the scope in the package-less scope', () => {
    renderTopLeft({ packageId: null });
    expect(screen.getByTestId('studio-pkg-switcher-name')).toHaveTextContent(/^Organization metadata$/);
    expect(screen.getByTestId('studio-pkg-switcher')).not.toHaveAttribute('data-package');
  });
});

describe('Studio top left — the collapsed rail (objectstack#37456)', () => {
  it('keeps the expand control, the way back and the app’s logo', () => {
    renderTopLeft();
    fireEvent.click(screen.getByTestId('studio-menu-toggle'));
    const rail = screen.getByTestId('studio-rail-head');
    expect(within(rail).getByTestId('studio-menu-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(within(rail).getByTestId('studio-package-back')).toBeInTheDocument();
    expect(within(rail).getByTestId('studio-pkg-switcher')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-brand-name')).toBeNull();
    expect(screen.queryByTestId('studio-pkg-switcher-name')).toBeNull();
  });
});

describe('Studio top left — the package-less scope keeps its Changes (objectstack#37456)', () => {
  it('~org with drafts pending: a Changes row with the count under the package row, which opens the sheet', () => {
    const onOpen = vi.fn();
    renderTopLeft({ packageId: null, scopePending: { count: 2, onOpen } });
    const top = screen.getByTestId('studio-top-left');
    const changes = within(top).getByRole('button', { name: /^Changes · 2$/ });
    expect(changes).toHaveAttribute('data-testid', 'studio-scope-changes');
    expect(within(top).getByTestId('studio-package-row').compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(changes);
    expect(onOpen).toHaveBeenCalledTimes(1);
    // The rail keeps it, as an icon that still names the count.
    fireEvent.click(screen.getByTestId('studio-menu-toggle'));
    expect(within(screen.getByTestId('studio-rail-head')).getByRole('button', { name: /^Changes · 2$/ })).toBeInTheDocument();
  });

  it('CONTROL: none passed (a package, or nothing pending): no Changes row', () => {
    renderTopLeft({ packageId: null });
    expect(screen.queryByTestId('studio-scope-changes')).toBeNull();
  });
});

describe('Studio — a page with no title row keeps its panel control (objectstack#37456)', () => {
  const assistant = <button type="button" data-testid="assistant">AI</button>;

  it('draws the panel control at the pane’s top right when the page has no title row', () => {
    render(
      <StudioTitleRowProvider save={null} assistant={assistant}>
        <div data-testid="page">loading…</div>
        <StudioTitleRowFallback />
      </StudioTitleRowProvider>,
    );
    const fallback = screen.getByTestId('studio-title-row-fallback');
    expect(fallback).toHaveAttribute('data-drawn', 'true');
    expect(within(fallback).getByTestId('assistant')).toBeInTheDocument();
  });

  it('draws it in the page’s title row, and not again, when the page has one (control)', () => {
    render(
      <StudioTitleRowProvider save={null} assistant={assistant}>
        <div data-testid="page">
          <StudioTitleRowEnd />
        </div>
        <StudioTitleRowFallback />
      </StudioTitleRowProvider>,
    );
    expect(screen.getAllByTestId('assistant')).toHaveLength(1);
    expect(within(screen.getByTestId('page')).getByTestId('assistant')).toBeInTheDocument();
    expect(screen.getByTestId('studio-title-row-fallback')).not.toHaveAttribute('data-drawn');
  });
});
