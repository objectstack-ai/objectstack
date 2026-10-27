// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26728 / objectstack#26736 — on the Studio data page, an action
 * edit no longer bricks the object's saves.
 *
 * The cards' measured cases: ticking "Expose to AI agents", or switching an
 * action's Type, wrote an action the spec refuses; the autosave sent it, the
 * server answered 422, and every later save of the object was refused until a
 * reload, with nothing on screen naming the action. Now, on the real pillar
 * with the real action inspector:
 *
 *  - a refused save is shown at the action: the strip names it, and "Show me"
 *    opens it on the Actions view, from another view too;
 *  - the editor recovers without a reload: the inspector's next write clears
 *    the refused key, the next autosave is accepted, and the strip goes;
 *  - a Type switch that leaves an input to fill is held, not refused: no save
 *    goes out, a neutral line names the input on the action, and filling it
 *    lets the save go.
 *
 * The client is a real `MetadataClient`; only the transport under it is a
 * double. The transport answers a PUT the way the server does: it parses each
 * action with the spec's `ActionSchema` and refuses the object with 422 and
 * the issues, at `actions.INDEX…`, when one fails.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';
import { ActionSchema } from '@objectstack/spec/ui';

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

/** The server's answer to a PUT: each action parsed with the spec. */
function serverIssues(body: Record<string, unknown>): Array<{ path: string; message: string; code: string }> {
  const actions = Array.isArray(body.actions) ? body.actions : [];
  return actions.flatMap((action, index) => {
    const parsed = ActionSchema.safeParse(action);
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({
          path: ['actions', index, ...issue.path].join('.'),
          message: issue.message,
          code: issue.code,
        }));
  });
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

async function pick(label: string, option: string) {
  fireEvent.keyDown(await screen.findByRole('combobox', { name: label }), { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

const lastSentAction = (name: string) =>
  (puts.at(-1)?.actions as Array<Record<string, unknown>> | undefined)?.find((a) => a.name === name);

describe('Studio data page — a refused action save is shown at the action, and recovers (objectstack#26728)', () => {
  it('names the action, opens it with "Show me" from another view, and clears once a save lands', async () => {
    // An action carrying the flat key the inspector used to write.
    await mountOnView({ name: 'showcase_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }], actions: [ARCHIVE, { ...SEND, aiExposed: true }] }, 'engine.studio.data.tab.actions');

    // Any edit: the label of the first action, which the list selects.
    const labelInput = (await screen.findByText(L('engine.inspector.action.label'), { selector: 'label' })).parentElement!.querySelector('input')!;
    fireEvent.change(labelInput, { target: { value: 'Archive now' } });
    await outlastDebounce();
    expect(puts).toHaveLength(1);

    // The refusal names the action, not "the server refused this draft".
    const strip = await screen.findByTestId('studio-refusal');
    expect(within(strip).getByTestId('studio-refusal-message')).toHaveTextContent(
      tFormat('engine.studio.refusal.action', 'en', { action: 'Send' }),
    );

    // "Show me" from another view opens the Actions view on that action.
    fireEvent.click(screen.getAllByRole('button', { name: L('engine.studio.data.tab.form') })[0]);
    fireEvent.click(within(screen.getByTestId('studio-refusal')).getByRole('button', { name: L('engine.studio.refusal.show') }));
    const expose = await screen.findByRole('checkbox', { name: L('engine.inspector.action.aiExposed') });
    expect(screen.getByDisplayValue('Send')).toBeInTheDocument();

    // Recovery without a reload: tick and untick write the spec's `ai` block
    // and clear the flat key; the next autosave is accepted, the strip goes.
    fireEvent.click(expose);
    fireEvent.click(expose);
    await outlastDebounce();
    expect(puts).toHaveLength(2);
    expect(lastSentAction('showcase_task_send')).not.toHaveProperty('aiExposed');
    expect(serverIssues(puts[1])).toEqual([]);
    await waitFor(() => expect(screen.queryByTestId('studio-refusal')).toBeNull());
  });
});

describe('Studio data page — a Type switch is held until its input is filled (objectstack#26736)', () => {
  it('script → API: no save, a neutral line naming the endpoint on the action; typing it lets the save go', async () => {
    await mountOnView({ name: 'showcase_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }], actions: [SEND] }, 'engine.studio.data.tab.actions');

    await pick(L('engine.inspector.action.type'), L('engine.inspector.action.type.api'));
    await outlastDebounce();
    expect(puts, 'an api action with no endpoint is held, not sent').toEqual([]);
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    expect(within(await screen.findByTestId('studio-held')).getByTestId('studio-held-message')).toHaveTextContent(
      tFormat('engine.studio.held.line', 'en', {
        clause: tFormat('engine.studio.held.actionNeedsInput', 'en', {
          input: L('engine.inspector.action.target.api.label'),
          action: 'Send',
        }),
      }),
    );

    const endpoint = screen.getByText(`${L('engine.inspector.action.target.api.label')} *`, { selector: 'label' }).parentElement!.querySelector('input')!;
    fireEvent.change(endpoint, { target: { value: '/api/v1/send' } });
    await outlastDebounce();
    expect(puts).toHaveLength(1);
    // The body the script had is gone with the switch, so the server accepts it.
    expect(lastSentAction('showcase_task_send')).not.toHaveProperty('body');
    expect(serverIssues(puts[0])).toEqual([]);
    expect(screen.queryByTestId('studio-held')).toBeNull();
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
  });
});
