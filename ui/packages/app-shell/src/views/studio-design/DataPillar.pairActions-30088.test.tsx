// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30088 (ADR-0146 D3) — Studio adds an action to a read-only
 * base's object, saved as its own `action` item in the base's paired
 * `<base>.custom` package.
 *
 * The REAL `DataPillar`, the REAL Actions view and the REAL action editor,
 * over a metadata client double. The customization the surface hands the
 * pillar is built here: its `ensure` is the ensure door.
 *
 * Pinned:
 *  - the Actions view of a read-only base's object offers New, with the same
 *    presets, once the base has or can get its pair; a preset writes nothing
 *    until the top bar's Save, which writes a new `action` item into the pair
 *    as a draft (`objectName` = the object, `ifNoneMatch: '*'`), asking the
 *    ensure door, then publishes that one action at the pair
 *    (objectstack#36511), and the object is not written;
 *  - the vendor's actions stay read-only (no Delete, the editor disabled);
 *    the added one carries the "added" mark, an edit is sent by Save into the
 *    pair's draft and published, and Delete takes the row off the page, its
 *    draft and its published row at the pair going with the next Save;
 *  - "only customizations" counts the added action and narrows the list to it;
 *  - walled: no New, and the pair's action opens read-only;
 *  - CONTROL: on a writable package an action is still written into the
 *    object draft (`actions`), and nothing is asked of the ensure door.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const BASE = 'com.example.crm';
const PAIR = 'com.example.crm.custom';
const OBJECT = 'crm_lead';

/** The vendor's action, served on the object. */
const VENDOR = {
  name: 'crm_lead_convert',
  label: 'Convert',
  objectName: OBJECT,
  locations: ['record_header'],
  type: 'script',
  body: { language: 'expression', source: 'true' },
};

/** An action the pair already holds on the object: published, and with a pending draft. */
const KEPT = {
  name: 'crm_lead_action_7',
  label: 'Qualify',
  objectName: OBJECT,
  locations: ['record_more'],
  operation: 'update',
  patch: { status: 'qualified' },
};

const srv = vi.hoisted(() => ({
  /** The pair's published actions (every object's). */
  pairPublished: [] as Array<Record<string, unknown>>,
  /** The pair's pending action drafts, by name. */
  pairDrafts: {} as Record<string, Record<string, unknown>>,
  /**
   * objectstack#35054 — what the pair's layered read serves for an action, by
   * name, where it differs from the served reads above (which are then the
   * translated copies). `draft: undefined` serves no `draft` key at all.
   */
  stored: {} as Record<string, { published: Record<string, unknown> | null; draft?: Record<string, unknown> | null }>,
}));

const servedObject = () => ({
  name: OBJECT,
  label: 'Lead',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { label: 'New', value: 'new' },
        { label: 'Qualified', value: 'qualified' },
      ],
    },
  },
  // The published pair action is served folded into the object, under the pair.
  actions: [VENDOR, ...srv.pairPublished.filter((a) => a.objectName === OBJECT).map((a) => ({ ...a, _packageId: PAIR }))],
});

const mockClient = {
  list: vi.fn(async (type: string, opts?: { packageId?: string }) => {
    if (type === 'action') return opts?.packageId === PAIR ? srv.pairPublished.map((a) => ({ ...a, _packageId: PAIR })) : [];
    if (type === 'object') return opts?.packageId === PAIR ? [] : [{ name: OBJECT, label: 'Lead' }];
    return [];
  }),
  listDrafts: vi.fn(async (opts?: { packageId?: string; type?: string }) =>
    opts?.type === 'action' && opts.packageId === PAIR
      ? Object.keys(srv.pairDrafts).map((name) => ({ type: 'action', name }))
      : [],
  ),
  layered: vi.fn(async (type: string, name: string, opts?: { packageId?: string }) => {
    if (type === 'action' && opts?.packageId === PAIR) {
      // The pair's action as stored: by default the served rows (no translation in play).
      const own = srv.stored[name];
      if (own) {
        const layers: Record<string, unknown> = { code: null, overlay: own.published, effective: own.published };
        if ('draft' in own) layers.draft = own.draft;
        return layers;
      }
      const published = srv.pairPublished.find((a) => a.name === name) ?? null;
      return { code: null, overlay: published, effective: published, draft: srv.pairDrafts[name] ?? null };
    }
    return { effective: servedObject(), code: servedObject() };
  }),
  getDraft: vi.fn(async (type: string, name: string, opts?: { packageId?: string }) =>
    type === 'action' && opts?.packageId === PAIR && srv.pairDrafts[name]
      ? // Served decorated, as the draft read serves it.
        { type, name, item: { ...srv.pairDrafts[name], _packageId: PAIR }, version: 'v1' }
      : null,
  ),
  get: vi.fn(async () => null),
  // The pair's action drafts are kept, so a read after a write serves them.
  publish: vi.fn(async () => ({})),
  save: vi.fn(async (type: string, name: string, body: unknown, opts?: { packageId?: string }) => {
    if (type === 'action' && opts?.packageId === PAIR) srv.pairDrafts[name] = body as Record<string, unknown>;
    return { ok: true, version: 'v2', state: 'draft' };
  }),
  reset: vi.fn(async (type: string, name: string, opts?: { packageId?: string; state?: string }) => {
    if (type === 'action' && opts?.packageId === PAIR) {
      if (opts.state === 'draft') delete srv.pairDrafts[name];
      else srv.pairPublished = srv.pairPublished.filter((a) => a.name !== name);
    }
    return { ok: true };
  }),
  withPreviewDrafts() {
    return this;
  },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
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

// The pillar reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { DataPillar, type StudioBaseCustomization } from './StudioDesignSurface';
import { StudioSaveHarness, pressStudioCancel, pressStudioSave } from './__tests__/studioSaveHarness';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t, tFormat } from '../metadata-admin/i18n';
import { indexCustomizations } from './customizationMarks';
import type { PackageCustomizationsState } from './CustomizationMark';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

const L = (key: string) => t(key, 'en');
const ensure = vi.fn(async (): Promise<string> => PAIR);

/** The base's customization read: the pair overrides nothing. */
function marksRead(): PackageCustomizationsState {
  const read = {
    packageId: BASE,
    overrides: [],
    extensions: [],
    switchedOff: [],
    contributions: [],
    counts: { overrides: 0, extensions: 0, switchedOff: 0 },
  } as never;
  return { status: 'read', read, index: indexCustomizations(BASE, read)!, baseName: 'CRM', contributorNames: new Map() };
}

function customizationOf(over: Partial<StudioBaseCustomization> = {}): StudioBaseCustomization {
  return {
    base: BASE,
    baseLabel: 'CRM',
    basedOn: '4.0.0',
    walled: false,
    pairId: PAIR,
    ensure,
    ensurePackage: vi.fn() as unknown as StudioBaseCustomization['ensurePackage'],
    marks: marksRead(),
    ...over,
  };
}

beforeEach(() => {
  srv.pairPublished = [];
  srv.pairDrafts = {};
  srv.stored = {};
  ensure.mockImplementation(async () => PAIR);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function mountOnActions(props: { readOnly: boolean; customization?: StudioBaseCustomization | null }) {
  render(
    <StudioSaveHarness><MemoryRouter initialEntries={[`/studio/${BASE}/data`]}>
      <DataPillar packageId={BASE} readOnly={props.readOnly} customization={props.customization ?? null} />
    </MemoryRouter></StudioSaveHarness>,
  );
  // The first match is the flat tab (the passthrough menu draws a second).
  fireEvent.click((await screen.findAllByRole('button', { name: L('engine.studio.data.tab.actions') }, { timeout: 8000 }))[0]);
  await within(await screen.findByTestId('actions-list', undefined, { timeout: 8000 })).findByText('Convert');
}

/** Past the retired autosave's 1.5 s debounce: nothing may leave before Save. */
async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

type SaveCall = [string, string, Record<string, unknown>, Record<string, unknown>];
const saves = () => mockClient.save.mock.calls as unknown as SaveCall[];
const actionSaves = () => saves().filter(([type]) => type === 'action');
const list = () => screen.getByTestId('actions-list');
const listRow = (label: string) => within(list()).getByText(label).closest('button') as HTMLElement;

describe('Studio adds an action to an installed app’s object, in its customization package (objectstack#30088)', () => {
  it('New writes a preset into the pair as a standalone action draft; the object is not written', async () => {
    await mountOnActions({ readOnly: true, customization: customizationOf() });
    // The vendor's action: read-only, no Delete.
    expect(screen.queryByRole('button', { name: L('engine.studio.actions.delete') })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: L('engine.inspector.action.label') })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: L('engine.studio.new') }));
    // The same presets as a writable package's New.
    for (const id of ['change_choice', 'run_flow', 'open_url', 'open_page']) {
      expect(await screen.findByTestId(`action-preset-${id}`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId('action-preset-change_choice'));
    // objectstack#36511 — nothing is written, and no pair asked for, before Save.
    await outlastDebounce();
    expect(actionSaves()).toHaveLength(0);
    expect(ensure).not.toHaveBeenCalled();

    await pressStudioSave();
    await waitFor(() => expect(mockClient.publish).toHaveBeenCalledTimes(1));
    expect(actionSaves()).toHaveLength(1);
    const [, name, body, opts] = actionSaves()[0]!;
    expect(name).toMatch(/^crm_lead_action_\d+$/);
    expect(name).not.toBe(VENDOR.name);
    expect(body).toMatchObject({ name, objectName: OBJECT, operation: 'update', locations: ['record_header'] });
    expect(opts).toMatchObject({ mode: 'draft', packageId: PAIR, ifNoneMatch: '*' });
    // Then that one action is published at the pair: live at once.
    expect(mockClient.publish).toHaveBeenCalledWith('action', name, { packageId: PAIR });
    expect(mockClient.save.mock.invocationCallOrder[0]).toBeLessThan(mockClient.publish.mock.invocationCallOrder[0]);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(saves().filter(([type]) => type === 'object')).toHaveLength(0);

    // Listed after the vendor's, with the "added" mark, open and removable.
    const row = await waitFor(() => {
      const r = within(list()).getAllByRole('button').find((b) => b.querySelector('[data-testid="customization-mark"]'));
      expect(r).toBeTruthy();
      return r!;
    });
    expect(within(row).getByTestId('customization-mark')).toHaveAttribute('data-kind', 'added');
    expect(within(listRow('Convert')).queryByTestId('customization-mark')).toBeNull();
    expect(screen.getByRole('button', { name: L('engine.studio.actions.delete') })).toBeInTheDocument();
  }, 30_000);

  it('the pair’s action edits into its draft at the pair, and Delete removes its draft and its row there', async () => {
    srv.pairPublished = [KEPT];
    srv.pairDrafts = { [KEPT.name]: KEPT };
    await mountOnActions({ readOnly: true, customization: customizationOf() });
    fireEvent.click(await within(list()).findByText('Qualify', undefined, { timeout: 8000 }));
    // Served on the object AND held by the pair: listed once, as the pair's.
    expect(within(list()).getAllByText('Qualify')).toHaveLength(1);
    expect(within(listRow('Qualify')).getByTestId('customization-mark')).toHaveAttribute('data-kind', 'added');

    const label = screen.getByRole('textbox', { name: L('engine.inspector.action.label') });
    expect(label).toBeEnabled();
    fireEvent.change(label, { target: { value: 'Mark qualified' } });
    await outlastDebounce();
    expect(actionSaves(), 'no write before Save').toHaveLength(0);
    await pressStudioSave();
    await waitFor(() => expect(mockClient.publish).toHaveBeenCalledTimes(1));
    expect(actionSaves()).toHaveLength(1);
    const [, name, body, opts] = actionSaves()[0]!;
    expect(name).toBe(KEPT.name);
    expect(body).toMatchObject({ name: KEPT.name, label: 'Mark qualified', objectName: OBJECT });
    // The read's decorations are not written back.
    expect(body).not.toHaveProperty('_packageId');
    expect(opts).toMatchObject({ mode: 'draft', packageId: PAIR });
    expect(mockClient.publish).toHaveBeenCalledWith('action', KEPT.name, { packageId: PAIR });
    expect(saves().filter(([type]) => type === 'object')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: L('engine.studio.actions.delete') }));
    await outlastDebounce();
    expect(mockClient.reset, 'Delete sends nothing before Save').not.toHaveBeenCalled();
    await pressStudioSave();
    await waitFor(() => expect(mockClient.reset).toHaveBeenCalledTimes(2));
    expect(mockClient.reset.mock.calls).toEqual([
      ['action', KEPT.name, { state: 'draft', packageId: PAIR }],
      ['action', KEPT.name, { packageId: PAIR }],
    ]);
    await waitFor(() => expect(within(list()).queryByText('Mark qualified')).not.toBeInTheDocument());
    expect(within(list()).getByText('Convert')).toBeInTheDocument();
  }, 30_000);

  it('“only customizations” counts the added action and keeps it alone', async () => {
    srv.pairPublished = [KEPT];
    await mountOnActions({ readOnly: true, customization: customizationOf() });
    const only = await screen.findByTestId('actions-customizations-only', undefined, { timeout: 8000 });
    expect(only).toHaveTextContent(tFormat('engine.list.customizations.only', 'en', { marked: 1 }));
    fireEvent.click(only);
    await waitFor(() => expect(within(list()).queryByText('Convert')).not.toBeInTheDocument());
    expect(within(list()).getByText('Qualify')).toBeInTheDocument();
  }, 30_000);

  it('Cancel takes back an added action and an edit: nothing is sent, the list is as the pair holds it (objectstack#36511)', async () => {
    srv.pairPublished = [KEPT];
    await mountOnActions({ readOnly: true, customization: customizationOf() });
    fireEvent.click(await within(list()).findByText('Qualify', undefined, { timeout: 8000 }));
    fireEvent.change(screen.getByRole('textbox', { name: L('engine.inspector.action.label') }), {
      target: { value: 'Mark qualified' },
    });
    fireEvent.click(screen.getByRole('button', { name: L('engine.studio.new') }));
    fireEvent.click(await screen.findByTestId('action-preset-change_choice'));
    await waitFor(() => expect(within(list()).getAllByTestId('customization-mark')).toHaveLength(2));

    await pressStudioCancel();
    await waitFor(() => expect(within(list()).getAllByTestId('customization-mark')).toHaveLength(1));
    expect(within(list()).getByText('Qualify')).toBeInTheDocument();
    expect(within(list()).queryByText('Mark qualified')).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-save')).toBeNull();
    await outlastDebounce();
    expect(actionSaves()).toHaveLength(0);
    expect(mockClient.publish).not.toHaveBeenCalled();
    expect(mockClient.reset).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  }, 30_000);

  it('walled: no New, and the pair’s action opens read-only', async () => {
    srv.pairPublished = [KEPT];
    await mountOnActions({ readOnly: true, customization: customizationOf({ walled: true }) });
    expect(screen.queryByRole('button', { name: L('engine.studio.new') })).not.toBeInTheDocument();
    fireEvent.click(await within(list()).findByText('Qualify', undefined, { timeout: 8000 }));
    expect(screen.getByRole('textbox', { name: L('engine.inspector.action.label') })).toBeDisabled();
    expect(screen.queryByRole('button', { name: L('engine.studio.actions.delete') })).not.toBeInTheDocument();
    expect(ensure).not.toHaveBeenCalled();
  }, 30_000);

  it('CONTROL: on a writable package the action is written into the object draft, and no door is asked', async () => {
    await mountOnActions({ readOnly: false });
    fireEvent.click(screen.getByRole('button', { name: L('engine.studio.new') }));
    fireEvent.click(await screen.findByTestId('action-preset-change_choice'));
    await outlastDebounce();
    await pressStudioSave();
    await waitFor(() => expect(saves().filter(([type]) => type === 'object').length).toBeGreaterThan(0));
    const [, , body] = saves().filter(([type]) => type === 'object').at(-1)!;
    const names = (body.actions as Array<Record<string, unknown>>).map((a) => a.name);
    expect(names).toContain(VENDOR.name);
    expect(names.some((n) => typeof n === 'string' && /^crm_lead_action_\d+$/.test(n))).toBe(true);
    expect(actionSaves()).toHaveLength(0);
    expect(ensure).not.toHaveBeenCalled();
  }, 30_000);
});

/**
 * objectstack#35054 (route D) — a pair action's buffer is the action as its
 * author stored it, not the pair's served (translated) list or draft.
 *
 * `action` is a translatable type: in a zh-CN session the pair's list and its
 * served drafts carry the translated label and confirmation text, and the
 * Save sends the buffer whole. Here the served reads carry the translated
 * copies and the pair's layered read the stored source.
 *
 * Direction, written before the run: with the buffer seeded from the served
 * reads (the unmodified tree) the first case goes RED on `confirmText` while
 * the edited `label` (the control) stays GREEN, and the second goes RED by
 * saving.
 */
describe('a pair action edits the action as stored (objectstack#35054)', () => {
  const SOURCE = { ...KEPT, confirmText: 'Qualify this lead?' };
  const SERVED = { ...SOURCE, label: '资格认定', confirmText: '认定此线索？' };

  it('a zh-CN edit saves the stored confirmation text; the edited label changes', async () => {
    srv.pairPublished = [SERVED];
    srv.pairDrafts = { [KEPT.name]: SERVED };
    srv.stored = { [KEPT.name]: { published: SOURCE, draft: SOURCE } };
    await mountOnActions({ readOnly: true, customization: customizationOf() });
    fireEvent.click(await within(list()).findByText('Qualify', undefined, { timeout: 8000 }));

    const label = screen.getByRole('textbox', { name: L('engine.inspector.action.label') });
    expect(label).toHaveValue('Qualify');
    fireEvent.change(label, { target: { value: 'Mark qualified' } });
    await pressStudioSave();
    await waitFor(() => expect(actionSaves()).toHaveLength(1));
    const [, name, body, opts] = actionSaves()[0]!;
    expect(name).toBe(KEPT.name);
    expect(opts).toMatchObject({ mode: 'draft', packageId: PAIR });
    expect(body.confirmText).toBe('Qualify this lead?');
    // Control: the edit itself is what the save carries.
    expect(body.label).toBe('Mark qualified');
    expect(mockClient.layered).toHaveBeenCalledWith('action', KEPT.name, { packageId: PAIR });
  }, 30_000);

  it('a pending draft whose stored copy is not served takes no edit, and nothing is saved', async () => {
    srv.pairPublished = [SERVED];
    srv.pairDrafts = { [KEPT.name]: SERVED };
    // The layered read serves the published action and no `draft` key.
    srv.stored = { [KEPT.name]: { published: SOURCE } };
    await mountOnActions({ readOnly: true, customization: customizationOf() });
    fireEvent.click(await within(list()).findByText('资格认定', undefined, { timeout: 8000 }));

    fireEvent.change(screen.getByRole('textbox', { name: L('engine.inspector.action.label') }), {
      target: { value: 'Mark qualified' },
    });
    await outlastDebounce();
    expect(actionSaves()).toHaveLength(0);
    expect(await screen.findByText(L('engine.studio.refusal.draftUnreadable'))).toBeInTheDocument();
    // objectstack#36511 — and the top bar offers no Save for it.
    expect(screen.queryByTestId('studio-save')).toBeNull();
  }, 30_000);
});
