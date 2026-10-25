// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Applications — the page is named by the console's one page header, the one
 * an object list, a dashboard and the Approvals Inbox draw (objectui#12553).
 *
 * The page drew its own header row: an `h1`, a subtitle line beneath it and
 * the New App button, stacked on a phone. It now renders `ConsolePageHeader`,
 * the console page header `@object-ui/app-shell` exports: the title, the
 * subtitle beside it, New App among the actions, in one row. A page that drew
 * no icon gets no chip.
 *
 * What this file pins, through the real page and the real header:
 *   - `page-header` holds the page's one `h1`, the subtitle in the title's
 *     row and New App, each through its unchanged `appManagement.*` key, with
 *     no icon chip;
 *   - New App in the header still opens the create-app route;
 *   - the header spans the page above the padded body, not inside it.
 *
 * jsdom applies no stylesheet, so structure is what is asserted; the one-row
 * shape and its `sm` breakpoint are app-shell's `PageHeader.oneRow-12423` pins.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn(async () => {}) }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// `ConsolePageHeader` stays REAL: the header under test is the package's.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: [], refresh }),
  useAdapter: () => ({ getClient: () => ({ meta: { saveItem: vi.fn(), deleteItem: vi.fn() } }) }),
}));

/** Each call site's key, so the pin names the pack key it reads. */
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»` }),
}));

// Imported after the mocks so the page picks them up.
const { AppManagementPage } = await import('../AppManagementPage');

afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/apps/demo/system/apps']}>
      <Routes>
        <Route path="/apps/:appName/system/apps" element={<AppManagementPage />} />
        <Route path="/apps/:appName/create-app" element={<p>create-app route</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Applications — the console page header (objectui#12553)', () => {
  it('`page-header` holds the one h1, the subtitle in its row and New App, with no icon chip', () => {
    const { container } = renderPage();
    const header = screen.getByTestId('page-header');

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(header.contains(h1s[0])).toBe(true);
    expect(h1s[0].textContent).toBe('«appManagement.title»');

    const line = within(header).getByText('«appManagement.subtitle»');
    expect(line.tagName).toBe('P');
    expect(line.parentElement).toBe(h1s[0].parentElement);

    const newApp = within(header).getByTestId('create-app-btn');
    expect(newApp).toHaveTextContent('«appManagement.newApp»');
    // The size every header action takes (`size="sm"`, `h-9`, the chip's
    // height), so New App does not make this header taller than the others.
    expect(newApp.className.split(/\s+/)).toContain('h-9');
    expect(newApp.className.split(/\s+/)).not.toContain('h-10');
    // New App is drawn once: the header's, not a second copy in the body.
    expect(screen.getAllByTestId('create-app-btn')).toHaveLength(1);

    // The page drew no icon, so the header draws no chip; New App's own glyph
    // sits among the actions, not beside the title.
    expect(h1s[0].parentElement!.querySelector('svg')).toBeNull();
  });

  it('New App in the header opens the create-app route', () => {
    renderPage();
    fireEvent.click(within(screen.getByTestId('page-header')).getByTestId('create-app-btn'));
    expect(screen.getByText('create-app route')).toBeInTheDocument();
  });

  it('the header spans the page above the padded body, not inside it', () => {
    renderPage();
    const header = screen.getByTestId('page-header');
    const body = header.nextElementSibling as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body!.className.split(' ')).toEqual(expect.arrayContaining(['p-4', 'sm:p-6']));
    expect(body!.contains(screen.getByText('«appManagement.empty»'))).toBe(true);
  });
});
