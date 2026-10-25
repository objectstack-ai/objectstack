/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record_header` actions must carry the record id even while the page record
 * is still being fetched (objectui#5176).
 *
 * The header is NOT gated on the record load. `isLoading` — the only state the
 * `<SkeletonDetail>` early return reads — is flipped false in a `queueMicrotask`
 * keyed on the route, while `pageRecord` arrives one `dataSource.findOne`
 * round-trip later. So for the whole duration of that fetch the page renders its
 * real header, with every `record_header` action live and clickable, and
 * `pageRecord` still `null`.
 *
 * In that window the `type:'api'` handler's `recordIdParam` seeding used to have
 * no source at all. Its fallback chain was row -> literal `recordId` override ->
 * `pageRecord`, and it stopped there — it never consulted `pureRecordId`, the id
 * this page is *addressed by*, which is read straight off the URL and is
 * therefore available on the very first render. Handed a `null` seed record,
 * `resolveRecordIdParamSeed` deliberately abstains (`{}` — no value, and no
 * error, because "no row context" is not that guard's business), so the caller
 * injected nothing, raised nothing, and dispatched anyway. What went out was a
 * mutation naming no record, and the backend answered `missing_record_id`.
 *
 * That is the user-visible "click does nothing, click again and it works": the
 * second click lands after the fetch settled. The reporter's one-to-one
 * correlation with a differently-shaped header DOM is real but is a co-symptom,
 * not the cause — the same unresolved `pageRecord` that starves the seed also
 * withholds the title/highlights chrome that makes the header render differently.
 *
 * The three sibling dispatch paths in this file (the legacy `dataSource.update`
 * default branch, the flow trigger, and the server-action bridge) all already
 * fall back to `pureRecordId`. This pins the api path to the same source, and
 * pins the one case the URL id cannot serve — a non-default `recordIdField` —
 * to a refusal rather than an under-specified request.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authFetchSpy = vi.fn(async () =>
  new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
);
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => authFetchSpy,
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

vi.mock('../hooks/useActionModal', () => ({
  useActionModal: () => ({
    modalHandler: vi.fn(async () => ({ success: true })),
    modalElement: null,
    closeModal: () => {},
    resolveModalTarget: vi.fn(async () => null),
  }),
}));

vi.mock('../utils/consoleServerAction', () => ({
  createConsoleServerActionHandler: () => vi.fn(async () => ({ success: true })),
}));

// Same capture posture as the sibling `recordIdParamSeed` pin — keep the real
// provider, record every handler set it is handed. The discriminator differs
// and that difference is the whole point of this file: the sibling waits for
// the capture whose context carries the LOADED record, which by construction
// sits after the window under test here.
const captured: Array<{ handlers: Record<string, (action: any) => Promise<any>>; context: any }> = [];
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: (props: any) => {
      captured.push({ handlers: props.handlers, context: props.context });
      return React.createElement(actual.ActionProvider as any, props);
    },
    SchemaRenderer: () => null,
  };
});

import { MetadataCtx } from '@object-ui/react';
import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'os_production_plan';
const RECORD_ID = 'rec-plan-1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Production Plan',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      code: { type: 'text', label: 'Code' },
    },
  },
];

const METADATA = {
  objects: OBJECTS,
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
} as any;

/**
 * A data source whose `findOne` is held open until the test releases it. This
 * is what makes the 1-in-10 timing report a deterministic case: the failure
 * window is not sampled, it is held.
 */
function makeDeferredDataSource() {
  let release!: (rec: unknown) => void;
  const settled = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const ds = {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(() => settled),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
  return { ds, release: () => release({ id: RECORD_ID, name: 'Plan A' }) };
}

/**
 * The record page's own provider, captured WHILE the record load is still in
 * flight: `context.objectName` identifies this page, and the absence of a
 * record id in the context is precisely the half-loaded state
 * (`record: pageRecord || {}`).
 */
function loadWindowCapture() {
  return [...captured]
    .reverse()
    .find((c) => c.handlers && c.context?.objectName === OBJECT_NAME && !c.context?.record?.id);
}

async function mountMidLoadAndCaptureHandlers(ds: any) {
  render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={METADATA}>
        <RecordDetailView
          dataSource={ds}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(loadWindowCapture()).toBeTruthy());
  authFetchSpy.mockClear();
  return loadWindowCapture()!;
}

beforeEach(() => {
  cleanup();
  captured.length = 0;
  authFetchSpy.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RecordDetailView record_header actions during the page-record load window (objectui#5176)', () => {
  it('the header renders live actions while the record is still loading', async () => {
    // The premise the whole card rests on. If the header were gated on the
    // record load there would be no window to dispatch in, and the reported
    // failure would be unreachable.
    const { ds } = makeDeferredDataSource();
    const capture = await mountMidLoadAndCaptureHandlers(ds);

    expect(ds.findOne).toHaveBeenCalled();
    expect(typeof capture.handlers.api).toBe('function');
    // Half-loaded by construction: the provider is up, the record is not.
    expect(capture.context?.record?.id).toBeUndefined();
  });

  it('seeds recordIdParam from the URL record id when the page record has not resolved', async () => {
    const { ds, release } = makeDeferredDataSource();
    const { handlers } = await mountMidLoadAndCaptureHandlers(ds);

    let r: any;
    await act(async () => {
      // A record_header action exactly as authored: no `_rowRecord` stash, no
      // literal `recordId` override, `recordIdField` defaulting to `id`.
      r = await handlers.api({
        name: 'archive_plan',
        type: 'api',
        method: 'POST',
        target: `/api/v1/data/${OBJECT_NAME}/archive`,
        recordIdParam: 'planId',
      });
    });

    expect(r.success).toBe(true);
    expect(authFetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    // The defect: this key was absent, and the request went out anyway.
    expect(body).toMatchObject({ planId: RECORD_ID });

    release();
  });

  it('injects identically before and after the record resolves', async () => {
    // The triage floor's first limb, stated as one assertion: the two header
    // render states are not allowed to disagree about the request body.
    const { ds, release } = makeDeferredDataSource();
    const { handlers: midLoadHandlers } = await mountMidLoadAndCaptureHandlers(ds);

    const action = {
      name: 'archive_plan',
      type: 'api',
      method: 'POST',
      target: `/api/v1/data/${OBJECT_NAME}/archive`,
      recordIdParam: 'planId',
    };

    await act(async () => {
      await midLoadHandlers.api({ ...action });
    });
    const [, midInit] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const midBody = JSON.parse(String(midInit.body));

    authFetchSpy.mockClear();
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(
        [...captured].reverse().find((c) => c.handlers && c.context?.record?.id === RECORD_ID),
      ).toBeTruthy(),
    );
    const loadedHandlers = [...captured]
      .reverse()
      .find((c) => c.handlers && c.context?.record?.id === RECORD_ID)!.handlers;

    await act(async () => {
      await loadedHandlers.api({ ...action });
    });
    const [, loadedInit] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const loadedBody = JSON.parse(String(loadedInit.body));

    expect(midBody).toEqual(loadedBody);
    expect(midBody).toMatchObject({ planId: RECORD_ID });
  });

  it('refuses rather than under-specifying when recordIdField names a field the URL id cannot supply', async () => {
    // The floor's second limb, for the residue the first cannot cover: the URL
    // carries the record's *id*, so an action keyed on some other field still
    // has no seed mid-load. It must refuse — never emit the body-incomplete
    // request this card is about.
    const { ds, release } = makeDeferredDataSource();
    const { handlers } = await mountMidLoadAndCaptureHandlers(ds);

    let r: any;
    await act(async () => {
      r = await handlers.api({
        name: 'link_code',
        label: 'Link by Code',
        type: 'api',
        method: 'POST',
        target: `/api/v1/data/${OBJECT_NAME}/link`,
        recordIdParam: 'targetCode',
        recordIdField: 'code',
      });
    });

    expect(r.success).toBe(false);
    expect(r.error).toContain('Link by Code');
    expect(r.error).toContain('code');
    expect(authFetchSpy).not.toHaveBeenCalled();

    release();
  });

  it('still prefers a stashed row over the URL id', async () => {
    // The new fallback is a LAST resort: it must not outrank the row a
    // related-list dispatch stashes, which may name a different record.
    const { ds, release } = makeDeferredDataSource();
    const { handlers } = await mountMidLoadAndCaptureHandlers(ds);

    let r: any;
    await act(async () => {
      r = await handlers.api({
        name: 'archive_plan',
        type: 'api',
        method: 'POST',
        target: `/api/v1/data/${OBJECT_NAME}/archive`,
        recordIdParam: 'planId',
        params: { _rowRecord: { id: 'row-child-7' } },
      });
    });

    expect(r.success).toBe(true);
    const [, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ planId: 'row-child-7' });

    release();
  });

  it('still prefers a literal recordId override over the URL id', async () => {
    const { ds, release } = makeDeferredDataSource();
    const { handlers } = await mountMidLoadAndCaptureHandlers(ds);

    let r: any;
    await act(async () => {
      r = await handlers.api({
        name: 'archive_plan',
        type: 'api',
        method: 'POST',
        target: `/api/v1/data/${OBJECT_NAME}/archive`,
        recordIdParam: 'planId',
        recordId: 'explicit-plan-9',
      } as any);
    });

    expect(r.success).toBe(true);
    const [, init] = authFetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ planId: 'explicit-plan-9' });

    release();
  });

  it('does not seed this page id into an action retargeting another object', async () => {
    // Same guard `interpolationRecord` uses: a child-object action must never
    // be handed the parent page's id. Mid-load it has no seed, so it refuses.
    const { ds, release } = makeDeferredDataSource();
    const { handlers } = await mountMidLoadAndCaptureHandlers(ds);

    let r: any;
    await act(async () => {
      r = await handlers.api({
        name: 'archive_other',
        label: 'Archive Other',
        type: 'api',
        method: 'POST',
        objectName: 'other_object',
        target: '/api/v1/data/other_object/archive',
        recordIdParam: 'planId',
        params: { _rowRecord: { name: 'no id here' } },
      });
    });

    expect(r.success).toBe(false);
    expect(authFetchSpy).not.toHaveBeenCalled();

    release();
  });
});
