// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36726 — a hook's Save publishes over the published hook it was
 * loaded at, never over one another writer published since.
 *
 * A Studio Save is the hook's draft and then that one hook's publish
 * (objectstack#36511), so it leaves no draft behind: two editors that opened
 * the same published hook each assert "no draft" and both pass the draft door.
 * Before this card the hook's publish was unpinned, and the later Save
 * replaced the earlier one's live hook without a word. Now the list load
 * reads each listed hook's layers at the package the publish writes and pins
 * the publish to its `overlayVersion` (`If-Match`), so the later Save is
 * refused `409 METADATA_CONFLICT` and the author is asked: reload, overwrite,
 * or keep editing.
 *
 * The other writer is the server double's own move of the live row (a Save
 * from another tab, a rollback): the panel cannot tell them apart, and one
 * panel keeps the queries unambiguous. The door's refusal is parsed by the
 * REAL `MetadataClient`, so the error the buffer catches is production's.
 *
 * And the reload residual (the scope addition on the card): a hook with a
 * draft pending before the Save (a copilot's) keeps that draft through a
 * refused publish and a reload, so the reload re-reads it carrying the
 * page's edit. Its next Save is asked again, never published over the row
 * that moved.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';

const PKG = 'com.example.showcase';
const GUARD = { name: 'guard_hook', label: 'Guard', object: 'invoice', events: ['beforeInsert'], handler: 'guard_fn' };
/** The live row's version the panel opens at. */
const LIVE = 'hmac-sha256:live0';
/** A draft pending before the Save (a copilot's). */
const PENDING = 'hmac-sha256:pending';

interface Sent {
  name: string;
  body: Record<string, unknown>;
  ifMatch: string | undefined;
  ifNoneMatch: string | undefined;
}

const srv = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  activeVersions: new Map<string, string>(),
  drafts: new Map<string, { body: Record<string, unknown>; version: string }>(),
  // A server from before `overlayVersion` was served serves none (the control).
  servesPublishedVersion: true,
  saves: [] as Array<{ name: string; body: Record<string, unknown>; ifMatch: string | undefined; ifNoneMatch: string | undefined }>,
  publishes: [] as Array<{ name: string; ifMatch: string | undefined; ifNoneMatch: string | undefined }>,
  seq: 0,
}));

/** The 409 the door answers, run through the real client's error parser. */
async function conflictRefusal(name: string, head: string | null): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(
        JSON.stringify({
          error: `hook/${name} has been modified since you loaded it. The version token sent is not the current version (current is ${head}).`,
          code: 'METADATA_CONFLICT',
          currentVersion: head,
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  });
  return client.publish('hook', name).then(
    () => {
      throw new Error('the stub door accepted the publish');
    },
    (e: unknown) => e as MetadataError,
  );
}

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const mockClient = {
  list: vi.fn(async () => [...srv.active.values()].map(copy)),
  listDrafts: vi.fn(async () => [...srv.drafts.keys()].map((name) => ({ type: 'hook', name }))),
  getDraft: vi.fn(async (_type: string, name: string) => {
    const row = srv.drafts.get(name);
    return row ? { type: 'hook', name, item: copy(row.body), version: row.version } : null;
  }),
  get: vi.fn(async () => null),
  layered: vi.fn(async (_type: string, name: string) => {
    const live = srv.active.get(name) ?? null;
    const draft = srv.drafts.get(name)?.body ?? null;
    const version = srv.servesPublishedVersion ? { overlayVersion: live ? (srv.activeVersions.get(name) ?? null) : null } : {};
    return { code: null, overlay: live && copy(live), effective: live && copy(live), draft: draft && copy(draft), ...version };
  }),
  withPreviewDrafts() {
    return this;
  },
  save: vi.fn(
    async (_type: string, name: string, item: Record<string, unknown>, options?: { ifMatch?: string; ifNoneMatch?: string }) => {
      const body = copy(item);
      srv.saves.push({ name, body, ifMatch: options?.ifMatch, ifNoneMatch: options?.ifNoneMatch });
      const head = srv.drafts.get(name)?.version ?? null;
      if (options?.ifMatch !== undefined && options.ifMatch !== head) throw await conflictRefusal(name, head);
      if (options?.ifNoneMatch !== undefined && head !== null) throw await conflictRefusal(name, head);
      srv.seq += 1;
      const version = `hmac-sha256:v${srv.seq}`;
      srv.drafts.set(name, { body, version });
      return { success: true, version, seq: srv.seq, state: 'draft' };
    },
  ),
  // The Save's own publish, pinned on the live row: the draft goes live and none is left.
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
  // The draft discard a refused Save sends (`?state=draft`).
  reset: vi.fn(async (_type: string, name: string, options?: { state?: string }) => {
    if (options?.state === 'draft') srv.drafts.delete(name);
    return { success: true };
  }),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import { HooksPanelHost } from './__tests__/hooksPanelHost';
import { pressStudioSave } from './__tests__/studioSaveHarness';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
// The source reaches a dynamic `import('@objectstack/lint')`: its first load is paid at collection (`check:test-source-alias`).
import '@objectstack/lint';
import { __setCelFormulaLoader } from '../metadata-admin/celAuthoring';

registerBuiltinInspectors();

beforeEach(() => {
  srv.active.clear();
  srv.activeVersions.clear();
  srv.drafts.clear();
  srv.servesPublishedVersion = true;
  srv.saves.length = 0;
  srv.publishes.length = 0;
  srv.seq = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear?: () => void }).mockClear?.();
  srv.active.set(GUARD.name, copy(GUARD));
  srv.activeVersions.set(GUARD.name, LIVE);
  __setCelFormulaLoader(() =>
    Promise.resolve({
      validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
      introspectScope: () => ({ fields: ['status'], roots: ['record'], functions: ['has'] }),
      inferExpressionType: () => 'boolean' as const,
    }),
  );
});
afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

const WAIT = { timeout: 4000 };

function openPanel() {
  render(<HooksPanelHost objectName="invoice" packageId={PKG} />);
}

/** Open the hook by its label and type a condition into its Expression tab: nothing is sent. */
async function edit(label: string, condition: string): Promise<void> {
  // The rail's row: the open hook's label shows in its inspector too.
  fireEvent.click((await screen.findAllByText(label, undefined, WAIT))[0]!);
  // A hook whose condition is already an expression opens on that mode: no "Expression" choice to press.
  const box = await waitFor(() => {
    const mode = screen.queryByText('Expression');
    if (mode) fireEvent.click(mode);
    const found = screen.queryAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA');
    if (!found) throw new Error('the condition box is not drawn yet');
    return found as HTMLTextAreaElement;
  }, WAIT);
  fireEvent.change(box, { target: { value: condition } });
}

/** Press Save and wait for its draft write; a Save refused at its publish stops on the dialog. */
async function save(): Promise<Sent> {
  const before = srv.saves.length;
  await pressStudioSave({ settle: false });
  await waitFor(() => expect(srv.saves.length).toBe(before + 1), WAIT);
  return srv.saves[srv.saves.length - 1]!;
}

async function saveAndLand(): Promise<void> {
  await save();
  await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull(), WAIT);
}

/** Another writer publishes the hook (another tab's Save, a rollback): the live row and its version move. */
function anotherWriterPublishes(patch: Record<string, unknown>): string {
  srv.seq += 1;
  const version = `hmac-sha256:other${srv.seq}`;
  srv.active.set(GUARD.name, { ...srv.active.get(GUARD.name)!, ...patch });
  srv.activeVersions.set(GUARD.name, version);
  return version;
}

const live = () => srv.active.get(GUARD.name)!;

/** The race: the panel opened at LIVE, another writer published, then this panel's Save. */
async function racePublished(): Promise<string> {
  openPanel();
  await edit('Guard', "record.status == 'open'");
  const theirs = anotherWriterPublishes({ label: 'Guard (B)' });
  const sent = await save();
  // Its draft passes: no draft was pending, and none is.
  expect([sent.ifMatch, sent.ifNoneMatch]).toEqual([undefined, '*']);
  await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
  return theirs;
}

describe('Hooks — two Saves over one published hook are not last-writer-wins (objectstack#36726)', () => {
  it('the later Save is refused at its publish, worded as a live change; keep editing leaves the edit unsaved', async () => {
    await racePublished();
    expect(srv.publishes.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([[LIVE, undefined]]);
    expect(live().label).toBe('Guard (B)');
    expect(screen.getByTestId('draft-conflict-dialog')).toHaveTextContent('This changed since you opened it');
    expect(screen.getByTestId('draft-conflict-dialog')).toHaveTextContent('guard_hook');

    fireEvent.click(screen.getByTestId('draft-conflict-cancel'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    // Nothing went live, the draft the Save wrote is taken back, and the edit stays, unsaved.
    expect(await screen.findByText(/^Not saved:/, undefined, WAIT)).toBeInTheDocument();
    expect(live().label).toBe('Guard (B)');
    expect(live().condition).toBeUndefined();
    expect(srv.drafts.size).toBe(0);
    expect(screen.getByTestId('studio-save')).toBeInTheDocument();
  });

  it('"reload" re-reads the other writer\'s hook, and the next Save is pinned to it', async () => {
    const theirs = await racePublished();
    fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    expect(srv.drafts.size).toBe(0);

    await edit('Guard (B)', "record.status == 'void'");
    await saveAndLand();
    expect(srv.publishes[srv.publishes.length - 1]).toMatchObject({ ifMatch: theirs, ifNoneMatch: undefined });
    // Built on the other writer's hook: its label is kept.
    expect(live()).toMatchObject({ label: 'Guard (B)', condition: "record.status == 'void'" });
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  });

  it('"overwrite" asks again, then re-publishes pinned to the refusal\'s currentVersion', async () => {
    const theirs = await racePublished();
    fireEvent.click(screen.getByTestId('draft-conflict-overwrite'));
    const before = srv.publishes.length;
    expect(await screen.findByTestId('draft-conflict-overwrite-confirm')).toBeInTheDocument();
    expect(srv.publishes.length).toBe(before);
    await act(async () => {
      fireEvent.click(screen.getByTestId('draft-conflict-overwrite-confirm'));
    });
    await waitFor(() => expect(live().condition).toBe("record.status == 'open'"), WAIT);
    expect(srv.publishes[srv.publishes.length - 1]).toMatchObject({ ifMatch: theirs });
  });

  it('one editor: each Save\'s publish is pinned to the version the last one left, so it never conflicts with itself', async () => {
    openPanel();
    await edit('Guard', "record.status == 'open'");
    await saveAndLand();
    const first = srv.activeVersions.get(GUARD.name)!;
    await edit('Guard', "record.status == 'void'");
    await saveAndLand();
    expect(srv.publishes.map((p) => p.ifMatch)).toEqual([LIVE, first]);
    expect(live().condition).toBe("record.status == 'void'");
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  });

  it('a new hook\'s publish asserts no published row of its name', async () => {
    openPanel();
    await screen.findByText('Guard', undefined, WAIT);
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    await save();
    await waitFor(() => expect(srv.publishes).toHaveLength(1), WAIT);
    expect(srv.publishes[0]).toMatchObject({ ifMatch: undefined, ifNoneMatch: '*' });
  });

  it('control: a server that serves no `overlayVersion` gets an unpinned publish, as before', async () => {
    srv.servesPublishedVersion = false;
    openPanel();
    await edit('Guard', "record.status == 'open'");
    anotherWriterPublishes({ label: 'Guard (B)' });
    await saveAndLand();
    expect(srv.publishes.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([[undefined, undefined]]);
  });
});

describe('Hooks — a reload over a pending draft does not pin its publish to the fresh read (objectstack#36726)', () => {
  it('a pending draft, a live change by another writer, a refused publish, Reload: the next Save is asked again', async () => {
    srv.drafts.set(GUARD.name, { body: copy(GUARD), version: PENDING });
    openPanel();
    await edit('Guard', "record.status == 'open'");
    // Another writer moves the live row without touching the pending draft.
    anotherWriterPublishes({ label: 'Guard (B)' });
    const sent = await save();
    expect(sent.ifMatch).toBe(PENDING);
    await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
    fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    // The draft pending before the Save is kept (it carries the page's edit), and re-read.
    expect(srv.drafts.get(GUARD.name)?.body.condition).toBe("record.status == 'open'");

    await edit('Guard', "record.status == 'void'");
    const publishesBefore = srv.publishes.length;
    await save();
    await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
    // Pinned to the version the conflict was raised on, never the fresh read's: asked again.
    expect(srv.publishes.slice(publishesBefore).map((p) => p.ifMatch)).toEqual([LIVE]);
    expect(live()).toMatchObject({ label: 'Guard (B)' });
    expect(live().condition).toBeUndefined();
  });
});
