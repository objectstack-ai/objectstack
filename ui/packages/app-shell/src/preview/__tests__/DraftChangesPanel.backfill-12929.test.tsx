/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12929 — the pending-changes sheet offers, under each field a publish
 * ADDS to an already-published object, an unchecked "backfill default" choice,
 * and only where the batch door would honour it (objectstack#24253): the
 * draft's `fields` map declares a LITERAL `defaultValue`. A runtime token, an
 * expression envelope, no default, and a brand-new object get no choice.
 *
 * The footer hands its host the checked fields as the door's `backfill`
 * option, and NOTHING when none is checked — so an author who checks nothing
 * sends the request the sheet always sent.
 *
 * Real: the sheet, its drill-in, its diff and the spec's default-shape
 * discriminator. Stubbed: `globalThis.fetch` (the `/meta` reads), the adapter
 * (the record count read), and `useObjectTranslation` (interpolating the
 * inline default, so labels read as an author sees them).
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

import { DraftChangesPanel, backfillCandidates, type DraftPublishOptions } from '../DraftChangesPanel';

const PACKAGE_ID = 'com.x';

const DRAFT_ROWS = [
  // Published, and the draft adds fields of every default shape.
  { type: 'object', name: 'st_ticket', packageId: PACKAGE_ID },
  // Not yet published: no existing records, so nothing to backfill.
  { type: 'object', name: 'st_queue', packageId: PACKAGE_ID },
];

const PUBLISHED_TICKET = { name: 'st_ticket', fields: { title: { type: 'text' } } };
const DRAFT_TICKET = {
  name: 'st_ticket',
  fields: {
    title: { type: 'text' },
    done: { type: 'boolean', defaultValue: false },
    opened_at: { type: 'datetime', defaultValue: 'NOW()' },
    score: { type: 'number', defaultValue: { dialect: 'cel', source: '1 + 1' } },
    note: { type: 'text' },
    level: { type: 'number', defaultValue: null },
  },
};
const DRAFT_QUEUE = { name: 'st_queue', fields: { open: { type: 'boolean', defaultValue: true } } };

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/_drafts')) return ok({ drafts: DRAFT_ROWS });
  if (/\/meta\/object(\?|$)/.test(url)) return ok([{ name: 'st_ticket' }]);
  const isDraft = url.includes('state=draft');
  if (url.includes('/meta/object/st_ticket')) return ok(isDraft ? DRAFT_TICKET : PUBLISHED_TICKET);
  if (url.includes('/meta/object/st_queue') && isDraft) return ok(DRAFT_QUEUE);
  return { ok: false, status: 404, json: async () => ({}) };
});

let find: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  find = vi.fn(async () => ({ data: [], total: 12 }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

function renderSheet(
  props: Partial<React.ComponentProps<typeof DraftChangesPanel>> & {
    onPublish?: (options?: DraftPublishOptions) => void;
  },
  adapter: unknown = { find },
) {
  return render(
    <AdapterCtx.Provider value={adapter as React.ContextType<typeof AdapterCtx>}>
      <DraftChangesPanel open onOpenChange={() => {}} packageId={PACKAGE_ID} posture="confirm" {...props} />
    </AdapterCtx.Provider>,
  );
}

/** Every drill-in has rendered its diff (the confirm posture expands each row). */
async function settled() {
  await waitFor(() => expect(screen.getAllByTestId('draft-entry-detail')).toHaveLength(DRAFT_ROWS.length));
}

describe('the backfill choice is offered only where the batch door would honour it (objectui#12929)', () => {
  it('one choice — the added literal-default field of the published object — unchecked, naming the record count', async () => {
    renderSheet({ onPublish: vi.fn() });
    await settled();
    const options = await screen.findAllByTestId('draft-backfill-option');
    expect(options).toHaveLength(1);
    // Waited for: the drill-in reads the count only after the option draws, so the
    // name carries no number until that read lands.
    const box = await screen.findByRole('checkbox', { name: 'Backfill default (12 existing records)' });
    expect(box).not.toBeChecked();
    // The literal the door would write is shown beside it.
    expect(options[0]).toHaveTextContent('= false');
    // Counted once, for the published object only, with the footer probe's `$top: 0`.
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    expect(find).toHaveBeenCalledWith('st_ticket', { $top: 0 });
  });

  it('names no number when the count read carries no numeric total', async () => {
    find = vi.fn(async () => ({ data: [] }));
    renderSheet({ onPublish: vi.fn() });
    await settled();
    expect(await screen.findByRole('checkbox', { name: 'Backfill default' })).not.toBeChecked();
  });

  it('offers nothing without a package: the package-less scope has no batch door', async () => {
    renderSheet({ onPublish: vi.fn(), packageId: null });
    await settled();
    expect(screen.queryAllByTestId('draft-backfill-option')).toEqual([]);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });

  it('offers nothing without a Publish: a read-only host has nothing for the choice to ride on', async () => {
    renderSheet({});
    await settled();
    expect(screen.queryAllByTestId('draft-backfill-option')).toEqual([]);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });
});

describe('the footer hands the host the checked fields, and nothing when none is checked (objectui#12929)', () => {
  it('unchecked: Publish all is called with no options at all', async () => {
    const onPublish = vi.fn();
    renderSheet({ onPublish });
    await settled();
    await screen.findByTestId('draft-backfill-option');
    fireEvent.click(screen.getByTestId('draft-changes-publish'));
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish.mock.calls[0]).toEqual([]);
  });

  it('checked: Publish all passes `{ backfill: [{ object, field }] }`, the door’s own option', async () => {
    const onPublish = vi.fn();
    renderSheet({ onPublish });
    await settled();
    fireEvent.click(await screen.findByRole('checkbox', { name: /^Backfill default/ }));
    expect(screen.getByRole('checkbox', { name: /^Backfill default/ })).toBeChecked();
    fireEvent.click(screen.getByTestId('draft-changes-publish'));
    expect(onPublish.mock.calls).toEqual([[{ backfill: [{ object: 'st_ticket', field: 'done' }] }]]);
  });

  it('checked then unchecked: back to no options', async () => {
    const onPublish = vi.fn();
    renderSheet({ onPublish });
    await settled();
    const box = await screen.findByRole('checkbox', { name: /^Backfill default/ });
    fireEvent.click(box);
    fireEvent.click(box);
    fireEvent.click(screen.getByTestId('draft-changes-publish'));
    expect(onPublish.mock.calls).toEqual([[]]);
  });
});

describe('backfillCandidates — the door’s rule over the two bodies (objectui#12929)', () => {
  const added = ['done', 'opened_at', 'score', 'note', 'level'];

  it('keeps only a declared literal default', () => {
    expect(backfillCandidates(PUBLISHED_TICKET, DRAFT_TICKET, added)).toEqual([{ field: 'done', value: false }]);
  });

  it('offers nothing for an unpublished object, or a draft whose `fields` is not the map the door reads', () => {
    expect(backfillCandidates(null, DRAFT_TICKET, added)).toEqual([]);
    const arrayShaped = { name: 'st_ticket', fields: [{ name: 'done', type: 'boolean', defaultValue: false }] };
    expect(backfillCandidates(PUBLISHED_TICKET, arrayShaped, ['done'])).toEqual([]);
  });

  it('a falsy literal is still a default; a field not in the added list is not offered', () => {
    const draft = { fields: { zero: { type: 'number', defaultValue: 0 }, empty: { type: 'text', defaultValue: '' } } };
    expect(backfillCandidates({ fields: {} }, draft, ['zero', 'empty'])).toEqual([
      { field: 'zero', value: 0 },
      { field: 'empty', value: '' },
    ]);
    expect(backfillCandidates({ fields: {} }, draft, ['zero'])).toEqual([{ field: 'zero', value: 0 }]);
  });
});
