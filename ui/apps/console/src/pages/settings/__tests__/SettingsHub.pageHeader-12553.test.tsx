// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Settings — the hub is named by the console's one page header, the one an
 * object list, a dashboard and the Approvals Inbox draw (objectui#12553).
 *
 * The hub drew its own header row: a large settings icon beside an `h1` with a
 * subtitle line beneath it. It now renders `ConsolePageHeader`, the console
 * page header `@object-ui/app-shell` exports: icon chip, title, and the
 * subtitle beside the title, in one row. The hub and each namespace page
 * (`SettingsView`) are sibling routes, so neither draws inside the other's
 * header.
 *
 * What this file pins, through the real page and the real header:
 *   - `page-header` holds the hub's one `h1` and the subtitle in the title's
 *     row, each through its unchanged `console.settingsHub.*` key, and an icon
 *     in the chip; the category headings stay `h2`s in the body;
 *   - the header spans the page above the padded body, not inside it.
 *
 * No i18n provider is mounted, so each call site renders its key (the sibling
 * `SettingsView.envelope` suite reads the empty state the same way). jsdom
 * applies no stylesheet, so structure is what is asserted.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsHub } from '../SettingsHub';

const MANIFESTS = [
  { namespace: 'localization', version: 1, label: 'Localization', category: 'Platform', specifiers: [] },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: true, data: { manifests: MANIFESTS } }),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHub() {
  return render(
    <MemoryRouter>
      <SettingsHub />
    </MemoryRouter>,
  );
}

describe('Settings hub — the console page header (objectui#12553)', () => {
  it('`page-header` holds the one h1, the subtitle in its row and an icon chip', async () => {
    const { container } = renderHub();
    await screen.findByText('Localization');
    const header = screen.getByTestId('page-header');

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(header.contains(h1s[0])).toBe(true);
    expect(h1s[0].textContent).toBe('console.settingsHub.title');

    const line = within(header).getByText('console.settingsHub.subtitle');
    expect(line.tagName).toBe('P');
    expect(line.parentElement).toBe(h1s[0].parentElement);

    expect(h1s[0].parentElement!.querySelector('svg')).not.toBeNull();

    // The category heading is a section heading of the body, not a second header.
    const h2 = container.querySelector('h2');
    expect(h2).not.toBeNull();
    expect(header.contains(h2)).toBe(false);
  });

  it('the header spans the page above the padded body, not inside it', async () => {
    renderHub();
    await screen.findByText('Localization');
    const header = screen.getByTestId('page-header');
    const body = header.nextElementSibling as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body!.className.split(' ')).toEqual(expect.arrayContaining(['p-6', 'max-w-6xl']));
    expect(header.closest('.max-w-6xl')).toBeNull();
    expect(body!.contains(screen.getByText('Localization'))).toBe(true);
  });
});
