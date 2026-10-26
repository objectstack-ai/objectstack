// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Flow Runs — the page is named by the console's one page header, the one an
 * object list, a dashboard and the Approvals Inbox draw (objectui#12553).
 *
 * The page drew its own `h1` (a large icon and title) with a subtitle line
 * beneath it. It now renders `ConsolePageHeader`, the console page header
 * `@object-ui/app-shell` exports: icon chip, title, and the subtitle beside
 * the title, in one row.
 *
 * What this file pins, through the real page and the real header:
 *   - `page-header` holds the page's one `h1` ("Flow Runs"), the subtitle in
 *     the title's row, and an icon in the chip;
 *   - the header spans the page above the padded body, not inside it.
 *
 * jsdom applies no stylesheet, so structure is what is asserted; the one-row
 * shape and its `sm` breakpoint are app-shell's `PageHeader.oneRow-12423` pins.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

const { ADAPTER } = vi.hoisted(() => {
  // A STABLE singleton: a fresh object per render loops the page's fetch effects.
  const client = {
    meta: { getItems: async () => [] },
    automation: { execute: async () => ({}), listRuns: async () => ({ runs: [] }) },
  };
  return { ADAPTER: { getClient: () => client } };
});

// `ConsolePageHeader` stays REAL: the header under test is the package's.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: [] }),
}));

// Imported after the mocks so the page picks them up.
import { FlowRunsPage } from './FlowRunsPage';

afterEach(cleanup);

describe('Flow Runs — the console page header (objectui#12553)', () => {
  it('`page-header` holds the one h1, the subtitle in its row and an icon chip', async () => {
    const { container } = render(<FlowRunsPage />);
    await screen.findByText('No flow definitions found.');
    const header = screen.getByTestId('page-header');

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(header.contains(h1s[0])).toBe(true);
    expect(h1s[0].textContent).toBe('Flow Runs');

    const line = within(header).getByText(
      'Pick a flow, trigger a test run with sample inputs, and inspect recent run history',
    );
    expect(line.tagName).toBe('P');
    expect(line.parentElement).toBe(h1s[0].parentElement);

    expect(h1s[0].parentElement!.querySelector('svg')).not.toBeNull();
  });

  it('the header spans the page above the padded body, not inside it', async () => {
    render(<FlowRunsPage />);
    await screen.findByText('No flow definitions found.');
    const header = screen.getByTestId('page-header');
    const body = header.nextElementSibling as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body!.className.split(' ')).toEqual(expect.arrayContaining(['p-4', 'sm:p-6']));
    expect(body!.contains(screen.getByText('No flow definitions found.'))).toBe(true);
  });
});
