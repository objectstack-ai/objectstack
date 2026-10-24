/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12510 — the pending-changes sheet's controls carry names: each row's
 * expander is named by the item's label (then its machine name and verdict),
 * and the sheet's close button is "Close".
 *
 * The 2026-10-15 test pass read both as buttons with no name; the browser's
 * computed tree on the Studio's Changes sheet names them ("Ticket a11y_ticket
 * New", "Close"). This pins the names by role so a restyle that hides the
 * text from the tree turns red. The harness is objectui#11862's.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
    language: 'zh-CN',
  }),
}));

import { DraftChangesPanel } from '../DraftChangesPanel';

const DRAFT_ROWS = [
  { type: 'permission', name: 'qa_readers', packageId: 'com.x', label: 'QA Readers' },
  { type: 'object', name: 'laneawf_qa_wf_obj', packageId: 'com.x', label: 'QA WF Object 2' },
  { type: 'page', name: 'home', packageId: 'com.x', label: { en: 'Home', 'zh-CN': '首页' } },
  { type: 'object', name: 'bare_obj', packageId: 'com.x', label: null },
];

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  if (url.includes('/_drafts')) return ok({ drafts: DRAFT_ROWS });
  if (/\/meta\/object(\?|$)/.test(url)) return ok([{ name: 'laneawf_qa_wf_obj', label: 'QA WF Object' }]);
  if (/\/meta\/page(\?|$)/.test(url)) return ok([]);
  if (/\/meta\/permission(\?|$)/.test(url)) return ok([]);
  return { ok: false, status: 404, json: async () => ({}) };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

async function renderPanel() {
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" />);
  // Every row classified: each badge has replaced its spinner.
  await waitFor(() => expect(screen.getAllByText(/^(New|Update)$/)).toHaveLength(DRAFT_ROWS.length));
}

describe('objectui#12510 — the pending-changes sheet names its controls', () => {
  it("each row's expander is a button named by the item's label first", async () => {
    await renderPanel();
    const toggle = screen.getByRole('button', { name: /^QA Readers\b/ });
    expect(toggle).toHaveAttribute('data-testid', 'draft-entry-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAccessibleName(/^QA Readers\s*qa_readers\s*New$/);
  });

  it('the sheet closes through a button named "Close"', async () => {
    await renderPanel();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });
});
