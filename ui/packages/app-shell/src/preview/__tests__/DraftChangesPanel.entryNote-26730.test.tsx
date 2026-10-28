// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26730 — a Pending changes entry carries the note its host gives it.
 *
 * The sheet is on the console's eager graph, so it does not read a refusal
 * itself: the Studio surface hands it `renderEntryNote`, and each entry shows
 * what that answers under its row, with every entry the host has nothing for
 * drawn as before. The surface's side (which refusal, when it goes) is pinned
 * in `StudioDesignSurface.publishRefusal-26730.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
    language: 'en',
  }),
}));

import { DraftChangesPanel, type DraftChangeEntry } from '../DraftChangesPanel';

// `flows`: a stored plural spelling, which the sheet folds before the host sees it.
const DRAFT_ROWS = [
  { type: 'flows', name: 'approval', packageId: 'com.x', label: 'Approval' },
  { type: 'object', name: 'invoice', packageId: 'com.x', label: 'Invoice' },
];

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  if (url.includes('/_drafts')) return ok({ drafts: DRAFT_ROWS });
  if (/\/meta\/[a-z_]+(\?|$)/.test(url)) return ok([]);
  return { ok: false, status: 404, json: async () => ({}) };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

async function renderPanel(renderEntryNote?: (entry: DraftChangeEntry) => React.ReactNode) {
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" renderEntryNote={renderEntryNote} />);
  await waitFor(() => expect(screen.getAllByTestId('draft-entry-toggle')).toHaveLength(DRAFT_ROWS.length));
}

/** The entry whose row holds `text`. */
function entryOf(text: string): HTMLElement {
  return screen.getByText(text).closest('[data-testid="draft-entry-toggle"]')!.parentElement as HTMLElement;
}

describe('a Pending changes entry shows the note its host gives it (objectstack#26730)', () => {
  it('under the entry it is for, and only there', async () => {
    const seen: string[] = [];
    await renderPanel((entry) => {
      seen.push(`${entry.type}/${entry.name}`);
      return entry.name === 'approval' ? <p>Not published. Check the step “Notify”.</p> : null;
    });
    // The host is asked with the folded type.
    expect(seen).toContain('flow/approval');
    const note = within(entryOf('Approval')).getByTestId('draft-entry-note');
    expect(note).toHaveTextContent('Not published. Check the step “Notify”.');
    expect(within(entryOf('Invoice')).queryByTestId('draft-entry-note')).toBeNull();
  });

  it('CONTROL: with no host note, no entry draws one', async () => {
    await renderPanel();
    expect(screen.queryByTestId('draft-entry-note')).toBeNull();
  });
});
