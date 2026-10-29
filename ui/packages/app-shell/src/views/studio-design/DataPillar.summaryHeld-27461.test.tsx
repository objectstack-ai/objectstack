// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27461 — on the Studio data page, a new Rollup field is held
 * until it is set up, not autosaved unconfigured.
 *
 * The card's step 4: "Add field", Type = Rollup, and the draft PUT went out at
 * once with `{ type: 'summary' }` and no `summaryOperations`, which the server
 * saved (a roll-up that reads 0 everywhere). Now the pillar asks the spec's
 * judges before sending (`objectHeldEdit`, pinned predicate by predicate in
 * `metadataError.summaryHeld-27461.test.ts`): the edit stays dirty and unsent,
 * the held line names the field and the input it still needs, with "Show me"
 * once the field is closed, and the save goes as soon as the roll-up is one
 * the spec accepts.
 *
 * The harness is `DataPillar.heldIncomplete-11786.test.tsx`'s: a real
 * `MetadataClient` over a transport double.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

/** Every PUT the transport received, parsed. */
const puts: Array<Record<string, unknown>> = [];

const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    puts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
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

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { addFieldFromFormToolbar } from './__tests__/dataPillarAddField';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t, tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

afterEach(() => {
  cleanup();
  puts.length = 0;
  fetchImpl.mockClear();
});

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

/** The fields of the last PUT body, by name. */
function lastSentField(name: string): Record<string, unknown> | undefined {
  const fields = puts[puts.length - 1]?.fields;
  return Array.isArray(fields)
    ? (fields as Array<Record<string, unknown>>).find((f) => f.name === name)
    : (fields as Record<string, Record<string, unknown>> | undefined)?.[name];
}

/** Mount, add a field on the Form tab, and retype it; returns its API name and label. */
async function addFieldAs(typeOption: RegExp): Promise<{ name: string; label: string }> {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
  await addFieldFromFormToolbar();
  await screen.findByText('Type', { selector: 'label' }, { timeout: 4000 });
  const name = (controlUnder('API name') as HTMLInputElement).value;
  const label = (controlUnder('Label') as HTMLInputElement).value;
  expect(name, 'the new field has no API name: the harness is dead').not.toBe('');
  await userEvent.click(controlUnder('Type'));
  await userEvent.click(await screen.findByRole('option', { name: typeOption }));
  return { name, label };
}

const heldLine = (clause: string) => tFormat('engine.studio.held.line', 'en', { clause });

describe('Studio data page — a Rollup is held until it is set up (objectstack#27461)', () => {
  it('sends no save for the bare roll-up; names each missing input in turn; a count lets the save go', async () => {
    const { name, label } = await addFieldAs(/^Rollup$/);
    await outlastDebounce();

    expect(puts, 'an unconfigured roll-up is not sent').toEqual([]);
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    const message = () => within(screen.getByTestId('studio-held')).getByTestId('studio-held-message');
    const needs = (inputKey: string) =>
      heldLine(tFormat('engine.studio.held.fieldNeedsInput', 'en', { input: t(inputKey, 'en'), field: label }));
    expect(message()).toHaveTextContent(needs('designer.field.summary.object'));

    const child = controlUnder(t('designer.field.summary.object', 'en')) as HTMLInputElement;
    fireEvent.change(child, { target: { value: 'showcase_task' } });
    fireEvent.blur(child);
    await outlastDebounce();
    expect(puts, 'a child object alone is not a roll-up yet').toEqual([]);
    expect(message()).toHaveTextContent(needs('designer.field.summary.function'));

    fireEvent.keyDown(controlUnder(t('designer.field.summary.function', 'en')), { key: 'ArrowDown' });
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: t('designer.field.summary.fn.count', 'en') }),
    );
    await waitFor(() => expect(puts.length).toBe(1), { timeout: 4000 });
    expect(lastSentField(name)).toEqual(
      expect.objectContaining({ type: 'summary', summaryOperations: { object: 'showcase_task', function: 'count' } }),
    );
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
  });

  it('"Show me" on the line reopens the held roll-up once its inspector is closed', async () => {
    // The first case proves the roll-up is never sent; this one needs only the line.
    const { name } = await addFieldAs(/^Rollup$/);

    const railHeader = screen.getByText(t('engine.studio.data.fieldProps', 'en')).closest('header') as HTMLElement;
    fireEvent.click(within(railHeader).getByRole('button', { name: t('engine.studio.close', 'en') }));
    expect(screen.queryByText('API name', { selector: 'label' })).toBeNull();

    fireEvent.click(within(screen.getByTestId('studio-held')).getByRole('button', { name: t('engine.studio.refusal.show', 'en') }));
    expect(await screen.findByText('API name', { selector: 'label' })).toBeInTheDocument();
    expect((controlUnder('API name') as HTMLInputElement).value).toBe(name);
  });
});
