// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36726 — a flow's Save, its switch and its creation publish over
 * the published flow they were built on, never over one another writer
 * published since.
 *
 * A Save is the flow's draft and then that one flow's publish
 * (objectstack#36511), so it leaves no draft: two editors that opened the same
 * published flow both pass the draft door, and before this card the later
 * publish replaced the earlier one in silence. The flow's load now reads its
 * layers at the address the publish writes BEFORE the draft, and pins the
 * publish to the `overlayVersion` they serve; the later Save is refused
 * `409 METADATA_CONFLICT` and the author is asked. A new flow's publish asserts
 * no published flow of its name.
 *
 * The other writer is the double's own move of the live row; the refusal is
 * parsed by the REAL `MetadataClient`. The REAL `AutomationsPillar`, with the
 * REAL registered `FlowPreview` and `FlowInspector`. Also pinned: the reload
 * residual of the card's scope addition.
 */

import '@testing-library/jest-dom/vitest';
// Paid at collection, not inside a clocked case (check:test-source-alias):
// the source under test loads `@objectstack/lint` lazily.
import '@objectstack/lint';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';

const PKG = 'com.acme.app';
const LIVE = 'hmac-sha256:live0';
const PENDING = 'hmac-sha256:pending';

const FLOW = {
  name: 'notify_owner',
  label: 'Notify owner',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const server = vi.hoisted(() => ({
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
          error: `flow/${name} has been modified since you loaded it. The version token sent is not the current version (current is ${head}).`,
          code: 'METADATA_CONFLICT',
          currentVersion: head,
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  });
  return client.publish('flow', name).then(
    () => {
      throw new Error('the stub door accepted the publish');
    },
    (e: unknown) => e as MetadataError,
  );
}

const mockClient = vi.hoisted(() => {
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return {
    list: vi.fn(async () => [...server.active.values()].map((row) => ({ name: row.name, label: row.label ?? row.name }))),
    listResponse: vi.fn(async () => ({ items: [...server.active.values()].map((row) => ({ name: row.name })) })),
    listDrafts: vi.fn(async () => [...server.drafts.keys()].map((name) => ({ type: 'flow', name }))),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (_type: string, name: string) => {
      const live = server.active.get(name) ?? null;
      const draft = server.drafts.get(name)?.body ?? null;
      const version = server.servesPublishedVersion ? { overlayVersion: live ? (server.activeVersions.get(name) ?? null) : null } : {};
      return { code: null, overlay: live && copy(live), overlayScope: live ? 'env' : null, effective: live && copy(live), draft: draft && copy(draft), ...version, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    // No draft is `null`, as the real client resolves the read's 404.
    getDraft: vi.fn(async (type: string, name: string) => {
      const row = server.drafts.get(name);
      return row ? { type, name, item: copy(row.body), version: row.version } : null;
    }),
    save: vi.fn(async (_type: string, name: string, item: unknown, options?: { ifMatch?: string; ifNoneMatch?: string }) => {
      const body = copy(item) as Record<string, unknown>;
      server.saves.push({ name, body, ifMatch: options?.ifMatch, ifNoneMatch: options?.ifNoneMatch });
      const head = server.drafts.get(name)?.version ?? null;
      if (options?.ifMatch !== undefined && options.ifMatch !== head) throw await conflictRefusal(name, head);
      if (options?.ifNoneMatch !== undefined && head !== null) throw await conflictRefusal(name, head);
      server.seq += 1;
      const version = `hmac-sha256:v${server.seq}`;
      server.drafts.set(name, { body, version });
      return { success: true, version, state: 'draft' };
    }),
    publish: vi.fn(async (_type: string, name: string, options?: { ifMatch?: string; ifNoneMatch?: '*' }) => {
      server.publishes.push({ name, ifMatch: options?.ifMatch, ifNoneMatch: options?.ifNoneMatch });
      const live = server.active.has(name) ? (server.activeVersions.get(name) ?? null) : null;
      if (options?.ifMatch !== undefined && options.ifMatch !== live) throw await conflictRefusal(name, live);
      if (options?.ifNoneMatch !== undefined && live !== null) throw await conflictRefusal(name, live);
      const draft = server.drafts.get(name);
      server.seq += 1;
      const version = `hmac-sha256:live${server.seq}`;
      if (draft) {
        server.active.set(name, draft.body);
        server.activeVersions.set(name, version);
      }
      server.drafts.delete(name);
      return { success: true, version };
    }),
    reset: vi.fn(async (_type: string, name: string, options?: { state?: string }) => {
      if (options?.state === 'draft') server.drafts.delete(name);
      return {};
    }),
  };
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

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { StudioSaveHarness, pressStudioSave } from './__tests__/studioSaveHarness';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

const en = (key: string) => t(key, 'en');
const WAIT = { timeout: 8000 };
const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } }));

beforeEach(() => {
  server.active.clear();
  server.activeVersions.clear();
  server.drafts.clear();
  server.servesPublishedVersion = true;
  server.saves.length = 0;
  server.publishes.length = 0;
  server.seq = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
  // The `/automation/_status` probe, the action catalog and the run history read go through the global `fetch`.
  vi.stubGlobal('fetch', fetchSpy);
  server.active.set(FLOW.name, JSON.parse(JSON.stringify(FLOW)));
  server.activeVersions.set(FLOW.name, LIVE);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(): void {
  render(
    <StudioSaveHarness>
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>
    </StudioSaveHarness>,
  );
}

async function openFlow(): Promise<void> {
  mount();
  await screen.findByTestId('auto-tab-canvas', undefined, WAIT);
  await waitFor(() => expect(screen.getByText('Status:').nextElementSibling).toHaveTextContent(en('engine.studio.auto.enabled')), WAIT);
}

async function editStartLabel(value: string): Promise<void> {
  fireEvent.click(document.querySelector('[data-node-id="start"] [role="button"]') as HTMLElement);
  const box = await within(screen.getByTestId('auto-config-aside')).findByLabelText('Label', undefined, WAIT);
  fireEvent.change(box, { target: { value } });
  fireEvent.blur(box);
  await screen.findByTestId('studio-save', undefined, WAIT);
}

async function save(): Promise<void> {
  const before = server.saves.length;
  await pressStudioSave({ settle: false });
  await waitFor(() => expect(server.saves.length).toBe(before + 1), WAIT);
}

async function saveAndLand(): Promise<void> {
  const before = server.publishes.length;
  await save();
  await waitFor(() => expect(server.publishes.length).toBe(before + 1), WAIT);
  await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull(), WAIT);
}

const live = () => server.active.get(FLOW.name)!;
const liveNodeLabel = (id: string) => (live().nodes as Array<{ id: string; label?: string }>).find((n) => n.id === id)?.label;

function anotherWriterPublishes(patch: Record<string, unknown>): string {
  server.seq += 1;
  const version = `hmac-sha256:other${server.seq}`;
  server.active.set(FLOW.name, { ...live(), ...patch });
  server.activeVersions.set(FLOW.name, version);
  return version;
}

async function racePublished(): Promise<string> {
  await openFlow();
  await editStartLabel('Kick-off');
  const theirs = anotherWriterPublishes({ description: 'Theirs' });
  await save();
  await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
  return theirs;
}

describe('Flows — two Saves over one published flow are not last-writer-wins (objectstack#36726)', () => {
  it('the later Save is refused at its publish, worded as a live change; keep editing leaves the edit unsaved', async () => {
    await racePublished();
    expect(server.saves.map((s) => [s.ifMatch, s.ifNoneMatch])).toEqual([[undefined, '*']]);
    expect(server.publishes.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([[LIVE, undefined]]);
    expect(screen.getByTestId('draft-conflict-dialog')).toHaveTextContent('This changed since you opened it');
    fireEvent.click(screen.getByTestId('draft-conflict-cancel'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    expect((await screen.findAllByText(/Not saved:/, undefined, WAIT)).length).toBeGreaterThan(0);
    expect(live().description).toBe('Theirs');
    expect(liveNodeLabel('start')).toBe('Start');
    expect(server.drafts.size).toBe(0);
    expect(screen.getByTestId('studio-save')).toBeInTheDocument();
  }, 30_000);

  it('"reload" re-reads the other writer\'s flow, and the next Save is pinned to it', async () => {
    const theirs = await racePublished();
    fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull(), WAIT);
    await editStartLabel('Begin');
    await saveAndLand();
    expect(server.publishes[server.publishes.length - 1]).toMatchObject({ ifMatch: theirs });
    expect(live().description).toBe('Theirs');
    expect(liveNodeLabel('start')).toBe('Begin');
  }, 30_000);

  it('"overwrite" asks again, then re-publishes pinned to the refusal\'s currentVersion', async () => {
    const theirs = await racePublished();
    fireEvent.click(screen.getByTestId('draft-conflict-overwrite'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('draft-conflict-overwrite-confirm'));
    });
    await waitFor(() => expect(liveNodeLabel('start')).toBe('Kick-off'), WAIT);
    expect(server.publishes[server.publishes.length - 1]).toMatchObject({ ifMatch: theirs });
  }, 30_000);

  it('one editor: each Save\'s publish is pinned to the version the last one left', async () => {
    await openFlow();
    await editStartLabel('Kick-off');
    await saveAndLand();
    const first = server.activeVersions.get(FLOW.name)!;
    await editStartLabel('Begin');
    await saveAndLand();
    expect(server.publishes.map((p) => p.ifMatch)).toEqual([LIVE, first]);
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  }, 30_000);

  it('the switch\'s publish is pinned too: a flip over a flow another writer published is asked about', async () => {
    await openFlow();
    anotherWriterPublishes({ description: 'Theirs' });
    fireEvent.click(screen.getByRole('switch'));
    await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
    expect(server.publishes.map((p) => p.ifMatch)).toEqual([LIVE]);
    expect(live().status).toBe('active');
  }, 30_000);

  it('a new flow\'s publish asserts no published flow of its name', async () => {
    mount();
    await screen.findByTestId(`auto-rail-row-${FLOW.name}`, undefined, WAIT);
    fireEvent.click(screen.getByTitle(en('engine.studio.auto.newTitle')));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByTestId('create-flow-preset-manual'));
    fireEvent.change(dialog.querySelectorAll('input')[0], { target: { value: 'Escalate' } });
    fireEvent.click(within(dialog).getByRole('button', { name: en('engine.studio.createLive') }));
    await waitFor(() => expect(server.publishes).toHaveLength(1), WAIT);
    expect(server.publishes[0]).toEqual({ name: 'escalate', ifMatch: undefined, ifNoneMatch: '*' });
    await waitFor(() => expect(server.active.has('escalate')).toBe(true), WAIT);
  }, 40_000);

  it('control: a server that serves no `overlayVersion` gets an unpinned publish, as before', async () => {
    server.servesPublishedVersion = false;
    await openFlow();
    await editStartLabel('Kick-off');
    anotherWriterPublishes({ description: 'Theirs' });
    await saveAndLand();
    expect(server.publishes.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([[undefined, undefined]]);
  }, 30_000);
});

describe('Flows — a reload over a pending draft does not pin its publish to the fresh read (objectstack#36726)', () => {
  it('a pending draft, a live change by another writer, a refused publish, Reload: the next Save is asked again', async () => {
    server.drafts.set(FLOW.name, { body: JSON.parse(JSON.stringify(FLOW)), version: PENDING });
    await openFlow();
    await editStartLabel('Kick-off');
    anotherWriterPublishes({ description: 'Theirs' });
    await save();
    expect(server.saves[server.saves.length - 1]!.ifMatch).toBe(PENDING);
    await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
    fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    // The draft pending before the Save is kept, carrying the page's edit, and re-read.
    expect(JSON.stringify(server.drafts.get(FLOW.name)?.body.nodes)).toContain('Kick-off');
    await waitFor(() => expect(document.querySelector('[data-node-id="start"]')).toHaveTextContent('Kick-off'), WAIT);

    await editStartLabel('Begin');
    const publishesBefore = server.publishes.length;
    await save();
    await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
    expect(server.publishes.slice(publishesBefore).map((p) => p.ifMatch)).toEqual([LIVE]);
    expect(live().description).toBe('Theirs');
    expect(liveNodeLabel('start')).toBe('Start');
  }, 30_000);
});
