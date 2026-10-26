/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * DashboardView — a header `modal` action's `target` names a PAGE, only
 * (objectui#4766; maintainer ruling on objectstack#6739, 2026-08-09).
 *
 * This view used to install its OWN `onModal` handler on the dashboard's
 * ActionRunner, carrying a second live copy of the retired convention:
 *
 *   create_/new_/add_/edit_/update_ + object  ->  { objectName, mode }
 *   anything else                             ->  { objectName: <target> }
 *
 * PR #4764 retired both limbs in `useActionModal`, but this copy was not on
 * that path, so the ruling could not reach it. It is gone: the view now
 * installs the SHARED `useActionModal` handler — the same one RecordDetailView
 * and the console runtimes install — so one contract has one implementation.
 *
 * What these pin, in the shape PR #4764 established:
 *
 *   1. a prefixed target and a bare target get the IDENTICAL verdict (the
 *      ruling explicitly declined the middle shape "keep the prefix, reject
 *      bare object names");
 *   2. the refusal is a NAMED diagnostic — it quotes the target and points at
 *      `type: 'form'`;
 *   3. a target naming a page still resolves and opens;
 *   4. the non-modal dashboard action paths (`script` handlers) are untouched.
 *
 * Non-vacuity: every refusal case puts the object the old code would have
 * parsed into REALLY in the metadata. A refusal measured against an empty
 * object list would pass by proving nothing was found, rather than proving
 * nothing was looked for — so each case also asserts the object metadata is
 * never consulted at all.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';

// Captured props of the (stubbed) DashboardRenderer — `modalHandler` is the
// handler the view really installs on the dashboard's ActionRunner, which is
// the thing under test. The factory inherits the real module and overrides only
// `DashboardRenderer`, so the package's own `ComponentRegistry.register` calls
// DO run now (objectui#6892). The stub no longer avoids that setup; it replaces
// the one component this file asserts on.
const cap = vi.hoisted(() => ({ props: null as any }));
vi.mock('@object-ui/plugin-dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DashboardRenderer: (props: any) => {
    cap.props = props;
    return null;
  },
}));

// The metadata the view itself reads (dashboards). `useActionModal` reads the
// SAME value through the real `MetadataCtx` below, so `getItem` sees every
// lookup either side makes.
const meta = vi.hoisted(() => ({ value: null as any }));
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ dashboardName: 'sales_overview' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dashboards/sales_overview', search: '' }),
}));

vi.mock('./useOpenRecordList', () => ({ useOpenRecordList: () => vi.fn() }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../providers/ExpressionProvider', () => ({ useExpressionContext: () => ({ app: undefined }) }));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string) => k }),
  useObjectLabel: () => ({
    dashboardLabel: ({ label, name }: any) => label ?? name,
    dashboardDescription: ({ description }: any) => description,
  }),
  // <ModalForm> builds its discard-guard strings with this at import time.
  createSafeTranslation: (defaults: Record<string, string>) => () => ({
    t: (k: string) => defaults?.[k] ?? k,
  }),
}));

import { DashboardView } from './DashboardView';

const SALES_DASHBOARD = { name: 'sales_overview', label: 'Sales Overview', widgets: [] };
/** A REAL object — the one `create_opportunity` used to be parsed into. */
const OPPORTUNITY_OBJECT = { name: 'opportunity', label: 'Opportunity', fields: {} };
const QUICK_LOG_PAGE = { name: 'quick_log_call', type: 'utility', label: 'Log a Call' };

/**
 * A refusal settles immediately; an OPENED modal returns a promise that settles
 * only when the dialog closes. So `await modalHandler(...)` on a case that is
 * supposed to be refused would HANG to the suite timeout if the retired branch
 * ever came back — failing late, opaquely, and cascading into the next test in
 * the file (PR #4764 measured exactly that cascade and hardened its own
 * diagnostic pin for it). This turns that hang into a fast, named assertion.
 */
const HUNG = Symbol('handler did not settle — it opened a modal instead of refusing');
function settle<T>(p: Promise<T>): Promise<T | typeof HUNG> {
  return Promise.race([p, new Promise<typeof HUNG>((r) => setTimeout(() => r(HUNG), 250))]);
}

/**
 * Mount the view and hand back the `modalHandler` it installed, plus the
 * `getItem` spy every metadata lookup goes through.
 */
async function mountDashboard(items: Record<string, any[]>) {
  const getItem = vi.fn(async (type: string, name: string) =>
    (items[type] ?? []).find((i) => i.name === name) ?? null);
  meta.value = {
    apps: [],
    objects: items.object ?? [],
    dashboards: items.dashboard ?? [SALES_DASHBOARD],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };

  render(
    <MetadataCtx.Provider value={meta.value as any}>
      <DashboardView />
    </MetadataCtx.Provider>,
  );

  await waitFor(() => expect(cap.props).not.toBeNull());
  return { modalHandler: cap.props.modalHandler as (s: any) => Promise<any>, getItem };
}

beforeEach(() => {
  cap.props = null;
  vi.clearAllMocks();
});

describe('DashboardView — a header modal target names a page, only (objectui#4766)', () => {
  it('REFUSES a create_ prefixed target, naming it and pointing at type: form', async () => {
    const { modalHandler, getItem } = await mountDashboard({
      object: [OPPORTUNITY_OBJECT],
      page: [],
    });

    let r: any;
    await act(async () => { r = await settle(modalHandler('create_opportunity')); });

    expect(r).not.toBe(HUNG);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(r.success).toBe(false);
    expect(r.error).toContain('create_opportunity');
    expect(r.error).toContain("type: 'form'");
    // The prefix is not special: `opportunity` exists, and is never asked for.
    expect(getItem).toHaveBeenCalledWith('page', 'create_opportunity');
    expect(getItem).not.toHaveBeenCalledWith('object', 'opportunity');
    expect(getItem).not.toHaveBeenCalledWith('object', 'create_opportunity');
  });

  it('judges a prefixed target and a bare object name IDENTICALLY', async () => {
    // The ruling declined the middle shape (keep the prefix, reject bare object
    // names), so the two spellings must be indistinguishable here — same
    // refusal, same diagnostic modulo the quoted name. Both objects really
    // exist in the metadata for this comparison.
    const { modalHandler, getItem } = await mountDashboard({
      object: [OPPORTUNITY_OBJECT],
      page: [],
    });

    let prefixed: any;
    let bare: any;
    await act(async () => { prefixed = await settle(modalHandler('create_opportunity')); });
    await act(async () => { bare = await settle(modalHandler('opportunity')); });

    expect(prefixed).not.toBe(HUNG);
    expect(bare).not.toBe(HUNG);
    expect(prefixed.success).toBe(false);
    expect(bare.success).toBe(false);
    expect(prefixed.error.replace('create_opportunity', 'opportunity')).toBe(bare.error);
    expect(getItem).not.toHaveBeenCalledWith('object', 'opportunity');
  });

  it('opens a target that names a PAGE, without probing the object metadata', async () => {
    const { modalHandler, getItem } = await mountDashboard({
      object: [OPPORTUNITY_OBJECT],
      page: [QUICK_LOG_PAGE],
    });

    // NOT awaited: a resolved target opens the dialog and returns a promise
    // that settles only when the dialog CLOSES, so awaiting it here would hang
    // to the suite timeout. `settled` is the assertion that it stayed open.
    let settled = false;
    await act(async () => {
      void modalHandler('quick_log_call').then(() => { settled = true; });
    });

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(settled).toBe(false);
    expect(getItem).toHaveBeenCalledWith('page', 'quick_log_call');
    expect(getItem).not.toHaveBeenCalledWith('object', 'quick_log_call');
  });

  it('reports a missing target distinctly from a refused one', async () => {
    const { modalHandler } = await mountDashboard({ object: [], page: [] });

    let r: any;
    await act(async () => { r = await settle(modalHandler('')); });

    expect(r).not.toBe(HUNG);
    expect(r.success).toBe(false);
    expect(r.error).toBe('Modal action has no target to open.');
  });

  it('leaves the non-modal dashboard action paths alone', async () => {
    // The `script` handlers this view owns are the other half of what it
    // installs on the runner; the modal retirement must not disturb them.
    await mountDashboard({ object: [], page: [] });

    expect(Object.keys(cap.props.scriptHandlers)).toEqual(
      expect.arrayContaining(['export_dashboard_pdf', 'forecast_dashboard']),
    );
    expect(typeof cap.props.modalHandler).toBe('function');
  });
});
