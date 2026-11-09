// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The publish-review sheet lists no `Options` change on a picklist-bound field
 * nobody edited (objectstack#29899).
 *
 * ## The defect
 *
 * A select field may name a package picklist instead of carrying its own
 * options (`{ type: 'select', picklist: 'NAME' }`). The draft row stores it so,
 * without `options`: the authoring door refuses the two keys together. The
 * live (published) read serves the same field with the options the runtime
 * resolved from the picklist written onto it (`PicklistServedFieldSchema`).
 * The sheet diffed the two as read, so on every publish of such an object it
 * listed `~ Tier tier · Options` beside the author's real edit.
 *
 * The routes below serve exactly that pair: the published read carries the
 * resolved options on `tier`, the strict draft read does not.
 *
 * ## The controls
 *
 * - A field with INLINE `options` whose options really changed still lists
 *   `Options`: the fix compares the stored form, it does not skip the key.
 * - A field moving between a picklist and inline options still lists both
 *   keys, in either direction.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/i18n')>();
  return {
    ...mod,
    useObjectTranslation: () => ({
      t: (_k: string, o?: { defaultValue?: string; count?: number }) =>
        (o?.defaultValue ?? _k).replace('{{count}}', String(o?.count ?? '')),
    }),
  };
});

import { DraftChangesPanel, computeChangeDetail } from '../DraftChangesPanel';

afterEach(() => {
  vi.restoreAllMocks();
});

type Body = Record<string, unknown>;

const TIER_OPTIONS = [
  { label: 'Bronze', value: 'bronze' },
  { label: 'Silver', value: 'silver' },
  { label: 'Gold', value: 'gold' },
];

/** `tier` as the draft row stores it: bound to the picklist, no `options`. */
const STORED_TIER = { type: 'select', label: 'Tier', picklist: 'showcase_tier' };
/** `tier` as the live read serves it: the picklist's options resolved onto it. */
const SERVED_TIER = { ...STORED_TIER, options: TIER_OPTIONS };

function mockRoutes(type: string, name: string, draft: Body, published: Body) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    const notFound = { ok: false, status: 404, json: async () => ({}) };
    if (url.includes('/_drafts')) return ok([{ type, name, packageId: 'com.test.showcase' }]);
    if (url.includes('state=draft')) return ok({ type, name, item: { ...draft, _draft: true } });
    if (url.includes(`/meta/${type}/${name}`)) return ok({ type, name, item: published });
    if (new RegExp(`/meta/${type}(\\?|$)`).test(url)) return ok([{ name }]);
    return notFound;
  }) as unknown as typeof fetch;
}

async function openEntryDetail() {
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.test.showcase" onPublish={vi.fn()} />);
  fireEvent.click(await screen.findByTestId('draft-entry-toggle'));
}

/** The text of every field and key row the drill-in rendered. */
function renderedRows(): string[] {
  return [
    ...screen
      .getByTestId('draft-entry-detail')
      .querySelectorAll('[data-testid="draft-field-row"], [data-testid="draft-key-row"]'),
  ].map((row) => (row.textContent ?? '').trim());
}

describe('DraftChangesPanel — a picklist-bound field compares in its stored form (objectstack#29899)', () => {
  it('lists only the label change when the draft edits another field of an object with a bound field', async () => {
    mockRoutes(
      'object',
      'showcase_member',
      {
        name: 'showcase_member',
        label: 'Member',
        fields: { tier: STORED_TIER, notes: { type: 'textarea', label: 'Again notes' } },
      },
      {
        name: 'showcase_member',
        label: 'Member',
        fields: { tier: SERVED_TIER, notes: { type: 'textarea', label: 'Notes' } },
      },
    );
    await openEntryDetail();

    await waitFor(() => expect(renderedRows().length).toBeGreaterThan(0), { timeout: 4000 });
    const rows = renderedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^~ Again notes notes/);
    expect(rows[0]).toContain('Label');
    expect(screen.getByTestId('draft-entry-detail').textContent).not.toContain('Options');
  });

  it('CONTROL: still lists an Options change on a field with inline options', async () => {
    mockRoutes(
      'object',
      'showcase_member',
      {
        name: 'showcase_member',
        label: 'Member',
        fields: {
          tier: STORED_TIER,
          status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }] },
        },
      },
      {
        name: 'showcase_member',
        label: 'Member',
        fields: {
          tier: SERVED_TIER,
          status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] },
        },
      },
    );
    await openEntryDetail();

    await waitFor(() => expect(renderedRows().length).toBeGreaterThan(0), { timeout: 4000 });
    const rows = renderedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^~ Status status/);
    expect(rows[0]).toContain('Options');
  });

  it('reads a bound field as unchanged in computeChangeDetail, and keeps a move to or from inline options', () => {
    const pub = { name: 'm', fields: { tier: SERVED_TIER } };
    expect(computeChangeDetail(pub, { name: 'm', fields: { tier: STORED_TIER } }, 'object').fields?.changed).toEqual([]);

    // Bound → inline: the field's `picklist` leaves and its `options` arrive.
    const inline = { type: 'select', label: 'Tier', options: TIER_OPTIONS };
    expect(computeChangeDetail(pub, { name: 'm', fields: { tier: inline } }, 'object').fields?.changed).toEqual([
      { name: 'tier', keys: expect.arrayContaining(['picklist', 'options']) },
    ]);
    // Inline → bound, read back as the runtime serves it.
    expect(
      computeChangeDetail({ name: 'm', fields: { tier: inline } }, { name: 'm', fields: { tier: STORED_TIER } }, 'object')
        .fields?.changed,
    ).toEqual([{ name: 'tier', keys: expect.arrayContaining(['picklist', 'options']) }]);

    // The array `fields` shape a body can arrive in reads the same.
    expect(
      computeChangeDetail(
        { name: 'm', fields: [{ name: 'tier', ...SERVED_TIER }] },
        { name: 'm', fields: [{ name: 'tier', ...STORED_TIER }] },
        'object',
      ).fields?.changed,
    ).toEqual([]);
  });
});
