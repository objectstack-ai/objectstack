// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A settings namespace page is named by the console's one page header, the one
 * an object list, a dashboard and the Approvals Inbox draw (objectui#12553).
 *
 * The page drew its own header block under its Back to settings button: the
 * manifest's icon, an `h1` with the Beta badge beside it, and the description
 * beneath. It now renders `ConsolePageHeader`, the console page header
 * `@object-ui/app-shell` exports: the icon chip, the title with its Beta badge
 * (the badge rides in the title node, as an object list's badge does), and the
 * description beside the title, in one row. Back to settings stays at the top
 * of the body. The page is its own route, a sibling of the hub's, so its `h1`
 * is a page header and not a section heading under the hub's.
 *
 * What this file pins, through the real page and the real header:
 *   - `page-header` holds the page's one `h1` (the manifest's label, with the
 *     Beta badge through its unchanged `console.settingsHub.beta` key), the
 *     description in the title's row, and the manifest's icon in the chip;
 *   - a manifest with no icon and no description draws neither;
 *   - Back to settings sits in the body below the header and still opens the
 *     hub;
 *   - the header spans the page above the padded body, not inside it.
 *
 * No i18n provider is mounted, so each chrome call site renders its key (the
 * sibling `SettingsView.envelope` suite reads it the same way). jsdom applies
 * no stylesheet, so structure is what is asserted.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { SettingsView } from '../SettingsView';

/**
 * An icon name Lucide does not have resolves to the static `Database` glyph
 * synchronously (`getLazyIcon`), so the chip's icon is on screen at once.
 */
const MAIL = {
  manifest: {
    namespace: 'mail',
    version: 1,
    label: 'Mail',
    description: 'Outbound email transport.',
    icon: 'box-open',
    beta: true,
    specifiers: [{ type: 'text', key: 'host', label: 'Host' }],
  },
  values: { host: { value: 'smtp.example.com', source: 'default', locked: false } },
};

const PLAIN = {
  manifest: {
    namespace: 'plain',
    version: 1,
    label: 'Plain',
    specifiers: [{ type: 'text', key: 'host', label: 'Host' }],
  },
  values: { host: { value: 'smtp.example.com', source: 'default', locked: false } },
};

let payload: unknown = MAIL;

beforeEach(() => {
  payload = MAIL;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: true, data: payload }),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderView(namespace: string) {
  return render(
    <MemoryRouter initialEntries={[`/system/settings/${namespace}`]}>
      <Routes>
        <Route path="/system/settings/:namespace" element={<SettingsView />} />
        <Route path="/system/settings" element={<p>settings hub route</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Settings namespace page — the console page header (objectui#12553)', () => {
  it('`page-header` holds the one h1 with its Beta badge, the description in its row and the icon chip', async () => {
    const { container } = renderView('mail');
    await screen.findByDisplayValue('smtp.example.com');
    const header = screen.getByTestId('page-header');

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(header.contains(h1s[0])).toBe(true);
    expect(within(h1s[0]).getByText('Mail')).toBeInTheDocument();
    expect(within(h1s[0]).getByText('console.settingsHub.beta')).toBeInTheDocument();
    expect(h1s[0].textContent).toBe('Mailconsole.settingsHub.beta');

    const line = within(header).getByText('Outbound email transport.');
    expect(line.tagName).toBe('P');
    expect(line.parentElement).toBe(h1s[0].parentElement);

    expect(h1s[0].parentElement!.querySelector('svg')?.getAttribute('class')).toContain('lucide-database');
  });

  it('a manifest with no icon and no description draws neither in the header', async () => {
    payload = PLAIN;
    const { container } = renderView('plain');
    await screen.findByDisplayValue('smtp.example.com');
    const header = screen.getByTestId('page-header');

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(header.contains(h1s[0])).toBe(true);
    expect(h1s[0].textContent).toBe('Plain');
    // objectui#12606 — the description line holds the "All settings" crumb
    // alone: no description text, and no icon chip (the only svg is the
    // crumb's chevron).
    const line = header.querySelector('p')!;
    expect(line.textContent).toBe('console.settingsView.backToHub');
    expect(Array.from(header.querySelectorAll('svg')).every((svg) => line.contains(svg))).toBe(true);
  });

  it('"All settings" is the header’s first crumb and opens the hub (objectui#12606)', async () => {
    renderView('mail');
    await screen.findByDisplayValue('smtp.example.com');
    const header = screen.getByTestId('page-header');
    const back = screen.getByRole('button', { name: /console\.settingsView\.backToHub/ });
    expect(header.contains(back)).toBe(true);
    // First on the description line, before the description text.
    const line = within(header).getByText('Outbound email transport.', { exact: false });
    expect(line.contains(back)).toBe(true);
    expect(line.textContent!.indexOf('console.settingsView.backToHub')).toBe(0);
    // Nothing of it is left in the body.
    expect(header.nextElementSibling!.contains(back)).toBe(false);

    fireEvent.click(back);
    expect(screen.getByText('settings hub route')).toBeInTheDocument();
  });

  it('the header spans the page above the padded body, not inside it', async () => {
    renderView('mail');
    await screen.findByDisplayValue('smtp.example.com');
    const header = screen.getByTestId('page-header');
    const body = header.nextElementSibling as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body!.className.split(' ')).toEqual(expect.arrayContaining(['p-6', 'max-w-3xl']));
    expect(header.closest('.max-w-3xl')).toBeNull();
    expect(body!.contains(screen.getByDisplayValue('smtp.example.com'))).toBe(true);
  });
});
