// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11786 — on the Studio data page, the normal path through an
 * incomplete field is held, not refused.
 *
 * The card's measured cases: switching a field to Picklist drew a red refusal
 * before the options editor could be used; picking Lookup drew one before a
 * target could be picked. The object write guard refuses both bodies (by
 * design, objectui#11253 / objectui#7714), and the autosave sent them anyway, so
 * every author passed through a red strip on the ordinary path.
 *
 * Now the pillar asks the same guard BEFORE sending: such an edit stays dirty
 * and unsent, the inspector hints the input it needs, a neutral line names it
 * (with "Show me" when that input is not the one open), and completing it lets
 * the next autosave go. Errors stay for what the author finished: a server
 * refusal of a complete body still shows objectui#11785's red strip.
 *
 * The client is a real `MetadataClient`, so the door that runs the guard is the
 * production one; only the transport under it is a double, as in
 * `DataPillar.choiceWithoutOptions-11253.test.tsx`.
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
/** When set, the next PUTs are refused with this 422 envelope (a server refusal). */
let refuseWith: Record<string, unknown> | null = null;

const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    puts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    if (refuseWith) {
      return new Response(JSON.stringify(refuseWith), { status: 422, headers: { 'content-type': 'application/json' } });
    }
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
  refuseWith = null;
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

describe('Studio data page — Picklist is held until it has an option (objectui#11786)', () => {
  it('sends no save and shows no red strip; the options editor carries the hint; one option lets the save go', async () => {
    const { name, label } = await addFieldAs(/^Picklist$/);
    await outlastDebounce();

    expect(puts, 'an incomplete Picklist is not sent').toEqual([]);
    expect(screen.queryByTestId('studio-refusal'), 'no red strip on the normal path').toBeNull();
    const held = screen.getByTestId('studio-held');
    expect(within(held).getByTestId('studio-held-message')).toHaveTextContent(
      heldLine(tFormat('engine.studio.held.needsOptions', 'en', { field: label })),
    );
    // The field is the one open: the line offers no "Show me".
    expect(within(held).queryByRole('button', { name: t('engine.studio.refusal.show', 'en') })).toBeNull();
    expect(screen.getByTestId('field-held-hint')).toHaveTextContent(t('designer.field.hint.addOption', 'en'));

    fireEvent.change(screen.getByPlaceholderText(t('designer.field.optValue', 'en')), { target: { value: 'open' } });
    await waitFor(() => expect(puts.length).toBe(1), { timeout: 4000 });
    expect(lastSentField(name)).toEqual(
      expect.objectContaining({ type: 'select', options: [expect.objectContaining({ value: 'open' })] }),
    );
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
    expect(screen.queryByTestId('field-held-hint')).toBeNull();
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
  });

  it('"Show me" on the line reopens the held field once its inspector is closed', async () => {
    const { name } = await addFieldAs(/^Picklist$/);
    await outlastDebounce();

    const railHeader = screen.getByText(t('engine.studio.data.fieldProps', 'en')).closest('header') as HTMLElement;
    fireEvent.click(within(railHeader).getByRole('button', { name: t('engine.studio.close', 'en') }));
    expect(screen.queryByText('API name', { selector: 'label' })).toBeNull();

    const held = screen.getByTestId('studio-held');
    fireEvent.click(within(held).getByRole('button', { name: t('engine.studio.refusal.show', 'en') }));
    expect(await screen.findByText('API name', { selector: 'label' })).toBeInTheDocument();
    expect((controlUnder('API name') as HTMLInputElement).value).toBe(name);
    expect(puts).toEqual([]);
  });
});

describe('Studio data page — Lookup is held until it has a target (objectui#11786)', () => {
  it('sends no save and shows no red strip; the related-object picker carries the hint; a target lets the save go', async () => {
    const { name, label } = await addFieldAs(/^Lookup$/);
    await outlastDebounce();

    expect(puts, 'a Lookup with no target is not sent').toEqual([]);
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    expect(within(screen.getByTestId('studio-held')).getByTestId('studio-held-message')).toHaveTextContent(
      heldLine(tFormat('engine.studio.held.needsTarget', 'en', { field: label })),
    );
    expect(screen.getByTestId('field-held-hint')).toHaveTextContent(t('designer.field.hint.pickTarget', 'en'));

    const target = screen.getByText(t('designer.field.relatedObject', 'en'), { selector: 'label' }).parentElement!
      .querySelector('input') as HTMLInputElement;
    await userEvent.click(target);
    await userEvent.type(target, 'showcase_task');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(puts.length).toBe(1), { timeout: 4000 });
    expect(lastSentField(name)).toEqual(expect.objectContaining({ type: 'lookup', reference: 'showcase_task' }));
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
    expect(screen.queryByTestId('field-held-hint')).toBeNull();
  });
});

describe('Studio data page — complete bodies are sent as before (objectui#11786 controls)', () => {
  it('a complete edit autosaves, with no held line', async () => {
    render(
      <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
        <DataPillar packageId="com.example.showcase" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
    await addFieldFromFormToolbar();
    await waitFor(() => expect(puts.length).toBe(1), { timeout: 4000 });
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });

  it('a server refusal of a complete body still shows the red strip (objectui#11785), never the held line', async () => {
    refuseWith = {
      success: false,
      error: {
        message: '[invalid_metadata] object/showcase_task failed spec validation',
        code: 422,
        details: {
          code: 'invalid_metadata',
          issues: [{ path: 'fields.title.label', message: 'Invalid input', code: 'custom' }],
        },
      },
    };
    render(
      <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
        <DataPillar packageId="com.example.showcase" />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
    await addFieldFromFormToolbar();
    const strip = await screen.findByTestId('studio-refusal', undefined, { timeout: 4000 });
    expect(puts.length).toBe(1);
    expect(within(strip).getByTestId('studio-refusal-message')).toHaveTextContent(
      tFormat('engine.studio.refusal.field', 'en', { field: 'Title' }),
    );
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });
});
