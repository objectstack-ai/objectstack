// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design surface's own pickers are the shared `Select` (objectui#11865).
 *
 * `StudioDesignSurface` drew its pickers as browser-native selects, beside
 * the shared Radix `Select` the rest of Studio picks with. This suite covers
 * the two the surface still draws: *New object*'s record sharing (OWD) and
 * *New automation*'s trigger. (The Interfaces nav-item inspector's *Link
 * object*, target and *Open in* pickers were pinned here too, until
 * objectstack#36502 retired that pillar and its inspector.)
 *
 * What is pinned:
 *   - each picker IS the primitive (a Radix combobox trigger), shows what the
 *     dialog holds, and no native select is left;
 *   - each picker keeps the accessible name the native control had;
 *   - every option of every picker writes what the native control wrote: the
 *     *New object* save and the *New automation* save as JSON text;
 *   - the keyboard alone opens a picker and selects.
 *
 * Read-only: neither picker has such a state. A read-only package offers no
 * *New object* (`StudioDesignSurface.emptyPackage`, "hides the CTA on a
 * read-only package"). The Automations rail's *New* is gated on the same
 * `readOnly` in the source; no suite pins that one.
 *
 * DIRECTION, observed against the native controls: every pin here but two
 * is red there, because each one reads a picker as the primitive's trigger.
 * The two green there too pin what the conversion kept: the trigger picker's
 * name, and the record sharing default saved untouched. What makes the write
 * pins guards of "the conversion changed nothing the surface writes" is the
 * literal each compares against: a `change` event on the pre-conversion
 * surface's native control wrote that same value, read once on that
 * component with these fixtures, and so were the names.
 */

// Warmed at module top so the first load of the console's lazily loaded
// authoring code is paid during collection, not inside a test's clock.
import '@objectstack/lint';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const server = vi.hoisted(() => ({
  rows: [] as Array<{ type: string; pkg: string; item: Record<string, unknown> }>,
  draftHeaders: [] as Array<{ type: string; packageId: string; name: string }>,
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown> }>,
}));

const mockClient = vi.hoisted(() => {
  const client: Record<string, unknown> = {
    list: vi.fn(async (type: string, options?: { packageId?: string }) =>
      server.rows
        .filter((r) => r.type === type && (!options?.packageId || r.pkg === options.packageId))
        .map((r) => JSON.parse(JSON.stringify(r.item)) as Record<string, unknown>),
    ),
    listDrafts: vi.fn(async (options?: { packageId?: string; type?: string }) =>
      server.draftHeaders
        .filter((d) => (!options?.type || d.type === options.type) && (!options?.packageId || d.packageId === options.packageId))
        .map((d) => ({ name: d.name, packageId: d.packageId })),
    ),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: null, editable: true, deletable: true, resettable: false, lock: 'none' })),
    getDraft: vi.fn(async (type: string, name: string) => {
      const hit = server.saves.find((s) => s.type === type && s.name === name);
      if (hit) return { item: JSON.parse(JSON.stringify(hit.body)) };
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      server.saves.push({ type, name, body: JSON.parse(JSON.stringify(item)) as Record<string, unknown> });
      return { type, name, item };
    }),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
  // The flow dialog's object picker reads its catalog through the draft-aware view.
  client.withPreviewDrafts = () => client;
  return client;
});

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
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

import { DataPillar } from './StudioDesignSurface';
import { ListFlowCreate } from './__tests__/listFlowCreateHost';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { t } from '../metadata-admin/i18n';
// The source under test reaches these dynamic imports (the command palette's
// record preview, the drafts panel's lint, the code editor): their first load
// is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@object-ui/plugin-detail';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

const en = (key: string) => t(key, 'en');

beforeEach(() => {
  server.rows = [];
  server.draftHeaders = [];
  server.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as { mockClear?: () => void }).mockClear?.();
  // No read here goes out over the global `fetch`; one double answers "absent".
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Open a picker from the keyboard and return its listbox. */
async function openList(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return await screen.findByRole('listbox');
}

/** The options an open picker lists, in order, once `waitFor` is among them. */
async function listed(trigger: HTMLElement, waitFor?: string): Promise<string[]> {
  const listbox = await openList(trigger);
  if (waitFor) await within(listbox).findByRole('option', { name: waitFor }, { timeout: 8000 });
  return within(listbox)
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');
}

/** Pick the option labelled `label`, waiting for a package list to offer it. */
async function pick(trigger: HTMLElement, label: string): Promise<void> {
  const listbox = await openList(trigger);
  fireEvent.click(await within(listbox).findByRole('option', { name: label }, { timeout: 8000 }));
}

// ---------------------------------------------------------------------------
// New object: record sharing (OWD)
// ---------------------------------------------------------------------------

const OWD_PRIVATE = en('engine.studio.settings.sharingPrivate');
const OWD_PUBLIC_READ = en('engine.studio.settings.sharingPublicRead');
const OWD_PUBLIC_READ_WRITE = en('engine.studio.settings.sharingPublicReadWrite');

/** The name the native control had: its wrapping label's whole text, the gloss of the chosen model included. */
const owdName = (descKey: string) =>
  `${en('engine.studio.data.owdLabel')} ${en(descKey)} ${en('engine.studio.data.owdHint')}`;

/** The package the base reading of these saves was taken in. */
const OBJECT_PKG = 'com.test.crmext';

async function openNewObject(): Promise<HTMLElement> {
  // An empty package: the pillar offers *New object* from its empty state.
  server.rows = [];
  render(
    <MemoryRouter initialEntries={[`/studio/${OBJECT_PKG}/data`]}>
      <DataPillar packageId={OBJECT_PKG} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTestId('empty-state-new-object', undefined, { timeout: 8000 }));
  return await screen.findByTestId('create-object-owd');
}

/** Name the object, submit, and return the JSON text of the one save call. */
async function submitObject(): Promise<string> {
  const dialog = screen.getByRole('dialog');
  fireEvent.change(dialog.querySelectorAll('input')[0], { target: { value: 'Visit' } });
  fireEvent.click(within(dialog).getByRole('button', { name: en('engine.studio.createLive') }));
  await waitFor_(() => expect(mockClient.save).toHaveBeenCalledTimes(1));
  return JSON.stringify((mockClient.save as ReturnType<typeof vi.fn>).mock.calls[0]);
}

/**
 * [option label, the JSON text of the save the create made]. The create is the
 * first-write pin, `ifNoneMatch: '*'` (objectui#11773).
 */
const OWD_WRITES: ReadonlyArray<readonly [string, string]> = [
  [OWD_PRIVATE, '["object","visit",{"name":"visit","label":"Visit","sharingModel":"private","fields":{"name":{"type":"text","label":"Name"}}},{"mode":"draft","packageId":"com.test.crmext","ifNoneMatch":"*","surface":"studio"}]'],
  [OWD_PUBLIC_READ, '["object","visit",{"name":"visit","label":"Visit","sharingModel":"public_read","fields":{"name":{"type":"text","label":"Name"}}},{"mode":"draft","packageId":"com.test.crmext","ifNoneMatch":"*","surface":"studio"}]'],
  [OWD_PUBLIC_READ_WRITE, '["object","visit",{"name":"visit","label":"Visit","sharingModel":"public_read_write","fields":{"name":{"type":"text","label":"Name"}}},{"mode":"draft","packageId":"com.test.crmext","ifNoneMatch":"*","surface":"studio"}]'],
];

describe('New object picks its record sharing with the shared Select (objectui#11865)', () => {
  it('the picker is the Radix combobox trigger, on the recommended default, and no native select is left', async () => {
    const trigger = await openNewObject();
    expect(screen.getByRole('dialog').querySelector('select')).toBeNull();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger.textContent).toBe(OWD_PRIVATE);
    expect(await listed(trigger)).toEqual([OWD_PRIVATE, OWD_PUBLIC_READ, OWD_PUBLIC_READ_WRITE]);
  });

  // The two names were read on the native control; red there only because the second is read after a pick in the list.
  it('keeps the name its wrapping label gave the native control, the chosen model’s gloss included', async () => {
    const trigger = await openNewObject();
    expect(trigger).toHaveAccessibleName(owdName('engine.studio.settings.sharingDescPrivate'));
    await pick(trigger, OWD_PUBLIC_READ);
    expect(screen.getByTestId('create-object-owd')).toHaveAccessibleName(owdName('engine.studio.settings.sharingDescPublicRead'));
  });

  it.each(OWD_WRITES.map((row) => [`→ ${row[0]}`, ...row] as const))('%s', async (_name, label, json) => {
    const trigger = await openNewObject();
    await pick(trigger, label);
    expect(await submitObject()).toBe(json);
  });

  it('left untouched, the default is saved, as before', async () => {
    await openNewObject();
    expect(await submitObject()).toBe(OWD_WRITES[0][1]);
  });
});

// ---------------------------------------------------------------------------
// New automation: the trigger, under Advanced
// ---------------------------------------------------------------------------

const LATER = en('engine.studio.newAutoTrigger.later');

async function openNewFlow(): Promise<HTMLElement> {
  server.rows = [{ type: 'object', pkg: PKG, item: { name: 'ticket', label: 'Ticket' } }];
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/metadata/flow`]}>
      <ListFlowCreate packageId={PKG} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTitle(en('engine.studio.auto.newTitle'), undefined, { timeout: 8000 }));
  fireEvent.change(await screen.findByPlaceholderText(en('engine.studio.auto.namePlaceholder')), {
    target: { value: 'Probe' },
  });
  fireEvent.click(screen.getByRole('radio', { name: en('engine.studio.rules.advanced') }));
  return screen.getByTestId('create-flow-trigger');
}

/** Submit and return the JSON text of the saved flow. */
async function submitFlow(): Promise<string> {
  fireEvent.click(screen.getByRole('button', { name: en('engine.studio.createLive') }));
  await waitFor_(() => expect(server.saves).toHaveLength(1));
  return JSON.stringify(server.saves[0].body);
}

const flowWith = (config: string) =>
  `{"name":"probe","label":"Probe","type":"autolaunched","nodes":[{"id":"start","type":"start","label":"Start"${config}},{"id":"end","type":"end","label":"End"}],"edges":[{"id":"e1","source":"start","target":"end"}],"status":"obsolete"}`;

/** [option label, the JSON text of the flow the create saved, no object named]. */
const TRIGGER_WRITES: ReadonlyArray<readonly [string, string]> = [
  [LATER, flowWith('')],
  ['Record created', flowWith(',"config":{"triggerType":"record-after-create"}')],
  ['Record updated', flowWith(',"config":{"triggerType":"record-after-update"}')],
  ['Record created or updated', flowWith(',"config":{"triggerType":"record-after-write"}')],
  ['Record before update', flowWith(',"config":{"triggerType":"record-before-update"}')],
  ['Record deleted', flowWith(',"config":{"triggerType":"record-after-delete"}')],
  ['Schedule', flowWith(',"config":{"triggerType":"schedule"}')],
  ['Time-relative (date sweep)', flowWith(',"config":{"triggerType":"time_relative"}')],
  ['Manual / autolaunched', flowWith(',"config":{"triggerType":"manual"}')],
  ['Webhook / API', flowWith(',"config":{"triggerType":"api"}')],
];

describe('New automation picks its trigger with the shared Select (objectui#11865)', () => {
  it('the picker is the Radix combobox trigger, on "choose later", and no native select is left', async () => {
    const trigger = await openNewFlow();
    expect(screen.getByRole('dialog').querySelector('select')).toBeNull();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('role', 'combobox');
    expect(trigger.textContent).toBe(LATER);
    expect(await listed(trigger)).toEqual(TRIGGER_WRITES.map((row) => row[0]));
  });

  // Green against the native control too, by design: it pins what the conversion kept.
  it('keeps the name its wrapping label gave the native control', async () => {
    const trigger = await openNewFlow();
    expect(screen.getByRole('combobox', { name: 'Trigger' })).toBe(trigger);
  });

  it.each(TRIGGER_WRITES.map((row) => [`→ ${row[0]}`, ...row] as const))('%s', async (_name, label, json) => {
    const trigger = await openNewFlow();
    await pick(trigger, label);
    expect(await submitFlow()).toBe(json);
  });

  it('Enter opens the picker and Enter on an option selects it', async () => {
    const trigger = await openNewFlow();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.keyDown(within(listbox).getByRole('option', { name: 'Manual / autolaunched' }), { key: 'Enter' });
    expect(await submitFlow()).toBe(flowWith(',"config":{"triggerType":"manual"}'));
  });
});

/** `waitFor` with the slow-box budget this file's other waits use. */
function waitFor_(assertion: () => void): Promise<void> {
  return waitFor(assertion, { timeout: 8000 });
}
