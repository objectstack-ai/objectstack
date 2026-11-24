// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35650 — on the Studio design surface, an object's Actions view
 * draws a script action's refusal catalogue (`refusals`) and declared texts
 * (`texts`) with their served rows: the key-only record control and the row's
 * help text, not the raw JSON editor the bare schema gives a record.
 *
 * The real pillar with the real action inspector: the surface reads the
 * `action` type row from `/meta/types` and hands its schema and its form to the
 * Actions view. The type row is built from the spec the way the server builds
 * it (`actionForm`, `ActionSchema` through `z.toJSONSchema(…, { io: 'input' })`).
 * The only stand-ins are the metadata client's transport and the data source.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { MetadataClient } from '@object-ui/data-objectstack';
import { ActionSchema, actionForm } from '@objectstack/spec/ui';

const ACTION_JSON_SCHEMA = z.toJSONSchema(ActionSchema as unknown as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

/** The served row's help text for `key`, read off the form the server serves. */
function servedHelpText(key: string): string {
  for (const section of actionForm.sections ?? []) {
    for (const row of section.fields ?? []) {
      if (typeof row !== 'string' && row.field === key) return String(row.helpText);
    }
  }
  throw new Error(`actionForm declares no ${key} row`);
}

const SIGN = {
  name: 'showcase_task_sign',
  label: 'Sign',
  objectName: 'showcase_task',
  locations: ['record_more'],
  type: 'script',
  body: { language: 'js', source: "throw { code: 'SIGN_IN_REQUIRED' };" },
  refusals: { SIGN_IN_REQUIRED: { message: 'Sign in first.', status: 401 } },
  texts: { email_subject: { message: 'Task signed' } },
};

let objectDef: Record<string, unknown> = {};

const fetchImpl = vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } }));
const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
});

const ACTION_TYPE_ROW = {
  type: 'action',
  name: 'action',
  label: 'Action',
  domain: 'ui',
  allowEnvironmentOverlay: true,
  allowRuntimeCreate: true,
  schema: ACTION_JSON_SCHEMA,
  form: actionForm,
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client, useMetadataTypes: () => ({ entries: [ACTION_TYPE_ROW] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

// The Advanced views live in a Radix DropdownMenu; rendered as passthroughs,
// as in DataPillar.actionRefusal-26736.test.tsx.
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

async function openActionsView(): Promise<void> {
  objectDef = { name: 'showcase_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }], actions: [SIGN] };
  render(
    <StudioSaveHarness><MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar objectName="showcase_task" packageId="com.example.showcase" />
    </MemoryRouter></StudioSaveHarness>,
  );
  // The first match is the flat tab (the passthrough menu draws a second).
  fireEvent.click((await screen.findAllByRole('button', { name: t('engine.studio.data.tab.actions', 'en') }))[0]);
  await screen.findByText(t('engine.inspector.moreFields', 'en'), {}, { timeout: 8000 });

}

describe('Studio Actions view — refusals and texts take their served rows (objectstack#35650)', () => {
  it('draws each as the key-only record control with the served help text, and no raw JSON', async () => {
    await openActionsView();
    // No editor on the panel holds either record as JSON text (the raw JSON face).
    const jsonHolders = Array.from(document.querySelectorAll('textarea')).filter(
      (el) => el.value.includes('"SIGN_IN_REQUIRED"') || el.value.includes('"email_subject"'),
    );
    expect(jsonHolders).toEqual([]);
    // The served rows' help text, and the key-only control drawing each entry under its key.
    expect(screen.getByText(servedHelpText('refusals'))).toBeInTheDocument();
    expect(screen.getByText(servedHelpText('texts'))).toBeInTheDocument();
    const rows = screen.getByTestId('action-served-rows');
    expect(within(rows).getByText('SIGN_IN_REQUIRED', { selector: 'span' })).toBeInTheDocument();
    expect(within(rows).getByText('email_subject', { selector: 'span' })).toBeInTheDocument();
  });
});
