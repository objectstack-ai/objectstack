// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The publish-review drill-in lists what the AUTHOR wrote, never the ADR-0010
 * protection envelope (objectui#12594).
 *
 * ## The defect
 *
 * A served item carries the envelope the spec declares in
 * `MetadataProtectionFields`: the registry's stamps (`_packageId`,
 * `_packageVersion`, `_provenance`) and the loader's lock family (`_lock`,
 * `_lockReason`, `_lockSource`, `_lockDocsUrl`). `METADATA_READ_DECORATIONS`
 * leaves them on the body on purpose, so they reached the diff. On a NEW item
 * there is no published body, every key the draft carries reads as added, and
 * the sheet listed `_packageId` under "Also changed:" beside the author's own
 * keys.
 *
 * ## The fixtures are derived, not listed
 *
 * The draft carries EVERY key `Object.keys(MetadataProtectionFields)` names, so
 * a key the spec adds to the envelope later is covered here without an edit,
 * and a local copy of the list cannot drift from the one the panel reads.
 *
 * ## The controls
 *
 * - `label` is an ordinary authored key: it MUST still list, which proves the
 *   diff ran and the strip took only the envelope.
 * - `_unpublished` is a key `AppSchema` declares OUTSIDE the envelope that
 *   starts with an underscore. It MUST still list, which proves the strip is
 *   the spec's envelope and not an underscore-prefix filter.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MetadataProtectionFields } from '@objectstack/spec/kernel';

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

const ENVELOPE_KEYS = Object.keys(MetadataProtectionFields);

/** A value for every envelope key, as a package-owned served draft wears them. */
const ENVELOPE: Record<string, unknown> = Object.fromEntries(
  ENVELOPE_KEYS.map((key) => [key, key === '_lock' ? 'full' : `${key}-value`]),
);

type Body = Record<string, unknown>;

/**
 * Routes for one entry. `published: null` makes it NEW: the published list
 * does not name it and the by-name published read 404s.
 */
function mockRoutes(type: string, name: string, draft: Body, published: Body | null) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    const notFound = { ok: false, status: 404, json: async () => ({}) };
    if (url.includes('/_drafts')) return ok([{ type, name, packageId: 'com.test.crmext' }]);
    if (url.includes('state=draft')) return ok({ type, name, item: { ...draft, _draft: true } });
    if (url.includes(`/meta/${type}/${name}`)) return published ? ok({ type, name, item: published }) : notFound;
    if (new RegExp(`/meta/${type}(\\?|$)`).test(url)) return ok(published ? [{ name }] : []);
    return notFound;
  }) as unknown as typeof fetch;
}

async function openEntryDetail() {
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.test.crmext" onPublish={vi.fn()} />);
  fireEvent.click(await screen.findByTestId('draft-entry-toggle'));
}

/** The text of every key row the drill-in rendered, `+ name` / `~ name` / `− name`. */
function renderedRows(): string[] {
  return [...screen.getByTestId('draft-entry-detail').querySelectorAll('p.font-mono')].map((p) =>
    (p.textContent ?? '').trim(),
  );
}

describe('DraftChangesPanel — the protection envelope never lists as authored (objectui#12594)', () => {
  it('reads a non-empty envelope off the spec', () => {
    // Guards every assertion below: an empty key list would make them vacuous.
    expect(ENVELOPE_KEYS).toContain('_packageId');
    expect(ENVELOPE_KEYS).toContain('_lock');
  });

  it("lists no envelope key on a NEW object's drill-in, and still lists the authored keys", async () => {
    mockRoutes(
      'object',
      'crmext_visit',
      { name: 'crmext_visit', label: 'Visit', fields: { subject: { type: 'text' } }, ...ENVELOPE },
      null,
    );
    await openEntryDetail();

    // CONTROL: the authored key and the field are listed, so the diff ran.
    await waitFor(() => expect(renderedRows()).toContain('+ label'));
    expect(renderedRows()).toContain('+ subject');

    const text = screen.getByTestId('draft-entry-detail').textContent ?? '';
    for (const key of ENVELOPE_KEYS) expect(text).not.toContain(key);
  });

  it('still lists a declared underscore key that is not in the envelope', async () => {
    // `_unpublished` is declared by `AppSchema`, beside the envelope it spreads.
    expect(ENVELOPE_KEYS).not.toContain('_unpublished');
    mockRoutes('app', 'crmext_app', { name: 'crmext_app', label: 'CRM', _unpublished: true, ...ENVELOPE }, null);
    await openEntryDetail();

    await waitFor(() => expect(renderedRows()).toContain('+ _unpublished'));
    expect(renderedRows()).toContain('+ label');
    const text = screen.getByTestId('draft-entry-detail').textContent ?? '';
    for (const key of ENVELOPE_KEYS) expect(text).not.toContain(key);
  });

  it('reads an UPDATE whose bodies differ only in the envelope as unchanged', async () => {
    const authored = { name: 'crmext_visit', label: 'Visit', fields: { subject: { type: 'text' } } };
    mockRoutes(
      'object',
      'crmext_visit',
      { ...authored, ...ENVELOPE },
      { ...authored, _lock: 'none', _packageId: 'com.test.other', _provenance: 'org' },
    );
    await openEntryDetail();

    await waitFor(() => expect(screen.getByText(/No differences detected/)).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(screen.queryByTestId('draft-entry-detail')).not.toBeInTheDocument();
  });

  it('leaves the envelope out of every list computeChangeDetail returns', () => {
    const detail = computeChangeDetail(null, { label: 'Visit', fields: { subject: { type: 'text' } }, ...ENVELOPE });
    expect(detail.keys).toEqual({ added: ['label'], changed: [], removed: [] });
    expect(detail.fields?.added).toEqual(['subject']);

    // The REMOVED direction too: a published body with the envelope against a
    // draft without one lists nothing.
    expect(computeChangeDetail({ label: 'Visit', ...ENVELOPE }, { label: 'Visit' }).keys).toEqual({
      added: [],
      changed: [],
      removed: [],
    });
  });
});
