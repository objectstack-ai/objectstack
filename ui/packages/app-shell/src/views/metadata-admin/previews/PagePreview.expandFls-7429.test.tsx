// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7429 — field-level security on `PagePreview`'s `$expand`.
 *
 * ## The site, and why it is the sharp one
 *
 * objectui#7215 / PR #7229 and objectui#7230 / PR #7428 gated `$expand` at six
 * of the helper's production call sites. This is one of the seven objectui#7429
 * recorded as still ungated. It passes **no column list at all**:
 *
 *     const expand = buildExpandFields(schema?.fields);
 *
 * `buildExpandFields` reads an absent column list as "no column restriction"
 * and falls back to **every declared relation on the object**, denied ones
 * included. So the record binding this Studio preview fetches to feed
 * `record:*` blocks does not merely fail to filter a column list — it has
 * none, and therefore asks the server to resolve the maximum possible set of
 * relations by default.
 *
 * ## ⚠️ The principal judged here is the STUDIO REVIEWER, not the page's
 * eventual audience — objectui#7429's own flag on this site, "a reason to
 * look, not a claim"
 *
 * Unlike the other six sites, this component does not call `DataSource.find`;
 * it calls the browser's global `fetch` directly with `credentials: 'include'`
 * — i.e. under whatever session is ALREADY loading this Studio preview. That
 * is the principal `usePermissions()` reports on too (`/me/permissions`, same
 * session), so gating on it is judging the request this browser is actually
 * about to make, on its own credentials. This file therefore does not assert
 * anything about the eventual page audience; it asserts that the CURRENT
 * session's `$expand` never exceeds what THAT session's own FLS allows.
 *
 * `/studio/*` mounts inside `MePermissionsProvider`
 * (`apps/console/src/AppContent.tsx` wraps `DefaultAppContent`, and the studio
 * routes render under it), so `usePermissions()` is live on this route, not a
 * no-provider default — PIN 6 below pins the deferred-policy case regardless.
 *
 * ## Grading — defence-in-depth, stated the same way #7215 / #7230 stated it
 *
 * Against ObjectStack's own server this is not a live disclosure:
 * `plugin-security`'s `FieldMasker.maskRecord` does `delete result[field]` on
 * every unreadable key and objectql's expand path writes the resolved record
 * back under THAT SAME KEY, so one statement removes the expanded object and
 * the bare id alike; the expansion sub-read itself takes the referenced
 * object's full CRUD + RLS + FLS treatment (objectstack#7626).
 *
 * ## The gate goes on the OUTPUT of `buildExpandFields` — copied, not re-derived
 *
 * The call passes `undefined`, so there is no input to gate; gating the
 * output also makes the "`checkField` answers false for an undeclared key"
 * trap structurally unreachable, because `buildExpandFields` returns a subset
 * of the object's DECLARED reference-bearing fields.
 *
 * ## Why the stub `checkField` is an ALLOWLIST
 *
 * Inherited from `expandFls-7215.test.tsx` for its reason: the real
 * `PermissionProvider` answers `true` for a field no policy mentions, so a
 * denial has to be modelled by a stub that ENUMERATES readable fields.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/** Stable stub identity — `PagePreview` carries `perms` in an effect dep list. */
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

// The rendered page body is orthogonal to what this file observes (the sample
// -record REST request this component issues directly via `fetch`).
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SchemaRenderer: () => <div data-testid="mock-schema-renderer" />,
  RecordContextProvider: ({ children }: { children: any }) => <>{children}</>,
}));

import { PagePreview } from './PagePreview';

const OBJECT = 'showcase_account';

/**
 * Two relations of DIFFERENT declared types so the pins cover the family
 * rather than one spelling: `account` is the readable `lookup` control,
 * `owner_dept` the denied `master_detail`, `secret_account` the denied
 * `lookup` under test.
 */
const OBJECT_FIELDS: Record<string, any> = {
  name: { type: 'text', label: 'Name' },
  account: { type: 'lookup', reference: 'account', label: 'Account' },
  secret_account: { type: 'lookup', reference: 'account', label: 'Secret Account' },
  owner_dept: { type: 'master_detail', reference: 'department', label: 'Dept' },
};

const draft = {
  name: 'acct_full',
  type: 'record',
  object: OBJECT,
  kind: 'full',
  regions: [{ name: 'main', components: [{ type: 'record:details' }] }],
};

/**
 * Stub `fetch` to serve the schema read and record the `$expand` query param
 * on the record read. Both endpoints this component calls directly.
 */
function stubFetch() {
  const dataCalls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/meta/object/')) {
      return { json: async () => ({ item: { name: OBJECT, fields: OBJECT_FIELDS } }) } as any;
    }
    if (url.startsWith('/api/v1/data/')) {
      dataCalls.push(url);
      return { json: async () => ({ records: [] }) } as any;
    }
    return { json: async () => ({}) } as any;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, dataCalls };
}

/** Parse the `$expand` query param off the most recent `/api/v1/data/` call. */
function expandFromCalls(dataCalls: string[]): string[] {
  const last = dataCalls.at(-1);
  if (!last) return [];
  const qs = last.split('?')[1] ?? '';
  const params = new URLSearchParams(qs);
  const raw = params.get('$expand');
  return raw ? raw.split(',') : [];
}

async function expandFor(): Promise<string[]> {
  const { dataCalls } = stubFetch();
  render(<PagePreview type="page" name={draft.name} draft={draft} />);
  await waitFor(() => expect(dataCalls.length).toBeGreaterThan(0));
  return expandFromCalls(dataCalls);
}

beforeEach(() => {
  state.isLoaded = true;
  state.readable = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PagePreview — record-binding `$expand` is FLS-gated (objectui#7429)', () => {
  // ── PIN 1: the defect itself ────────────────────────────────────────────
  it('does NOT ask the server to EXPAND a lookup the principal cannot read', async () => {
    state.readable = ['id', 'name', 'account'];
    const expand = await expandFor();
    expect(
      expand,
      'with no column list this preview expands EVERY declared relation, so a denied '
        + 'lookup is asked for by default rather than by configuration',
    ).not.toContain('secret_account');
  });

  // ── PIN 2: the live control — the gate narrows, it never empties ────────
  it('still expands a lookup the principal CAN read', async () => {
    state.readable = ['id', 'name', 'account'];
    const expand = await expandFor();
    expect(expand).toContain('account');
  });

  // ── PIN 3: `master_detail`, not only `lookup` ───────────────────────────
  it('gates a denied `master_detail` root too, not only `lookup`', async () => {
    state.readable = ['id', 'name', 'account'];
    const expand = await expandFor();
    expect(expand).not.toContain('owner_dept');
    expect(expand).toContain('account');
  });

  // ── PIN 4: the whole no-column-list set, asserted exactly ───────────────
  it('sends exactly the readable relations — asserted as a set, not merely by absence', async () => {
    state.readable = ['id', 'name', 'account'];
    const expand = await expandFor();
    expect(
      expand.slice().sort(),
      'an absence assertion alone would also pass if the expansion had gone empty',
    ).toEqual(['account']);
  });

  // ── PIN 5: every relation denied → no `$expand` param at all ────────────
  it('omits `$expand` entirely when every declared relation is denied', async () => {
    state.readable = ['id', 'name'];
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
        + 'forever, and a preview with no PermissionProvider must keep expanding',
    ).toEqual(expect.arrayContaining(['account', 'secret_account', 'owner_dept']));
  });
});
