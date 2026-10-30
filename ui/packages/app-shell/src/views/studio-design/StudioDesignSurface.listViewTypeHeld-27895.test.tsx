// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27895 — an edit that clears a required setting of a list view's
 * own type block (a calendar's start date) is held, not sent, as the pillar
 * holds every edit the spec refuses only for an unset input
 * (objectstack#27784, objectstack#27785): the draft door would refuse it with
 * a 422, and every later save with it.
 *
 * Through the mounted Interfaces pillar, its real list-view autosave and the
 * real panel; the client is a recorder.
 *
 * Pinned:
 *  - clearing the calendar's start date writes nothing, and the held line
 *    names the setting; its "Show me" focuses that setting's control;
 *  - picking a start date again sends the view, spec-valid, and the line goes;
 *  - CONTROL: an edit that leaves the block complete is sent at once, with no
 *    held line.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { ViewItemSchema } from '@objectstack/spec/ui';

const OBJECT_DEF = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
    due_date: { name: 'due_date', label: 'Due date', type: 'date' },
    start_date: { name: 'start_date', label: 'Start date', type: 'date' },
  },
};

const NAV = [
  { id: 'nav_obj', type: 'object', label: 'Tasks', objectName: 'showcase_task' },
];

/** The object's default list view: a calendar, as "Add view" creates one. */
const CALENDAR_VIEW = {
  name: 'showcase_task.default',
  object: 'showcase_task',
  viewKind: 'list',
  label: 'Due dates',
  isDefault: true,
  config: {
    type: 'calendar',
    data: { provider: 'object', object: 'showcase_task' },
    columns: ['title', 'status'],
    calendar: { startDateField: 'due_date', titleField: 'title' },
  },
};

let views: Record<string, Record<string, unknown>> = {};

const mockClient = {
  save: vi.fn(async (..._args: unknown[]) => ({ success: true, version: 'v1', state: 'draft' })),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'object') return [{ name: 'showcase_task', label: 'Task' }];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'object') return { effective: OBJECT_DEF, code: OBJECT_DEF };
    if (type === 'view') {
      const row = views[name];
      return row ? { code: null, overlay: row, overlayScope: 'env', effective: row } : { code: null, overlay: null, overlayScope: null, effective: null };
    }
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async (type: string) => (type === 'object' ? OBJECT_DEF : undefined)),
  withPreviewDrafts() { return this; },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';
import { t, tFormat } from '../metadata-admin/i18n';

/** Stands in for `plugin-view`'s `object-view`, recording the schema the canvas hands it. */
function ObjectViewRecorder({ schema }: { schema: Record<string, unknown> }) {
  return <pre data-testid="object-view-schema">{JSON.stringify(schema)}</pre>;
}

const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_DEF],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
};

beforeAll(() => {
  ComponentRegistry.register('object-view', ObjectViewRecorder as never, { namespace: 'plugin-view' });
});
beforeEach(() => {
  views = { 'showcase_task.default': CALENDAR_VIEW };
  mockClient.save.mockClear();
});
afterEach(cleanup);

function mountPillar(readOnly = false) {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <MetadataCtx.Provider value={METADATA}>
        <InterfacesPillar packageId="com.acme.app" readOnly={readOnly} />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

async function openObjectLeaf(readOnly = false) {
  mountPillar(readOnly);
  fireEvent.click(await screen.findByTitle('object · showcase_task'));
  return screen.findByTestId('studio-list-view-inspector', undefined, { timeout: 8000 });
}


const START = 'Start Date Field';

function viewSaves(): Array<[string, string, Record<string, unknown>, Record<string, unknown>]> {
  return mockClient.save.mock.calls.filter((c) => c[0] === 'view') as never;
}

function setting(key: string): HTMLElement {
  const control = document.getElementById(`mdf-studio-list-view-calendar.${key}`);
  if (!control) throw new Error(`no calendar.${key} setting`);
  return control;
}

/** Pick the option `text` of the calendar setting `key`, the way an author does. */
async function pick(key: string, text: string) {
  await waitFor(() => expect(setting(key)).toBeEnabled());
  fireEvent.keyDown(setting(key), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const hit = within(listbox)
    .getAllByRole('option')
    .find((o) => (o.querySelector('code')?.previousElementSibling?.textContent ?? o.textContent) === text);
  if (!hit) throw new Error(`calendar.${key} lists no "${text}"`);
  fireEvent.click(hit);
}

const heldClause = () =>
  tFormat('engine.studio.held.line', 'en', {
    clause: tFormat('engine.studio.held.listViewTypeNeedsInput', 'en', {
      input: START,
      type: t('engine.inspector.view.type.calendar', 'en'),
    }),
  });

describe('a list view whose type block lacks a required setting is held, not sent (objectstack#27895)', () => {
  it('clearing the calendar’s start date writes nothing, and the held line names it; "Show me" focuses it', async () => {
    await openObjectLeaf();
    await waitFor(() => expect(setting('startDateField')).toHaveTextContent('Due date'));

    await pick('startDateField', t('engine.form.none', 'en'));
    const held = await screen.findByTestId('studio-held');
    expect(within(held).getByTestId('studio-held-message')).toHaveTextContent(heldClause());
    await new Promise((r) => setTimeout(r, 2500));
    expect(viewSaves()).toEqual([]);

    fireEvent.click(within(held).getByRole('button', { name: t('engine.studio.refusal.show', 'en') }));
    await waitFor(() => expect(document.activeElement).toBe(setting('startDateField')));
  });

  it('picking a start date again sends the view, spec-valid, and the held line goes', async () => {
    await openObjectLeaf();
    await waitFor(() => expect(setting('startDateField')).toHaveTextContent('Due date'));
    await pick('startDateField', t('engine.form.none', 'en'));
    await screen.findByTestId('studio-held');

    await pick('startDateField', 'Start date');
    await waitFor(() => expect(viewSaves().length).toBeGreaterThan(0), { timeout: 8000 });
    const [, name, body] = viewSaves().at(-1)!;
    expect(name).toBe('showcase_task.default');
    expect((body.config as Record<string, unknown>).calendar).toEqual({ startDateField: 'start_date', titleField: 'title' });
    const parsed = ViewItemSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
  });

  it('CONTROL: an edit that leaves the block complete is sent at once, with no held line', async () => {
    await openObjectLeaf();
    await waitFor(() => expect(setting('startDateField')).toHaveTextContent('Due date'));
    await pick('startDateField', 'Start date');
    await waitFor(() => expect(viewSaves().length).toBeGreaterThan(0), { timeout: 8000 });
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });
});
