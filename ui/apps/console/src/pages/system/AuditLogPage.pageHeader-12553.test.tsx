// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Audit Log — the page is named by the console's one page header, the one an
 * object list, a dashboard and the Approvals Inbox draw (objectui#12553).
 *
 * The page drew its own header row: a large icon, an `h1`, a subtitle line
 * beneath it and a Refresh button. It now renders `ConsolePageHeader`, the
 * console page header `@object-ui/app-shell` exports: icon chip, title, the
 * subtitle beside the title, Refresh among the actions, in one row.
 *
 * What this file pins, through the real page and the real header:
 *   - `page-header` holds the page's one `h1` ("Audit Log"), the subtitle in
 *     the title's row, an icon in the chip, and Refresh;
 *   - Refresh in the header still reloads the ledger;
 *   - the header spans the page above the padded body, not inside it.
 *
 * jsdom applies no stylesheet, so structure is what is asserted; the one-row
 * shape and its `sm` breakpoint are app-shell's `PageHeader.oneRow-12423` pins.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { ADAPTER } = vi.hoisted(() => ({
  ADAPTER: {
    find: async () => ({ data: [], total: 0 }),
    findOne: async () => null,
    getObjectSchema: async () => undefined,
  },
}));

// `ConsolePageHeader` stays REAL: the header under test is the package's.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

// Imported after the mocks so the page picks them up.
import { AuditLogPage } from './AuditLogPage';

/** Every `/data/sys_audit_log` read the page makes. */
let ledgerReads = 0;

beforeEach(() => {
  ledgerReads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      ledgerReads += 1;
      return new Response(JSON.stringify({ object: 'sys_audit_log', records: [], total: 0 }), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Audit Log — the console page header (objectui#12553)', () => {
  it('`page-header` holds the one h1, the subtitle in its row, an icon chip and Refresh', async () => {
    const { container } = render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
    await waitFor(() => expect(ledgerReads).toBeGreaterThan(0));
    const header = screen.getByTestId('page-header');

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(header.contains(h1s[0])).toBe(true);
    expect(h1s[0].textContent).toBe('Audit Log');

    const line = within(header).getByText('Read-only system activity and record changes. Newest first.');
    expect(line.tagName).toBe('P');
    expect(line.parentElement).toBe(h1s[0].parentElement);

    expect(h1s[0].parentElement!.querySelector('svg')).not.toBeNull();

    expect(within(header).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    // Refresh is drawn once: the header's, not a second copy in the body.
    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
  });

  it('Refresh in the header reloads the ledger', async () => {
    render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
    const refresh = within(screen.getByTestId('page-header')).getByRole('button', { name: 'Refresh' });
    await waitFor(() => expect(refresh).not.toBeDisabled());
    const before = ledgerReads;
    fireEvent.click(refresh);
    await waitFor(() => expect(ledgerReads).toBeGreaterThan(before));
  });

  it('the header spans the page above the padded body, not inside it', async () => {
    render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
    await waitFor(() => expect(ledgerReads).toBeGreaterThan(0));
    const header = screen.getByTestId('page-header');
    const body = header.nextElementSibling as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body!.className.split(' ')).toEqual(expect.arrayContaining(['p-6', 'max-w-screen-2xl']));
    expect(header.closest('.max-w-screen-2xl')).toBeNull();
  });
});
