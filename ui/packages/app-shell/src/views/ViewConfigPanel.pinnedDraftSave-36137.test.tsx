// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36137 — every Console writer of a view draft is pinned, so a
 * view settings save that lands between 「Save to this view」's draft write and
 * its publish is refused instead of being published with it (ruling record
 * 7058616478 on objectstack#35955: a pending draft is never published on
 * someone else's behalf).
 *
 * The door is a `fetch` double of the `/meta` draft door, answering the way
 * `DraftConflictDialog.test.tsx` records it was measured to answer (a draft
 * save's receipt `version`, the draft read's `version`, `409
 * METADATA_CONFLICT` with `currentVersion` for a stale `If-Match` or for
 * `If-None-Match: *` over a draft), plus a publish that promotes the draft and
 * drops it. Every address names no package, as these Console writers do. The
 * client is the REAL `MetadataClient`, so the headers on the wire are
 * production's.
 *
 * The panel's host is the body of `handleViewConfigSave`: the panel's buffer
 * through `buildViewConfigSaveBody`, written by `persistRuntimeMetadata` with
 * the guard the panel hands it. That `ObjectView`'s handler forwards the guard
 * is pinned in `ObjectView.viewConfigSaveWiring-10210.test.tsx`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';

vi.mock('./RuntimeDraftBar', () => ({ RuntimeDraftBar: () => null }));

// One control: an edit of the view's label, as the real inspector's label field patches it.
vi.mock('./metadata-admin/inspectors/ViewVariantInspector', () => ({
  ViewVariantInspector: ({ draft, onPatch }: any) => (
    <div>
      <span data-testid="mock-inspector-shown-label">{String(draft?.label)}</span>
      <button
        type="button"
        data-testid="mock-inspector-label"
        onClick={() => onPatch({ label: 'Settings edit', config: { ...(draft?.config ?? {}), label: 'Settings edit' } })}
      >
        edit
      </button>
    </div>
  ),
}));

// Paid at collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import '@objectstack/formula';
import { ViewConfigPanel } from './ViewConfigPanel';
import { buildViewConfigSaveBody } from './objectViewTabs';
import {
  createRuntimeMetadata,
  persistRuntimeMetadata,
  saveAndPublishRuntimeMetadata,
  viewEnvelope,
} from './runtime-metadata-persistence';
import type { DraftVersionGuard } from './metadata-admin/DraftConflictDialog';

const OBJECT = 'crm_lead';
const VIEW_ID = `${OBJECT}.all`;
const PUBLISHED = {
  name: VIEW_ID,
  object: OBJECT,
  viewKind: 'list',
  label: 'Everything',
  config: { type: 'grid', columns: [{ field: 'name' }], data: { provider: 'object', object: OBJECT } },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const token = (seq: number) => `hmac-sha256:${seq.toString(16).padStart(64, '0')}`;

interface SentPut {
  name: string;
  ifMatch: string | null;
  ifNoneMatch: string | null;
  label: unknown;
  status: number;
}

/** The `/meta` view doors for package-less addresses; `holdPublish` parks the next publish. */
function viewDoor(start: { draft?: Record<string, unknown> } = {}) {
  let seq = 0;
  const published = new Map<string, Record<string, unknown>>([[VIEW_ID, PUBLISHED]]);
  const drafts = new Map<string, { body: Record<string, unknown>; version: string }>();
  if (start.draft) drafts.set(VIEW_ID, { body: start.draft, version: token(++seq) });
  const puts: SentPut[] = [];
  const publishes: Array<Record<string, unknown>> = [];
  let parked: { release: () => void } | null = null;
  let parkNext = false;
  let publishArrived: () => void = () => {};
  const arrived = new Promise<void>((resolve) => { publishArrived = resolve; });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname.endsWith('/meta/_drafts')) {
      return json(200, { drafts: [...drafts.keys()].map((name) => ({ type: 'view', name })) });
    }
    const m = /\/meta\/view\/([^/]+)(\/layers|\/publish)?$/.exec(url.pathname);
    if (!m) return json(404, { error: 'not modelled' });
    const name = decodeURIComponent(m[1]!);
    const tail = m[2];
    if (method === 'GET' && tail === '/layers') {
      const effective = published.get(name) ?? null;
      return json(200, {
        code: null,
        overlay: effective,
        overlayScope: effective ? 'env' : null,
        effective,
        draft: drafts.get(name)?.body ?? null,
      });
    }
    if (method === 'GET' && url.searchParams.get('state') === 'draft') {
      const row = drafts.get(name);
      if (!row) return json(404, { error: `No pending draft exists for view/${name}.`, code: 'NO_DRAFT' });
      return json(200, { type: 'view', name, item: row.body, version: row.version });
    }
    if (method === 'POST' && tail === '/publish') {
      if (parkNext) {
        parkNext = false;
        publishArrived();
        await new Promise<void>((resolve) => { parked = { release: resolve }; });
      }
      const row = drafts.get(name);
      if (!row) return json(404, { error: `No pending draft exists for view/${name}.`, code: 'NO_DRAFT' });
      published.set(name, row.body);
      drafts.delete(name);
      publishes.push(row.body);
      return json(200, { success: true, version: token(++seq), seq, message: 'published' });
    }
    if (method === 'DELETE') {
      drafts.delete(name);
      return json(200, { success: true });
    }
    if (method !== 'PUT' || url.searchParams.get('mode') !== 'draft') return json(404, { error: 'not modelled' });
    const headers = new Headers(init?.headers);
    const ifMatch = headers.get('If-Match');
    const ifNoneMatch = headers.get('If-None-Match');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const head = drafts.get(name)?.version ?? null;
    const refused =
      (ifMatch !== null && (head === null || ifMatch.replace(/^"|"$/g, '') !== head)) ||
      (ifNoneMatch !== null && head !== null);
    puts.push({ name, ifMatch, ifNoneMatch, label: body.label, status: refused ? 409 : 200 });
    if (refused) {
      return json(409, {
        error: `view/${name} has been modified since you loaded it.`,
        code: 'METADATA_CONFLICT',
        currentVersion: head,
      });
    }
    const version = token(++seq);
    drafts.set(name, { body, version });
    return json(200, { success: true, version, seq, state: 'draft', message: `Saved view '${name}'` });
  }) as typeof fetch;

  return {
    client: new MetadataClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl }),
    puts,
    publishes,
    draftOf: (name: string) => drafts.get(name),
    publishedOf: (name: string) => published.get(name),
    /** Park the next publish once it arrives; resolves when it has. */
    holdNextPublish(): Promise<void> {
      parkNext = true;
      return arrived;
    },
    releasePublish(): void {
      parked?.release();
    },
  };
}

type Door = ReturnType<typeof viewDoor>;

/** The panel, hosted the way `handleViewConfigSave` hosts it. */
function mountPanel(door: Door) {
  const outcomes: string[] = [];
  const onSave = vi.fn(async (draft: Record<string, any>, saveDraft: DraftVersionGuard['save']) => {
    try {
      const outcome = await persistRuntimeMetadata(
        'view',
        String(draft.id),
        buildViewConfigSaveBody(OBJECT, draft),
        { metadataClient: door.client },
        saveDraft,
      );
      outcomes.push(outcome);
      return outcome === 'saved';
    } catch (err) {
      outcomes.push(`refused: ${(err as Error).message}`);
      return false;
    }
  });
  render(
    <ViewConfigPanel
      open
      mode="edit"
      onClose={vi.fn()}
      activeView={{ id: VIEW_ID, label: 'Everything', type: 'grid', columns: ['name'], filter: [], sort: [] }}
      objectDef={{ name: OBJECT, fields: { name: { label: 'Name', type: 'text' } } }}
      onViewUpdate={vi.fn()}
      onSave={onSave}
      metadataClient={door.client}
    />,
  );
  return { onSave, outcomes };
}

const saveButton = () => screen.getByTestId('view-config-save') as HTMLButtonElement;

async function loadedAndEdited() {
  await waitFor(() => expect(screen.getByTestId('mock-inspector-shown-label')).toBeTruthy());
  fireEvent.click(screen.getByTestId('mock-inspector-label'));
  expect(saveButton().disabled).toBe(false);
}

/** 「Save to this view」's body: the view with another sort, as the reader saves it. */
const SAVE_TO_VIEW_BODY = { ...PUBLISHED, label: 'Everything', config: { ...PUBLISHED.config, sort: [{ field: 'name', order: 'desc' }] } };

describe('a view settings save between 「Save to this view」\'s draft write and its publish (objectstack#36137)', () => {
  it('is refused, and the publish publishes only the Save\'s own draft', async () => {
    const door = viewDoor();
    const { outcomes } = mountPanel(door);
    await loadedAndEdited();

    // Another admin's confirmed Save: its pinned draft write lands, its publish is parked.
    const parked = door.holdNextPublish();
    const saveToView = saveAndPublishRuntimeMetadata('view', VIEW_ID, SAVE_TO_VIEW_BODY, { metadataClient: door.client });
    await parked;
    expect(door.draftOf(VIEW_ID)?.body).toEqual(SAVE_TO_VIEW_BODY);

    // The settings save crosses it: pinned to "no draft", as the panel loaded the view.
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(screen.getByTestId('draft-conflict-dialog')).toBeTruthy());
    const settingsPut = door.puts[door.puts.length - 1]!;
    expect(settingsPut).toMatchObject({ ifNoneMatch: '*', ifMatch: null, label: 'Settings edit', status: 409 });
    // The Save's draft is untouched by it.
    expect(door.draftOf(VIEW_ID)?.body).toEqual(SAVE_TO_VIEW_BODY);

    door.releasePublish();
    await expect(saveToView).resolves.toBe('published');
    expect(door.publishes).toEqual([SAVE_TO_VIEW_BODY]);
    expect(door.publishedOf(VIEW_ID)).toEqual(SAVE_TO_VIEW_BODY);

    // Keep editing: nothing is saved, and the edit stays on screen, unsaved.
    await act(async () => {
      fireEvent.click(screen.getByTestId('draft-conflict-cancel'));
    });
    await waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toMatch(/^refused: /);
    expect(screen.getByTestId('mock-inspector-shown-label').textContent).toBe('Settings edit');
    expect(saveButton().disabled).toBe(false);
    expect(door.draftOf(VIEW_ID)).toBeUndefined();
    cleanup();
  });

  it('Reload takes the published view into the panel, and nothing is written', async () => {
    const door = viewDoor();
    const { outcomes } = mountPanel(door);
    await loadedAndEdited();
    const parked = door.holdNextPublish();
    const saveToView = saveAndPublishRuntimeMetadata('view', VIEW_ID, SAVE_TO_VIEW_BODY, { metadataClient: door.client });
    await parked;
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(screen.getByTestId('draft-conflict-dialog')).toBeTruthy());
    door.releasePublish();
    await saveToView;

    await act(async () => {
      fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    });
    await waitFor(() => expect(outcomes).toEqual(['reloaded']));
    expect(door.puts.filter((p) => p.status === 200)).toHaveLength(1);
    expect(door.publishes).toEqual([SAVE_TO_VIEW_BODY]);
    // The buffer is the view as now stored, and the next save is pinned to "no draft".
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    fireEvent.click(screen.getByTestId('mock-inspector-label'));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(outcomes).toEqual(['reloaded', 'saved']));
    expect(door.puts[door.puts.length - 1]).toMatchObject({ ifNoneMatch: '*', status: 200 });
    cleanup();
  });
});

describe('the view settings save is pinned to the draft it loaded (objectstack#36137)', () => {
  it('over no draft: If-None-Match: *, and the next save If-Match on the receipt', async () => {
    const door = viewDoor();
    const { outcomes } = mountPanel(door);
    await loadedAndEdited();
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(outcomes).toEqual(['saved']));
    const first = door.draftOf(VIEW_ID)!;
    expect(door.puts[0]).toMatchObject({ ifNoneMatch: '*', ifMatch: null, status: 200 });

    fireEvent.click(screen.getByTestId('mock-inspector-label'));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(outcomes).toEqual(['saved', 'saved']));
    expect(door.puts[1]).toMatchObject({ ifMatch: first.version, ifNoneMatch: null, status: 200 });
    expect(door.publishes).toEqual([]);
    cleanup();
  });

  it('over its own loaded draft: If-Match on the version the load read', async () => {
    const pending = { ...PUBLISHED, label: 'Pending' };
    const door = viewDoor({ draft: pending });
    const loaded = door.draftOf(VIEW_ID)!.version;
    const { outcomes } = mountPanel(door);
    await waitFor(() => expect(screen.getByTestId('mock-inspector-shown-label').textContent).toBe('Pending'));
    fireEvent.click(screen.getByTestId('mock-inspector-label'));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(outcomes).toEqual(['saved']));
    expect(door.puts).toEqual([
      expect.objectContaining({ ifMatch: loaded, ifNoneMatch: null, label: 'Settings edit', status: 200 }),
    ]);
    cleanup();
  });
});

describe('a view create carries the first-write pin (objectstack#36137)', () => {
  it('is refused over a name that holds a pending draft, which it leaves as it was', async () => {
    const pending = { ...PUBLISHED, label: 'Pending' };
    const door = viewDoor({ draft: pending });
    const env = viewEnvelope(OBJECT, { type: 'grid', columns: ['name'] }, { name: 'all', label: 'All' });
    expect(env.name).toBe(VIEW_ID);
    await expect(createRuntimeMetadata('view', env.name, env, { metadataClient: door.client })).rejects.toMatchObject({
      status: 409,
    });
    expect(door.puts).toEqual([expect.objectContaining({ ifNoneMatch: '*', status: 409 })]);
    expect(door.draftOf(VIEW_ID)?.body).toEqual(pending);
  });

  it('writes a new name (control)', async () => {
    const door = viewDoor();
    const env = viewEnvelope(OBJECT, { type: 'grid', columns: ['name'] }, { name: 'mine', label: 'Mine' });
    await expect(createRuntimeMetadata('view', env.name, env, { metadataClient: door.client })).resolves.toBe(env.name);
    expect(door.puts).toEqual([expect.objectContaining({ name: `${OBJECT}.mine`, ifNoneMatch: '*', status: 200 })]);
  });
});
