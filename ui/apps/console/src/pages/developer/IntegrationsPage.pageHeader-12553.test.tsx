// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Integrations & APIs — the page is named by the console's one page header,
 * the one an object list, a dashboard and the Approvals Inbox draw
 * (objectui#12553).
 *
 * The page drew its own `h1` (a large icon and title) with a subtitle line
 * beneath it. It now renders `ConsolePageHeader`, the console page header
 * `@object-ui/app-shell` exports: icon chip, title, and the subtitle beside
 * the title, in one row.
 *
 * What this file pins, through the real page and the real header:
 *   - `page-header` holds the page's one `h1` ("Integrations & APIs"), the
 *     subtitle in the title's row, and an icon in the chip;
 *   - the header spans the page above the padded body, not inside it.
 *
 * jsdom applies no stylesheet, so structure is what is asserted; the one-row
 * shape and its `sm` breakpoint are app-shell's `PageHeader.oneRow-12423` pins.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { IntegrationsPage } from './IntegrationsPage';

const EMPTY = 'No business objects yet — build one with the AI assistant, publish it, and it appears here as an API.';

beforeEach(() => {
  // The object list and the agent section's discovery read: both answer empty.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/apps/demo/developer/integrations']}>
      <Routes>
        <Route path="/apps/:appName/developer/integrations" element={<IntegrationsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Integrations & APIs — the console page header (objectui#12553)', () => {
  it('`page-header` holds the one h1, the subtitle in its row and an icon chip', async () => {
    const { container } = renderPage();
    await screen.findByText(EMPTY);
    const header = screen.getByTestId('page-header');

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(header.contains(h1s[0])).toBe(true);
    expect(h1s[0].textContent).toBe('Integrations & APIs');

    const line = within(header).getByText(
      'Every object you build is instantly a REST API. Drive your app from code or an agent.',
    );
    expect(line.tagName).toBe('P');
    expect(line.parentElement).toBe(h1s[0].parentElement);

    expect(h1s[0].parentElement!.querySelector('svg')).not.toBeNull();
  });

  it('the header spans the page above the padded body, not inside it', async () => {
    renderPage();
    await screen.findByText(EMPTY);
    const header = screen.getByTestId('page-header');
    const body = header.nextElementSibling as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body!.className.split(' ')).toEqual(expect.arrayContaining(['p-4', 'sm:p-6']));
    expect(body!.contains(screen.getByText(EMPTY))).toBe(true);
  });
});
