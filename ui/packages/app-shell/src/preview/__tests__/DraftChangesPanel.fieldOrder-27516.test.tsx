/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27516 — the review sheet reads an order-only field change as a
 * change.
 *
 * The publish door hashes an `object`'s `fields` in their declared order
 * (`canonicalize(body, 'object')`, `@objectstack/metadata-core`), so a draft
 * that only reorders its fields publishes a new version. The drill-in compared
 * fields by name only and read "No differences detected" for it. It now lists
 * a "Field order changed" row.
 *
 * The order compared is the order the door stores: the columns the `/meta`
 * reads inject ahead of the declared fields, and the write strips again, have
 * no place of the author's, so they are left out on both sides.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AUDIT_FIELD_DEFS, OWNER_FIELD_DEF } from '@objectstack/spec/data';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));

import { DraftChangesPanel, computeChangeDetail } from '../DraftChangesPanel';

const NO_CHANGE = 'No differences detected — the draft matches the published version.';
const ORDER_ROW = '~ Field order changed';

const condition = { type: 'select', label: 'Condition' };
const notes = { type: 'textarea', label: 'Notes' };
const title = { type: 'text', label: 'Title' };
const search = { type: 'text', system: true, hidden: true };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeChangeDetail compares the order of an object’s fields (objectstack#27516)', () => {
  it('reports a pure reorder of two authored fields, and nothing else', () => {
    const d = computeChangeDetail(
      { name: 'asset', fields: { title, condition, notes } },
      { name: 'asset', fields: { title, notes, condition } },
      'object',
    );
    expect(d.fields).toMatchObject({ added: [], changed: [], removed: [], reordered: true });
    expect(d.keys).toEqual({ added: [], changed: [], removed: [] });
  });

  it('reads the array shape of `fields` in its order too', () => {
    const d = computeChangeDetail(
      { name: 'asset', fields: [{ name: 'title', ...title }, { name: 'condition', ...condition }] },
      { name: 'asset', fields: [{ name: 'condition', ...condition }, { name: 'title', ...title }] },
      'object',
    );
    expect(d.fields?.reordered).toBe(true);
  });

  it('CONTROL: the same order is no reorder', () => {
    const d = computeChangeDetail(
      { name: 'asset', fields: { title, condition } },
      { name: 'asset', fields: { title, condition } },
      'object',
    );
    expect(d.fields?.reordered).toBe(false);
  });

  it('leaves out the columns the reads inject: their place is the platform’s', () => {
    // The registry-backed published read and the overlay-backed draft read put
    // the platform's columns in different places; the declared order is equal.
    const d = computeChangeDetail(
      {
        name: 'asset',
        fields: { created_at: AUDIT_FIELD_DEFS.created_at, owner_id: OWNER_FIELD_DEF, title, __search: search, condition },
      },
      {
        name: 'asset',
        fields: { owner_id: OWNER_FIELD_DEF, title, condition, created_at: AUDIT_FIELD_DEFS.created_at, __search: search },
      },
      'object',
    );
    expect(d.fields?.reordered).toBe(false);
  });

  it('counts an `owner_id` the author declared: its place is theirs', () => {
    const owner = { ...OWNER_FIELD_DEF, label: 'Account manager' };
    const d = computeChangeDetail(
      { name: 'asset', fields: { owner_id: owner, title } },
      { name: 'asset', fields: { title, owner_id: owner } },
      'object',
    );
    expect(d.fields?.reordered).toBe(true);
  });

  it('compares only the fields both versions declare: an added or removed field is its own row', () => {
    const d = computeChangeDetail(
      { name: 'asset', fields: { title, notes, condition } },
      { name: 'asset', fields: { serial: { type: 'text' }, title, condition } },
      'object',
    );
    expect(d.fields).toMatchObject({ added: ['serial'], removed: ['notes'], reordered: false });
  });

  it('is the publish door’s rule for an `object` only', () => {
    const d = computeChangeDetail(
      { name: 'asset', fields: { title, condition } },
      { name: 'asset', fields: { condition, title } },
      'view',
    );
    expect(d.fields?.reordered).toBe(false);
  });
});

/* ─────────────── the panel ─────────────── */

type Body = Record<string, unknown>;

function mockServer(published: Body, draft: Body): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/_drafts')) return ok([{ type: 'object', name: 'asset', packageId: 'com.x' }]);
    const [type, name] = url.split('?')[0].replace('/api/v1/meta/', '').split('/');
    if (!name) return ok([{ name: 'asset' }]);
    return url.includes('state=draft') ? ok({ type, name, item: draft }) : ok(published);
  }) as unknown as typeof fetch;
}

function assetRow(): HTMLElement {
  const hit = screen
    .getAllByTestId('draft-entry-toggle')
    .find((el) => el.querySelector('.font-mono')?.textContent === 'asset');
  if (!hit) throw new Error('no row for asset');
  return hit;
}

describe('the drill-in lists an order-only change (objectstack#27516)', () => {
  it('prints a Field order changed row and keeps the Update mark', async () => {
    mockServer(
      { name: 'asset', fields: { owner_id: OWNER_FIELD_DEF, title, condition, notes } },
      { name: 'asset', fields: { owner_id: OWNER_FIELD_DEF, title, notes, condition }, _draft: true },
    );
    render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" onPublish={vi.fn()} />);
    await waitFor(() => expect(assetRow().textContent).toContain('Update'));
    fireEvent.click(assetRow());
    const detail = await screen.findByTestId('draft-entry-detail');
    expect([...detail.querySelectorAll('p')].map((p) => p.textContent)).toEqual([ORDER_ROW]);
    expect(screen.queryByText(NO_CHANGE)).toBeNull();
    expect(assetRow().textContent).toContain('Update');
  });

  it('CONTROL: the same order still reads No differences detected', async () => {
    mockServer(
      { name: 'asset', fields: { owner_id: OWNER_FIELD_DEF, title, condition } },
      { name: 'asset', fields: { title, owner_id: OWNER_FIELD_DEF, condition }, _draft: true },
    );
    render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" onPublish={vi.fn()} />);
    await waitFor(() => expect(assetRow().textContent).toContain('Update'));
    fireEvent.click(assetRow());
    await screen.findByText(NO_CHANGE);
    expect(screen.queryByText(ORDER_ROW)).toBeNull();
  });
});
