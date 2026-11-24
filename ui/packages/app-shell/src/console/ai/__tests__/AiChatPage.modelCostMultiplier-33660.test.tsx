// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#33660 — in every chat host, the composer's model picker shows
 * each model's cost multiplier, notes the allowance left when usage is served,
 * and asks before a pick at ×20 or above applies.
 *
 * ## Real subjects
 *
 * The three hosts of the shared `ChatPane`: the full-page chat (`AiChatPage` at
 * `/ai/build`), the console dock (`ChatDockConversation`) and the Studio
 * copilot (`StudioCopilotConversation`), each with the REAL `ChatPane`, the
 * REAL `useAiModels` and `useAiUsage` reading a `fetch` stub, and the REAL
 * `ChatbotEnhanced` picker driven through its rendered `Select`. The stand-ins:
 * the agent catalog, auth, metadata, the adapter and the side panels.
 *
 * Pins, on each host:
 *  - `×N` is drawn beside each model the server gives a multiplier, and nothing
 *    beside the one it gives none;
 *  - a ×20 pick asks; Cancel keeps the model, Confirm switches it;
 *  - CONTROL: a ×5 pick applies at once, with no dialog;
 *  - the allowance note shows with usage served and is absent without it.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
}));
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'build', label: 'Build', capabilities: ['build'] }],
    isLoading: false,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: [] }),
}));
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => true }));
vi.mock('../../../layout/AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));
vi.mock('../ConversationsSidebar', () => ({ ConversationsSidebar: () => null }));

vi.mock('../PendingDraftsBar', () => ({ PendingDraftsBar: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { AiChatPage } from '../AiChatPage';
import { ChatDockConversation } from '../../../layout/ChatDockConversation';
import { StudioCopilotConversation } from '../../../views/studio-design/StudioAiCopilot';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const MODELS = [
  { id: 'anthropic/claude-haiku', label: 'Fast', default: true, costMultiplier: 1 },
  { id: 'anthropic/claude-sonnet', label: 'Advanced', default: false, costMultiplier: 5 },
  { id: 'anthropic/claude-opus', label: 'Expert', default: false, costMultiplier: 20 },
  { id: 'openai/gpt-luna', label: 'Standard', default: false },
];

const state = {
  /** `pool.fraction` the usage stub answers; `undefined` → the endpoint is not served (404). */
  usage: undefined as number | undefined,
  /** How many `/ai/usage` reads were answered. */
  usageAnswered: 0,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  state.usage = undefined;
  state.usageAnswered = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/ai\/models$/.test(url)) return json({ models: MODELS, defaultModel: MODELS[0].id });
      if (/\/ai\/usage$/.test(url)) {
        state.usageAnswered += 1;
        if (state.usage === undefined) return json({ error: 'not served' }, 404);
        return json({
          pool: {
            planType: 'paid', fraction: state.usage, unmetered: false, resetKind: 'weekly',
            resetsAt: null, upgrade: false, topUp: false,
          },
        });
      }
      const one = /\/conversations\/([^/?]+)$/.exec(url);
      if (one) return json({ id: decodeURIComponent(one[1]), messages: [] });
      return json({ success: true, data: [] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const I18N = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

function mountPage(): void {
  render(
    <I18nProvider config={I18N}>
      <MemoryRouter initialEntries={['/ai/build']}>
        <Routes>
          <Route path="/ai/:agent" element={<AiChatPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

function mountDock(): void {
  render(
    <I18nProvider config={I18N}>
      <MemoryRouter initialEntries={['/apps/crm_app/account']}>
        <ChatDockConversation userId="u1" apiBase="/api/v1/ai" />
      </MemoryRouter>
    </I18nProvider>,
  );
}

function mountStudio(): void {
  render(
    <I18nProvider config={I18N}>
      <MemoryRouter initialEntries={['/studio/crm_app']}>
        <StudioCopilotConversation packageId="crm_app" />
      </MemoryRouter>
    </I18nProvider>,
  );
}

async function picker(): Promise<HTMLElement> {
  return screen.findByRole('combobox', { name: 'Model' }, { timeout: 4000 });
}

async function open(trigger: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return within(await screen.findByRole('listbox')).getAllByRole('option');
}

const multiplierOf = (el: HTMLElement) =>
  el.querySelector('[data-testid="model-cost-multiplier"]')?.textContent ?? null;

describe.each([
  ['the full-page chat (/ai/build)', mountPage],
  ['the console dock', mountDock],
  ['the Studio copilot', mountStudio],
])('%s — the model picker shows the cost multiplier (objectstack#33660)', (_host, mount) => {
  it('draws ×N per model the server gives one, and nothing for the model it gives none', async () => {
    mount();
    const options = await open(await picker());
    expect(options.map((o) => o.textContent?.replace(/×.*$/, ''))).toEqual(['Fast', 'Advanced', 'Expert', 'Standard']);
    expect(options.map(multiplierOf)).toEqual(['×1', '×5', '×20', null]);
  });

  it('a ×20 pick asks; Cancel keeps the model, Confirm switches it', async () => {
    mount();
    let trigger = await picker();
    fireEvent.click((await open(trigger))[2]);
    let dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    trigger = await picker();
    expect(trigger.textContent).toBe('Fast');

    fireEvent.click((await open(trigger))[2]);
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch model' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // objectstack#35445 — the closed trigger names the model alone, so the switch reads off its name.
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toBe('Expert'));
  });

  it('CONTROL: a ×5 pick applies at once, with no dialog', async () => {
    mount();
    fireEvent.click((await open(await picker()))[1]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toBe('Advanced'));
  });

  it('the allowance note shows with usage served', async () => {
    state.usage = 0.4;
    mount();
    const trigger = await picker();
    await waitFor(() => expect(state.usageAnswered).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await open(trigger);
    expect((await screen.findByTestId('model-allowance-note')).textContent).toContain('60%');
  });

  it('CONTROL: without usage served there is no allowance note', async () => {
    mount();
    const trigger = await picker();
    await waitFor(() => expect(state.usageAnswered).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await open(trigger);
    expect(screen.queryByTestId('model-allowance-note')).toBeNull();
  });
});
