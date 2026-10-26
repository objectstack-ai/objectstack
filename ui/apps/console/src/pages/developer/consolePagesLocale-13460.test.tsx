// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13460 — four routed console pages speak the session's language.
 *
 * Developer → API Console, Developer → Public Forms, Developer → Integrations &
 * APIs and System → AI Approvals imported nothing from `@object-ui/i18n`, so a
 * zh / ja / ar operator got an English page. They now read
 * `console.developer.*` / `console.system.*` keys.
 *
 * What this file pins, through the real pages and a real `I18nProvider`:
 *   - under zh each page draws its heading and a sample of its copy from the
 *     zh pack (expectations read from the pack, guarded as real zh rows);
 *   - a sentence with an inline element (the bold action, a `<code>` key) is
 *     ONE translated string, and the element sits where the zh string put it,
 *     with no `{{slot}}` or private-use mark left in the text;
 *   - control: with no provider at all each page still reads its English.
 *
 * The AI queue is stubbed (it polls the AI service; its suites live in
 * `@object-ui/plugin-chatbot`); every network read answers empty.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

const ADAPTER = vi.hoisted(() => {
  const client = {
    baseUrl: 'http://api.test',
    meta: { getItems: async () => ({ type: 'view', items: [] }), saveItem: async () => ({ ok: true }) },
  };
  // A STABLE singleton: a fresh object per render loops the pages' load effects.
  return { getClient: () => client };
});
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));
vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AiPendingActionsInbox: ({ title, description }: { title?: string; description?: string }) => (
    <section data-testid="queue">
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Imported after the mocks so the pages pick them up.
import { ApiConsolePage } from './ApiConsolePage';
import { PublicFormsPage } from './PublicFormsPage';
import { IntegrationsPage } from './IntegrationsPage';
import { AiPendingActionsPage } from '../system/AiPendingActionsPage';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const { zh, en } = builtInLocales;
const zhDev = zh.console.developer;
const enDev = en.console.developer;
const zhSys = zh.console.system;

/** No `{{slot}}` and no private-use slot mark survives into the rendered text. */
const LEAK = /\{\{|[-]/u;

function page(element: React.ReactElement, language: 'zh' | null) {
  const routed = (
    <MemoryRouter initialEntries={['/apps/demo/developer/x']}>
      <Routes>
        <Route path="/apps/:appName/developer/x" element={element} />
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

describe('console pages under zh (objectui#13460)', () => {
  it('guard: the zh values read below are real zh rows, not English copies', () => {
    for (const [zhValue, enValue] of [
      [zhDev.apiConsole.endpointsTitle, enDev.apiConsole.endpointsTitle],
      [zhDev.publicForms.title, enDev.publicForms.title],
      [zhDev.integrations.title, enDev.integrations.title],
      [zhSys.aiApprovals.title, en.console.system.aiApprovals.title],
    ]) {
      expect(zhValue).not.toBe(enValue);
      expect(zhValue).toMatch(/\p{Script=Han}/u);
    }
  });

  it('API Console: the panel, the empty hint with Send in its zh place, and the send button', async () => {
    const { container } = page(<ApiConsolePage />, 'zh');
    expect(await screen.findByText(zhDev.apiConsole.endpointsTitle)).toBeTruthy();
    expect(screen.getByPlaceholderText(zhDev.apiConsole.searchPlaceholder)).toBeTruthy();
    expect(screen.getByRole('button', { name: zhDev.apiConsole.send })).toBeTruthy();
    const strong = screen.getByText(zhDev.apiConsole.send, { selector: 'strong' });
    expect(strong.parentElement!.textContent).toBe(
      zhDev.apiConsole.emptyHint.replace('{{send}}', zhDev.apiConsole.send),
    );
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('Public Forms: the card, the empty state with its action in place, and the toolbar', async () => {
    const { container } = page(<PublicFormsPage />, 'zh');
    expect(await screen.findByText(zhDev.publicForms.emptyTitle)).toBeTruthy();
    expect(screen.getByText(zhDev.publicForms.title)).toBeTruthy();
    expect(screen.getByRole('button', { name: zhDev.publicForms.publishButton })).toBeTruthy();
    const strong = screen.getByText(zhDev.publicForms.publishButton, { selector: 'strong' });
    expect(strong.parentElement!.textContent).toBe(
      zhDev.publicForms.emptyBody.replace('{{action}}', zhDev.publicForms.publishButton),
    );
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('Integrations & APIs: the header, the cards, and the auth sentence with its three elements', async () => {
    const { container } = page(<IntegrationsPage />, 'zh');
    expect(await screen.findByText(zhDev.integrations.noObjects)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(zhDev.integrations.title);
    expect(screen.getByText(zhDev.integrations.baseUrlTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: zhDev.integrations.copyBaseUrl })).toBeTruthy();
    const header = screen.getByText('x-api-key', { selector: 'code' });
    expect(header.parentElement!.textContent).toBe(
      zhDev.integrations.authExternal
        .replace('{{apiKey}}', zhDev.integrations.selfServeKey)
        .replace('{{section}}', zhDev.integrations.connectSection)
        .replace('{{header}}', 'x-api-key'),
    );
    expect(container.textContent).not.toMatch(LEAK);
  });

  it('AI Approvals: the header and the queue card', async () => {
    page(<AiPendingActionsPage />, 'zh');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(zhSys.aiApprovals.title);
    expect(screen.getByText(zhSys.aiApprovals.subtitle)).toBeTruthy();
    expect(screen.getByText(zhSys.aiApprovals.queueTitle)).toBeTruthy();
    expect(screen.getByText(zhSys.aiApprovals.queueDescription)).toBeTruthy();
  });
});

describe('control: with no provider each page reads its English (objectui#13460)', () => {
  it('API Console', async () => {
    page(<ApiConsolePage />, null);
    expect(await screen.findByText('API Endpoints')).toBeTruthy();
    const strong = screen.getByText('Send', { selector: 'strong' });
    expect(strong.parentElement!.textContent).toBe('Select an endpoint or type a URL and click Send');
  });

  it('Public Forms', async () => {
    page(<PublicFormsPage />, null);
    const strong = await screen.findByText('Publish form…', { selector: 'strong' });
    expect(strong.parentElement!.textContent).toBe(
      'Click Publish form… above to share an existing form, or build a new one in Views & Apps and mark it public.',
    );
  });

  it('Integrations & APIs', async () => {
    page(<IntegrationsPage />, null);
    const action = await screen.findByText('Open API Console', { selector: 'strong' });
    expect(action.parentElement!.textContent).toBe(
      "In the console you're already authenticated — use Open API Console above to call these endpoints now.",
    );
  });

  it('AI Approvals', () => {
    page(<AiPendingActionsPage />, null);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AI Approvals');
    expect(screen.getByText('Queue')).toBeTruthy();
  });
});
