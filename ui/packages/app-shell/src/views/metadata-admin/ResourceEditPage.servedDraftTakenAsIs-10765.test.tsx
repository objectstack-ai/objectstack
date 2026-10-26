// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10765 — the metadata-admin editor takes a served draft AS-IS. It
 * never rebuilds its draft as the served draft spread over `layered.effective`.
 *
 * ## The defect this file keeps fixed
 *
 * `effective` is the PUBLISHED layer (the server's `getMetaItemLayered`
 * composes it from code plus the `state: 'active'` overlay and never reads a
 * draft). A spread cannot express deletion: a key the author cleared in the
 * draft is absent from the first draft PUT, comes back into the editor from
 * the published layer on the refresh after that save — invisibly — and the
 * NEXT save sends it again. The named instance is the report inspector's
 * joined clear (objectui#10746): a report whose PUBLISHED version was bound
 * got `dataset` / `values` / `rows` / `columns` / `chart` / `order` back under
 * `type: 'joined'` after the first autosave, and the spec refuses those on a
 * joined report.
 *
 * ## The premise the fix rests on, and why the double below is shaped this way
 *
 * The spread existed for a "partial draft overlay". No such overlay reaches
 * this editor: the server stores a `?mode=draft` body raw (`saveMetaItem` →
 * `repo.put(ref, request.item)` → `JSON.stringify(body)`), its `?state=draft`
 * read returns that row raw (or `NO_DRAFT` 404), and a publish promotes the
 * draft body raw. So the fake client below is a SERVER DOUBLE that stores
 * draft rows raw, serves `effective` as the active row only, and promotes on
 * publish — the exact shape the real endpoints have. ⚠️ A double that merged
 * on the server's behalf would hide the defect on base and prove nothing.
 *
 * ## What is red on base and what is a control
 *
 * Red on base (the spread present): the post-save refresh in the report case
 * and the load refresh in the generic case both resurrect the cleared keys
 * from the published layer. Controls (green on both): an untouched inherited
 * `type` survives (it is inside the served draft), an item with no draft
 * shows the baseline unchanged, and the first draft save of a never-drafted
 * item is the whole edited document.
 *
 * The editor's draft is read through a stub canvas that prints it, the same
 * seam the sibling suites use for the real save door: everything else — the
 * page, its load/save/publish refreshes, the real `ReportDefaultInspector` and
 * its type picker — is shipping code.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

type Row = Record<string, unknown>;

/** The six keys the report inspector clears when the type becomes `joined`. */
const JOINED_CLEARED = ['dataset', 'values', 'rows', 'columns', 'chart', 'order'] as const;

/** A matrix report bound the way the Properties tab binds one — the PUBLISHED version. */
const PUBLISHED_BOUND_REPORT: Row = {
  name: 'pipeline',
  label: 'Pipeline',
  type: 'matrix',
  dataset: 'sales_metrics',
  values: ['total_amount'],
  rows: ['stage'],
  columns: ['close_quarter'],
  chart: { type: 'bar', xAxis: 'stage', yAxis: 'total_amount' },
  order: [{ by: 'total_amount' }],
};

/** A published page carrying a key the pending draft has deleted. */
const PUBLISHED_PAGE: Row = {
  name: 'home',
  label: 'Home',
  type: 'home',
  template: 'default',
  description: 'published description — the draft deleted this key',
  regions: [{ name: 'main', components: [{ type: 'text', id: 'b1' }] }],
};

/** The same page as the author left it in the draft: `description` gone, `type` untouched. */
const DRAFT_PAGE_WITHOUT_DESCRIPTION: Row = {
  name: 'home',
  label: 'Home (draft)',
  type: 'home',
  template: 'default',
  regions: [{ name: 'main', components: [{ type: 'text', id: 'b1' }] }],
};

/** What `JSON.stringify` puts on the wire and the server stores: own `undefined` keys drop out. */
const wire = (doc: unknown): Row => JSON.parse(JSON.stringify(doc)) as Row;
const key = (type: string, name: string) => `${type}/${name}`;

/**
 * The server double. `active` is the published overlay row per item, `drafts`
 * the pending draft row per item, both stored as the wire body — raw, never
 * merged with anything, exactly as `sys_metadata` holds them.
 */
const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown>; opts: Record<string, unknown> | undefined }>,
  publishes: [] as string[],
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  const toWire = (doc: unknown) => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  return {
    list: vi.fn(async () => []),
    listDrafts: vi.fn(async () => []),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    /** `GET …/layers`: `effective` is the ACTIVE row only — a draft never feeds it. */
    layered: vi.fn(async (type: string, name: string, _opts?: { packageId?: string }) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return {
        code: null,
        overlay: eff,
        overlayScope: eff ? 'env' : null,
        effective: eff,
        editable: true,
        deletable: true,
        resettable: false,
        lock: 'none',
      };
    }),
    /** `GET …?state=draft`: the stored draft row raw (decorated like the real read), else `NO_DRAFT`. */
    getDraft: vi.fn(async (type: string, name: string, _opts?: { packageId?: string }) => {
      const row = server.drafts.get(k(type, name));
      if (!row) {
        throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), {
          code: 'NO_DRAFT',
          status: 404,
        });
      }
      return { type, name, item: { ...row, _diagnostics: { valid: true, errors: [] } } };
    }),
    /** `PUT …?mode=draft`: the body lands raw in the draft slot; a publish-mode save lands in the active slot. */
    save: vi.fn(async (type: string, name: string, item: unknown, opts?: Record<string, unknown>) => {
      const body = toWire(item);
      server.saves.push({ type, name, body, opts });
      if (opts?.mode === 'draft') server.drafts.set(k(type, name), body);
      else server.active.set(k(type, name), body);
      return { type, name, item: body };
    }),
    /** `POST …/publish`: promote the draft body raw to active and drain the draft row. */
    publish: vi.fn(async (type: string, name: string, _opts?: Record<string, unknown>) => {
      const row = server.drafts.get(k(type, name));
      if (!row) {
        throw Object.assign(new Error(`No pending draft exists for ${type}/${name} — nothing to publish.`), {
          code: 'NO_DRAFT',
          status: 404,
        });
      }
      server.active.set(k(type, name), row);
      server.drafts.delete(k(type, name));
      server.publishes.push(k(type, name));
      return { success: true, version: 2 };
    }),
    reset: vi.fn(async (type: string, name: string, opts?: { state?: string }) => {
      if (opts?.state === 'draft') server.drafts.delete(k(type, name));
      else server.active.delete(k(type, name));
      return {};
    }),
  };
});

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [
        { type: 'report', name: 'report', label: 'Report', allowEnvironmentOverlay: true, schema: { required: [] } },
        { type: 'page', name: 'page', label: 'Page', allowEnvironmentOverlay: true, schema: { required: [] } },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerBuiltinInspectors } from './inspectors';
import { registerMetadataPreview, getMetadataPreview } from './preview-registry';

// The REAL default inspectors — `report` resolves to `ReportDefaultInspector`,
// whose type picker is the producer of the joined clear (objectui#10746).
registerBuiltinInspectors();

/**
 * Canvas stand-in with two jobs: print the editor's draft (the value under
 * test — what the load / save / publish refreshes installed), and hand the
 * test a way to dirty the draft so the real autosave door fires.
 */
function StubCanvas({
  draft,
  onPatch,
}: {
  draft: Record<string, unknown>;
  onPatch?: (patch: Record<string, unknown>) => void;
}) {
  return (
    <>
      <pre data-testid="editor-draft">{JSON.stringify(draft)}</pre>
      <button type="button" onClick={() => onPatch?.({ label: 'Edited in the designer' })}>
        patch the label
      </button>
    </>
  );
}

const realPreviews = {
  report: getMetadataPreview('report'),
  page: getMetadataPreview('page'),
};

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.saves.length = 0;
  server.publishes.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  registerMetadataPreview('report', StubCanvas as never);
  registerMetadataPreview('page', StubCanvas as never);
});

afterEach(() => {
  cleanup();
  if (realPreviews.report) registerMetadataPreview('report', realPreviews.report);
  if (realPreviews.page) registerMetadataPreview('page', realPreviews.page);
  window.history.replaceState(null, '', '/');
});

function renderEditor(type: string, name: string) {
  window.history.replaceState(null, '', `/metadata/${type}/${name}`);
  render(
    <MemoryRouter initialEntries={[`/metadata/${type}/${name}`]}>
      <MetadataResourceEditPage type={type} name={name} />
    </MemoryRouter>,
  );
}

/** The editor's draft, as the canvas received it. */
const editorDraft = (): Row => JSON.parse(screen.getByTestId('editor-draft').textContent ?? '{}') as Row;

const publishButton = () => screen.getAllByRole('button', { name: /^Publish$/ })[0]!;

/** Let the real autosave door fire (1500 ms debounce) and settle its refresh. */
async function awaitSaveCount(n: number) {
  await waitFor(() => expect(server.saves.length).toBe(n), { timeout: 8000 });
  await waitFor(() => expect(mockClient.getDraft.mock.calls.length).toBeGreaterThanOrEqual(n + 1), { timeout: 8000 });
}

describe('MetadataResourceEditPage — a served draft is taken as-is, never spread over `effective` (objectui#10765)', () => {
  it('THE TRIAGE PIN: a report over a bound published version, switched to `joined`, keeps the six keys cleared across the save, the refresh after it and the publish', async () => {
    server.active.set(key('report', 'pipeline'), wire(PUBLISHED_BOUND_REPORT));
    renderEditor('report', 'pipeline');

    // The REAL inspector's type picker (objectui#10746's producer).
    const picker = await screen.findByRole('combobox', { name: 'Report type' }, { timeout: 8000 });
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole('option', { name: 'Joined' }));

    // ① The first draft PUT is clean — that half is objectui#10746's, pinned there; restated as the control here.
    await awaitSaveCount(1);
    const firstPut = server.saves[0]!;
    expect(firstPut.opts).toMatchObject({ mode: 'draft' });
    expect(firstPut.body.type).toBe('joined');
    for (const k of JOINED_CLEARED) expect(firstPut.body, `first PUT carries no ${k}`).not.toHaveProperty(k);

    // ② THE DEFECT SITE: the refresh after the save. The served draft has no
    //    six keys; `effective` (the published, BOUND version) still has all six.
    //    On base the editor spread the draft over `effective` and every key came back.
    await waitFor(() => expect(editorDraft().type).toBe('joined'), { timeout: 8000 });
    const afterSave = editorDraft();
    for (const k of JOINED_CLEARED) {
      expect(afterSave, `after the post-save refresh the editor draft has no ${k}`).not.toHaveProperty(k);
    }
    // CONTROL: the inherited fields the spread claimed to protect are inside the served draft.
    expect(afterSave).toMatchObject({ name: 'pipeline', label: 'Pipeline', type: 'joined' });

    // ③ The next save is the one the defect made send them: dirty the draft on
    //    an unrelated key and let autosave PUT again.
    fireEvent.click(screen.getByRole('button', { name: 'patch the label' }));
    await awaitSaveCount(2);
    const secondPut = server.saves[1]!;
    expect(secondPut.body).toMatchObject({ type: 'joined', label: 'Edited in the designer' });
    for (const k of JOINED_CLEARED) expect(secondPut.body, `second PUT carries no ${k}`).not.toHaveProperty(k);

    // ④ Publish: the promoted body is the draft raw, and the post-publish
    //    refresh shows it — no six keys anywhere.
    await waitFor(() => expect(publishButton()).toBeEnabled(), { timeout: 8000 });
    fireEvent.click(publishButton());
    await waitFor(() => expect(server.publishes).toEqual(['report/pipeline']), { timeout: 8000 });
    const published = server.active.get(key('report', 'pipeline'))!;
    expect(published).toMatchObject({ type: 'joined', label: 'Edited in the designer' });
    for (const k of JOINED_CLEARED) expect(published, `published body carries no ${k}`).not.toHaveProperty(k);
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /^Publish$/ })).toHaveLength(0), { timeout: 8000 });
    const afterPublish = editorDraft();
    expect(afterPublish.type).toBe('joined');
    for (const k of JOINED_CLEARED) expect(afterPublish, `after publish the editor draft has no ${k}`).not.toHaveProperty(k);
  });

  it('GENERIC: a key the pending draft deleted stays deleted on load, across the next save and its refresh, and through publish — while the untouched inherited `type` survives (CONTROL)', async () => {
    server.active.set(key('page', 'home'), wire(PUBLISHED_PAGE));
    server.drafts.set(key('page', 'home'), wire(DRAFT_PAGE_WITHOUT_DESCRIPTION));
    renderEditor('page', 'home');

    // LOAD SITE — red on base: the spread put the published `description` back.
    await waitFor(() => expect(editorDraft().label).toBe('Home (draft)'), { timeout: 8000 });
    const loaded = editorDraft();
    expect(loaded).not.toHaveProperty('description');
    // CONTROL: `type` is inside the served draft, so taking the draft as-is keeps it.
    expect(loaded.type).toBe('home');
    expect(loaded).toStrictEqual(wire(DRAFT_PAGE_WITHOUT_DESCRIPTION));

    // SAVE + REFRESH: an unrelated edit, the real autosave, the real refresh.
    fireEvent.click(screen.getByRole('button', { name: 'patch the label' }));
    await awaitSaveCount(1);
    expect(server.saves[0]!.body).not.toHaveProperty('description');
    await waitFor(() => expect(editorDraft().label).toBe('Edited in the designer'), { timeout: 8000 });
    expect(editorDraft()).not.toHaveProperty('description');
    expect(editorDraft().type).toBe('home');

    // PUBLISH: the promoted body is the draft raw.
    await waitFor(() => expect(publishButton()).toBeEnabled(), { timeout: 8000 });
    fireEvent.click(publishButton());
    await waitFor(() => expect(server.publishes).toEqual(['page/home']), { timeout: 8000 });
    expect(server.active.get(key('page', 'home'))).not.toHaveProperty('description');
    await waitFor(() => expect(screen.queryAllByRole('button', { name: /^Publish$/ })).toHaveLength(0), { timeout: 8000 });
    expect(editorDraft()).not.toHaveProperty('description');
    expect(editorDraft().type).toBe('home');
  });

  it('EDGE / CONTROL: an item with no pending draft shows the published baseline unchanged', async () => {
    server.active.set(key('page', 'home'), wire(PUBLISHED_PAGE));
    renderEditor('page', 'home');
    await waitFor(() => expect(editorDraft().label).toBe('Home'), { timeout: 8000 });
    expect(editorDraft()).toStrictEqual(wire(PUBLISHED_PAGE));
    expect(screen.queryAllByRole('button', { name: /^Publish$/ })).toHaveLength(0);
  });

  it('EDGE / CONTROL: the first draft save of a never-drafted item is the WHOLE edited document, and the refresh shows exactly that', async () => {
    server.active.set(key('page', 'home'), wire(PUBLISHED_PAGE));
    renderEditor('page', 'home');
    await waitFor(() => expect(editorDraft().label).toBe('Home'), { timeout: 8000 });

    fireEvent.click(screen.getByRole('button', { name: 'patch the label' }));
    await awaitSaveCount(1);
    const firstDraft = server.saves[0]!.body;
    expect(server.saves[0]!.opts).toMatchObject({ mode: 'draft' });
    expect(firstDraft).toStrictEqual({ ...wire(PUBLISHED_PAGE), label: 'Edited in the designer' });
    await waitFor(() => expect(editorDraft().label).toBe('Edited in the designer'), { timeout: 8000 });
    expect(editorDraft()).toStrictEqual(firstDraft);
  });
});
