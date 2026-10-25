/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11807 — what the review sheet says about each pending draft.
 *
 * Two answers it got wrong, measured on the panel itself with mocked reads:
 *
 * - **A draft equal to its published version read *Update*.** The NEW / UPDATE
 *   mark comes from the published NAME list (`publishedNamesOf`), which says a
 *   published version exists, never that the draft differs from it. Even after
 *   the drill-in had loaded both bodies and printed "No differences detected",
 *   the row beside it still said *Update*.
 * - **Top-level keys were one undifferentiated list.** The drill-in split
 *   fields into added / changed / removed, then printed every other key as
 *   "Also changed: description, icon, label" — a key the draft adds, one it
 *   removes and one it edits, all in one breath.
 *
 * ## The no-change mark is decided where both bodies are already read
 *
 * Deciding it for every row at open costs two item reads per draft — the
 * O(drafts) fan-out the name-list read exists to avoid, and neither `_drafts`
 * nor the projected list read can stand in for the bodies. So the mark is set
 * by the drill-in's own comparison, read-decoration strip included, on expand.
 * The last block pins that cost: opening the sheet reads no item body of a
 * non-object draft, and expanding one reads exactly its two.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));

import { DraftChangesPanel, computeChangeDetail } from '../DraftChangesPanel';

const NO_CHANGE = 'No differences detected — the draft matches the published version.';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeChangeDetail splits top-level keys like fields (objectui#11807)', () => {
  it('names the key the draft adds, the one it edits and the one it removes', () => {
    const published = { name: 'visit', label: 'Visit', icon: 'map' };
    const draft = { name: 'visit', label: 'Customer Visit', description: 'On-site visit' };
    expect(computeChangeDetail(published, draft).keys).toEqual({
      added: ['description'],
      changed: ['label'],
      removed: ['icon'],
    });
  });

  it('reads an absent key and a null one as the same value, as before', () => {
    const d = computeChangeDetail({ name: 'visit', description: null }, { name: 'visit' });
    expect(d.keys).toEqual({ added: [], changed: [], removed: [] });
  });
});

/* ─────────────── the panel ─────────────── */

type Body = Record<string, unknown>;

interface Fixture {
  drafts: Array<{ type: string; name: string }>;
  /** Names the published list read returns, per type. */
  publishedNames: Record<string, string[]>;
  /** Published item bodies; absent = 404. */
  published: Record<string, Body>;
  /** Draft item bodies (the `item` of the draft envelope); absent = 404. */
  draft: Record<string, Body>;
}

function mockServer(fx: Fixture): string[] {
  const urls: string[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    const missing = { ok: false, status: 404, json: async () => ({}) };
    if (url.includes('/_drafts')) {
      return ok(fx.drafts.map((d) => ({ ...d, packageId: 'com.x' })));
    }
    const [type, name] = url.split('?')[0].replace('/api/v1/meta/', '').split('/');
    if (!name) return ok((fx.publishedNames[type] ?? []).map((n) => ({ name: n })));
    const key = `${type}/${name}`;
    if (url.includes('state=draft')) {
      return fx.draft[key] ? ok({ type, name, item: fx.draft[key] }) : missing;
    }
    return fx.published[key] ? ok(fx.published[key]) : missing;
  }) as unknown as typeof fetch;
  return urls;
}

function renderPanel() {
  return render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" onPublish={vi.fn()} />);
}

/** The row toggle whose name cell reads `name`. */
function row(name: string): HTMLElement {
  const hit = screen
    .getAllByTestId('draft-entry-toggle')
    .find((el) => el.querySelector('.font-mono')?.textContent === name);
  if (!hit) throw new Error(`no row for ${name}`);
  return hit;
}

const TICKET = { name: 'repairs_repair_ticket', label: 'Repair Ticket', fields: { title: { type: 'text' } } };

describe('a draft equal to its published version is not listed as Update (objectui#11807)', () => {
  const fixture: Fixture = {
    drafts: [
      { type: 'object', name: 'repairs_repair_ticket' },
      { type: 'object', name: 'visit' },
    ],
    publishedNames: { object: ['repairs_repair_ticket', 'visit'] },
    published: {
      'object/repairs_repair_ticket': { ...TICKET, _diagnostics: { valid: true, errors: [] } },
      'object/visit': { name: 'visit', label: 'Visit', fields: { title: { type: 'text' } } },
    },
    draft: {
      // The same authored body: only the framework's read decorations differ,
      // so this pair is equal exactly when the strip is applied.
      'object/repairs_repair_ticket': {
        ...TICKET,
        _draft: true,
        _diagnostics: { valid: false, errors: [{ path: 'label', message: 'x' }] },
      },
      'object/visit': { name: 'visit', label: 'Customer Visit', fields: { title: { type: 'text' } }, _draft: true },
    },
  };

  it('drops the Update mark once the drill-in finds nothing to publish, and keeps it on a real change', async () => {
    mockServer(fixture);
    renderPanel();
    await waitFor(() => expect(row('repairs_repair_ticket').textContent).toContain('Update'));
    expect(row('visit').textContent).toContain('Update');

    fireEvent.click(row('repairs_repair_ticket'));
    fireEvent.click(row('visit'));

    await waitFor(() => expect(row('repairs_repair_ticket').textContent).not.toContain('Update'));
    expect(within(row('repairs_repair_ticket')).getByRole('img', { name: NO_CHANGE })).toBeInTheDocument();
    expect(row('repairs_repair_ticket')).toHaveAttribute('title', NO_CHANGE);
    // CONTROL: the drafted change keeps its mark, and its drill-in did load.
    await waitFor(() => expect(screen.getByText('~ label')).toBeInTheDocument());
    expect(row('visit').textContent).toContain('Update');
    expect(row('visit')).not.toHaveAttribute('title');
    expect(within(row('visit')).queryByRole('img', { name: NO_CHANGE })).toBeNull();
  });

  it('never calls a NEW item unchanged, even when its draft carries nothing', async () => {
    mockServer({
      drafts: [{ type: 'object', name: 'fresh' }],
      publishedNames: { object: [] },
      published: {},
      draft: { 'object/fresh': {} },
    });
    renderPanel();
    await waitFor(() => expect(row('fresh').textContent).toContain('New'));
    fireEvent.click(row('fresh'));
    // The drill-in has nothing to list: no published body, an empty draft.
    await screen.findByText(NO_CHANGE);
    expect(row('fresh').textContent).toContain('New');
    expect(row('fresh')).not.toHaveAttribute('title');
  });

  it('never calls an entry unchanged when its draft read finds no draft', async () => {
    mockServer({
      drafts: [{ type: 'object', name: 'gone' }],
      publishedNames: { object: ['gone'] },
      published: {},
      draft: {},
    });
    renderPanel();
    await waitFor(() => expect(row('gone').textContent).toContain('Update'));
    fireEvent.click(row('gone'));
    await screen.findByText(NO_CHANGE);
    expect(row('gone').textContent).toContain('Update');
  });
});

describe('the drill-in lists top-level keys as added, changed and removed (objectui#11807)', () => {
  it('prints each key with the mark the field rows use', async () => {
    mockServer({
      drafts: [{ type: 'object', name: 'visit' }],
      publishedNames: { object: ['visit'] },
      published: { 'object/visit': { name: 'visit', label: 'Visit', icon: 'map', fields: { title: { type: 'text' } } } },
      draft: {
        'object/visit': {
          name: 'visit',
          label: 'Customer Visit',
          description: 'On-site visit',
          fields: { title: { type: 'text' }, status: { type: 'select' } },
        },
      },
    });
    renderPanel();
    await waitFor(() => expect(row('visit').textContent).toContain('Update'));
    fireEvent.click(row('visit'));
    const detail = await screen.findByTestId('draft-entry-detail');
    const lines = [...detail.querySelectorAll('p')].map((p) => p.textContent);
    expect(lines).toEqual(['+ status', 'Also changed:', '+ description', '~ label', '− icon']);
  });
});

describe('the no-change mark costs no read at open (objectui#11807)', () => {
  it('opening reads the feed and one list per type; expanding reads that entry’s two bodies', async () => {
    const views = ['a_list', 'b_list', 'c_list'];
    const urls = mockServer({
      drafts: views.map((name) => ({ type: 'view', name })),
      publishedNames: { view: views },
      published: Object.fromEntries(views.map((n) => [`view/${n}`, { name: n, label: n }])),
      draft: Object.fromEntries(views.map((n) => [`view/${n}`, { name: n, label: n }])),
    });
    renderPanel();
    await waitFor(() => expect(row('c_list').textContent).toContain('Update'));
    const itemReads = () => urls.filter((u) => /\/meta\/view\/[^/?]+/.test(u));
    expect(urls.filter((u) => u.includes('/_drafts'))).toHaveLength(1);
    expect(urls.filter((u) => /\/meta\/view(\?|$)/.test(u))).toHaveLength(1);
    expect(itemReads()).toEqual([]);

    fireEvent.click(row('b_list'));
    await waitFor(() => expect(row('b_list').textContent).not.toContain('Update'));
    expect(itemReads().sort()).toEqual([
      '/api/v1/meta/view/b_list?package=com.x',
      '/api/v1/meta/view/b_list?state=draft&package=com.x',
    ]);
    // The rows nobody opened keep the mark the name list gave them.
    expect(row('a_list').textContent).toContain('Update');
    expect(row('c_list').textContent).toContain('Update');
  });
});
