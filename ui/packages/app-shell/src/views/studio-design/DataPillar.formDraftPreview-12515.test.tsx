// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12515 — the Data pillar's Form tab Preview renders the runtime form
 * from the DRAFT definition.
 *
 * Measured on the card: Preview mounted the runtime `ObjectForm` against the
 * published object only, so a draft-only object showed "No published
 * definition yet" under a banner repeating the same instruction, and a
 * published object with a pending change previewed the version without it.
 * Preview now hands the same `ObjectForm` a data source whose
 * `getObjectSchema` answers the open object from the pillar's buffer. A
 * "Draft preview" chip says so; a Draft / Published toggle appears only when a
 * published version exists.
 *
 * The client is a real `MetadataClient` over an in-memory server, as in
 * `DataPillar.draftOnlyNoLayers-12508.test.tsx`. The adapter is the
 * `createEmptyDataSource` double whose `getObjectSchema` serves the published
 * definitions and records every call. The form is the real `ObjectForm`.
 *
 * Pinned:
 *  - a draft-only object with three draft fields shows the three fields, with
 *    the chip and no toggle, and the adapter is never asked for its definition;
 *  - a published object with a pending change shows the draft (a field added,
 *    one removed), and the toggle's Published side shows the published
 *    definition's fields;
 *  - CONTROL: a published object with no pending change has neither chip nor
 *    toggle, and its definition is the adapter's;
 *  - Preview never saves: a submitted preview form writes nothing.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const PKG = 'com.default.studio-test';

const server = {
  published: [] as Array<Record<string, unknown>>,
  drafts: new Map<string, Record<string, unknown>>(),
  draftHeaders: [] as string[],
  requests: [] as Array<{ method: string; path: string; status: number }>,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://test.local');
  const q = url.searchParams;
  let status = 200;
  let body: unknown = null;
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (method === 'GET' && meta) {
    const seg = meta[1].split('/').map(decodeURIComponent);
    if (seg[0] === '_drafts') {
      body = { success: true, data: { drafts: server.draftHeaders.map((name) => ({ type: 'object', name, packageId: PKG })) } };
    } else if (seg.length === 1) {
      body = { type: seg[0], items: q.get('preview') === 'draft' ? [] : server.published };
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const row = server.published.find((o) => o.name === seg[1]);
      if (row) body = { code: row, overlay: null, effective: row };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2 && q.get('state') === 'draft') {
      const row = server.drafts.get(seg[1]);
      if (row) body = { type: seg[0], name: seg[1], item: { ...row, _draft: true } };
      else [status, body] = [404, { error: { code: 'NO_DRAFT', message: 'absent' } }];
    } else {
      [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    }
  }
  server.requests.push({ method, path: url.pathname, status });
  return json(status, body);
}

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: vi.fn(serve) as unknown as typeof fetch });

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
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t } from '../metadata-admin/i18n';

const empty = createEmptyDataSource();
/** The published definitions, as the adapter serves them; every call recorded. */
const getObjectSchema = vi.fn(async (name: string) => server.published.find((o) => o.name === name) ?? null);
/** A write the preview must never reach. */
const create = vi.fn(async (_resource: string, data: unknown) => data);
const dataSource = { ...empty, getObjectSchema, create };
registerBuiltinInspectors();

const DRAFT_CHIP = t('engine.studio.data.form.draftChip', 'en');
const DRAFT = t('engine.studio.data.form.sourceDraft', 'en');
const PUBLISHED = t('engine.studio.data.form.sourcePublished', 'en');

/** A draft-only object with three draft fields. */
const ticket = {
  name: 'st_ticket',
  label: 'Ticket',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    priority: { type: 'select', label: 'Priority', options: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }] },
    due_on: { type: 'date', label: 'Due On' },
  },
};
/**
 * A published object, and a pending draft of it that adds one field and
 * removes one: each side of the toggle lists its own definition's fields.
 */
const asset = {
  name: 'st_asset',
  label: 'Asset',
  fields: { name: { type: 'text', label: 'Asset Name' }, serial: { type: 'text', label: 'Serial Number' } },
};
const assetDraft = {
  ...asset,
  fields: { name: asset.fields.name, warranty_ends: { type: 'date', label: 'Warranty Ends' } },
};

beforeEach(() => {
  server.published = [];
  server.drafts.clear();
  server.draftHeaders = [];
  server.requests = [];
  getObjectSchema.mockClear();
  create.mockClear();
});
afterEach(cleanup);

const settle = () =>
  act(async () => {
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function openPreview() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
      <DataPillar packageId={PKG} />
    </MemoryRouter>,
  );
  await settle();
  fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
  await settle();
  // The Records grid (the landing tab) reads the published definition through
  // the adapter; only what the Preview asks is counted.
  getObjectSchema.mockClear();
  fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
  await settle();
}

const toolbar = () => within(screen.getByTestId('form-toolbar'));
const asked = (name: string) => getObjectSchema.mock.calls.filter(([n]) => n === name).length;

describe('DataPillar Form Preview renders the draft definition (objectui#12515)', () => {
  it('a draft-only object with three draft fields shows the three fields', async () => {
    server.drafts.set('st_ticket', ticket);
    server.draftHeaders = ['st_ticket'];
    await openPreview();

    expect(await screen.findByText('Subject')).toBeInTheDocument();
    expect(screen.getByText('Priority')).toBeInTheDocument();
    expect(screen.getByText('Due On')).toBeInTheDocument();
    expect(toolbar().getByText(DRAFT_CHIP)).toBeInTheDocument();
    // No published version: nothing to toggle to.
    expect(screen.queryByTestId('form-preview-source')).toBeNull();
    // The definition came from the buffer, not from a server read by name.
    expect(asked('st_ticket')).toBe(0);
    expect(server.requests.filter((r) => r.status >= 400)).toEqual([]);
  });

  it('a published object with a pending change shows the draft; the toggle shows the published one', async () => {
    server.published = [asset];
    server.drafts.set('st_asset', assetDraft);
    server.draftHeaders = ['st_asset'];
    await openPreview();

    expect(await screen.findByText('Warranty Ends')).toBeInTheDocument();
    expect(screen.queryByText('Serial Number')).toBeNull();
    expect(toolbar().getByText(DRAFT_CHIP)).toBeInTheDocument();
    expect(toolbar().getByRole('button', { name: DRAFT, pressed: true })).toBeInTheDocument();
    expect(asked('st_asset')).toBe(0);

    fireEvent.click(toolbar().getByRole('button', { name: PUBLISHED }));
    await settle();
    expect(toolbar().getByRole('button', { name: PUBLISHED, pressed: true })).toBeInTheDocument();
    expect(await screen.findByText('Serial Number')).toBeInTheDocument();
    expect(screen.queryByText('Warranty Ends')).toBeNull();
    expect(toolbar().queryByText(DRAFT_CHIP)).toBeNull();
    expect(asked('st_asset')).toBeGreaterThan(0);

    fireEvent.click(toolbar().getByRole('button', { name: DRAFT }));
    await settle();
    expect(await screen.findByText('Warranty Ends')).toBeInTheDocument();
    expect(screen.queryByText('Serial Number')).toBeNull();
  });

  it('CONTROL: a published object with no pending change has neither chip nor toggle', async () => {
    server.published = [asset];
    await openPreview();

    expect(await screen.findByText('Serial Number')).toBeInTheDocument();
    expect(toolbar().queryByText(DRAFT_CHIP)).toBeNull();
    expect(screen.queryByTestId('form-preview-source')).toBeNull();
    expect(asked('st_asset')).toBeGreaterThan(0);
  });

  it('Preview never saves: a submitted preview form writes nothing', async () => {
    server.drafts.set('st_ticket', ticket);
    server.draftHeaders = ['st_ticket'];
    await openPreview();

    const subject = (await screen.findByText('Subject')).closest('[data-field]')?.querySelector('input');
    expect(subject, 'the Subject input never rendered: the harness is dead').toBeTruthy();
    fireEvent.change(subject as HTMLInputElement, { target: { value: 'Printer jam' } });
    const form = subject?.closest('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form as HTMLFormElement);
    await settle();

    expect(create).not.toHaveBeenCalled();
    expect(server.requests.filter((r) => r.method !== 'GET')).toEqual([]);
  });
});
