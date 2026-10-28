/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The approvals inbox names the flow, the step and the object in the reader's
 * UI language (objectstack#26883).
 *
 * The approvals door serves `process_label`, `step_label` and `object_label`
 * in the language the request's `Accept-Language` names, from the app's pack
 * (`flows.<flow>.label`, `flows.<flow>.approvals.<node_id>.label`,
 * `objects.<object>.label`), and the stored authoring text when the pack has
 * no entry. The request page reads through the console's authenticated fetch,
 * which stamps the active UI language; the inbox's `approvalsApi` called a
 * bare `fetch`, which carries only the browser's language, so a reader who
 * switched the console to 中文 read the inbox in English.
 *
 * Nothing between the page and the wire is stubbed here: the real
 * `I18nProvider` writes `<html lang>`, the real `createAuthenticatedFetch`
 * reads it, and the global `fetch` below stands in for the door, answering in
 * the language it is asked for, as the server does. A page that does not send
 * the UI language gets the English labels and goes red.
 */

import '@testing-library/jest-dom/vitest';
import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { I18nProvider } from '@object-ui/i18n';

const { ADAPTER, AUTH } = vi.hoisted(() => ({
  ADAPTER: {
    find: async () => ({ data: [{ id: 'opp_1' }, { id: 'exp_1' }] }),
    getObjectSchema: async () => ({ fields: {} }),
  },
  AUTH: { user: { id: 'u_1', email: 'approver@example.com' } },
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => AUTH,
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: [] }),
  DeclaredActionsBar: () => null,
  isViaOverrideRow: () => false,
}));

import { ApprovalsInboxPage } from './ApprovalsInboxPage';

/** The app's zh-CN pack, as the door would read it; `expense_approval` has no entry. */
const ZH_PACK: Record<string, string> = {
  'flows.opportunity_approval.label': '大额商机审批',
  'flows.opportunity_approval.approvals.manager_review.label': '销售经理审核',
  'objects.opportunity.label': '商机',
};

function row(id: string, flow: string, node: string, object: string, stored: { process: string; step: string; object: string }) {
  return {
    id,
    process_name: `flow:${flow}`,
    process_label: stored.process,
    current_step: node,
    step_label: stored.step,
    object_name: object,
    object_label: stored.object,
    record_id: id,
    record_title: `Record ${id}`,
    status: 'pending',
    pending_approvers: ['u_1'],
    submitter_id: 'u_2',
    submitter_name: 'Sam Submitter',
    submitted_at: new Date().toISOString(),
  };
}

/** The approvals door: each label in the asked language when the pack has it, else as stored. */
function doorRows(acceptLanguage: string | null) {
  const zh = /^zh\b/i.test(acceptLanguage ?? '');
  const pick = (key: string, stored: string) => (zh && ZH_PACK[key]) || stored;
  return [
    row('opp_1', 'opportunity_approval', 'manager_review', 'opportunity', {
      process: pick('flows.opportunity_approval.label', 'Large Deal Approval'),
      step: pick('flows.opportunity_approval.approvals.manager_review.label', 'Sales Manager Review'),
      object: pick('objects.opportunity.label', 'Opportunity'),
    }),
    row('exp_1', 'expense_approval', 'finance_review', 'expense', {
      process: pick('flows.expense_approval.label', 'Expense Approval'),
      step: pick('flows.expense_approval.approvals.finance_review.label', 'Finance Review'),
      object: pick('objects.expense.label', 'Expense'),
    }),
  ];
}

let seenLanguages: Array<string | null> = [];

beforeEach(() => {
  seenLanguages = [];
  document.documentElement.lang = '';
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const lang = new Headers(init?.headers).get('Accept-Language');
    if (/\/approvals\/requests(\?|$)/.test(url)) {
      seenLanguages.push(lang);
      const data = doorRows(lang);
      return new Response(JSON.stringify({ data, total: data.length }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }));
});

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

function renderInbox(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MePermissionsProvider initialPermissions={permissions()}>
        <MemoryRouter initialEntries={['/apps/app/system/approvals']}>
          <Routes>
            <Route path="/apps/:appName/system/approvals" element={<AfterBoot><ApprovalsInboxPage /></AfterBoot>} />
          </Routes>
        </MemoryRouter>
      </MePermissionsProvider>
    </I18nProvider>,
  );
}

/**
 * Mounts its children one commit after the providers. The console mounts a
 * page behind its boot (auth, routing), long after `I18nProvider` has written
 * `<html lang>`; a page mounted in the provider's own first commit would run
 * its fetch effect before the provider's (children's effects run first).
 */
function AfterBoot({ children }: { children: ReactNode }) {
  const [booted, setBooted] = useState(false);
  useEffect(() => setBooted(true), []);
  return booted ? <>{children}</> : null;
}

/** The queue row (table row) that holds `recordTitle`. */
async function queueRow(recordTitle: string): Promise<HTMLElement> {
  return waitFor(() => {
    const tr = screen.getAllByText(recordTitle)
      .map((el) => el.closest('tr'))
      .find((el): el is HTMLTableRowElement => !!el);
    expect(tr, `no table row holds ${recordTitle}`).toBeTruthy();
    return tr!;
  });
}

describe('ApprovalsInboxPage — flow, step and object labels in the reader language (objectstack#26883)', () => {
  it('asks the approvals door in the active UI language', async () => {
    renderInbox('zh');
    await queueRow('Record opp_1');
    expect(seenLanguages.length).toBeGreaterThan(0);
    expect(seenLanguages.every((l) => l === 'zh'), `saw: ${JSON.stringify(seenLanguages)}`).toBe(true);
  });

  it('the queue row shows the pack\'s flow, step and object labels under zh', async () => {
    renderInbox('zh');
    const tr = await queueRow('Record opp_1');
    expect(within(tr).getByText('大额商机审批')).toBeInTheDocument();
    expect(within(tr).getByText('销售经理审核')).toBeInTheDocument();
    expect(within(tr).getByText('商机')).toBeInTheDocument();
    expect(within(tr).queryByText('Opportunity')).toBeNull();
    expect(within(tr).queryByText('Large Deal Approval')).toBeNull();
    expect(within(tr).queryByText('Sales Manager Review')).toBeNull();
  });

  it('a flow the pack does not translate keeps its stored labels', async () => {
    renderInbox('zh');
    const tr = await queueRow('Record exp_1');
    expect(within(tr).getByText('Expense Approval')).toBeInTheDocument();
    expect(within(tr).getByText('Finance Review')).toBeInTheDocument();
  });

  it('the process and object filters list the labels shown', async () => {
    renderInbox('zh');
    await queueRow('Record opp_1');
    const triggers = screen.getAllByRole('combobox');
    const texts: string[] = [];
    for (const trigger of triggers) {
      fireEvent.click(trigger);
      for (const option of screen.queryAllByRole('option')) texts.push((option.textContent ?? '').trim());
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      cleanupOpenListbox();
    }
    expect(texts, `options: ${JSON.stringify(texts)}`).toEqual(expect.arrayContaining(['大额商机审批', 'Expense Approval', '商机', 'Expense']));
    expect(texts).not.toContain('Large Deal Approval');
    expect(texts).not.toContain('opportunity');
  });

  it('search matches the shown text and the machine name', async () => {
    renderInbox('zh');
    await queueRow('Record opp_1');
    const search = screen.getByRole('textbox');
    fireEvent.change(search, { target: { value: '销售经理' } });
    expect(screen.queryAllByText('Record opp_1').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Record exp_1')).toHaveLength(0);
    fireEvent.change(search, { target: { value: '商机' } });
    expect(screen.queryAllByText('Record opp_1').length).toBeGreaterThan(0);
    fireEvent.change(search, { target: { value: 'opportunity_approval' } });
    expect(screen.queryAllByText('Record opp_1').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Record exp_1')).toHaveLength(0);
  });

  it('control: an English UI reads the stored English labels', async () => {
    renderInbox('en');
    const tr = await queueRow('Record opp_1');
    expect(within(tr).getByText('Large Deal Approval')).toBeInTheDocument();
    expect(within(tr).getByText('Sales Manager Review')).toBeInTheDocument();
    expect(seenLanguages.every((l) => l === 'en'), `saw: ${JSON.stringify(seenLanguages)}`).toBe(true);
  });
});

/** Radix Select keeps a closed listbox mounted for a tick; drop any left so the next trigger lists only its own options. */
function cleanupOpenListbox(): void {
  for (const el of document.querySelectorAll('[role="listbox"]')) el.remove();
}
