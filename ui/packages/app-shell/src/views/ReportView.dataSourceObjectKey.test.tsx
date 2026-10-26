/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ReportView reads `dataSource.object` — and ONLY `object` (objectui#5116).
 *
 * The view used to accept `resource` as a second spelling of `object` in two
 * places, and to NAME that spelling in a user-facing warning:
 *
 *   :171  liveReport?.objectName || liveReport?.dataSource?.object
 *                                || liveReport?.dataSource?.resource
 *   :273  dataFetchSource.dataSource.object || dataFetchSource.dataSource.resource
 *   :275  console.warn('ReportView: dataSource missing object/resource property')
 *
 * `resource` is not on this contract. `ElementDataSourceConfig`
 * (`packages/core/src/data-scope/element-data-source.ts`) declares
 * `object` / `view?` / `filter?` / `sort?` / `limit?`, its spec twin
 * `ElementDataSourceSchema` is `z.strictObject` (an extra `resource` key is
 * REJECTED, not ignored), and the binding's own predicate
 * `isElementDataSourceConfig` decides on `object` — so a `resource`-only
 * binding was never a binding on any other renderer. `resource` IS a real key
 * elsewhere (the `DataSource` adapter's first parameter,
 * `LiveExportOptions.resource`); none of those is this surface. (`CRUDSchema.resource`
 * was a fourth until objectui#5373 retired `CRUDSchema` under ADR-0049.)
 *
 * Per AGENTS.md #0.1 the fix belongs at the producer, never as a renderer-side
 * alias — and the producer census found no producer to fix: nothing in this
 * repo or in the `objectstack` framework repo writes `resource` onto a report
 * `dataSource`. The limb was speculative from the commit that introduced it.
 *
 * What these pin, per input shape, BY RENDERING (not by reading the source):
 *
 *   object only      -> queries that object                (unchanged)
 *   resource only    -> NOT queried; the view reports it    (behaviour REMOVED)
 *   object+resource  -> queries `object`; `resource` inert  (unchanged)
 *   neither          -> NOT queried; the view reports it    (unchanged)
 *
 * and, on the second limb, which object the config panel's field list is
 * derived from. Both limbs are measured in every shape, so a fix applied to
 * only one of them fails here.
 *
 * Non-vacuity: the `resource`-only cases put a REAL object (`acct`, with real
 * fields) behind the non-contract spelling, so "no query" and "fallback
 * fields" prove the spelling was not read — not that there was nothing to
 * read.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

/** Props the (stubbed) report renderer and config panel were handed. */
const cap = vi.hoisted(() => ({ renderer: null as any, panel: null as any }));

vi.mock('@object-ui/plugin-report', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ReportRenderer: (props: any) => {
    cap.renderer = props;
    return null;
  },
}));
vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DrillDownDrawer: () => null,
}));
vi.mock('./ReportConfigPanel', () => ({
  ReportConfigPanel: (props: any) => {
    cap.panel = props;
    return null;
  },
}));

const meta = vi.hoisted(() => ({ value: null as any }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ reportName: 'revenue_by_month' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/reports/revenue_by_month', search: '' }),
}));

vi.mock('./useOpenRecordList', () => ({ useOpenRecordList: () => vi.fn() }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({ get: vi.fn() }) }));
vi.mock('./runtime-metadata-persistence', () => ({ persistRuntimeMetadata: vi.fn() }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string) => k }),
  createSafeTranslation: (defaults: Record<string, string>) => () => ({
    t: (k: string) => defaults?.[k] ?? k,
  }),
}));

import { ReportView } from './ReportView';

/** A REAL object with REAL fields — what a read of `resource` would find. */
const ACCT_OBJECT = {
  name: 'acct',
  label: 'Account',
  fields: { industry: { label: 'Industry', type: 'text' } },
};
/** A second real object, so "both keys" can show WHICH one was read. */
const OTHER_OBJECT = {
  name: 'other',
  label: 'Other',
  fields: { misc: { label: 'Misc', type: 'text' } },
};

/**
 * Mount the view over a report whose `dataSource` is exactly `ds`, and hand
 * back the two live measurements: what the adapter was asked to query, and
 * which field list the config panel was handed.
 */
async function mountReport(ds: Record<string, unknown>) {
  const find = vi.fn(
    async (_objectName: string, _params?: Record<string, unknown>) => ({ data: [{ id: '1' }] }),
  );
  meta.value = {
    apps: [],
    objects: [ACCT_OBJECT, OTHER_OBJECT],
    dashboards: [],
    reports: [{ name: 'revenue_by_month', label: 'Revenue by Month', dataSource: ds }],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: vi.fn(async () => null),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };

  render(<ReportView dataSource={{ find } as any} />);
  await waitFor(() => expect(cap.panel).not.toBeNull());
  // The fetch effect is async; let it settle before reading the spy.
  await waitFor(() => expect(find.mock.calls.length >= 0).toBe(true));
  await new Promise((r) => setTimeout(r, 0));

  return {
    /** First argument of the adapter query, or null when never queried. */
    queried: find.mock.calls.length ? find.mock.calls[0][0] : null,
    /** Field values the config panel got, e.g. ['industry'] or the fallbacks. */
    fieldValues: (cap.panel.availableFields as any[]).map((f) => f.value),
  };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cap.renderer = null;
  cap.panel = null;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  vi.clearAllMocks();
});

/** Every `console.warn` argument the view emitted, flattened to one string. */
const warnText = () =>
  warn.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');

describe('ReportView — `dataSource.object` is the only spelling (objectui#5116)', () => {
  it('object only: queries that object, and derives the field list from it', async () => {
    const { queried, fieldValues } = await mountReport({ object: 'acct' });

    expect(queried).toBe('acct');
    expect(fieldValues).toEqual(['industry']);
    expect(warnText()).not.toContain('dataSource missing');
  });

  it('resource only: NOT queried — the undeclared spelling is not a binding', async () => {
    const { queried, fieldValues } = await mountReport({ resource: 'acct' });

    // `acct` is a real object with real fields; it stays unread all the same.
    expect(queried).toBeNull();
    expect(fieldValues).not.toContain('industry');
    expect(warnText()).toContain('ReportView: dataSource missing object property');
  });

  it('object + resource: `object` wins and `resource` is inert', async () => {
    const { queried, fieldValues } = await mountReport({ object: 'acct', resource: 'other' });

    expect(queried).toBe('acct');
    expect(fieldValues).toEqual(['industry']);
    expect(warnText()).not.toContain('dataSource missing');
  });

  it('neither: NOT queried, and the view reports the missing key', async () => {
    const { queried } = await mountReport({});

    expect(queried).toBeNull();
    expect(warnText()).toContain('ReportView: dataSource missing object property');
  });

  it('the warning names `object` and does NOT teach the non-contract `resource`', async () => {
    await mountReport({ resource: 'acct' });

    const text = warnText();
    expect(text).toContain('object');
    // The old wording was 'missing object/resource property' — a user-facing
    // diagnostic that promised a key the contract never declared.
    expect(text).not.toContain('resource');
    expect(text).not.toContain('object/resource');
  });
});
