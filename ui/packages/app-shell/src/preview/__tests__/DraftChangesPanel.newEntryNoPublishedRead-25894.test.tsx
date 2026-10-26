// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#25894 — the pending-changes sheet does not ask
 * for the published body of a NEW draft.
 *
 * Measured on the 2026-10-25 browser pass: after New object → Save as draft in
 * Studio, the console logged `GET /api/v1/meta/object/NAME?package=PKG` → 404.
 * Studio's Publish opens this sheet in the confirm posture, every row
 * expanded, and each row's drill-in read the published body beside the draft
 * before the new-vs-update reads had answered. A draft-only item has no
 * published body, so that read could only answer 404.
 *
 * Pinned:
 *  - a NEW entry: no published item read, the draft read is sent, the detail
 *    renders;
 *  - CONTROL: an UPDATE entry still reads its published body;
 *  - while the classification is in flight, no drill-in sends a published read;
 *  - CONTROL: a type whose classification read fails stays unclassified, and
 *    its entry is read both ways, as before.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
    language: 'en',
  }),
}));

import { DraftChangesPanel } from '../DraftChangesPanel';

const PKG = 'com.x';
// `st_ticket` is draft-only (NEW); `st_queue` overwrites a published object.
const DRAFT_ROWS = [
  { type: 'object', name: 'st_ticket', packageId: PKG, label: 'Ticket' },
  { type: 'object', name: 'st_queue', packageId: PKG, label: 'Queue' },
];

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) });

let publishedList: () => Promise<unknown> = async () => ok([{ name: 'st_queue' }]);
const requests: string[] = [];

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  requests.push(url);
  if (url.includes('/_drafts')) return ok({ drafts: DRAFT_ROWS });
  if (/\/meta\/object(\?|$)/.test(url)) return publishedList();
  const item = url.match(/\/meta\/object\/([^?]+)/)?.[1];
  if (url.includes('state=draft')) return ok({ name: item, label: 'Draft', fields: {} });
  if (item === 'st_queue') return ok({ name: item, label: 'Published', fields: {} });
  return notFound();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  requests.length = 0;
  publishedList = async () => ok([{ name: 'st_queue' }]);
});

/** The published item reads sent for `name` (no `state=draft`). */
const publishedReads = (name: string) =>
  requests.filter((u) => u.includes(`/meta/object/${name}`) && !u.includes('state=draft'));
/**
 * The draft reads sent for `name`. Counted as "at least one", never exactly:
 * the sheet's security-posture lint reads each object draft too, once its
 * rule module has loaded, so the total depends on that load's timing.
 */
const draftReads = (name: string) =>
  requests.filter((u) => u.includes(`/meta/object/${name}`) && u.includes('state=draft'));

function renderConfirm() {
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId={PKG} onPublish={() => {}} posture="confirm" />);
}

describe('objectstack-ai/objectstack#25894 — a NEW draft is not asked for its published body', () => {
  it('a NEW entry sends its draft read only; an UPDATE entry (CONTROL) still reads its published body', async () => {
    renderConfirm();
    await waitFor(() => expect(screen.getAllByTestId('draft-entry-detail')).toHaveLength(DRAFT_ROWS.length));
    await waitFor(() => expect(publishedReads('st_queue')).toHaveLength(1));

    expect(draftReads('st_ticket').length, 'the drill-in never ran: the harness is dead').toBeGreaterThan(0);
    expect(publishedReads('st_ticket')).toEqual([]);
    expect(publishedReads('st_queue')[0]).toContain(`package=${PKG}`);
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Update')).toBeInTheDocument();
  });

  it('while the new-vs-update read is in flight, no drill-in sends a published read', async () => {
    let answer: () => void = () => {};
    publishedList = () =>
      new Promise((resolve) => {
        answer = () => resolve(ok([{ name: 'st_queue' }]));
      });
    renderConfirm();
    await waitFor(() => expect(requests.some((u) => /\/meta\/object(\?|$)/.test(u))).toBe(true));
    // The rows are expanded and mounted; their published reads wait.
    await waitFor(() => expect(screen.getAllByTestId('draft-entry-toggle')).toHaveLength(DRAFT_ROWS.length));
    expect(publishedReads('st_ticket')).toEqual([]);
    expect(publishedReads('st_queue')).toEqual([]);

    answer();
    await waitFor(() => expect(publishedReads('st_queue')).toHaveLength(1));
    await waitFor(() => expect(draftReads('st_ticket').length).toBeGreaterThan(0));
    expect(publishedReads('st_ticket')).toEqual([]);
  });

  it('CONTROL: a type whose classification fails is read both ways, as before', async () => {
    publishedList = async () => ({ ok: false, status: 500, json: async () => ({}) });
    renderConfirm();
    await waitFor(() => expect(publishedReads('st_ticket')).toHaveLength(1));
    await waitFor(() => expect(publishedReads('st_queue')).toHaveLength(1));
    expect(screen.queryByText('New')).toBeNull();
    expect(screen.queryByText('Update')).toBeNull();
  });
});
