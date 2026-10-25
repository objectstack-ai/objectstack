// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11788 — *New automation* asks for the trigger.
 *
 * The dialog asked only for a name; the trigger was found later inside the
 * Start node. The choices it now offers are the Start node's own trigger field
 * (`fieldsForNodeType('start')`, localized the way the inspector localizes it),
 * the object picker appears for exactly the triggers the Start node shows its
 * Object field for (that field's `showWhen`), and the choice is written where
 * the Start node's field writes it: `config.triggerType` and `config.objectName`
 * on the Start node. Leaving it unset saves the skeleton as before — the
 * control.
 *
 * Driven through the REAL `AutomationsPillar` and its `CreateItemDialog`; the
 * metadata client is a double that records each save. Every saved flow is
 * judged by the installed spec's `FlowSchema`, and its trigger kind by the
 * spec's own `resolveFlowTriggerKind` — the question the engine asks before it
 * binds a trigger.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FlowSchema, resolveFlowTriggerKind } from '@objectstack/spec/automation';

const PKG = 'com.acme.helpdesk';

const server = vi.hoisted(() => ({
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown> }>,
}));

const mockClient = vi.hoisted(() => {
  const client: Record<string, unknown> = {
    list: vi.fn(async (type: string) => (type === 'object' ? [{ name: 'ticket', label: 'Ticket' }] : [])),
    listDrafts: vi.fn(async () => []),
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
  // The shared object picker reads its catalog through the draft-aware view.
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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { t } from '../metadata-admin/i18n';
import { fieldsForNodeType } from '../metadata-admin/inspectors/flow-node-config';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

beforeEach(() => {
  server.saves.length = 0;
  // Every network read this pillar makes outside the client double answers
  // 404 — the runtime-status read included: these cases judge the save.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const en = (key: string) => t(key, 'en');

function renderPillar() {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} />
    </MemoryRouter>,
  );
}

/**
 * Open *New automation*, name it, and return the dialog's trigger picker —
 * under *Advanced* since objectui#11861, where the dialog's presets put it.
 * The picker is the shared `Select` since objectui#11865.
 */
async function openNew(label: string): Promise<HTMLElement> {
  renderPillar();
  fireEvent.click(await screen.findByTitle(en('engine.studio.auto.newTitle'), undefined, { timeout: 8000 }));
  fireEvent.change(await screen.findByPlaceholderText(en('engine.studio.auto.namePlaceholder')), {
    target: { value: label },
  });
  fireEvent.click(screen.getByRole('radio', { name: en('engine.studio.rules.advanced') }));
  return screen.getByRole('combobox', { name: 'Trigger' });
}

/** The Start node's own trigger choices, as the dialog lists them in English. */
const startOptions = () => fieldsForNodeType('start').find((f) => f.id === 'triggerType')!.options!;

/** Open the trigger picker and return its listbox. */
async function openTriggerList(trigger: HTMLElement): Promise<HTMLElement> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return await screen.findByRole('listbox');
}

/** Pick the trigger whose value is `value`, by the label the picker lists it under. */
async function pickTrigger(trigger: HTMLElement, value: string): Promise<void> {
  const label = startOptions().find((o) => o.value === value)!.label;
  fireEvent.click(within(await openTriggerList(trigger)).getByRole('option', { name: label }));
}

async function submitAndReadSave(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole('button', { name: en('engine.studio.createDraft') }));
  await waitFor(() => expect(server.saves).toHaveLength(1), { timeout: 8000 });
  const { body } = server.saves[0]!;
  const parsed = FlowSchema.safeParse(body);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  // Still born switched off (objectui#11779).
  expect(body.status).toBe('obsolete');
  return body;
}

const startOf = (flow: Record<string, unknown>) =>
  (flow.nodes as Array<Record<string, unknown>>).find((n) => n.type === 'start')!;

describe('objectui#11788 — New automation asks for the trigger', () => {
  it('offers the Start node\'s own triggers, after a "choose later" first choice', async () => {
    const trigger = await openNew('Ticket done');
    // "Choose later" is what the picker shows, and the list's first choice.
    expect(trigger.textContent).toBe(en('engine.studio.newAutoTrigger.later'));
    const offered = within(await openTriggerList(trigger))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(offered).toEqual([en('engine.studio.newAutoTrigger.later'), ...startOptions().map((o) => o.label)]);
  });

  it('a record trigger asks for its object and is saved on the Start node, binding as a record change', async () => {
    const trigger = await openNew('Ticket done');
    expect(screen.queryByRole('combobox', { name: 'Object' })).toBeNull();
    await pickTrigger(trigger, 'record-after-update');
    const object = await screen.findByRole('combobox', { name: 'Object' });
    fireEvent.change(object, { target: { value: 'ticket' } });
    fireEvent.blur(object);
    const body = await submitAndReadSave();
    expect(startOf(body).config).toEqual({ triggerType: 'record-after-update', objectName: 'ticket' });
    expect(resolveFlowTriggerKind(body)).toBe('record_change');
  });

  it('a trigger that watches no object shows no object picker and saves the trigger alone', async () => {
    const trigger = await openNew('Run by hand');
    await pickTrigger(trigger, 'manual');
    expect(screen.queryByRole('combobox', { name: 'Object' })).toBeNull();
    const body = await submitAndReadSave();
    expect(startOf(body).config).toEqual({ triggerType: 'manual' });
  });

  it('left unset, the skeleton is saved as before: a Start node with no config — the control', async () => {
    await openNew('Decide later');
    const body = await submitAndReadSave();
    expect(startOf(body)).not.toHaveProperty('config');
    expect(resolveFlowTriggerKind(body)).toBeUndefined();
  });
});
