/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The console's system and developer pages read the DECLARED session locale,
 * never the machine's (objectui#9909): the approvals inbox queue (the row's
 * amount and its submitted-at tooltip), the audit log's timestamp column, and
 * the flow runs table.
 *
 * The inbox's side sheet was read here too (its amount, its payload summary
 * and its timeline tooltips) until objectui#12484 deleted it: a request now
 * opens on its served page, whose summary and timeline draw through the record
 * page's own cells, and those cells' display-locale channel is pinned in
 * `packages/fields` (`NumberCellRenderer.grouping.test.tsx`, "active display
 * locale"; `date-locale-channel.test.tsx`).
 *
 * Every helper here has a `catch`, and none of them is the deliberate
 * fallback shape: each catches an unparseable VALUE, not a tag `Intl`
 * rejected, so the bare call was the primary leg.
 *
 * Each surface is read twice — under a declared `de-DE` tenant locale and a
 * declared `en` one — and must read differently; the runtime tripwire then
 * checks the argument every locale-taking call received. `useObjectTranslation`
 * is stubbed (as the pages' sibling suites stub it) so the strings are fixed;
 * `useDisplayLocale` reads the REAL `LocalizationProvider` value either way.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';

/** 2020-03-04 15:30:00 UTC — the suite runs in UTC. */
const { STORED, approvalsApiStub, ADAPTER, AUTH, I18N } = vi.hoisted(() => {
  const STORED = '2020-03-04T15:30:00.000Z';
  const EPOCH_MS = Date.UTC(2020, 2, 4, 15, 30, 0);
  const ROW: Record<string, unknown> = {
    id: 'req_1',
    process_name: 'purchase_approval',
    process_label: 'Purchase Approval',
    object_name: 'showcase_purchase',
    object_label: 'Purchase',
    record_id: 'po_1',
    record_title: 'PO-4417',
    status: 'pending',
    pending_approvers: ['u_1'],
    submitter_id: 'u_2',
    submitter_name: 'Sam Submitter',
    submitted_at: STORED,
    payload: {
      amount: 1234.5,
      quantity: 98765,
      closed_at: EPOCH_MS,
      review_note: STORED,
    },
  };
  const approvalsApiStub = {
    listRequests: async () => ({ data: [ROW], total: 1 }),
    approve: async () => ({ data: ROW, finalized: true }),
    reject: async () => ({ data: ROW, finalized: true }),
  };
  const listRuns = async () => ({ runs: [{ id: 'run_1', status: 'completed', startedAt: STORED, durationMs: 9 }] });
  // One client, as the real adapter's `getClient()` hands out: Flow Runs keys
  // its flow and run loads on it, so a fresh one per call re-ran them on every
  // render and its runs table never settled (objectui#11865 surfaced it).
  const client = {
    meta: { getItems: async (type: string) => (type === 'flow' ? [{ name: 'sync_flow', label: 'Sync' }] : []) },
    automation: { execute: async () => ({ success: true }), listRuns, getRun: async () => ({ run: null }) },
  };
  const ADAPTER = {
    find: async () => ({ data: [{ id: 'po_1' }] }),
    getObjectSchema: async () => ({ fields: {} }),
    getClient: () => client,
  };
  const AUTH = { user: { id: 'u_1', email: 'approver@example.com' } };
  const I18N = {
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  };
  return { STORED, approvalsApiStub, ADAPTER, AUTH, I18N };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => I18N,
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const authFetch = async () => new Response('{}', { status: 200 });
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => AUTH,
    createAuthenticatedFetch: () => authFetch,
    TokenStorage: { get: () => null },
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: [] }),
}));

vi.mock('../services/approvalsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approvalsApi: approvalsApiStub,
}));

import { ApprovalsInboxPage } from './system/ApprovalsInboxPage';
import { AuditLogPage } from './system/AuditLogPage';
import { FlowRunsPage } from './developer/FlowRunsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function permissions(): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u_1',
    tenantId: 't_1',
    roles: [],
    permissionSets: [],
    objects: {},
    fields: {},
    systemPermissions: ['setup.access'],
  };
}

/** Everything a reader can see or hover: text plus every `title` tooltip. */
function faceOf(root: HTMLElement): string {
  const titles = [...root.querySelectorAll('[title]')].map((el) => el.getAttribute('title') ?? '');
  return `${root.textContent ?? ''} | ${titles.join(' | ')}`.replace(/\s+/g, ' ');
}

interface Surface {
  name: string;
  read: (locale: string) => Promise<string>;
  de: RegExp[];
  en: RegExp[];
}

const SURFACES: Surface[] = [
  {
    name: 'ApprovalsInboxPage — queue',
    read: async (locale) => {
      render(
        <LocalizationProvider value={{ locale }}>
          <MePermissionsProvider initialPermissions={permissions()}>
            <MemoryRouter initialEntries={['/apps/app/system/approvals']}>
              <Routes>
                <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
              </Routes>
            </MemoryRouter>
          </MePermissionsProvider>
        </LocalizationProvider>,
      );
      await screen.findAllByText('Purchase Approval');
      await screen.findAllByText(/Sam Submitter/);
      const text = faceOf(document.body);
      cleanup();
      return text;
    },
    // the row's amount · its submitted-at tooltip
    de: [/1\.234,5/, /4\.3\.2020, 15:30:00/],
    en: [/1,234\.5/, /3\/4\/2020, 3:30:00\sPM/],
  },
  {
    name: 'AuditLogPage — timestamp column',
    read: async (locale) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(JSON.stringify({ records: [{ id: 'log_1', created_at: STORED, action: 'update', object_name: 'account' }] }), {
            status: 200,
          }),
        ),
      );
      render(
        <LocalizationProvider value={{ locale }}>
          <MemoryRouter>
            <AuditLogPage />
          </MemoryRouter>
        </LocalizationProvider>,
      );
      await screen.findByText('account');
      const text = faceOf(document.body);
      cleanup();
      vi.unstubAllGlobals();
      return text;
    },
    de: [/4\.3\.2020, 15:30:00/],
    en: [/3\/4\/2020, 3:30:00\sPM/],
  },
  {
    name: 'FlowRunsPage — runs table start time',
    read: async (locale) => {
      render(
        <LocalizationProvider value={{ locale }}>
          <FlowRunsPage />
        </LocalizationProvider>,
      );
      await screen.findAllByText(/2020/);
      const text = faceOf(document.body);
      cleanup();
      return text;
    },
    de: [/4\.3\.2020, 15:30:00/],
    en: [/3\/4\/2020, 3:30:00\sPM/],
  },
];

describe('console page faces follow the declared session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE faces under a de-DE session', async ({ read, de }) => {
    const text = await read('de-DE');
    for (const face of de) expect(text, `got: ${text.slice(0, 1500)}`).toMatch(face);
  });

  it.each(SURFACES)('$name — keeps its en faces under an en session', async ({ read, en }) => {
    const text = await read('en');
    for (const face of en) expect(text, `got: ${text.slice(0, 1500)}`).toMatch(face);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', async ({ read }) => {
    expect(await read('de-DE')).not.toBe(await read('en'));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', async ({ read }) => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await read('de-DE');
    });
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls).slice(0, 2000)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
