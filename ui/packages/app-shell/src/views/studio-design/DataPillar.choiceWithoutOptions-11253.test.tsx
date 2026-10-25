// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11253 — the Studio data page never sends a `select` / `radio`
 * without its options.
 *
 * The order this card closes, measured on the real surface before the fix:
 * "Add field" creates a `text` field, the inspector's Type dropdown turns it
 * into a `select` through `patchDef({ type })` and adds no options, and the
 * draft autosave PUTs that document 1.5 s later. The maintainer's ruling A on
 * objectstack#20827 refuses such a field at the `FieldSchema` door, and its
 * execution parameter orders objectui to change this order FIRST.
 *
 * The observation point is the WIRE, not a mock of `client.save`: the pillar
 * gets a real `MetadataClient`, whose `save` is the door that runs the object
 * write guard, and only the transport under it is a double. A save the guard
 * holds therefore never reaches `fetch`, which is exactly the claim: no
 * request carries a choice type without options.
 *
 * The held save must also say why on screen, naming the field, and adding one
 * option must let the next autosave go (the control that proves the pillar is
 * not simply refusing every select).
 *
 * Since objectui#11786 the pillar asks the same guard before sending, so "held"
 * is a neutral line naming the field by its label (`studio-held`), not a
 * refusal: the wire claim above is unchanged, and so is its control.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

/** An object that ALREADY stores an empty select, from before this guard. */
const storedEmptySelect = {
  name: 'showcase_task',
  label: 'Task',
  fields: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'status', label: 'Status', type: 'select' },
  ],
};

/** What the mount's read serves; each test picks one. */
let served: Record<string, unknown> = objectDef;

/** Every PUT the transport received, parsed. */
const puts: Array<{ url: string; body: Record<string, unknown> }> = [];

const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    puts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
});

// A real client: its `save` is the door under test. Only the reads the pillar
// makes on mount are answered directly, so they do not need a routed server.
const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: served, code: served })),
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
import { addFieldFromFormToolbar } from './__tests__/dataPillarAddField';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

afterEach(() => {
  cleanup();
  puts.length = 0;
  fetchImpl.mockClear();
  served = objectDef;
});

type WireField = { name?: string; type?: unknown; options?: unknown; picklist?: unknown };

/** Every field a PUT body carries, in either `fields` shape. */
function wireFields(body: Record<string, unknown>): WireField[] {
  const fields = body.fields;
  if (Array.isArray(fields)) return fields as WireField[];
  if (fields && typeof fields === 'object') {
    return Object.entries(fields as Record<string, WireField>).map(([name, def]) => ({ name, ...def }));
  }
  return [];
}

/** The claim, read off the wire: a choice field with no option source. */
function choiceWithoutOptions(): WireField[] {
  return puts.flatMap((p) =>
    wireFields(p.body).filter(
      (f) =>
        (f.type === 'select' || f.type === 'radio') &&
        !(Array.isArray(f.options) && f.options.length > 0) &&
        typeof f.picklist !== 'string',
    ),
  );
}

/** Past the autosave's 1.5 s debounce. */
async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

/** The inspector control under a visible label. */
function controlUnder(label: string): HTMLElement {
  const lab = screen.getByText(label, { selector: 'label' });
  return lab.parentElement!.querySelector('input, [role="combobox"]') as HTMLElement;
}

/** The held line naming `label`'s missing options (objectui#11786). */
function heldOptionsLine(label: string): string {
  return tFormat('engine.studio.held.line', 'en', {
    clause: tFormat('engine.studio.held.needsOptions', 'en', { field: label }),
  });
}

/** Add a field on the Form tab and turn it into the given choice type. */
async function addFieldAndType(typeLabel: RegExp): Promise<string> {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
  await addFieldFromFormToolbar();
  await screen.findByText('Type', { selector: 'label' }, { timeout: 4000 });
  const fieldName = (controlUnder('API name') as HTMLInputElement).value;
  expect(fieldName, 'the new field has no API name: the harness is dead').not.toBe('');
  await userEvent.click(controlUnder('Type'));
  await userEvent.click(await screen.findByRole('option', { name: typeLabel }));
  return fieldName;
}

describe('Studio data page — a new choice field is not sent without options (objectui#11253)', () => {
  for (const [type, typeLabel] of [
    ['select', /^Picklist$/],
    ['radio', /^Radio$/],
  ] as const) {
    it(`add a field, type it \`${type}\`, wait out the autosave: no request carries it without options`, async () => {
      const fieldName = await addFieldAndType(typeLabel);
      const fieldLabel = (controlUnder('Label') as HTMLInputElement).value;
      await outlastDebounce();
      expect(choiceWithoutOptions()).toEqual([]);

      // The held save says why, and names the field.
      expect(await screen.findByTestId('studio-held-message')).toHaveTextContent(heldOptionsLine(fieldLabel));

      // CONTROL: one option lets the next autosave go, and the banner clears.
      const before = puts.length;
      fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'open' } });
      await waitFor(() => expect(puts.length).toBeGreaterThan(before), { timeout: 4000 });
      const sent = wireFields(puts[puts.length - 1].body).find((f) => f.name === fieldName);
      expect(sent?.type).toBe(type);
      expect(sent?.options).toEqual([expect.objectContaining({ value: 'open' })]);
      expect(choiceWithoutOptions()).toEqual([]);
      await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
    });
  }
});

describe('Studio data page — an object that already stores an empty select (objectui#11253)', () => {
  /** Select a field's card on the Form tab, opening its inspector. */
  async function selectCard(label: string): Promise<void> {
    const card = (await screen.findByText(label)).closest('.cursor-grab') as HTMLElement;
    fireEvent.click(card);
    await waitFor(() => expect((controlUnder('API name') as HTMLInputElement).value).not.toBe(''));
  }

  it('an unrelated edit is held and names the stored field; an option on it lets both go', async () => {
    served = storedEmptySelect;
    render(
      <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
        <DataPillar packageId="com.example.showcase" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Form' }));

    // The unrelated edit: rename the text field's label.
    await selectCard('Title');
    const labelBox = controlUnder('Label') as HTMLInputElement;
    fireEvent.change(labelBox, { target: { value: 'Headline' } });
    fireEvent.blur(labelBox);
    await outlastDebounce();

    // Held: nothing reached the wire, and the banner names the STORED field.
    expect(puts).toEqual([]);
    expect(await screen.findByTestId('studio-held-message')).toHaveTextContent(heldOptionsLine('Status'));

    // Cleared on screen: the stored field's own inspector carries the editor.
    await selectCard('Status');
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'open' } });
    await waitFor(() => expect(puts.length).toBe(1), { timeout: 4000 });
    const sent = wireFields(puts[0].body);
    expect(sent.find((f) => f.name === 'status')?.options).toEqual([expect.objectContaining({ value: 'open' })]);
    // The held unrelated edit rides along; nothing was lost while it was held.
    expect(sent.find((f) => f.name === 'title')).toEqual(expect.objectContaining({ label: 'Headline' }));
    expect(choiceWithoutOptions()).toEqual([]);
  });
});
