// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12027 — the embedded item editor saves into the parent's DRAFT.
 *
 * `EmbeddedItemEditor` edits an item that lives inside a parent body
 * (`object.fields.amount`) and saves it by writing the whole parent back. It
 * used to base that write on the parent's published layers and send it in
 * publish mode. For a parent that exists only as a draft, `/layers` answers 404
 * by design (objectstack-ai/objectstack#22397), the client resolves that as
 * every layer `null`, and the save sent a publish-mode PUT of a one-field stub,
 * then said "Saved.".
 *
 * The REAL editor over a REAL `MetadataClient`, whose transport is an
 * in-memory server answering as the framework does: the pending-drafts ledger,
 * `?state=draft` (a decorated draft), `/layers` (404 for a parent with no
 * published row), and a PUT that stores into the draft row under `?mode=draft`
 * and into the published row otherwise.
 *
 * Pinned:
 *  - a draft-only parent's edit lands in its draft, every other field kept, and
 *    no publish-mode request is sent;
 *  - a published parent with a pending draft: the edit lands in the draft, the
 *    draft's own edits are kept, and the published row is untouched;
 *  - CONTROL: a published parent with no draft saves as it did before this card
 *    (one publish-mode PUT of the effective body with the item spliced in);
 *  - a parent with neither a draft nor a published version is refused with an
 *    error state: nothing is PUT, and no "Saved.";
 *  - a draft-read failure is the save's error, and nothing is PUT;
 *  - a 422 on a draft-mode save still lands its issue on the sub-form field.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';

const FIELD_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', title: 'Label' },
    description: { type: 'string', title: 'Description' },
  },
} satisfies Record<string, unknown>;

type Row = Record<string, unknown>;

const server = {
  active: new Map<string, Row>(),
  drafts: new Map<string, Row>(),
  requests: [] as Array<{ method: string; path: string; search: string; status: number }>,
  puts: [] as Array<{ search: string; body: Row }>,
  /** Rows whose `?state=draft` read fails with a 5xx. */
  failDraftRead: new Set<string>(),
  /** Rows whose draft-mode PUT is refused with this issue. */
  refuseDraftPut: new Map<string, { path: string; message: string }>(),
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const q = url.searchParams;
  let status = 200;
  let body: unknown = [];
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (meta) {
    const seg = meta[1].split('/').map(decodeURIComponent);
    const key = `${seg[0]}/${seg[1]}`;
    if (seg[0] === '_drafts') {
      body = { drafts: [...server.drafts.keys()].map((k) => ({ type: k.split('/')[0], name: k.split('/')[1], packageId: null })) };
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const row = server.active.get(key);
      if (row) body = { code: null, overlay: row, overlayScope: 'env', effective: row };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2 && method === 'PUT') {
      const item = JSON.parse(String(init?.body ?? '{}')) as Row;
      server.puts.push({ search: url.search, body: item });
      const draftMode = q.get('mode') === 'draft';
      const refusal = draftMode ? server.refuseDraftPut.get(key) : undefined;
      if (refusal) {
        [status, body] = [422, {
          error: `[invalid_metadata] ${key} failed spec validation: 1 issue — ${refusal.path} [custom]`,
          code: 'INVALID_METADATA',
          issues: [{ ...refusal, code: 'custom' }],
        }];
      } else {
        if (draftMode) server.drafts.set(key, item);
        else server.active.set(key, item);
        body = { type: seg[0], name: seg[1], state: draftMode ? 'draft' : 'active' };
      }
    } else if (seg.length === 2) {
      const draftRead = q.get('state') === 'draft';
      const row = (draftRead ? server.drafts : server.active).get(key);
      if (draftRead && server.failDraftRead.has(key)) {
        [status, body] = [500, { error: { code: 'INTERNAL_ERROR', message: 'draft store unavailable' } }];
      } else if (row) {
        // A served draft is DECORATED (`_draft`); the editor must strip it.
        body = { type: seg[0], name: seg[1], item: draftRead ? { ...row, _draft: true } : row };
      } else {
        [status, body] = [404, { error: { code: draftRead ? 'NO_DRAFT' : 'NOT_FOUND', message: 'absent' } }];
      }
    }
  }
  server.requests.push({ method, path: url.pathname, search: url.search, status });
  return json(status, body);
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => client,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'field', label: 'Field', allowEnvironmentOverlay: true, schema: FIELD_SCHEMA }],
  }),
}));

import { EmbeddedItemEditor } from './EmbeddedItemEditor';

/** The draft an author is mid-flight on: never published. */
const DRAFT_ORDER: Row = {
  name: 'sales_order',
  label: 'Sales Order',
  description: 'Orders taken by the field team',
  fields: {
    amount: { type: 'number', label: 'Amount' },
    region: { type: 'text', label: 'Region' },
  },
};

/** The published version, and a pending draft that has moved past it. */
const PUBLISHED_ORDER: Row = {
  name: 'sales_order',
  label: 'Sales Order',
  fields: { amount: { type: 'number', label: 'Amount' } },
};
const PENDING_ORDER: Row = {
  name: 'sales_order',
  label: 'Sales Orders (renamed in the draft)',
  fields: {
    amount: { type: 'number', label: 'Amount' },
    channel: { type: 'text', label: 'Channel' },
  },
};

const EDITED_AMOUNT = { type: 'number', label: 'Order amount' };

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.requests = [];
  server.puts = [];
  server.failDraftRead.clear();
  server.refuseDraftPut.clear();
});
afterEach(cleanup);

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function editAmountLabelAndSave() {
  render(
    <EmbeddedItemEditor
      parentType="object"
      parentName="sales_order"
      embeddedPath="fields"
      itemName="amount"
      editAs="field"
      initialRaw={{ type: 'number', label: 'Amount' }}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Order amount' } });
  fireEvent.click(saveButton());
}

const saveButton = () => screen.getByRole('button', { name: /save into object/i });
const publishModePuts = () => server.puts.filter((p) => !new URLSearchParams(p.search).has('mode'));

describe('EmbeddedItemEditor — an embedded edit saves into the parent\'s draft (objectui#12027)', () => {
  it('a draft-only parent: the edit lands in its draft with every other field kept, and no publish-mode request is sent', async () => {
    server.drafts.set('object/sales_order', DRAFT_ORDER);
    editAmountLabelAndSave();

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0].search).toBe('?mode=draft');
    expect(publishModePuts()).toEqual([]);
    // The whole draft, the one item replaced, and the read decoration gone.
    expect(server.puts[0].body).toEqual({
      ...DRAFT_ORDER,
      fields: { ...(DRAFT_ORDER.fields as Row), amount: EDITED_AMOUNT },
    });
    expect(server.active.has('object/sales_order')).toBe(false);
  });

  it('a published parent with a pending draft: the edit lands in the draft, the draft\'s own edits are kept, the published row is untouched', async () => {
    server.active.set('object/sales_order', PUBLISHED_ORDER);
    server.drafts.set('object/sales_order', PENDING_ORDER);
    editAmountLabelAndSave();

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(publishModePuts()).toEqual([]);
    expect(server.drafts.get('object/sales_order')).toEqual({
      ...PENDING_ORDER,
      fields: { ...(PENDING_ORDER.fields as Row), amount: EDITED_AMOUNT },
    });
    expect(server.active.get('object/sales_order')).toEqual(PUBLISHED_ORDER);
  });

  it('CONTROL: a published parent with no draft saves as before — one publish-mode PUT of the effective body with the item spliced in', async () => {
    server.active.set('object/sales_order', PUBLISHED_ORDER);
    editAmountLabelAndSave();

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0].search).toBe('');
    expect(server.puts[0].body).toEqual({
      ...PUBLISHED_ORDER,
      fields: { amount: EDITED_AMOUNT },
    });
    expect(server.drafts.has('object/sales_order')).toBe(false);
  });

  it('a parent with neither a draft nor a published version is refused with an error state: nothing is PUT, and no "Saved."', async () => {
    editAmountLabelAndSave();

    expect(await screen.findByText('Failed to load object/sales_order: (not found)')).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    await settle();
    expect(server.puts).toEqual([]);
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('a draft-read failure is the save\'s error, and nothing is PUT', async () => {
    server.active.set('object/sales_order', PUBLISHED_ORDER);
    server.drafts.set('object/sales_order', PENDING_ORDER);
    server.failDraftRead.add('object/sales_order');
    editAmountLabelAndSave();

    expect(await screen.findByText('draft store unavailable')).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    expect(server.puts).toEqual([]);
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('a 422 on the draft-mode save lands its issue on the sub-form field', async () => {
    server.drafts.set('object/sales_order', DRAFT_ORDER);
    server.refuseDraftPut.set('object/sales_order', {
      path: 'fields.amount.label',
      message: 'A field label must not be empty',
    });
    editAmountLabelAndSave();

    expect(await screen.findByText('Validation failed (1 issue).')).toBeInTheDocument();
    expect(screen.getByText('A field label must not be empty')).toBeInTheDocument();
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0].search).toBe('?mode=draft');
    expect(screen.queryByText('Saved.')).toBeNull();
    expect(server.drafts.get('object/sales_order')).toEqual(DRAFT_ORDER);
  });
});
