/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Audit Log drawer opens the row's own record page.
 *
 * A settings write records a `config_change` row that carries only a digest.
 * The CRUD mirror writes its own rows about the same settings row, and those
 * hold the value. Both name the settings row as `record_id`, and the
 * platform's record page for `sys_audit_log` (`sys_audit_log_detail`, in
 * `plugin-audit`) lists every ledger row with the row's `record_id`. The
 * drawer had no way to reach that page: "Open as list" opens the object list,
 * not a row.
 *
 * The router is real: the page mounts at `/apps/:appName/system/audit-log`, as
 * `systemRoutes` mounts it, and the console's record route
 * `/apps/:appName/:objectName/record/:recordId` holds a probe that reads back
 * what the link handed it.
 *
 * Pinned:
 *  - on a `config_change` row the drawer links to that row's record page under
 *    the list's app, says that page lists the record's other changes, and the
 *    link lands there carrying the way back to this page;
 *  - the landed row names the settings row the mirror's update row names, so
 *    the page's same-record list holds the update row;
 *  - a row about no record still links to its own page, without the hint;
 *  - under zh the link and the hint read the zh pack.
 *
 * Not pinned here, and pinned where the code lives: the page's same-record
 * list (`plugin-audit`'s `sys-audit-log-page.test.ts`, "the same-record list
 * is the ledger, keyed on `record_id` on both sides") and the related list's
 * `relationshipValueField` read (`plugin-detail`).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

const { ADAPTER } = vi.hoisted(() => ({
  ADAPTER: {
    find: async () => ({ data: [], total: 0 }),
    findOne: async () => null,
    getObjectSchema: async () => undefined,
  },
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

import { AuditLogPage } from './AuditLogPage';

/** The settings row both writers name. */
const SETTINGS_ROW = 'set_mail_from_0001';

/** The `config_change` row: a digest, no value. */
const CONFIG_CHANGE = {
  id: 'log_cfg_0001',
  created_at: '2026-11-06T10:00:01.000Z',
  action: 'config_change',
  object_name: 'sys_setting',
  record_id: SETTINGS_ROW,
  new_value: '{"digest":"sha256:9f2c"}',
};

/** The CRUD mirror's update row about the same settings row: it holds the value. */
const MIRROR_UPDATE = {
  id: 'log_upd_0002',
  created_at: '2026-11-06T10:00:00.000Z',
  action: 'update',
  object_name: 'sys_setting',
  record_id: SETTINGS_ROW,
  old_value: '{"value":"noreply@old.example"}',
  new_value: '{"value":"noreply@new.example"}',
};

/** A row about no record (an import run). */
const IMPORT_RUN = {
  id: 'log_imp_0003',
  created_at: '2026-11-06T09:00:00.000Z',
  action: 'import',
  object_name: 'account',
  record_id: null,
};

const LEDGER = [CONFIG_CHANGE, MIRROR_UPDATE, IMPORT_RUN];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ object: 'sys_audit_log', records: LEDGER, total: LEDGER.length }), { status: 200 }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** The console's record route, answering with what the link handed it. */
function RecordRouteProbe() {
  const { appName, objectName, recordId } = useParams();
  const from = (useLocation().state as { from?: { pathname?: string; label?: string } } | null)?.from;
  return (
    <div data-testid="record-route">
      <span data-testid="app">{appName}</span>
      <span data-testid="object">{objectName}</span>
      <span data-testid="record">{recordId}</span>
      <span data-testid="from-path">{from?.pathname}</span>
      <span data-testid="from-label">{from?.label}</span>
    </div>
  );
}

function renderAt(path = '/apps/setup/system/audit-log') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/apps/:appName/system/audit-log" element={<AuditLogPage />} />
        <Route path="/apps/:appName/:objectName/record/:recordId" element={<RecordRouteProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Opens the drawer on one ledger row. The table lists the rows in served order under its header row. */
async function openDrawerOn(rowId: string): Promise<HTMLElement> {
  await screen.findAllByRole('cell');
  await settle();
  const index = LEDGER.findIndex((r) => r.id === rowId);
  const rows = screen.getAllByRole('row');
  expect(rows).toHaveLength(LEDGER.length + 1);
  fireEvent.click(rows[index + 1]);
  const drawer = await screen.findByRole('dialog');
  // The drawer is the chosen row's: it shows that row's id.
  expect(within(drawer).getByText(rowId)).toBeInTheDocument();
  return drawer;
}

describe('AuditLogPage — the drawer opens the row\'s record page', () => {
  it('on a config_change row, links to that row\'s page and says it lists the record\'s other changes', async () => {
    renderAt();
    const drawer = await openDrawerOn(CONFIG_CHANGE.id);
    const link = within(drawer).getByRole('link', { name: /Open entry page/ });
    expect(link).toHaveAttribute('href', `/apps/setup/sys_audit_log/record/${CONFIG_CHANGE.id}`);
    expect(within(drawer).getByText(builtInLocales.en.console.system.auditLog.openEntryPageHint)).toBeInTheDocument();
  });

  it('the link lands on the record route with the row id and the way back to this page', async () => {
    renderAt();
    const drawer = await openDrawerOn(CONFIG_CHANGE.id);
    fireEvent.click(within(drawer).getByRole('link', { name: /Open entry page/ }));
    expect(await screen.findByTestId('record-route')).toBeInTheDocument();
    expect(screen.getByTestId('app')).toHaveTextContent('setup');
    expect(screen.getByTestId('object')).toHaveTextContent('sys_audit_log');
    expect(screen.getByTestId('record')).toHaveTextContent(CONFIG_CHANGE.id);
    expect(screen.getByTestId('from-path')).toHaveTextContent('/apps/setup/system/audit-log');
    expect(screen.getByTestId('from-label')).toHaveTextContent('Audit Log');
    // The landed row's `record_id` is the one the mirror's update row names,
    // so the page's same-record list (keyed on `record_id` on both sides)
    // holds the update row and its value.
    const landed = LEDGER.find((r) => r.id === screen.getByTestId('record').textContent);
    const sameRecord = LEDGER.filter((r) => r.record_id === landed?.record_id).map((r) => r.id);
    expect(sameRecord).toContain(MIRROR_UPDATE.id);
  });

  it('keeps the app segment the page is mounted under', async () => {
    renderAt('/apps/crm/system/audit-log');
    const drawer = await openDrawerOn(CONFIG_CHANGE.id);
    expect(within(drawer).getByRole('link', { name: /Open entry page/ }))
      .toHaveAttribute('href', `/apps/crm/sys_audit_log/record/${CONFIG_CHANGE.id}`);
  });

  it('a row about no record still links to its own page, without the hint', async () => {
    renderAt();
    const drawer = await openDrawerOn(IMPORT_RUN.id);
    expect(within(drawer).getByRole('link', { name: /Open entry page/ }))
      .toHaveAttribute('href', `/apps/setup/sys_audit_log/record/${IMPORT_RUN.id}`);
    expect(within(drawer).queryByText(builtInLocales.en.console.system.auditLog.openEntryPageHint)).toBeNull();
  });

  it('under zh, the link and the hint read the zh pack', async () => {
    const zhAudit = builtInLocales.zh.console.system.auditLog;
    // Guard: real zh rows, not English copied over.
    expect(zhAudit.openEntryPage).not.toBe(builtInLocales.en.console.system.auditLog.openEntryPage);
    expect(zhAudit.openEntryPageHint).not.toBe(builtInLocales.en.console.system.auditLog.openEntryPageHint);
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <MemoryRouter initialEntries={['/apps/setup/system/audit-log']}>
          <Routes>
            <Route path="/apps/:appName/system/audit-log" element={<AuditLogPage />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );
    const drawer = await openDrawerOn(CONFIG_CHANGE.id);
    expect(within(drawer).getByRole('link', { name: new RegExp(zhAudit.openEntryPage) })).toBeInTheDocument();
    expect(within(drawer).getByText(zhAudit.openEntryPageHint)).toBeInTheDocument();
  });
});
