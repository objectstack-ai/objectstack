/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7230 — field-level security on the record page's `$expand`.
 *
 * ## The site
 *
 * `RecordDetailView` loads the record backing an assigned or synthesized page
 * with
 *
 *     const expandFields = buildExpandFields(objectDef?.fields);
 *
 * — **no column list**. `buildExpandFields` reads an absent column list as "no
 * column restriction" and falls back to **every declared relation on the
 * object**, denied ones included. So every record page in the console asks the
 * server to resolve the object's full relation set, by default rather than by
 * configuration. objectui#7215 / PR #7229 gated the two projection sites in its
 * scope; this call site was outside it.
 *
 * ## Grading — the same reading #7215 recorded, not a stronger claim
 *
 * Against ObjectStack's own server this is defence-in-depth, not a live
 * disclosure: `plugin-security`'s `FieldMasker.maskRecord` does
 * `delete result[field]` on every unreadable key and objectql writes the
 * expanded record back under THAT SAME KEY, so one statement removes the
 * expanded object and the bare id alike; the expansion sub-read takes the
 * referenced object's full CRUD + RLS + FLS treatment (objectstack#7626). It is
 * load-bearing for a backend that does not strip, and the client-request side
 * is real either way.
 *
 * ## The gate is on the OUTPUT — copied from #7229
 *
 * There is no input to gate (the call passes `undefined`), and the output
 * contains only DECLARED reference-bearing fields, so the "`checkField` answers
 * false for an undeclared key" trap is structurally unreachable.
 *
 * ⚠️ One structural note that is load-bearing rather than cosmetic: this
 * component read `usePermissions()` ~670 lines BELOW this effect. The effect's
 * dependency array is evaluated DURING render, so listing `perms` there while
 * the binding was still declared below would throw
 * `Cannot access 'perms' before initialization` — a crash, not a stale value.
 * The hook call moved above the effect; the later destructure now reads that
 * one value instead of calling the hook again. Same lesson PR #7229 recorded
 * for `ListView`'s memo.
 *
 * The stub `checkField` is an ALLOWLIST, per `expandFls-7215.test.tsx`: the
 * real provider answers `true` for any field no policy mentions.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';

/** Stable stub identity — `perms` rides the record-load effect's dependency list. */
const { permsStub, state } = vi.hoisted(() => {
  const state: { isLoaded: boolean; readable: string[] } = { isLoaded: true, readable: [] };
  return {
    state,
    permsStub: {
      get isLoaded() { return state.isLoaded; },
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? state.readable.includes(field) : true,
      check: () => ({ allowed: true }),
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      userId: null,
      systemPermissions: undefined,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
// Orthogonal chrome — this file observes the record query's parameters only.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const OBJECT = 'os_7230_opportunity';
const REC = 'rec-1';

/**
 * `account` is the readable `lookup` control, `owner_dept` the denied
 * `master_detail`, `secret_account` the denied `lookup` under test.
 */
const objectDef = {
  name: OBJECT,
  label: 'Opportunity',
  managedBy: 'platform',
  highlightFields: ['name'],
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    stage: { label: 'Stage', type: 'text' },
    account: { label: 'Account', type: 'lookup', reference: 'accounts' },
    secret_account: { label: 'Secret Account', type: 'lookup', reference: 'accounts' },
    owner_dept: { label: 'Dept', type: 'master_detail', reference: 'departments' },
  },
};

const RECORD = { id: REC, name: 'Big deal', stage: 'new' };

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
    findOne: vi.fn(async (_name: string, id: string) => ({ ...RECORD, id })),
    create: vi.fn(async (_o: string, row: any) => row),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: async (name: string) => ({ name, fields: objectDef.fields }),
  } as Record<string, any>;
}

function makeMetadata() {
  const pages: any[] = [];
  return {
    objects: [], pages, loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => pages, getItem: async () => null,
    getItemsByType: () => pages,
  } as any;
}

/**
 * Mount the record page as a tenant with NO assigned page gets it (the metadata
 * context carries none, so the page is synthesized) and hand back the `$expand`
 * of the record query.
 *
 * The `waitFor` targets a real recorded `findOne` for THIS object, so a page
 * that stopped loading its record times out rather than reading as an empty
 * expansion.
 */
async function expandFor(): Promise<string[]> {
  const ds = makeDataSource();
  render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT}/${REC}`]}>
      <MetadataCtx.Provider value={makeMetadata()}>
        <RecordDetailView
          dataSource={ds as never}
          objects={[objectDef] as never}
          onEdit={() => {}}
          objectNameOverride={OBJECT}
          recordIdOverride={REC}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(ds.findOne.mock.calls.some((c: any[]) => c[0] === OBJECT)).toBe(true));
  const call = ds.findOne.mock.calls.filter((c: any[]) => c[0] === OBJECT).at(-1);
  return (call?.[2]?.$expand ?? []) as string[];
}

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.isLoaded = true;
  state.readable = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Unrelated chrome (approvals, favourites, row-level verdicts) reaches for
  // the platform API; happy-dom would resolve those relative URLs to a real
  // socket, which the repo's network-escape guard fails the file for
  // (objectui#6640). Serve them from a double — none of it is what this file
  // observes.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true, data: [] }),
    text: async () => '{}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RecordDetailView — `$expand` is FLS-gated (objectui#7230)', () => {
  // ── PIN 1: the defect itself ────────────────────────────────────────────
  it('does NOT ask the server to EXPAND a lookup the principal cannot read', async () => {
    state.readable = ['id', 'name', 'stage', 'account'];
    const expand = await expandFor();
    expect(
      expand,
      'with no column list the record page expands EVERY declared relation, so a denied '
        + 'lookup is asked for on every record page by default',
    ).not.toContain('secret_account');
  });

  // ── PIN 2: the live control — the gate narrows, it never empties ────────
  it('still expands a lookup the principal CAN read', async () => {
    state.readable = ['id', 'name', 'stage', 'account'];
    const expand = await expandFor();
    expect(
      expand,
      'the page subtitle interpolation and the `record:*` renderers depend on the expanded '
        + 'display name; a gate that emptied the expansion would show raw ids instead',
    ).toContain('account');
  });

  // ── PIN 3: `master_detail`, not only `lookup` ───────────────────────────
  it('gates a denied `master_detail` root too, not only `lookup`', async () => {
    state.readable = ['id', 'name', 'stage', 'account'];
    const expand = await expandFor();
    expect(expand).not.toContain('owner_dept');
    expect(expand).toContain('account');
  });

  // ── PIN 4: the whole set, asserted exactly ─────────────────────────────
  it('sends exactly the readable relations — asserted as a set, not merely by absence', async () => {
    state.readable = ['id', 'name', 'stage', 'account'];
    const expand = await expandFor();
    expect(
      expand.slice().sort(),
      'an absence assertion alone would also pass if the expansion had gone empty',
    ).toEqual(['account']);
  });

  // ── PIN 5: every relation denied → no `$expand` at all ─────────────────
  it('omits `$expand` entirely when every declared relation is denied', async () => {
    state.readable = ['id', 'name', 'stage'];
    const expand = await expandFor();
    expect(expand).toEqual([]);
  });

  // ── PIN 6: deferral — an unanswered policy filters nothing ─────────────
  it('filters NOTHING while `/me/permissions` has not answered', async () => {
    state.isLoaded = false;
    state.readable = [];
    const expand = await expandFor();
    expect(
      expand,
      'never filter on an unanswered policy — the no-provider default is `isLoaded: false` '
        + 'forever, and a console with no PermissionProvider must keep expanding',
    ).toEqual(expect.arrayContaining(['account', 'secret_account', 'owner_dept']));
  });
});
