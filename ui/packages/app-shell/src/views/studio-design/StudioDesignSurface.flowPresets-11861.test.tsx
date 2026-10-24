// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11861 — *New automation* opens on starting points, with the trigger
 * form under *Advanced*.
 *
 * The dialog asked for a name and then the Start node's whole trigger list
 * (objectui#11788). It now opens on the plain-language presets of
 * `flowPresets.ts`, the first one chosen; that trigger form is the *Advanced*
 * choice, and writes what it wrote.
 *
 * Each preset is one of the Start node's own trigger choices, written by the
 * same create path, so the pin proves a preset flow equal to the flow
 * *Advanced* writes for the same trigger — and every saved flow is judged by
 * the installed spec's `FlowSchema` and its trigger kind by the spec's own
 * `resolveFlowTriggerKind`. A record preset waits for its object: Create sends
 * nothing until one is named.
 *
 * Driven through the REAL `AutomationsPillar` and its `CreateItemDialog`; the
 * metadata client is a double that records each save.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
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
import { FLOW_PRESETS, flowPresetTrigger } from './flowPresets';
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
const ADVANCED = () => en('engine.studio.rules.advanced');

const startFields = fieldsForNodeType('start');
const startTriggerOptions = startFields.find((f) => f.id === 'triggerType')!.options!.map((o) => o.value);
/** The triggers the Start node asks an object for: its Object field's `showWhen`. */
const startWatchesObject = startFields.find((f) => f.id === 'objectName')!.showWhen!.equals;

/** Open *New automation* and name it. */
async function openNew(label: string): Promise<void> {
  fireEvent.click(await screen.findByTitle(en('engine.studio.auto.newTitle'), undefined, { timeout: 8000 }));
  fireEvent.change(await screen.findByPlaceholderText(en('engine.studio.auto.namePlaceholder')), {
    target: { value: label },
  });
}

/**
 * Pick the trigger whose value is `value` under *Advanced*, by the label the
 * trigger picker lists it under: the shared `Select` since objectui#11865.
 */
async function pickTrigger(value: string): Promise<void> {
  const label = startFields.find((f) => f.id === 'triggerType')!.options!.find((o) => o.value === value)!.label;
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Trigger' }), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: label }));
}

/** Name the object in the visible object picker (it commits on blur). */
async function pickObject(name: string): Promise<void> {
  const object = await screen.findByRole('combobox', { name: 'Object' });
  fireEvent.change(object, { target: { value: name } });
  fireEvent.blur(object);
}

function create(): void {
  fireEvent.click(screen.getByRole('button', { name: en('engine.studio.createDraft') }));
}

/** Wait for save number `n` and return its body, judged by the spec. */
async function savedBody(n: number): Promise<Record<string, unknown>> {
  await waitFor(() => expect(server.saves).toHaveLength(n), { timeout: 8000 });
  const { body } = server.saves[n - 1]!;
  const parsed = FlowSchema.safeParse(body);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  // Still born switched off (objectui#11779).
  expect(body.status).toBe('obsolete');
  return body;
}

/** The flow minus what the author typed: everything a preset or a trigger chose. */
const shapeOf = (flow: Record<string, unknown>) => {
  const { name: _name, label: _label, ...rest } = flow;
  return JSON.stringify(rest);
};

const startOf = (flow: Record<string, unknown>) =>
  (flow.nodes as Array<Record<string, unknown>>).find((n) => n.type === 'start')!;

describe('objectui#11861 — New automation opens on starting points', () => {
  it('offers 3 to 5 presets, the first chosen, and folds the trigger form under Advanced', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await openNew('Ticket done');
    expect(FLOW_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(FLOW_PRESETS.length).toBeLessThanOrEqual(5);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual([
      ...FLOW_PRESETS.map((p) => en(p.labelKey)),
      ADVANCED(),
    ]);
    expect(radios.map((r) => r.checked)).toEqual([true, ...FLOW_PRESETS.slice(1).map(() => false), false]);
    // The group says what it asks.
    expect(screen.getByRole('group', { name: en('engine.studio.auto.presets') })).toBeInTheDocument();
    // The trigger form is not on the page until Advanced is chosen.
    expect(screen.queryByRole('combobox', { name: 'Trigger' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: ADVANCED() }));
    // Nothing chosen: the picker shows "choose later".
    expect(screen.getByRole('combobox', { name: 'Trigger' }).textContent).toBe(en('engine.studio.newAutoTrigger.later'));
    // Choosing a preset again folds it away.
    fireEvent.click(screen.getByRole('radio', { name: en(FLOW_PRESETS[1].labelKey) }));
    expect(screen.queryByRole('combobox', { name: 'Trigger' })).toBeNull();
  });

  it("every preset is one of the Start node's own triggers, and only a record one waits for an object", () => {
    for (const preset of FLOW_PRESETS) {
      expect(startTriggerOptions, preset.id).toContain(preset.triggerType);
      // Which presets wait is the Start node's Object field's decision; a
      // record trigger is one it asks an object for.
      expect(startWatchesObject.includes(preset.triggerType), preset.id).toBe(preset.triggerType.startsWith('record-'));
      const waits = flowPresetTrigger(preset, startWatchesObject, '');
      expect(waits === null, preset.id).toBe(preset.triggerType.startsWith('record-'));
      expect(flowPresetTrigger(preset, startWatchesObject, ' ticket ')).toEqual(
        preset.triggerType.startsWith('record-')
          ? { triggerType: preset.triggerType, objectName: 'ticket' }
          : { triggerType: preset.triggerType },
      );
    }
  });

  it.each(FLOW_PRESETS.map((p) => [p.id, p] as const))(
    'the %s preset saves a working flow, the very flow Advanced writes for its trigger',
    async (_id, preset) => {
      render(
        <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
          <AutomationsPillar packageId={PKG} />
        </MemoryRouter>,
      );
      const watches = startWatchesObject.includes(preset.triggerType);

      // Through the preset.
      await openNew('From the preset');
      fireEvent.click(screen.getByRole('radio', { name: en(preset.labelKey) }));
      if (watches) await pickObject('ticket');
      create();
      const viaPreset = await savedBody(1);
      expect(startOf(viaPreset).config).toEqual(
        watches ? { triggerType: preset.triggerType, objectName: 'ticket' } : { triggerType: preset.triggerType },
      );
      // A trigger the platform binds wherever it is installed: a record change,
      // or none (started by a button or another flow). Never a schedule, a
      // time-relative sweep or an inbound hook — see `flowPresets.ts`.
      expect(resolveFlowTriggerKind(viaPreset)).toBe(watches ? 'record_change' : undefined);
      // No step and no script: the Start node and the End node.
      expect((viaPreset.nodes as Array<{ type: string }>).map((n) => n.type)).toEqual(['start', 'end']);

      // Through Advanced, with the same trigger and object.
      await openNew('From advanced');
      fireEvent.click(screen.getByRole('radio', { name: ADVANCED() }));
      await pickTrigger(preset.triggerType);
      if (watches) await pickObject('ticket');
      create();
      const viaAdvanced = await savedBody(2);
      expect(shapeOf(viaPreset)).toBe(shapeOf(viaAdvanced));
    },
  );

  it('a record preset with no object sends nothing and says what it needs, until the object is named', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await openNew('Ticket opened');
    const first = FLOW_PRESETS[0];
    expect(startWatchesObject).toContain(first.triggerType);
    expect(screen.queryByText(en('engine.studio.auto.preset.needsObject'))).toBeNull();
    create();
    expect(await screen.findByText(en('engine.studio.auto.preset.needsObject'))).toBeInTheDocument();
    // Held: nothing reached the server, and the dialog is still open.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(server.saves).toHaveLength(0);
    expect(screen.getByRole('radio', { name: en(first.labelKey) })).toBeChecked();

    await pickObject('ticket');
    expect(screen.queryByText(en('engine.studio.auto.preset.needsObject'))).toBeNull();
    create();
    const body = await savedBody(1);
    expect(startOf(body).config).toEqual({ triggerType: first.triggerType, objectName: 'ticket' });
  });

  it("Advanced, left on its first choice, writes objectui#11788's blank flow byte for byte — the control", async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await openNew('Decide later');
    fireEvent.click(screen.getByRole('radio', { name: ADVANCED() }));
    create();
    const body = await savedBody(1);
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({
        name: 'decide_later',
        label: 'Decide later',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: en('engine.studio.auto.nodeStart') },
          { id: 'end', type: 'end', label: en('engine.studio.auto.nodeEnd') },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
        status: 'obsolete',
      }),
    );
    expect(resolveFlowTriggerKind(body)).toBeUndefined();
  });
});
