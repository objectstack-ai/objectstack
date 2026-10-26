// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13160 — a refused package publish shows the reasons the server
 * returned, under the count sentence.
 *
 * ## The defect
 *
 * `POST /packages/:id/publish` answers a refusal on a 200: the dispatcher's
 * `{ success: true, data }` envelope around the door's `PackagePublishResult`,
 * whose own `success` is false and whose `validationErrors` carry one
 * `message` per reason, each against the item (`type`, `name`) it judged. The
 * sheet's `publish` threw only the count sentence, so the author read "Publish
 * blocked by 1 validation error(s)." and never the reason (measured on a
 * package with no items: the server said "No metadata items found for
 * package …", the sheet did not).
 *
 * ## Real vs stubbed
 *
 * Real: the sheet and its `apiJson`, which unwraps the envelope. Stubbed:
 * `globalThis.fetch` (the server).
 *
 * The count sentence is read from the string table through the same `tFormat`
 * the sheet calls. The reasons are the fixture's own strings: what is pinned is
 * that the server's words reach the sheet, one line each, never prose of ours.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const PUBLISH_URL = `/api/v1/packages/${PKG_ID}/publish`;

/** What the stubbed publish door does: answer with a body, or fail the request. */
let publishAnswer: { body: unknown } | { reject: Error };
const posts: Array<{ url: string; method: string | undefined }> = [];

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** The door's `PackagePublishResult`, inside the dispatcher's envelope (`true` on every 200). */
function answer(result: Record<string, unknown>) {
  return {
    body: {
      success: true,
      data: { packageId: PKG_ID, version: 0, publishedAt: '2026-10-20T00:00:00.000Z', itemsPublished: 0, ...result },
    },
  };
}

beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === PUBLISH_URL) {
        posts.push({ url, method: init?.method });
        if ('reject' in publishAnswer) throw publishAnswer.reject;
        return json(publishAnswer.body);
      }
      if (url.startsWith('/api/v1/meta/_drafts')) return json({ success: true, data: { drafts: [] } });
      return json({ success: true, data: {} });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Press *Publish* and return the message block the sheet settles on, found by
 * its sentence (the block's own text), with the lines listed under it.
 */
async function publishAndRead(sentence: string): Promise<{ block: HTMLElement; lines: string[] }> {
  render(
    <MemoryRouter>
      <PackageDetailSheet pkg={PKG} open onOpenChange={vi.fn()} onChanged={vi.fn()} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: t('engine.packages.detail.publish', 'en') }));
  await waitFor(() => expect(posts).toEqual([{ url: PUBLISH_URL, method: 'POST' }]));
  const block = await screen.findByText(sentence);
  const lines = within(block)
    .queryAllByRole('listitem')
    .map((li) => li.textContent ?? '');
  return { block, lines };
}

describe('a refused package publish shows the server’s reasons under the count (objectui#13160)', () => {
  it('one reason that names no item: the measured refusal of a package with no items', async () => {
    const reason = `No metadata items found for package '${PKG_ID}'`;
    publishAnswer = answer({ success: false, validationErrors: [{ type: '', name: '', message: reason }] });
    const { lines } = await publishAndRead(tFormat('engine.packages.detail.publishBlocked', 'en', { count: 1 }));
    expect(lines).toEqual([reason]);
  });

  it('two reasons: each is a line, led by the item it names, in the order the server sent them', async () => {
    const schema = "Field 'status' references unknown picklist 'lead_status'";
    const namespace = 'The package declares no namespace to publish endpoints under';
    publishAnswer = answer({
      success: false,
      validationErrors: [
        { type: 'object', name: 'lead', message: schema },
        { type: 'api', name: '', message: namespace },
      ],
    });
    const { lines } = await publishAndRead(tFormat('engine.packages.detail.publishBlocked', 'en', { count: 2 }));
    expect(lines).toEqual([`object/lead: ${schema}`, `api: ${namespace}`]);
  });
});

describe('controls: the answers that are not a refusal with reasons read as before (objectui#13160)', () => {
  it('a published package keeps the success row, with no lines', async () => {
    publishAnswer = answer({ success: true, version: 2, itemsPublished: 3 });
    const { block, lines } = await publishAndRead(t('engine.packages.detail.published', 'en'));
    expect(block.textContent).toBe(t('engine.packages.detail.published', 'en'));
    expect(lines).toEqual([]);
  });

  it('a refusal with an empty validationErrors still says there is nothing to publish, with no lines', async () => {
    publishAnswer = answer({ success: false, validationErrors: [] });
    const { block, lines } = await publishAndRead(t('engine.packages.detail.nothingToPublish', 'en'));
    expect(block.textContent).toBe(t('engine.packages.detail.nothingToPublish', 'en'));
    expect(lines).toEqual([]);
  });

  it('a request that throws still shows its own message, with no lines', async () => {
    publishAnswer = { reject: new TypeError('Failed to fetch') };
    const { block, lines } = await publishAndRead('Failed to fetch');
    expect(block.textContent).toBe('Failed to fetch');
    expect(lines).toEqual([]);
  });
});
