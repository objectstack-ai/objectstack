// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36660 — on a read-only base's object, an action the base's pair
 * adds is its own `action` item, buffered from its pending draft and published
 * by the top bar's Save. When the AI assistant (copilot or MCP) wrote that
 * draft, the open action carries the designers' line (`StudioAiDraftNotice`):
 * Save makes the AI's change live too, and 「放弃 AI 的改动」 drops that one
 * action's draft at the pair the ensure door answers, asking first only over
 * the row's unsaved edit. A person's own draft gets no such line.
 *
 * The REAL `DataPillar`, Actions view and action editor over the metadata
 * client double of DataPillar.pairActions-30088.test.tsx.
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
  locations: ['record_page'],
  type: 'script',
  body: { language: 'expression', source: 'true' },
};

/** An action the pair already holds on the object: published, and with a pending draft. */
const KEPT = {
  name: 'crm_lead_action_7',
  label: 'Qualify',
  objectName: OBJECT,
  locations: ['record_page'], component: 'action:menu',
  operation: 'update',
  patch: { status: 'qualified' },
};

const srv = vi.hoisted(() => ({
  /** The pair's published actions (every object's). */
  pairPublished: [] as Array<Record<string, unknown>>,
  /** The pair's pending action drafts, by name. */
  pairDrafts: {} as Record<string, Record<string, unknown>>,
  /** The provenance each pair draft's read serves, by name (absent: none recorded). */
  pairDraftChanges: {} as Record<string, Array<Record<string, unknown>>>,
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
        {
          type,
          name,
          item: { ...srv.pairDrafts[name], _packageId: PAIR },
          version: 'v1',
          ...(srv.pairDraftChanges[name] ? { draftChanges: srv.pairDraftChanges[name] } : {}),
        }
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
import '@object-ui/plugin-detail';
import { DataPillar, type StudioBaseCustomization } from './StudioDesignSurface';
import { StudioSaveHarness, pressStudioSave } from './__tests__/studioSaveHarness';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t } from '../metadata-admin/i18n';
import { indexCustomizations } from './customizationMarks';
import type { PackageCustomizationsState } from './CustomizationMark';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

const L = (key: string) => t(key, 'en');
let confirmSpy: ReturnType<typeof vi.spyOn>;
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
  srv.pairDraftChanges = {};
  srv.stored = {};
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  ensure.mockImplementation(async () => PAIR);
});

afterEach(() => {
  cleanup();
  confirmSpy.mockRestore();
  vi.clearAllMocks();
});

async function mountOnActions(props: { readOnly: boolean; customization?: StudioBaseCustomization | null }) {
  render(
    <StudioSaveHarness><MemoryRouter initialEntries={[`/studio/${BASE}/data`]}>
      <DataPillar objectName={OBJECT} packageId={BASE} readOnly={props.readOnly} customization={props.customization ?? null} />
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

const list = () => screen.getByTestId('actions-list');

const AI_KEPT = { ...KEPT, label: 'Qualify (AI)', patch: { status: 'new' } };
const AI_CHANGE = { path: ['patch'], by: 'copilot', actor: 'u1', at: '2026-11-27T10:00:00.000Z' };
const notice = () => screen.queryByTestId('studio-ai-draft-notice');

async function openAiRow(changes: Array<Record<string, unknown>> | undefined = [AI_CHANGE]) {
  srv.pairPublished = [KEPT];
  srv.pairDrafts = { [KEPT.name]: AI_KEPT };
  if (changes) srv.pairDraftChanges = { [KEPT.name]: changes };
  await mountOnActions({ readOnly: true, customization: customizationOf() });
  fireEvent.click(await within(list()).findByText('Qualify (AI)', undefined, { timeout: 8000 }));
}

describe('a pair action\'s pending draft written by the AI assistant (objectstack#36660)', () => {
  it('the open action shows the AI version with the notice, and a person\'s Save makes it live', async () => {
    await openAiRow();
    expect(await screen.findByTestId('studio-ai-draft-notice')).toHaveTextContent(L('engine.studio.aiDraft.notice'));
    fireEvent.change(screen.getByRole('textbox', { name: L('engine.inspector.action.label') }), {
      target: { value: 'Qualify (AI, reviewed)' },
    });
    await pressStudioSave();
    await waitFor(() => expect(mockClient.publish).toHaveBeenCalledTimes(1));
    expect(mockClient.publish).toHaveBeenCalledWith('action', KEPT.name, { packageId: PAIR, draftVersion: expect.any(String) });
    await waitFor(() => expect(notice()).toBeNull());
  }, 30_000);

  it('an MCP-written draft is the AI\'s too', async () => {
    await openAiRow([{ ...AI_CHANGE, by: 'mcp' }]);
    expect(await screen.findByTestId('studio-ai-draft-notice')).toBeInTheDocument();
  }, 30_000);

  it('a person\'s own pending draft, or one whose read recorded nothing, gets no AI line', async () => {
    await openAiRow([{ ...AI_CHANGE, by: 'studio' }]);
    expect(screen.getByRole('textbox', { name: L('engine.inspector.action.label') })).toHaveValue('Qualify (AI)');
    expect(notice()).toBeNull();
    cleanup();
    await openAiRow(undefined);
    expect(screen.getByRole('textbox', { name: L('engine.inspector.action.label') })).toHaveValue('Qualify (AI)');
    expect(notice()).toBeNull();
  }, 30_000);

  it('discard with nothing unsaved asks nothing and drops that one action\'s draft at the door\'s pair; the published action is back', async () => {
    await openAiRow();
    fireEvent.click(await screen.findByTestId('studio-ai-draft-discard'));
    await waitFor(() => expect(mockClient.reset).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockClient.reset).toHaveBeenCalledWith('action', KEPT.name, { state: 'draft', packageId: PAIR });
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(mockClient.publish).not.toHaveBeenCalled();
    expect(await within(list()).findByText('Qualify', undefined, { timeout: 8000 })).toBeInTheDocument();
    await waitFor(() => expect(notice()).toBeNull());
    expect(within(list()).queryByText('Qualify (AI)')).toBeNull();
  }, 30_000);

  it('discard over the row\'s unsaved edit asks first; declined, nothing is sent and the edit stays', async () => {
    confirmSpy.mockReturnValue(false);
    await openAiRow();
    const label = screen.getByRole('textbox', { name: L('engine.inspector.action.label') });
    fireEvent.change(label, { target: { value: 'Unsaved' } });
    fireEvent.click(screen.getByTestId('studio-ai-draft-discard'));
    expect(confirmSpy).toHaveBeenCalledWith(L('engine.studio.aiDraft.discardConfirmUnsaved'));
    await outlastDebounce();
    expect(mockClient.reset).not.toHaveBeenCalled();
    expect(label).toHaveValue('Unsaved');
    expect(notice()).toBeInTheDocument();
  }, 30_000);

  it('discard over the row\'s unsaved edit, confirmed: the draft and the edit go', async () => {
    await openAiRow();
    fireEvent.change(screen.getByRole('textbox', { name: L('engine.inspector.action.label') }), {
      target: { value: 'Unsaved' },
    });
    fireEvent.click(screen.getByTestId('studio-ai-draft-discard'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockClient.reset).toHaveBeenCalledWith('action', KEPT.name, { state: 'draft', packageId: PAIR }));
    expect(await within(list()).findByText('Qualify', undefined, { timeout: 8000 })).toBeInTheDocument();
    await waitFor(() => expect(notice()).toBeNull());
  }, 30_000);
});
