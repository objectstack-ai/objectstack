// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26730 — the Data strip's "Show me" ends on the input.
 *
 * Measured before this card: "Show me" opened the field (or, since
 * objectstack#26736, the action) a refusal names and stopped there, with the
 * focus left on the button. It now ends on the input the sentence names: the
 * field inspector's control for a field key, the actions panel's for an
 * action key.
 *
 * The harness is `DataPillar.actionRefusal-26736.test.tsx`'s: a real
 * `MetadataClient` over a transport whose PUT answers the dispatcher's 422
 * envelope with the issues `refuse` names, and the real registered inspectors.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const SEND = {
  name: 'showcase_task_send',
  label: 'Send',
  objectName: 'showcase_task',
  locations: ['record_more'],
  type: 'script',
  body: { language: 'expression', source: 'true' },
};
const ARCHIVE = { ...SEND, name: 'showcase_task_archive', label: 'Archive' };

let objectDef: Record<string, unknown> = {};

/** Every PUT the transport received, parsed. */
const puts: Array<Record<string, unknown>> = [];

/** The issues the server refuses every PUT with, from the body it was sent. */
let refuse: (body: Record<string, unknown>) => Array<{ path: string; message: string; code: string }> = () => [];

/** The server's answer to a PUT. */
function serverIssues(body: Record<string, unknown>): Array<{ path: string; message: string; code: string }> {
  return refuse(body);
}

const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    puts.push(body);
    const issues = serverIssues(body);
    if (issues.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            message: '[invalid_metadata] object/showcase_task failed spec validation',
            code: 422,
            details: { code: 'invalid_metadata', issues },
          },
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
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

// The Advanced views live in a Radix DropdownMenu; rendered as passthroughs,
// as in DataPillar.inspectorBelongsToView-11781.test.tsx.
type PassthroughProps = { children?: React.ReactNode; onSelect?: () => void };
vi.mock('@object-ui/components', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/components')>();
  return {
    ...mod,
    DropdownMenu: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuTrigger: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuContent: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuItem: (p: PassthroughProps) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
    DropdownMenuRadioGroup: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuRadioItem: (p: PassthroughProps) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
  };
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
  refuse = () => [];
  fetchImpl.mockClear();
});

const L = (key: string) => t(key, 'en');

/** Past the autosave's 1.5 s debounce. */
async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

async function mountOnView(def: Record<string, unknown>, tabKey: string): Promise<void> {
  objectDef = def;
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
  // The first match is the flat tab (the passthrough menu draws a second).
  fireEvent.click((await screen.findAllByRole('button', { name: L(tabKey) }))[0]);
}

/** The inspector control under a visible label. */
function controlUnder(label: string): HTMLElement {
  const lab = screen.getByText(label, { selector: 'label' });
  return lab.parentElement!.querySelector('input, textarea, [role="combobox"]') as HTMLElement;
}

/** Where the sent body keeps the field named `name`: its index, or its key. */
function fieldKeyOf(body: Record<string, unknown>, name: string): string {
  const fields = body.fields;
  if (Array.isArray(fields)) return String(fields.findIndex((f) => (f as { name?: unknown }).name === name));
  return name;
}

const TASK = { name: 'showcase_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }] };

describe('Studio data page — "Show me" puts the focus on the input the refusal names (objectstack#26730)', () => {
  it('a field\'s label: the field inspector opens with the focus on Label', async () => {
    refuse = (body) => {
      const key = fieldKeyOf(body, 'due_note');
      return key === '-1' ? [] : [{ path: `fields.${key}.label`, message: 'Too long', code: 'too_big' }];
    };
    await mountOnView(TASK, 'engine.studio.data.tab.form');
    await addFieldFromFormToolbar(undefined, { label: 'Due note' });
    await outlastDebounce();
    const strip = await screen.findByTestId('studio-refusal', undefined, { timeout: 4000 });
    expect(within(strip).getByTestId('studio-refusal-message')).toHaveTextContent(
      tFormat('engine.studio.refusal.field', 'en', { field: 'Due note' }),
    );

    // The rail's own header close (the field inspector inside carries another).
    const railHeader = screen.getByText(L('engine.studio.data.fieldProps')).closest('header') as HTMLElement;
    fireEvent.click(within(railHeader).getByRole('button', { name: L('engine.studio.close') }));
    expect(screen.queryByText(L('designer.field.label'), { selector: 'label' })).toBeNull();

    fireEvent.click(within(strip).getByRole('button', { name: L('engine.studio.refusal.show') }));
    await screen.findByText(L('designer.field.label'), { selector: 'label' }, { timeout: 4000 });
    const label = controlUnder(L('designer.field.label')) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(label));
    expect(label.value).toBe('Due note');
  });

  it('an action\'s label, from another view: the actions panel opens with the focus on it', async () => {
    refuse = (body) => {
      const actions = Array.isArray(body.actions) ? (body.actions as Array<{ name?: unknown }>) : [];
      const index = actions.findIndex((a) => a.name === SEND.name);
      return index < 0 ? [] : [{ path: `actions.${index}.label`, message: 'Too long', code: 'too_big' }];
    };
    await mountOnView({ ...TASK, actions: [ARCHIVE, SEND] }, 'engine.studio.data.tab.actions');
    // Any edit: the label of the first action, which the list selects.
    const labelInput = (await screen.findByText(L('engine.inspector.action.label'), { selector: 'label' })).parentElement!.querySelector('input')!;
    fireEvent.change(labelInput, { target: { value: 'Archive now' } });
    await outlastDebounce();
    expect(puts).toHaveLength(1);
    await screen.findByTestId('studio-refusal');

    fireEvent.click(screen.getAllByRole('button', { name: L('engine.studio.data.tab.form') })[0]);
    fireEvent.click(within(screen.getByTestId('studio-refusal')).getByRole('button', { name: L('engine.studio.refusal.show') }));
    const send = await screen.findByDisplayValue('Send', undefined, { timeout: 4000 });
    await waitFor(() => expect(document.activeElement).toBe(send));
  });
});
