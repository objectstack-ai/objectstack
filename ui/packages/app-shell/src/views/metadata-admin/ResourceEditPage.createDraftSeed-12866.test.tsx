// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12866 — a new dataset's designer shows the spec create seed's
 * structural defaults before the first save, and they are what the save writes.
 *
 * The REAL page, with the real dataset designer (preview + curated inspector),
 * over a REAL `MetadataClient` whose transport is an in-memory server that
 * records every `PUT`. The `/meta/types` entry carries what the live server
 * serves for `dataset`: the spec's create seed (`getMetadataCreateSeed`) and
 * the dataset JSON schema. The live `useMetadataTypes` reads that registry
 * AFTER the page's first render, so the entry here can be held back and
 * released, as the live one arrives.
 *
 *   (a) Measures reads 1 (`count`) before the first save, and the saved body
 *       carries the same measures — with the entry served at mount, and with
 *       it arriving after the first render;
 *   (b) CONTROL: none of the seed's placeholder identity (its `label`, its
 *       placeholder `object`) reaches the draft;
 *   (c) a measure the author added before the entry arrived is not
 *       overwritten when it does.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
/** Whether the type registry has answered; `release()` answers it later. */
const registry = vi.hoisted(() => ({
  servedAtMount: true,
  release: null as null | (() => void),
}));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  const { useState } = await import('react');
  return {
    ...mod,
    useMetadataClient: () => client.current,
    useMetadataTypes: () => {
      const [served, setServed] = useState(registry.servedAtMount);
      registry.release = () => setServed(true);
      return { loading: !served, error: null, entries: served ? [datasetEntry()] : [] };
    },
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
/** Read from the seed, never restated. */
const SEED = getMetadataCreateSeed('dataset') as { label: string; object: string; measures: unknown[] };

let entry: Record<string, unknown> | undefined;
function datasetEntry(): Record<string, unknown> {
  entry ??= {
    type: 'dataset',
    label: 'Dataset',
    domain: 'analytics',
    allowEnvironmentOverlay: true,
    allowRuntimeCreate: true,
    schema: DATASET_JSON_SCHEMA,
    createSeed: getMetadataCreateSeed('dataset'),
  };
  return entry;
}

client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

registerDefaultMetadataSchemas();
registerBuiltinPreviews();
registerBuiltinInspectors();

beforeEach(() => {
  server.puts = [];
  registry.servedAtMount = true;
  registry.release = null;
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
});

const saveButton = () => screen.getByRole('button', { name: /Save \(⌘S\)/ });

/** The count badge beside the inspector's "Measures" section title. */
function measuresBadge(): string | null | undefined {
  const title = screen.getAllByText('Measures').find((el) => el.nextElementSibling);
  return title?.nextElementSibling?.textContent;
}

async function openNewDataset() {
  render(
    <MemoryRouter initialEntries={['/metadata/dataset/new']}>
      <Routes>
        <Route path="/metadata/dataset/new" element={<MetadataResourceEditPage type="dataset" name="" createMode />} />
        <Route path="/metadata/dataset/:name" element={<div data-testid="landed" />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.findByRole('textbox', { name: 'Label' }, { timeout: 8000 });
}

async function nameAndPickObject(labelBox: HTMLElement) {
  fireEvent.change(labelBox, { target: { value: 'Probe Ds' } });
  fireEvent.blur(labelBox);
  // The dataset's own Name comes first; each measure row has a Name too.
  await waitFor(() => expect(screen.getAllByRole('textbox', { name: 'Name' })[0]).toHaveValue('probe_ds'));
  const baseObject = screen.getByRole('combobox', { name: 'Base object' });
  fireEvent.click(baseObject);
  const search = await screen.findByPlaceholderText(/Search objects/i);
  fireEvent.change(search, { target: { value: 'crm_account' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  await waitFor(() => expect(baseObject).toHaveTextContent('crm_account'));
}

async function saveBody(): Promise<Record<string, unknown>> {
  fireEvent.click(saveButton());
  await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
  return server.puts[0]!.body;
}

describe('a new dataset shows the create seed\'s measures before the first save (objectui#12866)', () => {
  it('(a) served at mount: Measures reads 1 (`count`) before save, and the save writes the same', async () => {
    expect(SEED.measures).toEqual([{ name: 'count', aggregate: 'count' }]);
    const labelBox = await openNewDataset();
    await waitFor(() => expect(measuresBadge()).toBe('1'));
    expect(screen.getByDisplayValue('count')).toBeInTheDocument();
    await nameAndPickObject(labelBox);
    expect(measuresBadge()).toBe('1');
    const body = await saveBody();
    expect(body.measures).toEqual(SEED.measures);
  });

  it('(a) arriving after the first render: Measures reads 0, then 1 (`count`) once the registry answers', async () => {
    registry.servedAtMount = false;
    const labelBox = await openNewDataset();
    expect(measuresBadge()).toBe('0');
    act(() => registry.release!());
    await waitFor(() => expect(measuresBadge()).toBe('1'));
    await nameAndPickObject(labelBox);
    const body = await saveBody();
    expect(body.measures).toEqual(SEED.measures);
  });

  it('(b) CONTROL: the seed\'s placeholder identity never reaches the draft', async () => {
    const labelBox = await openNewDataset();
    await waitFor(() => expect(measuresBadge()).toBe('1'));
    expect(labelBox).toHaveValue('');
    expect(screen.queryByDisplayValue(SEED.label)).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Base object' })).not.toHaveTextContent(SEED.object);
    expect(document.body.textContent).not.toContain(SEED.object);
  });

  it('(c) a measure the author added before the registry answered is kept when it does', async () => {
    registry.servedAtMount = false;
    await openNewDataset();
    fireEvent.click(screen.getByRole('button', { name: /Add measure/ }));
    await waitFor(() => expect(measuresBadge()).toBe('1'));
    // Releasing the entry runs the page's effects inside `act`, so a seeding
    // that overwrote the author's measure would already show here.
    act(() => registry.release!());
    await new Promise((r) => setTimeout(r, 50));
    expect(measuresBadge()).toBe('1');
    expect(screen.queryByDisplayValue('count')).toBeNull();
  });
});
