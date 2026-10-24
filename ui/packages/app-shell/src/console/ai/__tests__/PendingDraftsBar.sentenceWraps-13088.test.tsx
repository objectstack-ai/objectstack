// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13088 — the pending-drafts bar's sentence is never cut to one line.
 *
 * On a phone the bar's row is narrower than its sentence. The sentence used to
 * be drawn in a `truncate` span (one line, `overflow: hidden`, an ellipsis),
 * so at 390 px the zh sentence ended 「用户还看不…」 and the half that says
 * users cannot see the change yet was cut. It now wraps onto more lines,
 * taking the row's free width, while the publish button keeps its place on
 * the bar.
 *
 * ## What is read here, and what is not
 *
 * This environment runs no layout and loads no stylesheet, so a reading of
 * the sentence's widths or its computed `white-space` would pass whatever the
 * markup said. What is read instead is the structure that decides whether the
 * sentence can wrap, each reading one the old span fails:
 *
 * - the sentence element, found by its own `data-testid` (never by a class
 *   this file asserts about), carries no one-line clamp: no `truncate`,
 *   `whitespace-nowrap`, `text-nowrap`, `text-ellipsis`, `overflow-hidden`,
 *   `overflow-x-hidden`, `overflow-clip` or `line-clamp-*`;
 * - nothing from the sentence up to the bar carries a class that would hand
 *   it `white-space: nowrap` by inheritance (`truncate`, `whitespace-nowrap`,
 *   `text-nowrap`);
 * - the publish button sits on the same bar.
 *
 * The boxes themselves (the sentence's `scrollWidth` against `clientWidth`,
 * its line count, the bar, the button and the input) were measured in
 * Chromium at 320, 390, 1010 and 1280 px, zh and en, before and after, and are
 * recorded on this change's pull request.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { PendingDraftsBar } from '../PendingDraftsBar.js';

vi.mock('../../../providers/MetadataProvider.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ refresh: vi.fn() }),
}));

const PKG = 'app.hcpl';
const DRAFT = { type: 'object', name: 'hcpl_borrowing', label: 'Borrowing', packageId: PKG };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes('/meta/_drafts') ? { drafts: [DRAFT] } : { success: true };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Classes that clamp the element they sit on to one line, or clip it. */
const CLAMPS_ITSELF = new Set([
  'truncate',
  'whitespace-nowrap',
  'text-nowrap',
  'text-ellipsis',
  'overflow-hidden',
  'overflow-x-hidden',
  'overflow-clip',
]);
/** Classes whose `white-space: nowrap` every descendant inherits. */
const NOWRAP_INHERITED = new Set(['truncate', 'whitespace-nowrap', 'text-nowrap']);

function classesOf(el: Element): string[] {
  return Array.from(el.classList);
}

describe('objectui#13088 — the pending-drafts bar shows its whole sentence', () => {
  it('the sentence wraps instead of being clamped to one line, and the publish button stays on the bar', async () => {
    render(<PendingDraftsBar packageId={PKG} idle />);
    const bar = await screen.findByTestId('pending-drafts-bar', undefined, { timeout: 4000 });
    const sentence = within(bar).getByTestId('pending-drafts-bar-sentence');

    // The whole sentence is in the element, including its second half.
    expect(sentence).toHaveTextContent('1 change(s) are not published yet — users cannot see them.');

    // No one-line clamp on the sentence itself.
    const clamps = classesOf(sentence).filter((c) => CLAMPS_ITSELF.has(c) || /^line-clamp-/.test(c));
    expect(clamps).toEqual([]);

    // Nothing between the sentence and the bar (both included) hands it
    // `white-space: nowrap` by inheritance.
    const inherited: string[] = [];
    for (let el: Element | null = sentence; el; el = el === bar ? null : el.parentElement) {
      for (const c of classesOf(el)) if (NOWRAP_INHERITED.has(c)) inherited.push(`${el.tagName.toLowerCase()} ${c}`);
    }
    expect(inherited).toEqual([]);

    // The publish action stays on the bar.
    expect(within(bar).getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });
});
