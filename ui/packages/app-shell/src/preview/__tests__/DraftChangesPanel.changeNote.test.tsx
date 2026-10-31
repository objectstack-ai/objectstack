/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0146 D1 — the publish review takes an optional change note, and the
 * footer hands it to its host as the batch door's `message`. The server
 * records that note on every item history row the publish writes.
 *
 * Offered only where the footer publishes one package as a batch (the only
 * door that carries a note to every row): not in the package-less scope, and
 * not on a read-only host. A note of only whitespace sends none, and a sheet
 * with no note and no backfill choice still calls its host with no options —
 * the request it always sent.
 *
 * Real: the sheet and its footer. Stubbed: `globalThis.fetch` (the `/meta`
 * reads), the adapter, and `useObjectTranslation` (returning the inline
 * default, so labels read as an author sees them).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdapterCtx } from '@object-ui/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: Record<string, unknown> & { defaultValue?: string }) =>
      (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(o?.[name] ?? '')),
    language: 'en',
  }),
}));

import { DraftChangesPanel, type DraftPublishOptions } from '../DraftChangesPanel';

const PACKAGE_ID = 'com.x';

const DRAFT_ROWS = [{ type: 'object', name: 'st_ticket', packageId: PACKAGE_ID }];
const PUBLISHED_TICKET = { name: 'st_ticket', fields: { title: { type: 'text' } } };
const DRAFT_TICKET = {
  name: 'st_ticket',
  fields: { title: { type: 'text' }, done: { type: 'boolean', defaultValue: false } },
};

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/_drafts')) return ok({ drafts: DRAFT_ROWS });
  if (/\/meta\/object(\?|$)/.test(url)) return ok([{ name: 'st_ticket' }]);
  if (url.includes('/meta/object/st_ticket')) return ok(url.includes('state=draft') ? DRAFT_TICKET : PUBLISHED_TICKET);
  return { ok: false, status: 404, json: async () => ({}) };
});

const find = vi.fn(async () => ({ data: [], total: 3 }));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  find.mockClear();
});

function renderSheet(props: Partial<React.ComponentProps<typeof DraftChangesPanel>> & {
  onPublish?: (options?: DraftPublishOptions) => void;
}) {
  return render(
    <AdapterCtx.Provider value={{ find } as unknown as React.ContextType<typeof AdapterCtx>}>
      <DraftChangesPanel open onOpenChange={() => {}} packageId={PACKAGE_ID} posture="confirm" {...props} />
    </AdapterCtx.Provider>,
  );
}

async function settled() {
  await waitFor(() => expect(screen.getAllByTestId('draft-entry-detail')).toHaveLength(DRAFT_ROWS.length));
}

const noteBox = () => screen.getByRole('textbox', { name: 'Change note (optional)' });

describe('the change note is offered where the batch door publishes (ADR-0146 D1)', () => {
  it('a labelled, empty note field sits above Publish all', async () => {
    renderSheet({ onPublish: vi.fn() });
    await settled();
    expect(noteBox()).toHaveValue('');
    expect(noteBox()).toHaveAttribute('placeholder', 'What changed and why. It is shown in each item’s history.');
  });

  it('not in the package-less scope: that Publish promotes each draft by itself', async () => {
    renderSheet({ onPublish: vi.fn(), packageId: null });
    await settled();
    expect(screen.queryByTestId('draft-changes-note')).toBeNull();
  });

  it('not on a read-only host: there is no Publish for it to ride on', async () => {
    renderSheet({});
    await settled();
    expect(screen.queryByTestId('draft-changes-note')).toBeNull();
  });

  it('disabled while the host publishes', async () => {
    renderSheet({ onPublish: vi.fn(), publishing: true });
    await settled();
    expect(noteBox()).toBeDisabled();
  });
});

describe('the footer hands the host the note as the door’s `message` (ADR-0146 D1)', () => {
  it('a note is sent trimmed, as `{ message }`', async () => {
    const onPublish = vi.fn();
    renderSheet({ onPublish });
    await settled();
    fireEvent.change(noteBox(), { target: { value: '  Track whether a ticket is done  ' } });
    fireEvent.click(screen.getByTestId('draft-changes-publish'));
    expect(onPublish.mock.calls).toEqual([[{ message: 'Track whether a ticket is done' }]]);
  });

  it('no note, or only whitespace: Publish all is called with no options at all', async () => {
    const onPublish = vi.fn();
    renderSheet({ onPublish });
    await settled();
    fireEvent.click(screen.getByTestId('draft-changes-publish'));
    fireEvent.change(noteBox(), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('draft-changes-publish'));
    expect(onPublish.mock.calls).toEqual([[], []]);
  });

  it('a note rides beside the checked backfill choices', async () => {
    const onPublish = vi.fn();
    renderSheet({ onPublish });
    await settled();
    fireEvent.click(await screen.findByRole('checkbox', { name: /^Backfill default/ }));
    fireEvent.change(noteBox(), { target: { value: 'Backfill done flags' } });
    fireEvent.click(screen.getByTestId('draft-changes-publish'));
    expect(onPublish.mock.calls).toEqual([
      [{ backfill: [{ object: 'st_ticket', field: 'done' }], message: 'Backfill done flags' }],
    ]);
  });
});
