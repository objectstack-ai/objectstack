// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11692 — the package OWD overview saves an object whose fields name a
 * shared picklist.
 *
 * The panel seeds each changed row's PUT from a SERVED object read — the
 * pending draft when there is one, else `layered.effective` — and a
 * picklist-bound field is served with `picklist` AND the options the runtime
 * resolved from the list. The authoring door refuses the two keys together for
 * the whole object (`422 INVALID_METADATA` at `fields.FIELD.options`), so an OWD
 * edit that never touched a field was refused for one. Measured live on the
 * card: Studio → Access → OWD overview, change one object's sharing model, Save.
 *
 * The client is a real `MetadataClient`; its reads are served by doubles and
 * its transport refuses a body the way the authoring door does, so the claim
 * is read off the WIRE: the door accepted the body, the bound field went out
 * without `options`, and every other field went out byte-identical.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MetadataClient } from '@object-ui/data-objectstack';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { t } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';

/** Pick a dial's option by its label, through the trigger, as a user does; the dials are the shared Select (objectui#11865). */
async function pickOwd(testId: string, label: string): Promise<void> {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: label }));
}

type Row = Record<string, unknown>;

const PKG = 'com.example.acme';

/** The object as the runtime SERVES it: one bound field, one inline select, one text field. */
function served(extra: Row = {}): Row {
  return {
    name: 'acme_account',
    label: 'Account',
    sharingModel: 'private',
    ...extra,
    fields: {
      tier: {
        type: 'select',
        label: 'Tier',
        picklist: 'acme_tier',
        options: [
          { label: 'Gold', value: 'gold' },
          { label: 'Platinum', value: 'platinum' },
        ],
      },
      status: {
        type: 'select',
        label: 'Status',
        options: [
          { label: 'Open', value: 'open' },
          { label: 'Closed', value: 'closed' },
        ],
      },
      title: { type: 'text', label: 'Title' },
    },
  };
}

const SERVED_STATUS = JSON.stringify((served().fields as Record<string, Row>).status);
const SERVED_TITLE = JSON.stringify((served().fields as Record<string, Row>).title);

/** The authoring door's refusal for a field carrying both keys. */
function doorRefusal(body: Row): string[] {
  return Object.entries((body.fields ?? {}) as Record<string, Row>)
    .filter(([, def]) => def && def.picklist !== undefined && def.options !== undefined)
    .map(([name]) => `fields.${name}.options`);
}

const puts: Array<{ url: string; body: Row; status: number }> = [];

const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    const body = JSON.parse(String(init.body)) as Row;
    const refused = doorRefusal(body);
    const status = refused.length > 0 ? 422 : 200;
    puts.push({ url: String(url), body, status });
    return new Response(
      JSON.stringify(
        status === 422
          ? {
              error: 'failed spec validation',
              code: 'INVALID_METADATA',
              issues: refused.map((path) => ({
                path,
                code: 'custom',
                message: '`picklist` and `options` cannot both be declared. Keep `picklist` and delete `options`.',
              })),
            }
          : { success: true },
      ),
      { status, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
});

/** A real client over the refusing transport, its reads served by doubles. */
function makeClient(draft: Row | null): MetadataClient {
  const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
  Object.assign(client, {
    list: vi.fn(async (type: string) => (type === 'object' ? [{ name: 'acme_account', label: 'Account' }] : [])),
    listDrafts: vi.fn(async () => []),
    layered: vi.fn(async () => ({ effective: served(), code: served() })),
    getDraft: vi.fn(async () => (draft ? { type: 'object', name: 'acme_account', item: draft } : null)),
  });
  return client;
}

afterEach(() => {
  cleanup();
  puts.length = 0;
  fetchImpl.mockClear();
  vi.mocked(toast.success).mockClear();
});

async function changeSharingAndSave(client: MetadataClient): Promise<void> {
  render(<PackageOwdOverviewPanel client={client} packageId={PKG} locale="en-US" />);
  await screen.findByTestId('owd-row-acme_account');
  await pickOwd('owd-internal-acme_account', t('engine.studio.settings.sharingPublicRead', 'en-US'));
  fireEvent.click(screen.getByTestId('owd-save'));
  await waitFor(() => expect(puts).toHaveLength(1));
}

describe('PackageOwdOverviewPanel — a picklist-bound object saves without its served options (objectui#11692)', () => {
  it('no pending draft: the body seeded from `layered.effective` reaches the door accepted, the bound field without `options`', async () => {
    await changeSharingAndSave(makeClient(null));

    const [put] = puts;
    expect(put!.status, `refused at ${doorRefusal(put!.body).join(', ')}`).toBe(200);
    expect(put!.url).toContain('/meta/object/acme_account');
    const fields = put!.body.fields as Record<string, Row>;
    expect(fields.tier).toEqual({ type: 'select', label: 'Tier', picklist: 'acme_tier' });
    // Nothing else is touched: the inline select and the text field go out as served.
    expect(JSON.stringify(fields.status)).toBe(SERVED_STATUS);
    expect(JSON.stringify(fields.title)).toBe(SERVED_TITLE);
    // The control: the OWD edit itself still lands, and the save reports success.
    expect(put!.body.sharingModel).toBe('public_read');
    expect(put!.body.label).toBe('Account');
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it('a pending draft that serves the bound field resolved: the body seeded from the draft is accepted the same way', async () => {
    await changeSharingAndSave(makeClient(served({ description: 'authored in the draft' })));

    const [put] = puts;
    expect(put!.status, `refused at ${doorRefusal(put!.body).join(', ')}`).toBe(200);
    const fields = put!.body.fields as Record<string, Row>;
    expect(fields.tier).toEqual({ type: 'select', label: 'Tier', picklist: 'acme_tier' });
    expect(JSON.stringify(fields.status)).toBe(SERVED_STATUS);
    // The draft's own key rides along: this was seeded from the draft, not the baseline.
    expect(put!.body.description).toBe('authored in the draft');
    expect(put!.body.sharingModel).toBe('public_read');
  });
});
