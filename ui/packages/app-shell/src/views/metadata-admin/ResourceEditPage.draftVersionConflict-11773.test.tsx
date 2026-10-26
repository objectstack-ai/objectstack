// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11773 — the metadata designer's draft save sends the version its
 * buffer was saved at, and its two 409s stay apart.
 *
 * The `/meta` draft door answers two different conflicts with the same status
 * and they need different answers from the author:
 *
 *  - `409 DESTRUCTIVE_CHANGE` — the body would drop or narrow data; the editor's
 *    own confirmation re-sends it with `force`. Judged BEFORE the version.
 *  - `409 METADATA_CONFLICT` — the draft was saved elsewhere since this buffer
 *    was; the shared conflict dialog offers reload or overwrite.
 *
 * The door double answers the way the published 18.0.0-next.0 door was
 * measured to (readings on the pull request): the draft read serves the
 * draft's `version` (no draft: `null` from `getDraft`), a stale `If-Match` or
 * an `If-None-Match: *` over an existing draft is `409 METADATA_CONFLICT` with
 * `currentVersion`. Its refusals are parsed by the REAL `MetadataClient`. Only
 * the page canvas is stubbed, to hand the test a way to dirty the draft; the
 * autosave, the save door and both dialogs are shipping code.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';

const PAGE = {
  name: 'home',
  label: 'Home',
  type: 'home',
  template: 'default',
  regions: [{ name: 'main', components: [{ type: 'text', id: 'b1' }] }],
};

/** A label the door double treats as dropping data, so the destructive path is reachable. */
const DESTRUCTIVE_LABEL = 'Drops a column';

interface SaveCall {
  body: Record<string, unknown>;
  force: boolean;
  ifMatch: string | undefined;
  ifNoneMatch: string | undefined;
}

const door = {
  draft: null as null | { body: Record<string, unknown>; version: string },
  seq: 0,
  saves: [] as SaveCall[],
};

async function parsedRefusal(wire: unknown): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(JSON.stringify(wire), { status: 409, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch,
  });
  return client.save('page', 'home', {}, { mode: 'draft' }).then(
    () => {
      throw new Error('the stub door accepted the save');
    },
    (e: unknown) => e as MetadataError,
  );
}

function writeDraft(body: Record<string, unknown>): string {
  door.seq += 1;
  const version = `hmac-sha256:v${door.seq}`;
  door.draft = { body, version };
  return version;
}

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: PAGE, code: PAGE, editable: true })),
  // The draft read serves the body and its version; no draft is `null`.
  getDraft: vi.fn(async () =>
    door.draft
      ? { type: 'page', name: 'home', item: JSON.parse(JSON.stringify(door.draft.body)), version: door.draft.version }
      : null,
  ),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
  save: vi.fn(async (_type: string, _name: string, item: unknown, options?: { force?: boolean; ifMatch?: string; ifNoneMatch?: string }) => {
    const body = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    const ifMatch = options?.ifMatch;
    const ifNoneMatch = options?.ifNoneMatch;
    const force = !!options?.force;
    door.saves.push({ body, force, ifMatch, ifNoneMatch });
    if (body.label === DESTRUCTIVE_LABEL && !force) {
      throw await parsedRefusal({
        error: "page/home would drop or transform existing data: Field 'subject' removed. — re-submit with ?force=true to proceed.",
        code: 'DESTRUCTIVE_CHANGE',
        issues: [{ code: 'field_removed', field: 'subject', message: "Field 'subject' removed." }],
      });
    }
    const head = door.draft?.version ?? null;
    if ((ifMatch !== undefined && ifMatch !== head) || (ifNoneMatch !== undefined && head !== null)) {
      throw await parsedRefusal({
        error: `page/home has been modified since you loaded it. The version token sent is not the current version (current is ${head}).`,
        code: 'METADATA_CONFLICT',
        currentVersion: head,
      });
    }
    const version = writeDraft(body);
    return { success: true, version, seq: door.seq, state: 'draft', message: `Saved page 'home' [seq=${door.seq}]` };
  }),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [{ type: 'page', name: 'page', label: 'Page', allowEnvironmentOverlay: true, schema: { required: [] } }],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerMetadataPreview, getMetadataPreview } from './preview-registry';

/** Canvas stand-in: its only job is to dirty the draft, which arms the real autosave. */
function StubPageCanvas({ onPatch }: { onPatch?: (patch: Record<string, unknown>) => void }) {
  return (
    <>
      {['One', 'Two', 'Three', DESTRUCTIVE_LABEL].map((label) => (
        <button key={label} type="button" onClick={() => onPatch?.({ label })}>
          {`label ${label}`}
        </button>
      ))}
    </>
  );
}

const realPagePreview = getMetadataPreview('page');

beforeEach(() => {
  door.draft = null;
  door.seq = 0;
  door.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  registerMetadataPreview('page', StubPageCanvas as never);
  window.history.replaceState(null, '', '/metadata/page/home?package=com.acme.app');
});

afterEach(() => {
  cleanup();
  if (realPagePreview) registerMetadataPreview('page', realPagePreview);
  window.history.replaceState(null, '', '/');
});

function renderEditor() {
  render(
    <MemoryRouter initialEntries={['/metadata/page/home?package=com.acme.app']}>
      <MetadataResourceEditPage type="page" name="home" />
    </MemoryRouter>,
  );
}

/** Patch the label and wait for the autosave that carries it to be sent. */
async function patchAndSave(label: string): Promise<SaveCall> {
  const before = door.saves.length;
  fireEvent.click(await screen.findByRole('button', { name: `label ${label}` }, { timeout: 8000 }));
  await waitFor(() => expect(door.saves.length).toBe(before + 1), { timeout: 8000 });
  return door.saves[door.saves.length - 1]!;
}

describe('MetadataResourceEditPage — draft saves carry their version (objectui#11773)', () => {
  it('the first autosave is pinned to the load (no draft: If-None-Match); each later one sends the version the one before it received', async () => {
    renderEditor();
    const first = await patchAndSave('One');
    expect([first.ifMatch, first.ifNoneMatch]).toEqual([undefined, '*']);
    await waitFor(() => expect(door.draft?.version).toBe('hmac-sha256:v1'), { timeout: 8000 });
    expect((await patchAndSave('Two')).ifMatch).toBe('hmac-sha256:v1');
    await waitFor(() => expect(door.draft?.version).toBe('hmac-sha256:v2'), { timeout: 8000 });
    expect((await patchAndSave('Three')).ifMatch).toBe('hmac-sha256:v2');
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  });

  it('a draft saved elsewhere refuses the stale save with the CONFLICT dialog, not the destructive one', async () => {
    renderEditor();
    await patchAndSave('One');
    await waitFor(() => expect(door.draft?.version).toBe('hmac-sha256:v1'), { timeout: 8000 });
    // Another editor's save of the same draft.
    writeDraft({ ...PAGE, label: 'Theirs' });

    const stale = await patchAndSave('Two');
    expect(stale.ifMatch).toBe('hmac-sha256:v1');
    expect(await screen.findByTestId('draft-conflict-dialog', undefined, { timeout: 8000 })).toHaveTextContent('home');
    expect(screen.queryByText('Destructive change detected')).toBeNull();
    expect(door.draft?.body.label).toBe('Theirs');

    fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), { timeout: 8000 });
    // The reload re-read the draft, so the next save is pinned to THEIR
    // version and starts from their body.
    await waitFor(() => expect(mockClient.getDraft.mock.calls.length).toBeGreaterThanOrEqual(3), { timeout: 8000 });
    expect((await patchAndSave('Three')).ifMatch).toBe('hmac-sha256:v2');
  });

  it('a load of an item with a pending draft: the first save sends If-Match with the version the read served', async () => {
    const theirs = writeDraft({ ...PAGE, label: 'Pending' });
    renderEditor();
    const first = await patchAndSave('One');
    expect([first.ifMatch, first.ifNoneMatch]).toEqual([theirs, undefined]);
    // The draft was read at the package the save writes.
    expect(mockClient.getDraft).toHaveBeenCalledWith('page', 'home', { packageId: 'com.acme.app' });
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  });

  it('two editors who each load and save once: the later first save is refused, and the earlier draft survives', async () => {
    renderEditor();
    await screen.findByRole('button', { name: 'label One' }, { timeout: 8000 });
    // The other editor, who opened the page at the same time, saves first.
    writeDraft({ ...PAGE, label: 'Theirs', description: 'kept' });

    const mine = await patchAndSave('One');
    expect([mine.ifMatch, mine.ifNoneMatch]).toEqual([undefined, '*']);
    expect(await screen.findByTestId('draft-conflict-dialog', undefined, { timeout: 8000 })).toHaveTextContent('home');
    expect(door.draft?.body).toMatchObject({ label: 'Theirs', description: 'kept' });
  });

  it('"overwrite" after a 409 re-sends pinned to the refusal\'s currentVersion, and the next save to its receipt', async () => {
    renderEditor();
    await patchAndSave('One');
    await waitFor(() => expect(door.draft?.version).toBe('hmac-sha256:v1'), { timeout: 8000 });
    const theirs = writeDraft({ ...PAGE, label: 'Theirs' });

    await patchAndSave('Two');
    await screen.findByTestId('draft-conflict-dialog', undefined, { timeout: 8000 });
    fireEvent.click(screen.getByTestId('draft-conflict-overwrite'));
    const before = door.saves.length;
    fireEvent.click(await screen.findByTestId('draft-conflict-overwrite-confirm'));
    await waitFor(() => expect(door.saves.length).toBe(before + 1), { timeout: 8000 });
    const overwrite = door.saves[door.saves.length - 1]!;
    expect([overwrite.ifMatch, overwrite.ifNoneMatch, overwrite.body.label]).toEqual([theirs, undefined, 'Two']);
    await waitFor(() => expect(door.draft?.body.label).toBe('Two'), { timeout: 8000 });
    const overwriteReceipt = door.draft?.version;

    expect((await patchAndSave('Three')).ifMatch).toBe(overwriteReceipt);
  });

  it('control: a destructive change still opens its own confirmation, and the forced retry keeps the version', async () => {
    renderEditor();
    await patchAndSave('One');
    await waitFor(() => expect(door.draft?.version).toBe('hmac-sha256:v1'), { timeout: 8000 });

    const refused = await patchAndSave(DESTRUCTIVE_LABEL);
    expect([refused.force, refused.ifMatch]).toEqual([false, 'hmac-sha256:v1']);
    expect(await screen.findByText('Destructive change detected', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();

    const before = door.saves.length;
    fireEvent.click(screen.getByRole('button', { name: 'Force save' }));
    await waitFor(() => expect(door.saves.length).toBe(before + 1), { timeout: 8000 });
    const forced = door.saves[door.saves.length - 1]!;
    expect([forced.force, forced.ifMatch, forced.body.label]).toEqual([true, 'hmac-sha256:v1', DESTRUCTIVE_LABEL]);
    await waitFor(() => expect(door.draft?.body.label).toBe(DESTRUCTIVE_LABEL), { timeout: 8000 });
  });
});
