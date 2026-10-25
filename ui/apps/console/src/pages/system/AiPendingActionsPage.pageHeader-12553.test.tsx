// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AI Approvals — the page is named by the console's one page header, the one
 * an object list, a dashboard and the Approvals Inbox draw (objectui#12553).
 *
 * The page drew its own `h1` with a subtitle line beneath it, and no icon. It
 * now renders `ConsolePageHeader`, the console page header
 * `@object-ui/app-shell` exports: the title and the subtitle beside it, in one
 * row. A page that drew no icon gets no chip.
 *
 * What this file pins, through the real page and the real header:
 *   - `page-header` holds the page's one `h1` ("AI Approvals") and the
 *     subtitle in the title's row, with no icon chip;
 *   - the header spans the page above the padded body, which still holds the
 *     queue.
 *
 * The queue component is stubbed: it polls the AI service, and its own suites
 * live in `@object-ui/plugin-chatbot`. jsdom applies no stylesheet, so
 * structure is what is asserted.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AiPendingActionsInbox: ({ title }: { title?: string }) => title ?? null,
}));

// Imported after the mocks so the page picks them up.
import { AiPendingActionsPage } from './AiPendingActionsPage';

afterEach(cleanup);

describe('AI Approvals — the console page header (objectui#12553)', () => {
  it('`page-header` holds the one h1 and the subtitle in its row, with no icon chip', () => {
    const { container } = render(<AiPendingActionsPage />);
    const header = screen.getByTestId('page-header');

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(header.contains(h1s[0])).toBe(true);
    expect(h1s[0].textContent).toBe('AI Approvals');

    const line = within(header).getByText(
      'Review actions an AI agent proposed. Approve to execute them server-side; reject to send a reason back to the model so it can revise the next turn.',
    );
    expect(line.tagName).toBe('P');
    expect(line.parentElement).toBe(h1s[0].parentElement);

    // The page drew no icon, so the header draws no chip.
    expect(header.querySelector('svg')).toBeNull();
  });

  it('the header spans the page above the padded body, which holds the queue', () => {
    render(<AiPendingActionsPage />);
    const header = screen.getByTestId('page-header');
    const body = header.nextElementSibling as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body!.className.split(' ')).toEqual(expect.arrayContaining(['p-6', 'max-w-6xl']));
    expect(header.closest('.max-w-6xl')).toBeNull();
    expect(body!.textContent).toBe('Queue');
  });
});
