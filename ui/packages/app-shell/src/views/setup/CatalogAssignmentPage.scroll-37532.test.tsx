// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37532 — the catalog list and the picked item's section shared
 * the page's one scroll, so a pick far down a long list (the recycle bin's 38
 * objects) left the section above the visible area and the page read blank.
 * On two columns the list now stays in view and scrolls on its own; a pick the
 * administrator makes brings the section into view when it is not. Driven
 * through Position holders, the smallest page on the shared layout.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const positions = [
  { name: 'auditor', label: 'Auditor' },
  { name: 'sales_rep', label: 'Sales rep' },
];
const adapter = { find: vi.fn(async () => ({ data: [] })), create: vi.fn(), delete: vi.fn() };
const metadata = {
  objects: [],
  ensureType: vi.fn(async () => positions),
  getTypeStatus: vi.fn(() => 'ready'),
  refresh: vi.fn(async () => {}),
};
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
  useMetadata: () => metadata,
}));

import { PositionHoldersPage } from './PositionHoldersPage';

const SECTION = 'setup-position-holders-section';
let sectionTop = 0;
const scrollIntoView = vi.fn();

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/component/security/position-holders${search}`]}>
      <PositionHoldersPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sectionTop = 0;
  scrollIntoView.mockClear();
  (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = scrollIntoView;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.testid === SECTION ? sectionTop : 0;
    return { top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('catalog list and section scroll (objectstack#37532)', () => {
  it('holds the list in view on two columns, scrolling on its own', async () => {
    renderPage();
    await screen.findByRole('list', { name: 'Positions' });
    const nav = screen.getByTestId('setup-position-holders-list');
    for (const cls of ['md:sticky', 'md:self-start', 'md:overflow-y-auto']) expect(nav).toHaveClass(cls);
    expect(nav.className).toMatch(/md:max-h-\[calc\(100svh-var\(--os-chrome-banners,0px\)-3rem\)\]/);
  });

  it('a pick whose section sits below the visible area brings the section into view', async () => {
    sectionTop = window.innerHeight + 1200;
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Sales rep/ }));
    expect(await screen.findByRole('heading', { name: 'Sales rep' })).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByTestId(SECTION));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('a pick whose section is scrolled above the visible area brings it back', async () => {
    sectionTop = -1400;
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Auditor/ }));
    await screen.findByRole('heading', { name: 'Auditor' });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('leaves the scroll alone when the section is already in view', async () => {
    sectionTop = 40;
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Auditor/ }));
    await screen.findByRole('heading', { name: 'Auditor' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('a link that names an item opens it without moving the scroll', async () => {
    sectionTop = window.innerHeight + 1200;
    renderPage('?position=auditor');
    await screen.findByRole('heading', { name: 'Auditor' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
