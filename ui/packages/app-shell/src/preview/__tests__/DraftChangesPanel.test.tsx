/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));

import { DraftChangesPanel, computeChangeDetail } from '../DraftChangesPanel';

afterEach(() => {
  vi.restoreAllMocks();
});

/* ─────────────── computeChangeDetail (pure) ─────────────── */

describe('computeChangeDetail', () => {
  it('classifies a NEW item: every field and every top-level key added', () => {
    const draft = {
      name: 'ticket',
      label: 'Ticket',
      fields: { status: { type: 'select' }, title: { type: 'text' } },
    };
    const d = computeChangeDetail(null, draft);
    expect(d.fields?.added.sort()).toEqual(['status', 'title']);
    expect(d.fields?.changed).toEqual([]);
    expect(d.fields?.removed).toEqual([]);
    expect(d.keys).toEqual({ added: ['label', 'name'], changed: [], removed: [] });
  });

  it('diffs an UPDATE: added / changed (with keys) / removed fields, unchanged keys dropped', () => {
    const published = {
      name: 'ticket',
      label: 'Ticket',
      fields: {
        title: { type: 'text', label: 'Title' },
        old_notes: { type: 'textarea' },
      },
    };
    const draft = {
      name: 'ticket',
      label: 'Repair Ticket', // changed
      fields: {
        title: { type: 'text', label: 'Subject' }, // label changed
        status: { type: 'select' }, // added
        // old_notes removed
      },
    };
    const d = computeChangeDetail(published, draft);
    expect(d.fields?.added).toEqual(['status']);
    expect(d.fields?.changed).toEqual([{ name: 'title', keys: ['label'] }]);
    expect(d.fields?.removed).toEqual(['old_notes']);
    // `name` unchanged, `fields` handled separately
    expect(d.keys).toEqual({ added: [], changed: ['label'], removed: [] });
  });

  it('handles field-less metadata types with a plain top-level key diff', () => {
    const published = { name: 'crm', label: 'CRM', navigation: [{ id: 'a' }] };
    const draft = { name: 'crm', label: 'CRM', navigation: [{ id: 'a' }, { id: 'b' }] };
    const d = computeChangeDetail(published, draft);
    expect(d.fields).toBeNull();
    expect(d.keys).toEqual({ added: [], changed: ['navigation'], removed: [] });
  });

  it('reports no differences when draft matches published', () => {
    const body = { name: 'x', fields: { a: { type: 'text' } } };
    const d = computeChangeDetail(body, structuredClone(body));
    expect(d.fields?.added).toEqual([]);
    expect(d.fields?.changed).toEqual([]);
    expect(d.fields?.removed).toEqual([]);
    expect(d.keys).toEqual({ added: [], changed: [], removed: [] });
  });
});

/* ─────────────── panel behaviour ─────────────── */

const PUBLISHED_TICKET = {
  name: 'ticket',
  label: 'Ticket',
  fields: { title: { type: 'text' } },
};
const DRAFT_TICKET = {
  name: 'ticket',
  label: 'Ticket',
  fields: { title: { type: 'text' }, status: { type: 'select' } },
};

/** Route fetches by URL shape: _drafts list, published type list, item reads. */
function mockRoutes() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/_drafts')) {
      return ok([{ type: 'object', name: 'ticket', packageId: 'com.x' }]);
    }
    if (url.includes('state=draft')) {
      return ok({ type: 'object', name: 'ticket', item: DRAFT_TICKET });
    }
    if (/\/meta\/object\/ticket/.test(url)) {
      return ok(PUBLISHED_TICKET);
    }
    if (/\/meta\/object(\?|$)/.test(url)) {
      return ok([{ name: 'ticket' }]);
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

function renderPanel(extra: Partial<React.ComponentProps<typeof DraftChangesPanel>> = {}) {
  return render(
    <DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" {...extra} />,
  );
}

describe('DraftChangesPanel', () => {
  it('shows no publish footer without onPublish (read-only review, e.g. preview bar)', async () => {
    mockRoutes();
    renderPanel();
    await waitFor(() => expect(screen.getByText('ticket')).toBeInTheDocument());
    expect(screen.queryByTestId('draft-changes-publish')).not.toBeInTheDocument();
  });

  it('renders the confirm footer and forwards the click to onPublish', async () => {
    mockRoutes();
    const onPublish = vi.fn();
    renderPanel({ onPublish });
    await waitFor(() => expect(screen.getByTestId('draft-changes-publish')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('draft-changes-publish'));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm button while publishing', async () => {
    mockRoutes();
    renderPanel({ onPublish: vi.fn(), publishing: true });
    await waitFor(() => expect(screen.getByTestId('draft-changes-publish')).toBeInTheDocument());
    expect(screen.getByTestId('draft-changes-publish')).toBeDisabled();
  });

  it('expands an entry into a lazily-fetched field-level diff', async () => {
    mockRoutes();
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('draft-entry-toggle')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('draft-entry-toggle'));
    await waitFor(() => expect(screen.getByTestId('draft-entry-detail')).toBeInTheDocument());
    // status is added in the draft; title unchanged → only the + row shows.
    expect(screen.getByText('+ status')).toBeInTheDocument();
    expect(screen.queryByText(/~ title/)).not.toBeInTheDocument();
  });
});

/* ─────────── `/meta` type segment is singular — always (objectstack#9180) ─────────── */

/**
 * The panel is DATA-DRIVEN, not authored: `type` arrives from the
 * `/api/v1/meta/_drafts` feed's stored rows with a `typeof` check and nothing
 * else, so a row stored under a pre-#7894 plural spelling made the Console emit
 * a plural `/meta` item route. These pins assert the EMITTED addresses, with a
 * fixture that carries a plural stored `type` — a route-spelling fix passes
 * vacuously against an already-singular fixture.
 *
 * Nothing here asserts anything about the at-rest data: residue stays exactly
 * as stored, and this change adds no write path.
 */

/** Record every URL the panel requests, and answer each route shape. */
function mockRoutesRecording(
  drafts: Array<{ type: string; name: string; packageId?: string | null }>,
): string[] {
  const urls: string[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/_drafts')) {
      return ok(drafts.map((d) => ({ packageId: 'com.x', ...d })));
    }
    const segments = url.split('?')[0].replace('/api/v1/meta/', '').split('/');
    // `/meta/:type` is the published-name list; `/meta/:type/:name` is an item.
    if (segments.length === 1) return ok([{ name: 'ticket' }]);
    return ok(url.includes('state=draft') ? { item: DRAFT_TICKET } : PUBLISHED_TICKET);
  }) as unknown as typeof fetch;
  return urls;
}

/** Every `/meta` request except the `_drafts` feed the values come from. */
const metaRoutes = (urls: string[]) => urls.filter((u) => !u.includes('/_drafts'));

describe('DraftChangesPanel — /meta routes are addressed in the singular', () => {
  it('reads the published list of a PLURAL stored type at its singular route', async () => {
    const urls = mockRoutesRecording([{ type: 'objects', name: 'ticket' }]);
    renderPanel();
    await waitFor(() => expect(screen.getByText('ticket')).toBeInTheDocument());
    await waitFor(() => expect(metaRoutes(urls)).toContain('/api/v1/meta/object'));
    expect(metaRoutes(urls).filter((u) => /\/meta\/objects\b/.test(u))).toEqual([]);
  });

  it('reads both item bodies of a PLURAL stored type at singular routes', async () => {
    const urls = mockRoutesRecording([{ type: 'objects', name: 'ticket' }]);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('draft-entry-toggle')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('draft-entry-toggle'));
    await waitFor(() => expect(screen.getByTestId('draft-entry-detail')).toBeInTheDocument());
    const items = metaRoutes(urls).filter((u) => u.includes('/ticket'));
    expect(items).toContain('/api/v1/meta/object/ticket?package=com.x');
    expect(items).toContain('/api/v1/meta/object/ticket?state=draft&package=com.x');
    expect(items.filter((u) => /\/meta\/objects\b/.test(u))).toEqual([]);
  });

  it('FOLDS `capabilities`, never strips it — `capabilitie` is what a rule emits', async () => {
    const urls = mockRoutesRecording([{ type: 'capabilities', name: 'billing_admin' }]);
    renderPanel();
    await waitFor(() => expect(screen.getByText('billing_admin')).toBeInTheDocument());
    await waitFor(() => expect(metaRoutes(urls)).toContain('/api/v1/meta/capability'));
    // `capabilities` and `capabilitie` both contain the stripped stem, so one
    // assertion covers the unfixed spelling AND the `replace(/s$/, '')` fix.
    expect(metaRoutes(urls).filter((u) => u.includes('capabilitie'))).toEqual([]);
  });

  it('leaves an already-canonical type and a plugin-registered kind untouched', async () => {
    const urls = mockRoutesRecording([
      { type: 'view', name: 'ticket_list' },
      { type: 'my_plugin_kind', name: 'thing' },
    ]);
    renderPanel();
    await waitFor(() => expect(screen.getByText('ticket_list')).toBeInTheDocument());
    await waitFor(() => expect(metaRoutes(urls)).toContain('/api/v1/meta/view'));
    expect(metaRoutes(urls)).toContain('/api/v1/meta/my_plugin_kind');
  });

  it('groups and labels the drafts under the canonical singular type', async () => {
    mockRoutesRecording([{ type: 'objects', name: 'ticket' }]);
    renderPanel();
    await waitFor(() => expect(screen.getByText('ticket')).toBeInTheDocument());
    // This file's `t` stub returns the default uninterpolated. The heading
    // names its type through the `object` count family (objectui#13221); an
    // unfolded `objects` group would read the raw `{{n}} {{type}}` fallback.
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('{{count}} objects');
  });
});
