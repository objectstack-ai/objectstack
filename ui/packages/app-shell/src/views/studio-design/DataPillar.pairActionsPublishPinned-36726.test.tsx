// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36726 — an action a read-only base's pair adds to one of its
 * objects (objectstack#30088) is published over the published action its row
 * was loaded at, never over one another writer published since.
 *
 * A Save writes the row's draft at the pair, then publishes that one action
 * there (objectstack#36511), so it leaves no draft: two editors that opened
 * the same published action both pass the draft door, and before this card
 * the later publish replaced the earlier one in silence. The pair's layered
 * read, which the row's buffer already comes from (objectstack#35054), serves
 * `overlayVersion`; the row's publish is pinned to it, so the later Save is
 * refused `409 METADATA_CONFLICT` and the author is asked.
 *
 * The other writer is the double's own move of the live row; the door's
 * refusal is parsed by the REAL `MetadataClient`. Also pinned: a new row's
 * publish asserts no published action of its name, and the reload residual
 * of the card's scope addition (a draft pending before the Save is kept, and
 * the reload that re-reads it does not pin its publish to the fresh read).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';

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

/** The action the pair holds on the object, published. */
const KEPT = {
  name: 'crm_lead_action_7',
  label: 'Qualify',
  objectName: OBJECT,
  locations: ['record_page'], component: 'action:menu',
  operation: 'update',
  patch: { status: 'qualified' },
};

const LIVE = 'hmac-sha256:live0';
const PENDING = 'hmac-sha256:pending';

const srv = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  activeVersions: new Map<string, string>(),
  drafts: new Map<string, { body: Record<string, unknown>; version: string }>(),
  servesPublishedVersion: true,
  saves: [] as Array<{ name: string; body: Record<string, unknown>; ifMatch: string | undefined; ifNoneMatch: string | undefined }>,
  publishes: [] as Array<{ name: string; ifMatch: string | undefined; ifNoneMatch: string | undefined }>,
  seq: 0,
}));

async function conflictRefusal(name: string, head: string | null): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(
        JSON.stringify({
          error: `action/${name} has been modified since you loaded it. The version token sent is not the current version (current is ${head}).`,
          code: 'METADATA_CONFLICT',
          currentVersion: head,
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  });
  return client.publish('action', name).then(
    () => {
      throw new Error('the stub door accepted the publish');
    },
    (e: unknown) => e as MetadataError,
  );
}

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const servedObject = () => ({
  name: OBJECT,
  label: 'Lead',
  fields: {
    name: { type: 'text', label: 'Name' },
    // The "Change a picklist field" preset a new row is made from needs one.
    status: { type: 'select', label: 'Status', options: [{ label: 'New', value: 'new' }, { label: 'Hot', value: 'hot' }] },
  },
  actions: [VENDOR, ...[...srv.active.values()].map((a) => ({ ...a, _packageId: PAIR }))],
});

const mockClient = {
  list: vi.fn(async (type: string, opts?: { packageId?: string }) => {
    if (type === 'action') return opts?.packageId === PAIR ? [...srv.active.values()].map((a) => ({ ...copy(a), _packageId: PAIR })) : [];
    if (type === 'object') return opts?.packageId === PAIR ? [] : [{ name: OBJECT, label: 'Lead' }];
    return [];
  }),
  listDrafts: vi.fn(async (opts?: { packageId?: string; type?: string }) =>
    opts?.type === 'action' && opts.packageId === PAIR ? [...srv.drafts.keys()].map((name) => ({ type: 'action', name })) : [],
  ),
  layered: vi.fn(async (type: string, name: string, opts?: { packageId?: string }) => {
    if (type === 'action' && opts?.packageId === PAIR) {
      const live = srv.active.get(name) ?? null;
      const draft = srv.drafts.get(name)?.body ?? null;
      const version = srv.servesPublishedVersion ? { overlayVersion: live ? (srv.activeVersions.get(name) ?? null) : null } : {};
      return { code: null, overlay: live && copy(live), effective: live && copy(live), draft: draft && copy(draft), ...version };
    }
    return { effective: servedObject(), code: servedObject() };
  }),
  getDraft: vi.fn(async (type: string, name: string, opts?: { packageId?: string }) => {
    const row = type === 'action' && opts?.packageId === PAIR ? srv.drafts.get(name) : undefined;
    return row ? { type, name, item: { ...copy(row.body), _packageId: PAIR }, version: row.version } : null;
  }),
  get: vi.fn(async () => null),
  save: vi.fn(async (type: string, name: string, item: unknown, opts?: { packageId?: string; ifMatch?: string; ifNoneMatch?: string }) => {
    if (type !== 'action' || opts?.packageId !== PAIR) return { ok: true, version: 'v-other', state: 'draft' };
    const body = copy(item) as Record<string, unknown>;
    srv.saves.push({ name, body, ifMatch: opts.ifMatch, ifNoneMatch: opts.ifNoneMatch });
    const head = srv.drafts.get(name)?.version ?? null;
    if (opts.ifMatch !== undefined && opts.ifMatch !== head) throw await conflictRefusal(name, head);
    if (opts.ifNoneMatch !== undefined && head !== null) throw await conflictRefusal(name, head);
    srv.seq += 1;
    const version = `hmac-sha256:v${srv.seq}`;
    srv.drafts.set(name, { body, version });
    return { success: true, version, state: 'draft' };
  }),
  publish: vi.fn(async (_type: string, name: string, options?: { ifMatch?: string; ifNoneMatch?: '*' }) => {
    srv.publishes.push({ name, ifMatch: options?.ifMatch, ifNoneMatch: options?.ifNoneMatch });
    const live = srv.active.has(name) ? (srv.activeVersions.get(name) ?? null) : null;
    if (options?.ifMatch !== undefined && options.ifMatch !== live) throw await conflictRefusal(name, live);
    if (options?.ifNoneMatch !== undefined && live !== null) throw await conflictRefusal(name, live);
    const draft = srv.drafts.get(name);
    srv.seq += 1;
    const version = `hmac-sha256:live${srv.seq}`;
    if (draft) {
      srv.active.set(name, draft.body);
      srv.activeVersions.set(name, version);
    }
    srv.drafts.delete(name);
    return { success: true, version };
  }),
  reset: vi.fn(async (type: string, name: string, opts?: { packageId?: string; state?: string }) => {
    if (type === 'action' && opts?.packageId === PAIR && opts.state === 'draft') srv.drafts.delete(name);
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
// as in DataPillar.pairActions-30088.test.tsx.
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
const ensure = vi.fn(async (): Promise<string> => PAIR);
const WAIT = { timeout: 8000 };

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

function customization(): StudioBaseCustomization {
  return {
    base: BASE,
    baseLabel: 'CRM',
    basedOn: '4.0.0',
    walled: false,
    pairId: PAIR,
    ensure,
    ensurePackage: vi.fn() as unknown as StudioBaseCustomization['ensurePackage'],
    marks: marksRead(),
  };
}

beforeEach(() => {
  srv.active.clear();
  srv.activeVersions.clear();
  srv.drafts.clear();
  srv.servesPublishedVersion = true;
  srv.saves.length = 0;
  srv.publishes.length = 0;
  srv.seq = 0;
  srv.active.set(KEPT.name, copy(KEPT));
  srv.activeVersions.set(KEPT.name, LIVE);
  ensure.mockImplementation(async () => PAIR);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const list = () => screen.getByTestId('actions-list');
const live = () => srv.active.get(KEPT.name)!;

async function mountOnActions(): Promise<void> {
  render(
    <StudioSaveHarness>
      <MemoryRouter initialEntries={[`/studio/${BASE}/data`]}>
        <DataPillar objectName={OBJECT} packageId={BASE} readOnly customization={customization()} />
      </MemoryRouter>
    </StudioSaveHarness>,
  );
  fireEvent.click((await screen.findAllByRole('button', { name: L('engine.studio.data.tab.actions') }, WAIT))[0]);
  await within(await screen.findByTestId('actions-list', undefined, WAIT)).findByText('Convert', undefined, WAIT);
}

/** Open the row by its label and rename it: nothing is sent. */
async function relabel(from: string, to: string): Promise<void> {
  fireEvent.click(await within(list()).findByText(from, undefined, WAIT));
  fireEvent.change(screen.getByRole('textbox', { name: L('engine.inspector.action.label') }), { target: { value: to } });
}

async function save(): Promise<void> {
  const before = srv.saves.length;
  await pressStudioSave({ settle: false });
  await waitFor(() => expect(srv.saves.length).toBe(before + 1), WAIT);
}

async function saveAndLand(): Promise<void> {
  const before = srv.publishes.length;
  await save();
  await waitFor(() => expect(srv.publishes.length).toBe(before + 1), WAIT);
  await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull(), WAIT);
}

function anotherWriterPublishes(patch: Record<string, unknown>): string {
  srv.seq += 1;
  const version = `hmac-sha256:other${srv.seq}`;
  srv.active.set(KEPT.name, { ...live(), ...patch });
  srv.activeVersions.set(KEPT.name, version);
  return version;
}

async function racePublished(): Promise<string> {
  await mountOnActions();
  await relabel('Qualify', 'Mark qualified');
  const theirs = anotherWriterPublishes({ patch: { status: 'hot' } });
  await save();
  expect(srv.saves[srv.saves.length - 1]).toMatchObject({ ifMatch: undefined, ifNoneMatch: '*' });
  await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
  return theirs;
}

describe('Pair actions — two Saves over one published action are not last-writer-wins (objectstack#36726)', () => {
  it('the later Save is refused at its publish, worded as a live change; keep editing leaves the edit unsaved', async () => {
    await racePublished();
    expect(srv.publishes.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([[LIVE, undefined]]);
    expect(screen.getByTestId('draft-conflict-dialog')).toHaveTextContent('This changed since you opened it');
    fireEvent.click(screen.getByTestId('draft-conflict-cancel'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    expect((await screen.findAllByText(/Not saved:/, undefined, WAIT)).length).toBeGreaterThan(0);
    expect(live()).toMatchObject({ label: 'Qualify', patch: { status: 'hot' } });
    expect(srv.drafts.size).toBe(0);
    expect(screen.getByTestId('studio-save')).toBeInTheDocument();
  }, 30_000);

  it('"reload" re-reads the other writer\'s action, and the next Save is pinned to it', async () => {
    const theirs = await racePublished();
    fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull(), WAIT);
    await relabel('Qualify', 'Qualify lead');
    await saveAndLand();
    expect(srv.publishes[srv.publishes.length - 1]).toMatchObject({ ifMatch: theirs });
    // Built on the other writer's action.
    expect(live()).toMatchObject({ label: 'Qualify lead', patch: { status: 'hot' } });
  }, 30_000);

  it('"overwrite" asks again, then re-publishes pinned to the refusal\'s currentVersion', async () => {
    const theirs = await racePublished();
    fireEvent.click(screen.getByTestId('draft-conflict-overwrite'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('draft-conflict-overwrite-confirm'));
    });
    await waitFor(() => expect(live().label).toBe('Mark qualified'), WAIT);
    expect(srv.publishes[srv.publishes.length - 1]).toMatchObject({ ifMatch: theirs });
  }, 30_000);

  it('one editor: each Save\'s publish is pinned to the version the last one left', async () => {
    await mountOnActions();
    await relabel('Qualify', 'Mark qualified');
    await saveAndLand();
    const first = srv.activeVersions.get(KEPT.name)!;
    await relabel('Mark qualified', 'Qualify lead');
    await saveAndLand();
    expect(srv.publishes.map((p) => p.ifMatch)).toEqual([LIVE, first]);
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  }, 30_000);

  it('a new row\'s publish asserts no published action of its name', async () => {
    await mountOnActions();
    fireEvent.click(screen.getByRole('button', { name: L('engine.studio.new') }));
    fireEvent.click(await screen.findByTestId('action-preset-change_choice'));
    await save();
    await waitFor(() => expect(srv.publishes).toHaveLength(1), WAIT);
    expect(srv.publishes[0]).toMatchObject({ ifMatch: undefined, ifNoneMatch: '*' });
  }, 30_000);

  it('control: a server that serves no `overlayVersion` gets an unpinned publish, as before', async () => {
    srv.servesPublishedVersion = false;
    await mountOnActions();
    await relabel('Qualify', 'Mark qualified');
    anotherWriterPublishes({ patch: { status: 'hot' } });
    await saveAndLand();
    expect(srv.publishes.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([[undefined, undefined]]);
  }, 30_000);
});

describe('Pair actions — a reload over a pending draft does not pin its publish to the fresh read (objectstack#36726)', () => {
  it('a pending draft, a live change by another writer, a refused publish, Reload: the next Save is asked again', async () => {
    srv.drafts.set(KEPT.name, { body: copy(KEPT), version: PENDING });
    await mountOnActions();
    await relabel('Qualify', 'Mark qualified');
    anotherWriterPublishes({ patch: { status: 'hot' } });
    await save();
    expect(srv.saves[srv.saves.length - 1]!.ifMatch).toBe(PENDING);
    await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
    fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    // The draft pending before the Save is kept, carrying the page's edit, and re-read.
    expect(srv.drafts.get(KEPT.name)?.body.label).toBe('Mark qualified');

    await relabel('Mark qualified', 'Qualify lead');
    const publishesBefore = srv.publishes.length;
    await save();
    await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
    expect(srv.publishes.slice(publishesBefore).map((p) => p.ifMatch)).toEqual([LIVE]);
    expect(live()).toMatchObject({ label: 'Qualify', patch: { status: 'hot' } });
  }, 30_000);
});
