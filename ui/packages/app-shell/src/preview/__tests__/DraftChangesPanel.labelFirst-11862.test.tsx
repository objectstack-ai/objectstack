/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11862 (the remainder) — the Changes list leads each row with the
 * item's label, and the machine name follows as secondary text.
 *
 * Measured on a live boot (re-measure `6138292486`): rows read
 * `PERMISSION · 1 | qa_readers | New` and `OBJECT · 1 | laneawf_qa_wf_obj |
 * Update`, where the object's label is "QA WF Object 2". On the maintainer's
 * word 「所有地方以标签为主，机器名只作为次要信息」 and the seat ruling `6053526025`
 * (question 1, A at the producer), the label is the one each `_drafts` row
 * carries since objectstack-ai/objectstack#22200: the draft body's own label,
 * or `null`. It is read off that row, for a NEW row and an UPDATE row alike,
 * and no item is read to find it.
 *
 *  - a NEW row and an UPDATE row lead with the row's label, the machine name
 *    beneath it in monospace;
 *  - a locale-map label reads in the console language;
 *  - CONTROL: a row whose label is `null` reads as its name alone, once, in
 *    monospace, as before;
 *  - no item is read for a label: before any row is expanded, a permission
 *    or page row is never read by name. (An object row's draft IS read at
 *    open, by the security-posture lint, for its sharing settings: that read
 *    predates this change and is not a label read.)
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

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

/** The row toggle that holds `text`. */
function rowOf(text: string): HTMLElement {
  return screen.getByText(text).closest('[data-testid="draft-entry-toggle"]') as HTMLElement;
}

describe('objectui#11862 — the Changes list: label first, machine name second', () => {
  it("a NEW row leads with its `_drafts` row's label, the machine name beneath it", async () => {
    await renderPanel();
    const row = rowOf('QA Readers');
    expect(within(row).getByText('qa_readers')).toHaveClass('font-mono');
    expect(within(row).getByText('New')).toBeInTheDocument();
  });

  it("an UPDATE row leads with its `_drafts` row's label, the machine name beneath it", async () => {
    await renderPanel();
    const row = rowOf('QA WF Object 2');
    expect(within(row).getByText('laneawf_qa_wf_obj')).toHaveClass('font-mono');
    expect(within(row).getByText('Update')).toBeInTheDocument();
  });

  it('a locale-map label reads in the console language, never as [object Object]', async () => {
    await renderPanel();
    const row = rowOf('首页');
    expect(within(row).getByText('home')).toHaveClass('font-mono');
    expect(screen.queryByText('[object Object]')).toBeNull();
  });

  it('CONTROL: a row whose label is null reads as its name alone, once, in monospace', async () => {
    await renderPanel();
    const row = rowOf('bare_obj');
    expect(within(row).getAllByText('bare_obj')).toHaveLength(1);
    expect(within(row).getByText('bare_obj')).toHaveClass('font-mono');
  });

  it('no item is read for a label: a permission or page row is never read by name', async () => {
    await renderPanel();
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((u) => u.includes('/_drafts'))).toBe(true);
    // An item read is `/meta/TYPE/NAME`; none is made for these rows before one is expanded.
    expect(urls.filter((u) => /\/meta\/(permission|page)\/[^/?]+/.test(u))).toEqual([]);
  });
});
