// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13460, second pass — four more console surfaces speak the session's
 * language.
 *
 * System → Audit Log, Developer → Flow Runs, the Integrations page's "Connect
 * an AI agent" card and the public `/s/:token` share landing drew their copy as
 * English literals. They now read `console.system.auditLog.*`,
 * `console.developer.flowRuns.*`, `console.developer.agentConnect.*` and
 * `sharedRecord.*`.
 *
 * What this file pins, through the real pages and a real `I18nProvider`:
 *   - under zh each page draws its heading and a sample of its copy from the
 *     zh pack (expectations read from the pack, guarded as real zh rows);
 *   - a sentence that names another control (Flow Runs' "Click Run Flow",
 *     "the Test Run panel") names it by that control's zh label;
 *   - a sentence with an inline `<code>` is ONE translated string, the code
 *     sits where the zh string put it, and no `{{slot}}` or private-use mark
 *     is left in the text;
 *   - control: with no provider at all each page still reads its English.
 *
 * Every network read answers empty, and a share-link resolve answers 404.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

const ADAPTER = vi.hoisted(() => {
  // A STABLE singleton: a fresh object per render loops the pages' load effects.
  const client = {
    meta: { getItems: async () => ({ type: 'flow', items: [{ name: 'welcome_flow', label: 'Welcome' }] }) },
    automation: { execute: async () => ({}), listRuns: async () => ({ runs: [] }) },
  };
  return {
    getClient: () => client,
    find: async () => ({ data: [], total: 0 }),
    findOne: async () => null,
    getObjectSchema: async () => undefined,
  };
});
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: [], getTypeStatus: () => 'loaded' }),
}));

// Imported after the mocks so the pages pick them up.
import { AuditLogPage } from './system/AuditLogPage';
import { FlowRunsPage } from './developer/FlowRunsPage';
import { AgentConnectSection } from './developer/AgentConnectSection';
import SharedRecordPage from './SharedRecordPage';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/share-links/')) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ records: [], data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const { zh, en } = builtInLocales;
const zhAudit = zh.console.system.auditLog;
const zhFlow = zh.console.developer.flowRuns;
const zhAgent = zh.console.developer.agentConnect;
const zhShared = zh.sharedRecord;

/** No `{{slot}}` and no private-use slot mark survives into the rendered text. */
const LEAK = /\{\{|[\u{E000}-\u{F8FF}]/u;

function page(element: React.ReactElement, language: 'zh' | null, path = '/x', route = '/x') {
  const routed = (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>
  );
  return render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        {routed}
      </I18nProvider>
    ) : (
      routed
    ),
  );
}

describe('console pages under zh (objectui#13460, second pass)', () => {
  it('guard: the zh values read below are real zh rows, not English copies', () => {
    for (const [zhValue, enValue] of [
      [zhAudit.title, en.console.system.auditLog.title],
      [zhFlow.title, en.console.developer.flowRuns.title],
      [zhAgent.title, en.console.developer.agentConnect.title],
      [zhShared.cannotOpen, en.sharedRecord.cannotOpen],
    ]) {
      expect(zhValue).not.toBe(enValue);
      expect(zhValue).toMatch(/\p{Script=Han}/u);
    }
  });

  it('Audit Log: the heading, the filter labels and the empty state', async () => {
    const { container } = page(<AuditLogPage />, 'zh');
    expect(await screen.findByText(zhAudit.emptyTitle)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(zhAudit.title);
    expect(screen.getByText(zhAudit.emptyUnfiltered)).toBeTruthy();
    for (const label of [zhAudit.action, zhAudit.object, zhAudit.actor, zhAudit.from, zhAudit.to]) {
      expect(screen.getByText(label, { selector: 'label' })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: new RegExp(zhAudit.openAsList) })).toBeTruthy();
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('Flow Runs: the cards, and the sentences that name another control by its zh label', async () => {
    const { container } = page(<FlowRunsPage />, 'zh');
    expect(await screen.findByText(zhFlow.recentRuns)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(zhFlow.title);
    expect(screen.getByText(zhFlow.testRunTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: zhFlow.runFlow })).toBeTruthy();
    expect(screen.getByText(zhFlow.noInputs.replace('{{action}}', zhFlow.runFlow))).toBeTruthy();
    expect(await screen.findByText(zhFlow.noRuns.replace('{{panel}}', zhFlow.testRunTitle))).toBeTruthy();
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('Connect an AI agent: the card, and the disabled notice with its <code> in the zh place', async () => {
    const { container } = page(<AgentConnectSection />, 'zh');
    expect(await screen.findByText(zhAgent.disabledTitle)).toBeTruthy();
    expect(screen.getByText(zhAgent.title)).toBeTruthy();
    expect(screen.getByRole('button', { name: zhAgent.generateKey })).toBeTruthy();
    expect(screen.getByPlaceholderText(zhAgent.keyNamePlaceholder)).toBeTruthy();
    const flag = screen.getByText('OS_MCP_SERVER_ENABLED=true', { selector: 'code' });
    expect(flag.parentElement!.textContent).toBe(
      zhAgent.disabledBody.replace('{{flag}}', 'OS_MCP_SERVER_ENABLED=true'),
    );
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('share landing: an unknown link says so in zh', async () => {
    const { container } = page(<SharedRecordPage />, 'zh', '/s/abc', '/s/:token');
    expect(await screen.findByText(zhShared.cannotOpen)).toBeTruthy();
    expect(screen.getByText(zhShared.invalidLink)).toBeTruthy();
    expect(container.textContent).not.toMatch(LEAK);
  });
});

describe('control: with no provider each page still reads its English (objectui#13460)', () => {
  it('Audit Log', async () => {
    page(<AuditLogPage />, null);
    expect(await screen.findByText('No audit entries')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Audit Log');
  });

  it('Flow Runs', async () => {
    page(<FlowRunsPage />, null);
    expect(await screen.findByText('Recent Runs')).toBeTruthy();
    expect(
      screen.getByText('This flow declares no input variables. Click Run Flow to invoke it with no parameters.'),
    ).toBeTruthy();
    expect(await screen.findByText('No runs yet. Use the Test Run panel to invoke this flow.')).toBeTruthy();
  });

  it('Connect an AI agent', async () => {
    page(<AgentConnectSection />, null);
    expect(await screen.findByText('MCP is not enabled for this environment')).toBeTruthy();
    expect(screen.getByText('Connect an AI agent (MCP)')).toBeTruthy();
  });

  it('share landing', async () => {
    page(<SharedRecordPage />, null, '/s/abc', '/s/:token');
    expect(await screen.findByText("Can't open this link")).toBeTruthy();
    expect(screen.getByText('This link is invalid or no longer available.')).toBeTruthy();
  });
});
