// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11922 — a refused publish on the package sheet names each refused
 * item with the server's reason.
 *
 * ## The defect
 *
 * `POST /packages/:id/publish-drafts` answers a refusal on a 200: the batch's
 * own `success` is false AND `failed[]` carries every item that did not publish
 * with its `error` (`PublishPackageDraftsResponseSchema`: `outcome` is
 * `refused` if and only if `failed` is non-empty). `publishDrafts` asked
 * `success === false` first and threw through the envelope ladder, whose last
 * rung is "Action failed" — the batch carries no `error` key — so the author
 * never read which item was refused, or why. The `failed[]` reading below it
 * was unreachable on every refusal the producer sends.
 *
 * ## Real vs stubbed
 *
 * Real: the sheet, `useMetadataClient` and the client it builds, which unwraps
 * the route's `{ success, data }` envelope, so the batch is read through the
 * composition the console reads it through. Stubbed: `globalThis.fetch` (the
 * server).
 *
 * The rows are read from the string table through the same `tFormat` the sheet
 * calls, so what is pinned is which row, which item and which reason, never the
 * prose around them.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { PackageDetailSheet, type InstalledPackageRow } from './PackagesPage';
import { t, tFormat } from './i18n';

const PKG_ID = 'com.acme.crm';
const PKG: InstalledPackageRow = {
  manifest: { id: PKG_ID, name: 'Acme CRM', version: '1.0.0', type: 'app' },
  enabled: true,
  status: 'installed',
  source: 'authored',
  writable: true,
};
const DRAFTS = [
  { type: 'object', name: 'lead' },
  { type: 'view', name: 'lead_list' },
];

/**
 * A batch answer as the producer sends it: the protocol's result, carrying its
 * own `success` (`=== (outcome === 'published')`, pinned upstream), inside the
 * dispatcher's `{ success: true, data }` envelope — `true` on every 200, the
 * refusals included.
 */
function batch(data: Record<string, unknown>) {
  return { success: true, data: { success: data.outcome === 'published', ...data } };
}

let batchBody: unknown;
const posts: string[] = [];

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/publish-drafts')) {
        posts.push(url);
        return json(batchBody);
      }
      if (url.startsWith('/api/v1/meta/_drafts')) return json({ success: true, data: { drafts: DRAFTS } });
      return json({ success: true, data: {} });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Press *Publish app* and return the line the sheet settles on. */
async function publishAndRead(matches: (text: string) => boolean): Promise<string> {
  render(
    <MemoryRouter>
      <PackageDetailSheet pkg={PKG} open onOpenChange={vi.fn()} onChanged={vi.fn()} />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole('button', {
      name: tFormat('engine.packages.detail.publishApp', 'en', { count: DRAFTS.length }),
    }),
  );
  await waitFor(() => expect(posts).toHaveLength(1));
  // The message line is a leaf: its whole text is the sheet's `msg.text`.
  const leaf = (_: string, node: Element | null) =>
    !!node && node.childElementCount === 0 && matches(node.textContent ?? '');
  // A refusal of more than one sentence leads with its first and keeps the
  // whole line behind "More" (objectui#13332): open it, then read the line.
  await waitFor(() =>
    expect(!!screen.queryByTestId('refusal-more') || screen.queryAllByText(leaf).length > 0).toBe(true),
  );
  const more = screen.queryByTestId('refusal-more');
  if (more) {
    fireEvent.click(more);
    return screen.getByTestId('refusal-detail').textContent ?? '';
  }
  const line = await screen.findByText(leaf);
  return line.textContent ?? '';
}

describe('the package sheet names what a refused publish refused (objectui#11922)', () => {
  it('a pre-flight refusal names every refused item with the server’s reason', async () => {
    const prefix = "Object name 'lead' must start with the package namespace 'acme_'";
    const stored = "Draft 'views/lead_list' is stored under the non-canonical metadata type 'views'";
    batchBody = batch({
      outcome: 'refused',
      publishedCount: 0,
      failedCount: 2,
      published: [],
      failed: [
        { type: 'object', name: 'lead', error: prefix, code: 'NAMESPACE_PREFIX' },
        { type: 'views', name: 'lead_list', error: stored, code: 'STORED_TYPE_NOT_CANONICAL' },
      ],
    });
    const row = tFormat('engine.packages.detail.publishDraftsPartial', 'en', { published: 0, failed: 2 });
    const shown = await publishAndRead((text) => text.startsWith(row));
    expect(shown).toContain(`object/lead: ${prefix}`);
    expect(shown).toContain(`views/lead_list: ${stored}`);
    expect(shown).not.toContain(t('engine.packages.detail.actionFailed', 'en'));
  });

  it('a rolled-back batch names its causal item with its reason, and not the siblings it took down', async () => {
    const reason = 'sharingModel is not set';
    batchBody = batch({
      outcome: 'refused',
      publishedCount: 0,
      failedCount: 2,
      published: [],
      failed: [
        { type: 'object', name: 'lead', error: reason, code: 'SECURITY_OWD_UNSET' },
        {
          type: 'view',
          name: 'lead_list',
          error: 'not published — the batch is all-or-nothing (ADR-0067 D2) and object/lead failed; the transaction rolled back',
          code: 'BATCH_ABORTED',
        },
      ],
    });
    const shown = await publishAndRead((text) =>
      text.startsWith(tFormat('engine.packages.detail.publishDraftsRolledBack', 'en', { cause: '' })),
    );
    expect(shown).toBe(
      tFormat('engine.packages.detail.publishDraftsRolledBack', 'en', { cause: `object/lead: ${reason}` }),
    );
    expect(shown).not.toContain('view/lead_list');
  });
});

describe('controls: the answers that are not a refusal read as before (objectui#11922)', () => {
  it('a published batch keeps the success row', async () => {
    batchBody = batch({
      outcome: 'published',
      publishedCount: 2,
      failedCount: 0,
      published: DRAFTS.map((d, i) => ({ ...d, version: `sha256:${i}` })),
      failed: [],
    });
    const ok = t('engine.packages.detail.publishDraftsOk', 'en');
    expect(await publishAndRead((text) => text === ok)).toBe(ok);
  });

  it('a batch whose envelope carries an error and an empty failed[] still shows the envelope’s text', async () => {
    const message = 'Publishing is temporarily unavailable. Nothing was changed.';
    batchBody = batch({
      outcome: 'nothing_to_publish',
      publishedCount: 0,
      failedCount: 0,
      published: [],
      failed: [],
      error: { code: 'SERVICE_UNAVAILABLE', message },
    });
    expect(await publishAndRead((text) => text.startsWith(message))).toBe(`${message} (SERVICE_UNAVAILABLE)`);
  });
});
