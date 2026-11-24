// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36725 — on the Studio design surface, an object's Hooks view
 * draws a hook's refusal catalogue (`refusals`) and declared texts (`texts`)
 * with their served rows: the key-only record control and the row's help
 * text, not the raw JSON editor the bare schema gives a record.
 *
 * The real pillar with the real hook inspector: the surface reads the `hook`
 * type row from `/meta/types` and hands its schema and its form to the Hooks
 * view. The type row is built from the spec the way the server builds it
 * (`hookForm`, `HookSchema` through `z.toJSONSchema(…, { io: 'input' })`). The
 * only stand-ins are the metadata client's transport and the data source.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { MetadataClient } from '@object-ui/data-objectstack';
import { HookSchema, hookForm } from '@objectstack/spec/data';

const HOOK_JSON_SCHEMA = z.toJSONSchema(HookSchema as unknown as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

/** The served row's help text for `key`, read off the form the server serves. */
function servedHelpText(key: string): string {
  for (const section of hookForm.sections ?? []) {
    for (const row of section.fields ?? []) {
      if (typeof row !== 'string' && row.field === key) return String(row.helpText);
    }
  }
  throw new Error(`hookForm declares no ${key} row`);
}

const LOCK = {
  name: 'showcase_task_lock',
  label: 'Lock signed tasks',
  object: 'showcase_task',
  events: ['beforeUpdate'],
  body: { language: 'js', source: "throw { code: 'CONTRACT_LOCKED' };" },
  refusals: { CONTRACT_LOCKED: { message: 'A signed task is locked.', status: 409 } },
  texts: { follow_up_subject: { message: 'Follow up on the task' } },
};

const objectDef = { name: 'showcase_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }] };

const fetchImpl = vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } }));
const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  list: vi.fn(async (type: string) => (type === 'hook' ? [LOCK] : [{ name: 'showcase_task', label: 'Task' }])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
});

const HOOK_TYPE_ROW = {
  type: 'hook',
  name: 'hook',
  label: 'Hook',
  domain: 'data',
  allowEnvironmentOverlay: true,
  allowRuntimeCreate: true,
  schema: HOOK_JSON_SCHEMA,
  form: hookForm,
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client, useMetadataTypes: () => ({ entries: [HOOK_TYPE_ROW] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

// The Advanced views live in a Radix DropdownMenu; rendered as passthroughs,
// as in DataPillar.actionServedRows-35650.test.tsx.
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

// The source reaches a dynamic import of it: its first load is paid at collection (`check:test-source-alias`).
import '@objectstack/lint';
import { DataPillar } from './StudioDesignSurface';
import { StudioSaveHarness } from './__tests__/studioSaveHarness';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

afterEach(() => {
  cleanup();
  fetchImpl.mockClear();
});

async function openHook(): Promise<void> {
  render(
    <StudioSaveHarness><MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar objectName="showcase_task" packageId="com.example.showcase" />
    </MemoryRouter></StudioSaveHarness>,
  );
  // The first match is the flat tab (the passthrough menu draws a second).
  fireEvent.click((await screen.findAllByRole('button', { name: t('engine.studio.data.tab.hooks', 'en') }))[0]);
  fireEvent.click(await screen.findByRole('button', { name: LOCK.label }, { timeout: 8000 }));
  await screen.findByText(t('engine.inspector.moreFields', 'en'), {}, { timeout: 8000 });
}

describe('Studio Hooks view — refusals and texts take their served rows (objectstack#36725)', () => {
  it('draws each as the key-only record control with the served help text, and no raw JSON', async () => {
    await openHook();
    // No editor on the panel holds either record as JSON text (the raw JSON face).
    const jsonHolders = Array.from(document.querySelectorAll('textarea')).filter(
      (el) => el.value.includes('"CONTRACT_LOCKED"') || el.value.includes('"follow_up_subject"'),
    );
    expect(jsonHolders).toEqual([]);
    // The served rows' help text, and the key-only control drawing each entry under its key.
    expect(screen.getByText(servedHelpText('refusals'))).toBeInTheDocument();
    expect(screen.getByText(servedHelpText('texts'))).toBeInTheDocument();
    const rows = screen.getByTestId('hook-served-rows');
    expect(within(rows).getByText('CONTRACT_LOCKED', { selector: 'span' })).toBeInTheDocument();
    expect(within(rows).getByText('follow_up_subject', { selector: 'span' })).toBeInTheDocument();
  });
});
