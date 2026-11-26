// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37515 — the OWD overview's Save writes each row's draft through
 * the draft guard, pinned to the draft read of the load the author saw.
 *
 * The publish was already pinned (objectstack#36962); the draft write before
 * it was a whole-document PUT over a read taken a moment earlier, so:
 *
 *  1. a draft another writer saved since the read was replaced entirely;
 *  2. a draft that appeared after the page loaded was picked up by the
 *     Save-time re-read and published live with the row, never shown.
 *
 * Neither moves the live row, so the published pin catches neither. Now the
 * draft save sends `If-Match` the load's draft version, or `If-None-Match: *`
 * when the load read none, and the door's `409 METADATA_CONFLICT` opens the
 * draft conflict dialog (objectstack#36601) instead.
 *
 * The other writer is the server double's own move of the draft row. Its
 * refusals are parsed by the REAL `MetadataClient`, so the error the guard
 * reads is production's.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';
import { t } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';
import { StudioSaveHarness, pressStudioSave } from './__tests__/studioSaveHarness';

const PACKAGE = 'com.qa.owd';
const L = (key: string) => t(key, 'en-US');
const PUBLIC_READ = L('engine.studio.settings.sharingPublicRead');
const PUBLIC_READ_WRITE = L('engine.studio.settings.sharingPublicReadWrite');
const UNPUBLISHED_DRAFT = L('engine.studio.unpublishedDraft');
const WAIT = { timeout: 4000 };

type Body = Record<string, unknown>;

interface Write {
  name: string;
  ifMatch: string | undefined;
  ifNoneMatch: string | undefined;
}

interface Deferred {
  promise: Promise<void>;
  release: () => void;
}

function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface Server {
  published: Map<string, Body>;
  publishedVersions: Map<string, string>;
  drafts: Map<string, Body>;
  draftVersions: Map<string, string>;
  /** Whether the draft read serves `version` (a server from before it did serves none: the control). */
  servesDraftVersion: boolean;
  saves: Write[];
  publishes: Write[];
  resets: string[];
  /** The package each draft read named. */
  draftReadPackages: Array<string | undefined>;
  /** Run once when the Save reads `name`'s layers: another writer acting in the Save's own window. */
  onSaveLayers: Map<string, () => void>;
  /** objectstack#37440 — run once right before `name`'s next publish reaches the door: another writer in between. */
  onPublish: Map<string, () => void>;
  /** objectstack#37440 — the `draftVersion` each publish named, in order. */
  publishDraftPins: Array<string | undefined>;
  /** Held list reads, released by the test (the load-sequencing case). */
  listGates: Deferred[];
  seq: number;
}

/** The 409 the door answers, run through the real client's error parser. */
async function conflictRefusal(name: string, head: string | null): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(
        JSON.stringify({
          error: `object/${name} has been modified since you loaded it.`,
          code: 'METADATA_CONFLICT',
          currentVersion: head,
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  });
  return client.publish('object', name).then(
    () => {
      throw new Error('the stub door accepted the write');
    },
    (e: unknown) => e as MetadataError,
  );
}

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function newServer(): Server {
  const server: Server = {
    published: new Map(),
    publishedVersions: new Map(),
    drafts: new Map(),
    draftVersions: new Map(),
    servesDraftVersion: true,
    saves: [],
    publishes: [],
    resets: [],
    draftReadPackages: [],
    onSaveLayers: new Map(),
    onPublish: new Map(),
    publishDraftPins: [],
    listGates: [],
    seq: 0,
  };
  server.published.set('a_alpha', { name: 'a_alpha', label: 'Alpha', sharingModel: 'private', fields: {} });
  server.publishedVersions.set('a_alpha', 'pub:alpha0');
  server.published.set('b_beta', { name: 'b_beta', label: 'Beta', sharingModel: 'private', fields: {} });
  server.publishedVersions.set('b_beta', 'pub:beta0');
  return server;
}

function makeClient(server: Server, saving: { on: boolean }) {
  return {
    list: async () => {
      const gate = server.listGates.shift();
      if (gate) await gate.promise;
      return [...server.published.values()].map((b) => ({ name: b.name, label: b.label }));
    },
    listDrafts: async () => [...server.drafts.keys()].map((name) => ({ name })),
    layered: async (_t: string, name: string) => {
      if (saving.on) {
        const act = server.onSaveLayers.get(name);
        server.onSaveLayers.delete(name);
        act?.();
      }
      const live = server.published.get(name) ?? null;
      return {
        code: null,
        overlay: live && copy(live),
        effective: live && copy(live),
        overlayVersion: live ? (server.publishedVersions.get(name) ?? null) : null,
      };
    },
    getDraft: async (_t: string, name: string, opts?: { packageId?: string }) => {
      server.draftReadPackages.push(opts?.packageId);
      const draft = server.drafts.get(name);
      if (!draft) return null;
      const version = server.servesDraftVersion ? { version: server.draftVersions.get(name) ?? null } : {};
      return { type: 'object', name, item: copy(draft), ...version };
    },
    save: async (_t: string, name: string, body: Body, opts?: { ifMatch?: string; ifNoneMatch?: '*' }) => {
      server.saves.push({ name, ifMatch: opts?.ifMatch, ifNoneMatch: opts?.ifNoneMatch });
      const head = server.drafts.has(name) ? (server.draftVersions.get(name) ?? null) : null;
      if (opts?.ifMatch !== undefined && opts.ifMatch !== head) throw await conflictRefusal(name, head);
      if (opts?.ifNoneMatch !== undefined && head !== null) throw await conflictRefusal(name, head);
      server.seq += 1;
      const version = `draft:mine${server.seq}`;
      server.drafts.set(name, copy(body));
      server.draftVersions.set(name, version);
      return { success: true, version, state: 'draft' };
    },
    publish: async (_t: string, name: string, opts?: { ifMatch?: string; ifNoneMatch?: '*'; draftVersion?: string }) => {
      server.publishes.push({ name, ifMatch: opts?.ifMatch, ifNoneMatch: opts?.ifNoneMatch });
      server.publishDraftPins.push(opts?.draftVersion);
      const between = server.onPublish.get(name);
      server.onPublish.delete(name);
      between?.();
      // objectstack#37440 — the door judges the draft pin first, against the draft row.
      if (opts?.draftVersion !== undefined && opts.draftVersion !== (server.draftVersions.get(name) ?? null)) {
        throw await conflictRefusal(name, server.draftVersions.get(name) ?? null);
      }
      const head = server.published.has(name) ? (server.publishedVersions.get(name) ?? null) : null;
      if (opts?.ifMatch !== undefined && opts.ifMatch !== head) throw await conflictRefusal(name, head);
      if (opts?.ifNoneMatch !== undefined && head !== null) throw await conflictRefusal(name, head);
      server.seq += 1;
      const version = `pub:mine${server.seq}`;
      const draft = server.drafts.get(name);
      if (draft) {
        server.published.set(name, draft);
        server.publishedVersions.set(name, version);
      }
      server.drafts.delete(name);
      server.draftVersions.delete(name);
      return { success: true, version };
    },
    reset: async (_t: string, name: string, opts?: { state?: string; ifMatch?: string }) => {
      if (opts?.state === 'draft') {
        const head = server.draftVersions.get(name) ?? null;
        if (opts.ifMatch !== undefined && opts.ifMatch !== head) throw await conflictRefusal(name, head);
        server.resets.push(name);
        server.drafts.delete(name);
        server.draftVersions.delete(name);
      }
      return { success: true };
    },
  } as unknown as React.ComponentProps<typeof PackageOwdOverviewPanel>['client'];
}

/** The panel, and a way to bump its publish nonce (a package publish elsewhere re-reads the table). */
function renderPanel(server: Server): { saving: { on: boolean }; bumpNonce: () => void } {
  const saving = { on: false };
  const client = makeClient(server, saving);
  const tree = (nonce: number) => (
    <StudioSaveHarness locale="en-US">
      <PackageOwdOverviewPanel client={client} packageId={PACKAGE} locale="en-US" publishNonce={nonce} />
    </StudioSaveHarness>
  );
  let nonce = 0;
  const { rerender } = render(tree(nonce));
  return { saving, bumpNonce: () => rerender(tree(++nonce)) };
}

/** Another writer (a copilot, another tab) saves `name`'s draft: the draft row and its version move. */
function anotherWriterSavesDraft(server: Server, name: string, patch: Body): string {
  server.seq += 1;
  const version = `draft:theirs${server.seq}`;
  const base = server.drafts.get(name) ?? server.published.get(name)!;
  server.drafts.set(name, { ...copy(base), ...patch });
  server.draftVersions.set(name, version);
  return version;
}

/** Another admin publishes `name`: the live row and its version move. */
function anotherAdminPublishes(server: Server, name: string, sharingModel: string): void {
  server.seq += 1;
  server.published.set(name, { ...server.published.get(name)!, sharingModel });
  server.publishedVersions.set(name, `pub:theirs${server.seq}`);
}

async function pick(name: string, option: string): Promise<void> {
  await screen.findByTestId(`owd-row-${name}`, undefined, WAIT);
  fireEvent.keyDown(screen.getByTestId(`owd-internal-${name}`), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: option }));
  await screen.findByTestId(`owd-dirty-${name}`);
}

async function save(saving: { on: boolean }): Promise<void> {
  saving.on = true;
  await pressStudioSave({ settle: false });
}

async function nextDialog(): Promise<HTMLElement> {
  return screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
}

async function answer(choice: 'reload' | 'cancel'): Promise<void> {
  fireEvent.click(screen.getByTestId(`draft-conflict-${choice}`));
  await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
}

/** Let every queued read run to its end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

const pins = (writes: Write[]) => writes.map((w) => [w.name, w.ifMatch, w.ifNoneMatch]);
const liveSharing = (server: Server, name: string) => server.published.get(name)?.sharingModel;

let server: Server;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  server = newServer();
});
afterEach(cleanup);

describe('the OWD overview — a draft replaced since the load is refused, not overwritten (objectstack#37515)', () => {
  it('a pending draft another writer re-saved after the load: the draft save is refused and asked about; nothing is written or published', async () => {
    server.drafts.set('a_alpha', { ...server.published.get('a_alpha')!, description: 'the copilot draft' });
    server.draftVersions.set('a_alpha', 'draft:v1');
    const { saving } = renderPanel(server);
    await pick('a_alpha', PUBLIC_READ_WRITE);
    const theirs = anotherWriterSavesDraft(server, 'a_alpha', { description: 'saved elsewhere' });

    await save(saving);
    const dialog = await nextDialog();
    // The draft dialog, not the live-change one: it is the draft that moved.
    expect(dialog).toHaveTextContent(L('engine.draftConflict.title'));
    expect(pins(server.saves)).toEqual([['a_alpha', 'draft:v1', undefined]]);
    expect(server.publishes).toEqual([]);

    await answer('cancel');
    expect(await screen.findByText(/Alpha: Not saved:/, undefined, WAIT)).toBeInTheDocument();
    // The other writer's draft stands as they saved it; the edit stays on the page.
    expect(server.draftVersions.get('a_alpha')).toBe(theirs);
    expect(server.drafts.get('a_alpha')).toMatchObject({ description: 'saved elsewhere', sharingModel: 'private' });
    expect(liveSharing(server, 'a_alpha')).toBe('private');
    expect(server.resets).toEqual([]);
    expect(screen.getByTestId('owd-dirty-a_alpha')).toBeInTheDocument();
  });

  it('a draft written in the Save\'s own window, after the Save read the row: refused, not replaced', async () => {
    const { saving } = renderPanel(server);
    await pick('b_beta', PUBLIC_READ);
    let theirs = '';
    server.onSaveLayers.set('b_beta', () => {
      theirs = anotherWriterSavesDraft(server, 'b_beta', { description: 'in between' });
    });

    await save(saving);
    await nextDialog();
    expect(pins(server.saves)).toEqual([['b_beta', undefined, '*']]);
    await answer('cancel');
    expect(server.draftVersions.get('b_beta')).toBe(theirs);
    expect(server.drafts.get('b_beta')).toMatchObject({ description: 'in between', sharingModel: 'private' });
    expect(server.publishes).toEqual([]);
  });

  it('"overwrite" asks again, then the author\'s version replaces the draft and goes live', async () => {
    server.drafts.set('a_alpha', { ...server.published.get('a_alpha')!, description: 'the copilot draft' });
    server.draftVersions.set('a_alpha', 'draft:v1');
    const { saving } = renderPanel(server);
    await pick('a_alpha', PUBLIC_READ_WRITE);
    const theirs = anotherWriterSavesDraft(server, 'a_alpha', { description: 'saved elsewhere' });

    await save(saving);
    await nextDialog();
    fireEvent.click(screen.getByTestId('draft-conflict-overwrite'));
    await screen.findByTestId('draft-conflict-overwrite-confirm');
    expect(server.saves).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByTestId('draft-conflict-overwrite-confirm'));
    });
    await waitFor(() => expect(liveSharing(server, 'a_alpha')).toBe('public_read_write'), WAIT);
    // Re-sent pinned to the version the refusal named; what went live is the
    // draft the author loaded and edited, not the one saved elsewhere.
    expect(pins(server.saves)).toEqual([
      ['a_alpha', 'draft:v1', undefined],
      ['a_alpha', theirs, undefined],
    ]);
    expect(server.published.get('a_alpha')).toMatchObject({ description: 'the copilot draft' });
  });
});

describe('the OWD overview — a draft that appeared after the load is never published unseen (objectstack#37515)', () => {
  it('the row loaded with no draft: its save asserts none, is refused, and nothing goes live', async () => {
    const { saving } = renderPanel(server);
    await pick('a_alpha', PUBLIC_READ_WRITE);
    const theirs = anotherWriterSavesDraft(server, 'a_alpha', { sharingModel: 'public_read', description: 'the copilot draft' });

    await save(saving);
    await nextDialog();
    expect(pins(server.saves)).toEqual([['a_alpha', undefined, '*']]);
    await answer('cancel');
    expect(await screen.findByText(/Alpha: Not saved:/, undefined, WAIT)).toBeInTheDocument();
    // Nothing the author never saw went live, and the copilot's draft is not taken back as if this Save wrote it.
    expect(server.publishes).toEqual([]);
    expect(liveSharing(server, 'a_alpha')).toBe('private');
    expect(server.resets).toEqual([]);
    expect(server.draftVersions.get('a_alpha')).toBe(theirs);
  });

  it('"reload" shows the draft under its mark; the next Save, made over it, goes live', async () => {
    const { saving } = renderPanel(server);
    await pick('a_alpha', PUBLIC_READ_WRITE);
    const theirs = anotherWriterSavesDraft(server, 'a_alpha', { sharingModel: 'public_read', description: 'the copilot draft' });

    await save(saving);
    await nextDialog();
    await answer('reload');
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-a_alpha')).toBeNull(), WAIT);
    expect(screen.getByTestId('owd-internal-a_alpha')).toHaveTextContent(PUBLIC_READ);
    expect(within(screen.getByTestId('owd-row-a_alpha')).getByText(UNPUBLISHED_DRAFT)).toBeInTheDocument();
    expect(server.publishes).toEqual([]);

    await pick('a_alpha', PUBLIC_READ_WRITE);
    await save(saving);
    await waitFor(() => expect(liveSharing(server, 'a_alpha')).toBe('public_read_write'), WAIT);
    expect(server.saves[server.saves.length - 1]).toMatchObject({ name: 'a_alpha', ifMatch: theirs });
    expect(server.published.get('a_alpha')).toMatchObject({ description: 'the copilot draft' });
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  });
});

describe('the OWD overview — the draft pin, with no other writer (objectstack#37515)', () => {
  it('control: the draft is read at the package; each save is pinned to its load and lands; no dialog', async () => {
    server.drafts.set('a_alpha', { ...server.published.get('a_alpha')!, description: 'the copilot draft' });
    server.draftVersions.set('a_alpha', 'draft:v1');
    const { saving } = renderPanel(server);
    await pick('a_alpha', PUBLIC_READ);
    await pick('b_beta', PUBLIC_READ_WRITE);
    await save(saving);
    await waitFor(() => expect(liveSharing(server, 'b_beta')).toBe('public_read_write'), WAIT);
    expect(liveSharing(server, 'a_alpha')).toBe('public_read');
    expect(pins(server.saves)).toEqual([
      ['a_alpha', 'draft:v1', undefined],
      ['b_beta', undefined, '*'],
    ]);
    expect(new Set(server.draftReadPackages)).toEqual(new Set([PACKAGE]));
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  });

  it('control: one editor saving one row twice never conflicts with its own Save (the entry goes on publish)', async () => {
    const { saving } = renderPanel(server);
    await pick('a_alpha', PUBLIC_READ);
    await save(saving);
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-a_alpha')).toBeNull(), WAIT);
    await pick('a_alpha', PUBLIC_READ_WRITE);
    await save(saving);
    await waitFor(() => expect(liveSharing(server, 'a_alpha')).toBe('public_read_write'), WAIT);
    expect(pins(server.saves)).toEqual([
      ['a_alpha', undefined, '*'],
      ['a_alpha', undefined, '*'],
    ]);
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  });

  it('control: a server whose draft read serves no `version` gets an unpinned draft save, as before', async () => {
    server.servesDraftVersion = false;
    server.drafts.set('a_alpha', { ...server.published.get('a_alpha')!, description: 'the copilot draft' });
    server.draftVersions.set('a_alpha', 'draft:v1');
    const { saving } = renderPanel(server);
    await pick('a_alpha', PUBLIC_READ);
    await save(saving);
    await waitFor(() => expect(liveSharing(server, 'a_alpha')).toBe('public_read'), WAIT);
    expect(pins(server.saves)).toEqual([['a_alpha', undefined, undefined]]);
  });

  it('a row refused at its draft save keeps its edit over a re-read, still pinned to the load it was made on', async () => {
    const { saving } = renderPanel(server);
    await pick('a_alpha', PUBLIC_READ_WRITE);
    await pick('b_beta', PUBLIC_READ);
    anotherWriterSavesDraft(server, 'a_alpha', { description: 'the copilot draft' });
    await save(saving);
    await nextDialog();
    await answer('cancel');
    // Beta went live and the table was read back, Alpha's edit kept.
    await waitFor(() => expect(liveSharing(server, 'b_beta')).toBe('public_read'), WAIT);
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-b_beta')).toBeNull(), WAIT);
    expect(screen.getByTestId('owd-dirty-a_alpha')).toBeInTheDocument();

    // That re-read served the copilot's draft; the kept edit is still the one made with none: asked again.
    const before = server.saves.length;
    await save(saving);
    await nextDialog();
    expect(pins(server.saves.slice(before))).toEqual([['a_alpha', undefined, '*']]);
    expect(liveSharing(server, 'a_alpha')).toBe('private');
  });
});

describe('the OWD overview — loads are sequenced (objectstack#37515)', () => {
  it('a plain load finishing before the kept-edit re-read it overlapped does not re-pin the kept edit to its read', async () => {
    const { saving, bumpNonce } = renderPanel(server);
    await pick('a_alpha', PUBLIC_READ_WRITE);
    await pick('b_beta', PUBLIC_READ);
    anotherAdminPublishes(server, 'a_alpha', 'public_read');
    // Hold the next two loads: the package-publish re-read, then the Save's kept-edit re-read.
    const plain = deferred();
    const keep = deferred();
    server.listGates.push(plain, keep);

    await save(saving);
    await nextDialog();
    bumpNonce();
    await answer('cancel');
    // Beta goes live; the pass's re-read (keeping Alpha's edit) waits behind the plain one.
    await waitFor(() => expect(liveSharing(server, 'b_beta')).toBe('public_read'), WAIT);
    // The plain load runs to its end first, then the kept-edit re-read.
    await act(async () => {
      plain.release();
      await settle();
    });
    await act(async () => {
      keep.release();
      await settle();
    });
    await waitFor(() => expect(screen.queryByTestId('owd-dirty-b_beta')).toBeNull(), WAIT);
    expect(screen.getByTestId('owd-dirty-a_alpha')).toBeInTheDocument();

    // Alpha's next publish is still pinned to the row its edit was made on: asked, never published over theirs.
    const before = server.publishes.length;
    await save(saving);
    await nextDialog();
    expect(pins(server.publishes.slice(before))).toEqual([['a_alpha', 'pub:alpha0', undefined]]);
    expect(liveSharing(server, 'a_alpha')).toBe('public_read');
  });
});

describe('the OWD overview — a row\'s publish promotes only the draft its own save wrote (objectstack#37440)', () => {
  it('PIN: another writer\'s draft lands between the row\'s draft save and its publish: nothing goes live, their draft is kept, nothing is asked', async () => {
    const { saving } = renderPanel(server);
    await pick('b_beta', PUBLIC_READ);
    let theirs = '';
    server.onPublish.set('b_beta', () => {
      theirs = anotherWriterSavesDraft(server, 'b_beta', { description: 'in between' });
    });

    await save(saving);
    // The row reads as refused (the door's own refusal), edits on the page.
    expect(await screen.findByText(/^Beta: /, undefined, WAIT)).toBeInTheDocument();
    // The publish named the draft this Save wrote: its own receipt.
    expect(server.publishDraftPins).toEqual(['draft:mine1']);
    expect(liveSharing(server, 'b_beta')).toBe('private');
    // Their draft stands, never taken back as if it were this Save's.
    expect(server.draftVersions.get('b_beta')).toBe(theirs);
    expect(server.drafts.get('b_beta')).toMatchObject({ description: 'in between' });
    expect(server.resets).toEqual([]);
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
    expect(screen.getByTestId('owd-dirty-b_beta')).toBeInTheDocument();
  });

  it('CONTROL: with no other writer in between, the row\'s draft goes live', async () => {
    const { saving } = renderPanel(server);
    await pick('b_beta', PUBLIC_READ);

    await save(saving);
    await waitFor(() => expect(liveSharing(server, 'b_beta')).toBe('public_read'), WAIT);
    expect(server.drafts.has('b_beta')).toBe(false);
    expect(server.resets).toEqual([]);
  });
});
