// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12848 — picking a new dataset's base object keeps the create seed's
 * `count` measure.
 *
 * The REAL page, with the real dataset designer (preview + curated inspector),
 * over a REAL `MetadataClient` whose transport is an in-memory server that
 * records every `PUT`. The `/meta/types` entry carries what the live server
 * serves for `dataset`: the spec's create seed (`getMetadataCreateSeed`) and
 * the dataset JSON schema.
 *
 *   - open → pick a base object → save: the body carries the seed's measures;
 *   - open → pick one object → pick another → save: still carried;
 *   - CONTROL (`objectChangePatch`): a move from one object to another clears
 *     the joins, dimensions, filter and every measure that names a field, and
 *     keeps the measure that names none;
 *   - CONTROL: selecting the same object only sets `object`;
 *   - the base-object hint says so, in en and zh: field measures are cleared
 *     and a row count is kept.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { z } from 'zod';
import { getMetadataCreateSeed, getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { MetadataClient } from '@object-ui/data-objectstack';

const server = {
  puts: [] as Array<{ name: string; body: Record<string, unknown> }>,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (seg.length === 1) return json(200, { items: [] });
  if (method === 'PUT') {
    server.puts.push({ name: seg[1]!, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return json(200, { success: true, version: 'hmac-sha256:v1', seq: 1, state: 'draft', message: `Saved ${seg[0]}/${seg[1]}` });
  }
  return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
}

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client.current,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        {
          type: 'dataset',
          label: 'Dataset',
          domain: 'analytics',
          allowEnvironmentOverlay: true,
          allowRuntimeCreate: true,
          schema: DATASET_JSON_SCHEMA,
          createSeed: getMetadataCreateSeed('dataset'),
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from '../ResourceEditPage';
import { registerDefaultMetadataSchemas } from '../default-schemas';
import { registerBuiltinPreviews } from '../previews';
import { registerBuiltinInspectors } from '.';
import { DatasetDefaultInspector, objectChangePatch } from './DatasetDefaultInspector';

const DATASET_JSON_SCHEMA = z.toJSONSchema(getMetadataTypeSchema('dataset') as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;
/** The spec seed's measures, read from the seed (never restated). */
const SEED_MEASURES = (getMetadataCreateSeed('dataset') as { measures: unknown[] }).measures;

client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

registerDefaultMetadataSchemas();
registerBuiltinPreviews();
registerBuiltinInspectors();

beforeEach(() => {
  server.puts = [];
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
});

const saveButton = () => screen.getByRole('button', { name: /Save \(⌘S\)/ });

/** Open a new dataset, type its Label (which derives the Name). */
async function openNewDataset(label: string) {
  render(
    <MemoryRouter initialEntries={['/metadata/dataset/new']}>
      <Routes>
        <Route path="/metadata/dataset/new" element={<MetadataResourceEditPage type="dataset" name="" createMode />} />
        <Route path="/metadata/dataset/:name" element={<div data-testid="landed" />} />
      </Routes>
    </MemoryRouter>,
  );
  const labelBox = await screen.findByRole('textbox', { name: 'Label' }, { timeout: 8000 });
  fireEvent.change(labelBox, { target: { value: label } });
  fireEvent.blur(labelBox);
  // The dataset's own Name comes first; the seed's `count` measure row, in the
  // draft from the start (objectui#12866), has a Name too.
  await waitFor(() => expect(screen.getAllByRole('textbox', { name: 'Name' })[0]).toHaveValue('probe_ds'));
}

async function pickBaseObject(objectName: string) {
  const baseObject = screen.getByRole('combobox', { name: 'Base object' });
  fireEvent.click(baseObject);
  const search = await screen.findByPlaceholderText(/Search objects/i);
  fireEvent.change(search, { target: { value: objectName } });
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(baseObject).toHaveTextContent(objectName));
}

async function saveBody(): Promise<Record<string, unknown>> {
  fireEvent.click(saveButton());
  await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
  return server.puts[0]!.body;
}

describe('a new dataset keeps the create seed\'s count measure (objectui#12848)', () => {
  it('open → pick a base object → save: the body carries the seed\'s measures', async () => {
    expect(SEED_MEASURES).toEqual([{ name: 'count', aggregate: 'count' }]);
    await openNewDataset('Probe Ds');
    await pickBaseObject('crm_account');
    const body = await saveBody();
    expect(body.object).toBe('crm_account');
    expect(body.measures).toEqual(SEED_MEASURES);
  });

  it('open → pick one object → pick another → save: the body still carries them', async () => {
    await openNewDataset('Probe Ds');
    await pickBaseObject('crm_account');
    await pickBaseObject('crm_contact');
    const body = await saveBody();
    expect(body.object).toBe('crm_contact');
    expect(body.measures).toEqual(SEED_MEASURES);
  });
});

describe('objectChangePatch moves a dataset between objects (objectui#12848)', () => {
  const authored = {
    object: 'crm_opportunity',
    include: ['account'],
    dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
    filter: { stage: 'won' },
    measures: [
      { name: 'deal_count', label: 'Deals', aggregate: 'count' },
      { name: 'row_count', aggregate: 'count', field: '*' },
      { name: 'amount_sum', aggregate: 'sum', field: 'amount' },
      { name: 'won_count', aggregate: 'count', filter: { stage: 'won' } },
      { name: 'won_rate', derived: { op: 'ratio', of: ['won_count', 'deal_count'] } },
    ],
  };

  it('CONTROL: a move clears what names the old object\'s fields and keeps the field-less counts', () => {
    expect(objectChangePatch('crm_account', 'crm_opportunity', authored)).toEqual({
      object: 'crm_account',
      include: [],
      dimensions: [],
      filter: undefined,
      measures: [
        { name: 'deal_count', label: 'Deals', aggregate: 'count' },
        { name: 'row_count', aggregate: 'count', field: '*' },
      ],
    });
  });

  it('CONTROL: selecting the same object changes nothing but `object`', () => {
    expect(objectChangePatch('crm_opportunity', 'crm_opportunity', authored)).toEqual({ object: 'crm_opportunity' });
  });

  it.each([
    ['en-US', 'Changing the base object clears its dimensions, field measures, joins & filters; a row count is kept.'],
    ['zh-CN', '更改基础对象会清空其维度、字段度量、关联与筛选；行计数会保留。'],
  ] as const)('the base-object hint says a row count is kept (%s)', (locale, hint) => {
    render(<DatasetDefaultInspector type="dataset" name="sales" locale={locale} draft={authored} onPatch={vi.fn()} readOnly={false} />);
    expect(screen.getByText(hint)).toBeInTheDocument();
  });
});
