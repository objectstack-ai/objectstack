// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34724 (ADR-0146 D4 as amended 2026-11-17) — a Data pillar link
 * can open an object's Actions view on one action:
 * `?surface=object:<object>&action=<name>`. Studio's landing links a
 * switched-off action that lives in its object's `actions[]` here, since such
 * an action has no item page and its switch is on the Actions view.
 *
 * On the real pillar with the real action inspector:
 *  - the link opens the object on the Actions view, the named action selected
 *    (its inspector shows its label, not the first action's);
 *  - CONTROL: the same link without `action=` opens the object on Records, as
 *    before, with no action inspector;
 *  - the param is read once: picking another view afterwards stays there;
 *  - the param leaves the URL once another object opens, so a reload or a
 *    shared copy never opens that object on an action (seat L2 S4); the first
 *    write, naming the deep-linked object, keeps it.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches `import('@objectstack/lint')`: paid here, at collection, never inside a test's clock.
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
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
  list: vi.fn(async () => [
    { name: 'showcase_task', label: 'Task' },
    { name: 'showcase_note', label: 'Note' },
  ]),
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
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

afterEach(() => {
  cleanup();
  puts.length = 0;
  fetchImpl.mockClear();
});

const L = (key: string) => t(key, 'en');

const TASK = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
  actions: [ARCHIVE, SEND],
};

/** The URL the pillar mirrored back: what a reload or a shared copy opens. */
function UrlProbe(): React.ReactElement {
  const [params] = useSearchParams();
  return <span data-testid="url">{params.toString()}</span>;
}

function mountAt(search: string): void {
  objectDef = TASK;
  render(
    <MemoryRouter initialEntries={[`/studio/com.example.showcase/data${search}`]}>
      <UrlProbe />
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
}

const labelInput = async () =>
  (await screen.findByText(L('engine.inspector.action.label'), { selector: 'label' })).parentElement!.querySelector('input')!;

describe('Studio data page — `?action=` opens the object\'s Actions view on that action (objectstack#34724)', () => {
  it('lands on the Actions view with the named action selected, not the first one', async () => {
    mountAt('?surface=object%3Ashowcase_task&action=showcase_task_send');
    expect(await labelInput()).toHaveValue('Send');
    expect(screen.queryByDisplayValue('Archive')).not.toBeInTheDocument();
  });

  it('CONTROL: without `action=` the object opens on Records, with no action inspector', async () => {
    mountAt('?surface=object%3Ashowcase_task');
    // The object loaded: its tabs are drawn.
    await screen.findAllByRole('button', { name: L('engine.studio.data.tab.actions') });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(screen.queryByText(L('engine.inspector.action.label'), { selector: 'label' })).not.toBeInTheDocument();
  });

  it('is read once: a later pick of another view stays there', async () => {
    mountAt('?surface=object%3Ashowcase_task&action=showcase_task_send');
    expect(await labelInput()).toHaveValue('Send');
    fireEvent.click(screen.getAllByRole('button', { name: L('engine.studio.data.tab.form') })[0]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(screen.queryByText(L('engine.inspector.action.label'), { selector: 'label' })).not.toBeInTheDocument();
  });

  it('drops `action=` from the URL once another object opens, and keeps it until then', async () => {
    mountAt('?surface=object%3Ashowcase_task&action=showcase_task_send');
    expect(await labelInput()).toHaveValue('Send');
    const url = () => new URLSearchParams(screen.getByTestId('url').textContent ?? '');
    // The mirror's first write names the deep-linked object: the key stays.
    expect(url().get('surface')).toBe('object:showcase_task');
    expect(url().get('action')).toBe('showcase_task_send');

    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    await waitFor(() => expect(url().get('surface')).toBe('object:showcase_note'));
    expect(url().has('action')).toBe(false);
  });
});
