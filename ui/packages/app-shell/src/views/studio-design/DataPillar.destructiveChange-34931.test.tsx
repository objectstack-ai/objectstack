// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34931 — the object draft save the door refuses `409
 * DESTRUCTIVE_CHANGE` (a removed field holds data) asks the author: the
 * confirm names what would be lost; Force save sends the same body to the same
 * address with `?force=true`; Cancel puts the field back and sends nothing.
 * Any other refusal still reads on the pillar's refusal strip.
 *
 * The client is a real `MetadataClient`: only the transport is a double, so
 * the URL each PUT left with is what the door would read.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'place', label: 'Place', type: 'text' },
  ],
};
const LOST = "Field 'place' removed — existing data in this column will become inaccessible.";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refused = (status: number, code: string, message: string) =>
  json(status, { success: false, error: { message, code, details: { code, issues: [{ code: 'x', field: 'place', message }] } } });

const puts: Array<{ url: string; body: { fields: Array<{ name: string }> } }> = [];
let answers: Response[] = [];
const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method !== 'PUT') return json(404, null);
  puts.push({ url, body: JSON.parse(String(init.body)) });
  return answers.shift() ?? json(200, { success: true });
});

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
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
// The field header's ⋯ menu as plain buttons (as in `DataPillar.celGate.test.tsx`).
vi.mock('@object-ui/components', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/components')>();
  const Pass = (p: { children?: React.ReactNode }) => <div>{p.children}</div>;
  const Item = (p: { children?: React.ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
  );
  return {
    ...mod,
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Item,
    DropdownMenuRadioGroup: Pass,
    DropdownMenuRadioItem: Item,
  };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
// The source reaches a dynamic import of it: its first load is paid at collection (`check:test-source-alias`).
import '@objectstack/lint';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

afterEach(() => {
  cleanup();
  puts.length = 0;
  answers = [];
});

const card = (label: string) => screen.queryByText(label)?.closest('.cursor-grab') ?? null;
const fieldNames = (i: number) => puts[i].body.fields.map((f) => f.name);

/** Open the Form tab, remove Place, and let the autosave send it. */
async function removePlace(first: Response) {
  answers = [first];
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
  fireEvent.click((await screen.findByText('Place')).closest('.cursor-grab') as HTMLElement);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove “Place”' }));
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByTestId('field-remove-confirm-action'));
  await waitFor(() => expect(puts).toHaveLength(1), { timeout: 4000 });
  expect(fieldNames(0)).toEqual(['title']);
}

describe('Data pillar — a destructive object draft save is confirmed, not dead-ended (objectstack#34931)', () => {
  it('names what would be lost; Force save re-sends the same body forced to the same package', async () => {
    await removePlace(refused(409, 'DESTRUCTIVE_CHANGE', LOST));
    const confirm = await screen.findByTestId('object-destructive-confirm');
    expect(confirm).toHaveTextContent(LOST);
    expect(screen.queryByTestId('studio-refusal')).toBeNull();

    fireEvent.click(within(confirm).getByTestId('object-destructive-force'));
    await waitFor(() => expect(puts).toHaveLength(2), { timeout: 4000 });
    const [first, forced] = puts.map((p) => new URL(p.url));
    expect(forced.pathname).toBe(first.pathname);
    expect(forced.searchParams.get('force')).toBe('true');
    expect(forced.searchParams.get('package')).toBe('com.example.showcase');
    expect(forced.searchParams.get('mode')).toBe('draft');
    expect(first.searchParams.get('force')).toBeNull();
    expect(puts[1].body).toEqual(puts[0].body);
    await waitFor(() => expect(screen.queryByTestId('object-destructive-confirm')).toBeNull());
    expect(card('Place')).toBeNull();
  });

  it('Cancel puts the field back and sends nothing more', async () => {
    await removePlace(refused(409, 'DESTRUCTIVE_CHANGE', LOST));
    fireEvent.click(within(await screen.findByTestId('object-destructive-confirm')).getByTestId('object-destructive-keep'));
    await waitFor(() => expect(card('Place')).not.toBeNull());
    await new Promise((r) => setTimeout(r, 2300));
    expect(puts).toHaveLength(1);
    expect(screen.queryByTestId('object-destructive-confirm')).toBeNull();
  });

  it('any other refusal reads on the refusal strip, with no confirm', async () => {
    await removePlace(refused(422, 'INVALID_METADATA', 'Field place is invalid'));
    expect(await screen.findByTestId('studio-refusal')).toBeInTheDocument();
    expect(screen.queryByTestId('object-destructive-confirm')).toBeNull();
    await new Promise((r) => setTimeout(r, 2300));
    expect(puts).toHaveLength(1);
  });
});
