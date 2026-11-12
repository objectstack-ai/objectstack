// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#32755 — an update to a published view stored as a
 * `defineView` container reads *Update*, not *New*.
 *
 * Measured in Studio › Publish on a hosted tenant: after an MCP client drafted
 * a `form` change to the already-published view `ebqu_claim.default`, the
 * sheet listed it as *New* ("publishing adds this item"), while the sibling
 * view `ebqu_claim.by_status` read *Update* with its changed keys.
 *
 * The cause is the classification read. `GET /meta/view` enumerates the views
 * a stored container expands to (`ebqu_claim.form` here) and never the
 * container itself, so the container's own name is absent from the list. The
 * by-name door serves the container row, so an unlisted view draft asks it.
 *
 * Pinned, against a mocked server shaped as that read answered:
 *  - the container view's draft reads *Update*, and its drill-in lists the
 *    changed `form` key;
 *  - CONTROL: a view draft that was never published still reads *New*;
 *  - a listed view costs no by-name read at open;
 *  - CONTROL: a by-name read that fails leaves its entry unclassified.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
    language: 'en',
  }),
}));

import { DraftChangesPanel } from '../DraftChangesPanel';

type Body = Record<string, unknown>;

const form = (span?: string) => ({
  type: 'simple',
  sections: [{ name: 's1', fields: [{ field: 'name', ...(span ? { span } : {}) }, { field: 'amount' }] }],
});

const CONTAINER = 'ebqu_claim.default';
const LISTED = 'ebqu_claim.by_status';
const FRESH = 'ebqu_claim.fresh';

/** Bodies keyed by view name; absent = 404, `'fail'` = 500. */
const published: Record<string, Body | 'fail'> = {
  [CONTAINER]: { name: CONTAINER, object: 'ebqu_claim', form: form() },
  [LISTED]: { name: LISTED, object: 'ebqu_claim', type: 'grid', columns: ['name'] },
};
const draft: Record<string, Body> = {
  [CONTAINER]: { name: CONTAINER, object: 'ebqu_claim', form: form('full') },
  [LISTED]: { name: LISTED, object: 'ebqu_claim', type: 'grid', columns: ['name', 'amount'] },
  [FRESH]: { name: FRESH, object: 'ebqu_claim', form: form() },
};

const requests: string[] = [];

function mockServer(byName: Record<string, Body | 'fail'> = published) {
  requests.length = 0;
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/_drafts')) {
      return ok([CONTAINER, LISTED, FRESH].map((name) => ({ type: 'view', name, packageId: 'com.x' })));
    }
    const name = url.match(/\/meta\/view\/([^?]+)/)?.[1];
    // The list read: the container's EXPANSION and the flat view, never the
    // container's own name.
    if (!name) return ok([{ name: 'ebqu_claim.form' }, { name: LISTED }]);
    const decoded = decodeURIComponent(name);
    if (url.includes('state=draft')) {
      return draft[decoded] ? ok({ type: 'view', name: decoded, item: draft[decoded] }) : { ok: false, status: 404, json: async () => ({}) };
    }
    const body = byName[decoded];
    if (body === 'fail') return { ok: false, status: 500, json: async () => ({}) };
    return body ? ok(body) : { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel() {
  return render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" onPublish={vi.fn()} />);
}

/** The row toggle whose name cell reads `name`. */
function row(name: string): HTMLElement {
  const hit = screen
    .getAllByTestId('draft-entry-toggle')
    .find((el) => [...el.querySelectorAll('.font-mono')].some((n) => n.textContent === name));
  if (!hit) throw new Error(`no row for ${name}`);
  return hit;
}

const byNamePublishedReads = (name: string) =>
  requests.filter((u) => u.includes(`/meta/view/${encodeURIComponent(name)}`) && !u.includes('state=draft'));

describe('a published view stored as a container reads Update (objectstack#32755)', () => {
  it('classifies the container view as Update and lists its changed form key', async () => {
    mockServer();
    renderPanel();

    await waitFor(() => expect(row(CONTAINER).textContent).toContain('Update'));
    expect(row(CONTAINER).textContent).not.toContain('New');
    expect(row(LISTED).textContent).toContain('Update');

    fireEvent.click(row(CONTAINER));
    const detail = await screen.findByTestId('draft-entry-detail');
    await waitFor(() => expect(detail.querySelectorAll('[data-testid="draft-key-row"]').length).toBeGreaterThan(0));
    const keyLines = [...detail.querySelectorAll('[data-testid="draft-key-row"] p')].map((p) => p.textContent ?? '');
    expect(keyLines).toHaveLength(1);
    expect(keyLines[0].startsWith('~')).toBe(true);
    expect(keyLines[0]).toMatch(/form/i);
  });

  it('CONTROL: a view draft that was never published still reads New', async () => {
    mockServer();
    renderPanel();

    await waitFor(() => expect(row(FRESH).textContent).toContain('New'));
    expect(row(FRESH).textContent).not.toContain('Update');
  });

  it('asks the by-name door only for the views the list did not name', async () => {
    mockServer();
    renderPanel();

    await waitFor(() => expect(row(FRESH).textContent).toContain('New'));
    expect(byNamePublishedReads(CONTAINER)).toEqual([`/api/v1/meta/view/${encodeURIComponent(CONTAINER)}?package=com.x`]);
    expect(byNamePublishedReads(FRESH)).toEqual([`/api/v1/meta/view/${encodeURIComponent(FRESH)}?package=com.x`]);
    expect(byNamePublishedReads(LISTED)).toEqual([]);
  });

  it('CONTROL: a by-name read that fails leaves its entry unclassified', async () => {
    mockServer({ ...published, [CONTAINER]: 'fail' });
    renderPanel();

    await waitFor(() => expect(row(FRESH).textContent).toContain('New'));
    expect(row(LISTED).textContent).toContain('Update');
    expect(row(CONTAINER).textContent).not.toContain('New');
    expect(row(CONTAINER).textContent).not.toContain('Update');
  });
});
