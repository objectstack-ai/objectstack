// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11843 — the Data pillar's Objects rail lists a draft-only object by
 * the label its draft declares, as it lists a published object by its label.
 *
 * Measured on the card: a draft-only object labelled "Repair Ticket" was
 * listed as `repairs_repair_ticket`, while its published sibling read
 * "Technician". The rail merges the published list with the package's draft
 * headers, and a draft header carries no label. The draft-overlaid list
 * (`GET /meta/object?package=…&preview=draft`) serves each pending draft with
 * its own label and a `_draft` mark, so the rail now reads its draft-only rows'
 * labels from it, and from nothing else.
 *
 * The client is a real `MetadataClient`, so the three reads are the ones the
 * production client sends; only the transport under it is a double. The
 * per-object load on selection (`layered`, `getDraft`) is stubbed, as in
 * `DataPillar.heldIncomplete-11786.test.tsx`: it is not what this card is about.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const PKG = 'com.example.repairs';
const BASE = 'http://test.local/api/v1/meta';
const PUBLISHED_URL = `${BASE}/object?package=${PKG}`;
const DRAFTS_URL = `${BASE}/_drafts?packageId=${PKG}&type=object`;
const OVERLAID_URL = `${BASE}/object?package=${PKG}&preview=draft`;

const technician = {
  name: 'repairs_technician',
  label: 'Technician',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

/** The package's published objects, in the order the server lists them. */
const published = [
  { name: 'repairs_technician', label: 'Technician', _packageId: PKG },
  { name: 'repairs_site', label: 'Site', _packageId: PKG },
];

/**
 * The package's pending object drafts: one draft-only object that declares a
 * label, one that declares none, and a draft over the published Technician.
 */
const draftHeaders = [
  { type: 'object', name: 'repairs_repair_ticket', packageId: PKG, updatedAt: null, updatedBy: null },
  { type: 'object', name: 'repairs_note', packageId: PKG, updatedAt: null, updatedBy: null },
  { type: 'object', name: 'repairs_technician', packageId: PKG, updatedAt: null, updatedBy: null },
];

/**
 * What the draft-overlaid list serves for that package: the draft wins over the
 * published Technician (with its own, different label), the draft-only objects
 * surface with their own bodies, and every draft carries `_draft: true`. Listed
 * in a different order from the rail, and with one draft the two membership
 * reads do not name, so that neither the rail's order nor its members can come
 * from this read without a pin seeing it.
 */
const overlaid = [
  { name: 'repairs_repair_ticket', label: 'Repair Ticket', _packageId: PKG, _draft: true },
  { name: 'repairs_site', label: 'Site', _packageId: PKG },
  { name: 'repairs_orphan', label: 'Orphan', _packageId: PKG, _draft: true },
  { name: 'repairs_note', _packageId: PKG, _draft: true },
  { name: 'repairs_technician', label: 'Field Technician', _packageId: PKG, _draft: true },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** How the draft-overlaid read is answered in the current test. */
let answerOverlaid: () => Response = () => json({ type: 'object', items: overlaid });
/** Every GET the transport received. */
const gets: string[] = [];

const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
  const url = String(input);
  if ((init?.method ?? 'GET').toUpperCase() === 'GET') gets.push(url);
  if (url === PUBLISHED_URL) return json({ type: 'object', items: published });
  if (url === DRAFTS_URL) return json({ success: true, data: { drafts: draftHeaders } });
  if (url === OVERLAID_URL) return answerOverlaid();
  return json(null, 404);
});

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  layered: vi.fn(async () => ({ effective: technician, code: technician })),
  getDraft: vi.fn(async () => null),
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();
registerBuiltinInspectors();

afterEach(() => {
  cleanup();
  gets.length = 0;
  fetchImpl.mockClear();
  answerOverlaid = () => json({ type: 'object', items: overlaid });
});

function renderPillar() {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
      <DataPillar packageId={PKG} />
    </MemoryRouter>,
  );
}

/** The rail's rows, top to bottom, as the author reads them (the New object button excluded). */
function railRows(): string[] {
  const nav = screen.getByPlaceholderText(t('engine.studio.data.searchObjects', 'en')).closest('nav');
  expect(nav, 'the Objects rail did not render: the harness is dead').not.toBeNull();
  const newObject = t('engine.studio.data.newObject', 'en');
  return within(nav as HTMLElement)
    .getAllByRole('button')
    .map((b) => (b.textContent ?? '').trim())
    .filter((text) => text !== newObject);
}

describe('Studio Data pillar — a draft-only object is listed by its draft\'s label (objectui#11843)', () => {
  it('lists a draft-only object that declares a label by that label, read from the package-scoped draft-overlaid list', async () => {
    renderPillar();
    expect(await screen.findByRole('button', { name: 'Repair Ticket' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'repairs_repair_ticket' })).toBeNull();
    // The label came from the overlaid list of THIS package, asked once.
    expect(gets.filter((u) => u === OVERLAID_URL)).toHaveLength(1);
  });

  it('lists a draft-only object that declares no label by its name', async () => {
    renderPillar();
    expect(await screen.findByRole('button', { name: 'repairs_note' })).toBeInTheDocument();
  });

  it('control: published rows, the members and their order are as before; a pending draft does not relabel a published object', async () => {
    renderPillar();
    await screen.findByRole('button', { name: 'Technician' });
    // Published first, in the published list's order, then the draft-only
    // objects in the draft headers' order. `repairs_orphan` is served only by
    // the overlaid read and is not a member; the published Technician keeps
    // its published label although its pending draft declares another.
    expect(railRows()).toEqual(['Technician', 'Site', 'Repair Ticket', 'repairs_note']);
    expect(screen.queryByRole('button', { name: 'Field Technician' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Orphan' })).toBeNull();
  });

  it.each([
    ['the overlaid read fails', () => json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'store unavailable' } }, 500)],
    // A caller the server does not admit to pending drafts is answered the
    // published list: no entry carries `_draft`, so no draft label is served.
    ['the overlaid read is answered the published list', () => json({ type: 'object', items: published })],
  ])('leaves the rail as it was when %s: draft-only objects by name, no failure shown', async (_case, answer) => {
    answerOverlaid = answer;
    renderPillar();
    expect(await screen.findByRole('button', { name: 'repairs_repair_ticket' })).toBeInTheDocument();
    expect(railRows()).toEqual(['Technician', 'Site', 'repairs_repair_ticket', 'repairs_note']);
    expect(screen.queryByText(t('engine.studio.loadFailed', 'en'))).toBeNull();
    expect(gets.filter((u) => u === OVERLAID_URL)).toHaveLength(1);
  });
});
