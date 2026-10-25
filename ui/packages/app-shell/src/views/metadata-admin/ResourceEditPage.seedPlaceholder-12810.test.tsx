// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12810 — a dataset created with no base object is refused at the
 * client; it is never saved bound to the spec seed's placeholder object.
 *
 * The REAL page, with the real dataset designer (preview + curated inspector),
 * over a REAL `MetadataClient` whose transport is an in-memory server that
 * records every `PUT`. The `/meta/types` entry carries what the live server
 * serves for `dataset`: the spec's create seed (`getMetadataCreateSeed`) and
 * the dataset JSON schema (its `required` list).
 *
 *   (a) no base object picked → Save is refused with a stated reason, and no
 *       `PUT` is sent;
 *   (b) a base object picked → the body carries the picked object and the
 *       author's label, and no placeholder anywhere.
 *
 * That the seed's structural defaults survive `buildCreateModeBody` is pinned
 * in `createBody.seedPlaceholders-12810.test.ts` (here the designer's own
 * object picker resets `measures` when the object first changes).
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

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
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

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { registerBuiltinPreviews } from './previews';
import { registerBuiltinInspectors } from './inspectors';

const DATASET_JSON_SCHEMA = z.toJSONSchema(getMetadataTypeSchema('dataset') as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;
/** The spec seed's placeholder object, read from the seed (never restated). */
const PLACEHOLDER = (getMetadataCreateSeed('dataset') as { object: string }).object;

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

describe('dataset create with no base object (objectui#12810)', () => {
  it('(a) Save is refused at the client, naming the unset base object, and no PUT is sent', async () => {
    expect(DATASET_JSON_SCHEMA.required).toContain('object');
    await openNewDataset('Probe Ds');
    fireEvent.click(saveButton());
    const alert = await screen.findByText(/before saving: a new item is never saved with the placeholder/, {}, { timeout: 8000 });
    expect(alert.textContent).toContain('object');
    // Give any stray save a chance to land before reading the server's log.
    await new Promise((r) => setTimeout(r, 50));
    expect(server.puts).toEqual([]);
    expect(screen.queryByTestId('landed')).toBeNull();
  });

  it('(b) with a base object picked, the body carries the picked object', async () => {
    await openNewDataset('Probe Ds');
    const baseObject = screen.getByRole('combobox', { name: 'Base object' });
    fireEvent.click(baseObject);
    const search = await screen.findByPlaceholderText(/Search objects/i);
    fireEvent.change(search, { target: { value: 'crm_account' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(baseObject).toHaveTextContent('crm_account'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
    const body = server.puts[0]!.body;
    expect(server.puts[0]!.name).toBe('probe_ds');
    expect(body.object).toBe('crm_account');
    expect(body.label).toBe('Probe Ds');
    expect(JSON.stringify(body)).not.toContain(PLACEHOLDER);
  });
});
