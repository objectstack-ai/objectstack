// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36726 — the extension a read-only base's pair holds of one of
 * its objects (objectstack#28575) is published over the published extension
 * row its buffer was loaded at, never over one another writer published since.
 *
 * The extension's Save writes its draft at the pair, then publishes that one
 * extension there (objectstack#36511), so it leaves no draft: two editors that
 * opened the same published extension both pass the draft door, and before
 * this card the later publish replaced the earlier one in silence. The load
 * now reads the extension's layers at the pair BEFORE its rows and pins the
 * publish to their `overlayVersion` (`If-None-Match: *` where the pair holds
 * no extension), so the later Save is refused `409 METADATA_CONFLICT` and the
 * author is asked.
 *
 * The other writer is the double's own move of the live row; the refusal is
 * parsed by the REAL `MetadataClient`. Also pinned: the reload residual of
 * the card's scope addition.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Module scope as well as in the `vi.mock` factory below: the cold transform is paid
// during collection, which no test or hook timeout clocks (AGENTS.md, flaky-test discipline).
import '@object-ui/components';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';

const BASE = 'com.example.hotcrm';
const PAIR = 'com.example.hotcrm.custom';
const OBJECT = 'crm_account';
const EXT = 'object_extension';
const LIVE = 'hmac-sha256:live0';
const PENDING = 'hmac-sha256:pending';

type Row = Record<string, unknown>;

const srv = vi.hoisted(() => ({
  /** The pair's published extension row of the object, `null` when it has none. */
  publishedExt: null as Record<string, unknown> | null,
  publishedVersion: null as string | null,
  /** The pair's pending extension draft. */
  draftExt: null as { body: Record<string, unknown>; version: string } | null,
  servesPublishedVersion: true,
  saves: [] as Array<{ body: Record<string, unknown>; ifMatch: string | undefined; ifNoneMatch: string | undefined }>,
  publishes: [] as Array<{ ifMatch: string | undefined; ifNoneMatch: string | undefined }>,
  seq: 0,
}));

async function conflictRefusal(head: string | null): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(
        JSON.stringify({
          error: `object_extension/${OBJECT} has been modified since you loaded it. The version token sent is not the current version (current is ${head}).`,
          code: 'METADATA_CONFLICT',
          currentVersion: head,
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  });
  return client.publish(EXT, OBJECT).then(
    () => {
      throw new Error('the stub door accepted the publish');
    },
    (e: unknown) => e as MetadataError,
  );
}

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const baseFields = () => ({
  name: { type: 'text', label: 'Account Name', required: true },
  industry: { type: 'text', label: 'Industry' },
});
/** The base as served, the pair's published extension merged in. */
const served = (): Row => ({
  name: OBJECT,
  label: 'Account',
  fields: { ...baseFields(), ...((srv.publishedExt?.fields ?? {}) as Row) },
});

const extFields = (row: Row | null | undefined) => Object.keys((row?.fields ?? {}) as Row);

const mockClient = {
  list: vi.fn(async (_type: string, opts?: { packageId?: string }) =>
    opts?.packageId === PAIR ? [] : [{ name: OBJECT, label: 'Account' }],
  ),
  listDrafts: vi.fn(async (opts?: { packageId?: string; type?: string }) =>
    srv.draftExt && opts?.packageId === PAIR && (!opts.type || opts.type === EXT) ? [{ type: EXT, name: OBJECT }] : [],
  ),
  layered: vi.fn(async (type: string, name: string, opts?: { packageId?: string }) => {
    if (type === EXT && name === OBJECT && opts?.packageId === PAIR) {
      const live = srv.publishedExt;
      const draft = srv.draftExt?.body ?? null;
      // The door's 404, answered by the client as the empty view.
      if (!live && !draft) return { code: null, overlay: null, overlayScope: null, effective: null };
      const version = srv.servesPublishedVersion ? { overlayVersion: live ? srv.publishedVersion : null } : {};
      return { code: null, overlay: live && copy(live), effective: live && copy(live), draft: draft && copy(draft), ...version };
    }
    return { effective: served(), code: served() };
  }),
  getDraft: vi.fn(async (type: string, name: string, opts?: { packageId?: string }) =>
    type === EXT && name === OBJECT && opts?.packageId === PAIR && srv.draftExt
      ? { type, name, item: copy(srv.draftExt.body), version: srv.draftExt.version }
      : null,
  ),
  get: vi.fn(async (type: string, name: string, opts?: { packageId?: string }) =>
    type === EXT && name === OBJECT && opts?.packageId === PAIR && srv.publishedExt ? { ...copy(srv.publishedExt), _packageId: PAIR } : null,
  ),
  publish: vi.fn(async (type: string, _name: string, options?: { ifMatch?: string; ifNoneMatch?: '*' }) => {
    if (type !== EXT) return {};
    srv.publishes.push({ ifMatch: options?.ifMatch, ifNoneMatch: options?.ifNoneMatch });
    const live = srv.publishedExt ? srv.publishedVersion : null;
    if (options?.ifMatch !== undefined && options.ifMatch !== live) throw await conflictRefusal(live);
    if (options?.ifNoneMatch !== undefined && live !== null) throw await conflictRefusal(live);
    srv.seq += 1;
    if (srv.draftExt) {
      srv.publishedExt = srv.draftExt.body;
      srv.publishedVersion = `hmac-sha256:live${srv.seq}`;
    }
    srv.draftExt = null;
    return { success: true, version: srv.publishedVersion };
  }),
  reset: vi.fn(async (type: string, _name: string, opts?: { state?: string }) => {
    if (type === EXT && opts?.state === 'draft') srv.draftExt = null;
    return {};
  }),
  save: vi.fn(async (type: string, _name: string, item: unknown, opts?: { ifMatch?: string; ifNoneMatch?: string }) => {
    if (type !== EXT) return { ok: true, version: 'v-other', state: 'draft' };
    const body = copy(item) as Row;
    srv.saves.push({ body, ifMatch: opts?.ifMatch, ifNoneMatch: opts?.ifNoneMatch });
    const head = srv.draftExt?.version ?? null;
    if (opts?.ifMatch !== undefined && opts.ifMatch !== head) throw await conflictRefusal(head);
    if (opts?.ifNoneMatch !== undefined && head !== null) throw await conflictRefusal(head);
    srv.seq += 1;
    srv.draftExt = { body, version: `hmac-sha256:v${srv.seq}` };
    return { success: true, version: srv.draftExt.version, state: 'draft' };
  }),
};

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
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, ObjectView: () => <div data-testid="records-panel" /> };
});

// The console's preview and authoring code loads `@objectstack/lint` lazily;
// warmed here so its first load is paid at import, not inside a test's clock.
import '@objectstack/lint';
import { DataPillar, type StudioBaseCustomization } from './StudioDesignSurface';
import { StudioSaveHarness, pressStudioSave } from './__tests__/studioSaveHarness';
import { t } from '../metadata-admin/i18n';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { ObjectFieldInspector } from '../metadata-admin/inspectors/ObjectFieldInspector';

registerMetadataInspector('object', ObjectFieldInspector);

const FORM = t('engine.studio.data.tab.form', 'en');
const WAIT = { timeout: 8000 };
const ensure = vi.fn(async (): Promise<string> => PAIR);

function customization(): StudioBaseCustomization {
  return {
    base: BASE,
    baseLabel: 'HotCRM',
    basedOn: '4.0.0',
    walled: false,
    pairId: PAIR,
    ensure,
    ensurePackage: vi.fn() as unknown as StudioBaseCustomization['ensurePackage'],
    marks: { status: 'off' },
  };
}

beforeEach(() => {
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
  srv.publishedExt = { extend: OBJECT, fields: { region__c: { type: 'text', label: 'Region' } } };
  srv.publishedVersion = LIVE;
  srv.draftExt = null;
  srv.servesPublishedVersion = true;
  srv.saves.length = 0;
  srv.publishes.length = 0;
  srv.seq = 0;
  ensure.mockImplementation(async () => PAIR);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openOnForm(): Promise<void> {
  render(
    <StudioSaveHarness>
      <MemoryRouter initialEntries={[`/studio/${BASE}/data`]}>
        <DataPillar objectName={OBJECT} packageId={BASE} readOnly customization={customization()} />
      </MemoryRouter>
    </StudioSaveHarness>,
  );
  await waitFor(() => expect(screen.getByTestId('records-panel')).toBeInTheDocument(), WAIT);
  await userEvent.click(screen.getAllByRole('button', { name: FORM })[0]);
  await screen.findByRole('button', { name: 'Layout', pressed: true });
}

/** Add an extension field from the Form toolbar: nothing is sent. */
async function addField(label: string): Promise<void> {
  await userEvent.click(await screen.findByTestId('data-form-add-extension-field'));
  const popover = await screen.findByTestId('add-field-popover');
  await userEvent.type(within(popover).getByTestId('add-field-label-input'), label);
  await userEvent.click(within(popover).getByTestId('add-field-create'));
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

/** Another writer publishes the pair's extension: its row and its version move. */
function anotherWriterPublishes(field: string): string {
  srv.seq += 1;
  srv.publishedExt = { ...srv.publishedExt!, fields: { ...(srv.publishedExt!.fields as Row), [field]: { type: 'text', label: field } } };
  srv.publishedVersion = `hmac-sha256:other${srv.seq}`;
  return srv.publishedVersion;
}

async function racePublished(): Promise<string> {
  await openOnForm();
  await addField('Tier');
  const theirs = anotherWriterPublishes('score__c');
  await save();
  expect(srv.saves[srv.saves.length - 1]).toMatchObject({ ifMatch: undefined, ifNoneMatch: '*' });
  await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
  return theirs;
}

describe('Extension — two Saves over one published extension are not last-writer-wins (objectstack#36726)', () => {
  it('the later Save is refused at its publish, worded as a live change; keep editing leaves the edit unsaved', async () => {
    await racePublished();
    expect(srv.publishes).toEqual([{ ifMatch: LIVE, ifNoneMatch: undefined }]);
    expect(screen.getByTestId('draft-conflict-dialog')).toHaveTextContent('This changed since you opened it');
    fireEvent.click(screen.getByTestId('draft-conflict-cancel'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    expect((await screen.findAllByText(/Not saved:/, undefined, WAIT)).length).toBeGreaterThan(0);
    expect(extFields(srv.publishedExt)).toEqual(['region__c', 'score__c']);
    expect(srv.draftExt).toBeNull();
    expect(screen.getByTestId('studio-save')).toBeInTheDocument();
  }, 30_000);

  it('"reload" re-reads the other writer\'s extension, and the next Save is pinned to it', async () => {
    const theirs = await racePublished();
    fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    await waitFor(() => expect(screen.queryByTestId('studio-save')).toBeNull(), WAIT);
    await addField('Tier');
    await saveAndLand();
    expect(srv.publishes[srv.publishes.length - 1]).toMatchObject({ ifMatch: theirs });
    // Built on the other writer's extension: its field is kept.
    expect(extFields(srv.publishedExt)).toEqual(['region__c', 'score__c', 'tier__c']);
  }, 30_000);

  it('"overwrite" asks again, then re-publishes pinned to the refusal\'s currentVersion', async () => {
    const theirs = await racePublished();
    fireEvent.click(screen.getByTestId('draft-conflict-overwrite'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('draft-conflict-overwrite-confirm'));
    });
    await waitFor(() => expect(extFields(srv.publishedExt)).toEqual(['region__c', 'tier__c']), WAIT);
    expect(srv.publishes[srv.publishes.length - 1]).toMatchObject({ ifMatch: theirs });
  }, 30_000);

  it('one editor: each Save\'s publish is pinned to the version the last one left', async () => {
    await openOnForm();
    await addField('Tier');
    await saveAndLand();
    const first = srv.publishedVersion;
    await addField('Score');
    await saveAndLand();
    expect(srv.publishes.map((p) => p.ifMatch)).toEqual([LIVE, first]);
    expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull();
  }, 30_000);

  it('a pair that holds no extension of the object: the first publish asserts none', async () => {
    srv.publishedExt = null;
    srv.publishedVersion = null;
    await openOnForm();
    await addField('Tier');
    await saveAndLand();
    expect(srv.publishes).toEqual([{ ifMatch: undefined, ifNoneMatch: '*' }]);
  }, 30_000);

  it('control: a server that serves no `overlayVersion` gets an unpinned publish, as before', async () => {
    srv.servesPublishedVersion = false;
    await openOnForm();
    await addField('Tier');
    anotherWriterPublishes('score__c');
    await saveAndLand();
    expect(srv.publishes).toEqual([{ ifMatch: undefined, ifNoneMatch: undefined }]);
  }, 30_000);
});

describe('Extension — a reload over a pending draft does not pin its publish to the fresh read (objectstack#36726)', () => {
  it('a pending draft, a live change by another writer, a refused publish, Reload: the next Save is asked again', async () => {
    srv.draftExt = { body: copy(srv.publishedExt!), version: PENDING };
    await openOnForm();
    await addField('Tier');
    anotherWriterPublishes('score__c');
    await save();
    expect(srv.saves[srv.saves.length - 1]!.ifMatch).toBe(PENDING);
    await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
    fireEvent.click(screen.getByTestId('draft-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('draft-conflict-dialog')).toBeNull(), WAIT);
    // The draft pending before the Save is kept, carrying the page's edit, and re-read.
    expect(extFields(srv.draftExt?.body)).toEqual(['region__c', 'tier__c']);

    await addField('Rank');
    const publishesBefore = srv.publishes.length;
    await save();
    await screen.findByTestId('draft-conflict-dialog', undefined, WAIT);
    expect(srv.publishes.slice(publishesBefore).map((p) => p.ifMatch)).toEqual([LIVE]);
    expect(extFields(srv.publishedExt)).toEqual(['region__c', 'score__c']);
  }, 30_000);
});
