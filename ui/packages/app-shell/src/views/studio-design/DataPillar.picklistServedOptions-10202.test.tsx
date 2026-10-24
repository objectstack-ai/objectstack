// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10202 — the Studio data page saves an object whose fields name a
 * shared picklist.
 *
 * The page seeds its buffer from the SERVED object (`layers.effective`), where a
 * picklist-bound field carries `picklist` and the options the runtime resolved
 * from the list and its extensions. The authoring door refuses the two keys
 * together (`422 INVALID_METADATA` at `fields.FIELD.options`, measured on
 * objectstack `main`), so both of the page's object PUTs that re-send that
 * buffer — the draft autosave and the grid's column reorder — leave the served
 * `options` out of every bound field, and touch nothing else.
 *
 * The client is a real `MetadataClient`; only its transport is a double, and
 * that double refuses a body the way the authoring door does. So the claim is
 * read off the WIRE.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

type Row = Record<string, unknown>;

const PKG = 'com.example.showcase';

/** The object as the runtime SERVES it (the record `fields` shape the runtime serves). */
const SERVED: Row = {
  name: 'showcase_account',
  label: 'Account',
  fields: {
    title: { type: 'text', label: 'Title' },
    tier: {
      type: 'select',
      label: 'Tier',
      picklist: 'showcase_tier',
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
  },
};

/** The authoring door's refusal for a field carrying both keys. */
function doorRefusal(body: Row): string[] {
  const fields = body.fields;
  const entries: Array<[string, Row]> = Array.isArray(fields)
    ? (fields as Row[]).map((f) => [String(f.name), f])
    : Object.entries((fields ?? {}) as Record<string, Row>);
  return entries
    .filter(([, def]) => def && def.picklist !== undefined && def.options !== undefined)
    .map(([name]) => `fields.${name}.options`);
}

const puts: Array<{ body: Row; status: number }> = [];

const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    const body = JSON.parse(String(init.body)) as Row;
    const refused = doorRefusal(body);
    const status = refused.length > 0 ? 422 : 200;
    puts.push({ body, status });
    return new Response(
      JSON.stringify(
        status === 422
          ? {
              error: 'failed spec validation',
              code: 'INVALID_METADATA',
              issues: refused.map((path) => ({ path, code: 'custom', message: '`picklist` and `options` cannot both be declared' })),
            }
          : { success: true },
      ),
      { status, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
});

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  list: vi.fn(async (type: string) => (type === 'object' ? [{ name: 'showcase_account', label: 'Account' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: SERVED, code: SERVED })),
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

// The records grid: a double that reorders the columns it was handed through
// the grid's authoring context, the way a header drag does.
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { useGridFieldAuthoring } = await import('@object-ui/components');
  function GridDouble({ schema }: { schema?: { table?: { fields?: string[] } } }) {
    const authoring = useGridFieldAuthoring();
    const cols = schema?.table?.fields ?? [];
    return (
      <>
        <button type="button" onClick={() => authoring?.onReorderFields?.([...cols].reverse())}>
          Reverse columns
        </button>
        {/* objectui#12511 — the grid's "+" column, drawn from the same context. */}
        {authoring?.onAddColumn && (
          <button type="button" data-testid="grid-add-column" onClick={authoring.onAddColumn}>
            Add column
          </button>
        )}
      </>
    );
  }
  return { ...mod, ObjectView: GridDouble };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

import { DataPillar } from './StudioDesignSurface';
import { addFieldFromGrid } from './__tests__/dataPillarAddField';
import { createEmptyDataSource } from './__tests__/emptyDataSource';

const dataSource = createEmptyDataSource();

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

afterEach(() => {
  cleanup();
  puts.length = 0;
  fetchImpl.mockClear();
});

function renderData() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
      <DataPillar packageId={PKG} />
    </MemoryRouter>,
  );
}

const fieldCountShown = () => screen.getByText(/^\d+ fields$/).textContent;

/** Past the autosave's 1.5 s debounce. */
async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

/** What every PUT the page sent carried for `tier` and `status`. */
function sentFields(): Array<{ tier: unknown; status: unknown; status_code: number }> {
  return puts.map((p) => {
    const f = p.body.fields as Record<string, Row>;
    return { tier: f.tier, status: f.status, status_code: p.status };
  });
}

const SERVED_STATUS = JSON.stringify((SERVED.fields as Record<string, Row>).status);

describe('Studio data page — a picklist-bound field is saved without its served options (objectui#10202)', () => {
  it('the draft autosave (an added field) sends no bound field with `options`, and the inline select byte-identical', async () => {
    renderData();
    await waitFor(() => expect(fieldCountShown()).toBe('3 fields'), { timeout: 8000 });
    await addFieldFromGrid();
    await outlastDebounce();
    await waitFor(() => expect(puts.length).toBeGreaterThan(0), { timeout: 4000 });

    for (const sent of sentFields()) {
      expect(sent.status_code, 'the door accepted the body').toBe(200);
      expect(sent.tier).toEqual({ type: 'select', label: 'Tier', picklist: 'showcase_tier' });
      expect(JSON.stringify(sent.status)).toBe(SERVED_STATUS);
    }
  });

  it("the grid's column reorder sends no bound field with `options` either", async () => {
    renderData();
    await waitFor(() => expect(fieldCountShown()).toBe('3 fields'), { timeout: 8000 });
    fireEvent.click(await screen.findByRole('button', { name: 'Reverse columns' }, { timeout: 8000 }));
    await waitFor(() => expect(puts.length).toBeGreaterThan(0), { timeout: 4000 });

    const first = puts[0];
    expect(first.status, `refused at ${doorRefusal(first.body).join(', ')}`).toBe(200);
    expect(Object.keys(first.body.fields as Row)).toEqual(['status', 'tier', 'title']);
    const f = first.body.fields as Record<string, Row>;
    expect(f.tier).toEqual({ type: 'select', label: 'Tier', picklist: 'showcase_tier' });
    expect(JSON.stringify(f.status)).toBe(SERVED_STATUS);
  });
});
