// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25916, third pass — Flow Runs' client-capability diagnostics speak the
 * session's language.
 *
 * Each of the page's three panels calls one client method (`meta.getItems`,
 * `automation.execute`, `automation.listRuns`). A client without it used to
 * leave an English sentence in the panel's error state. The state now keeps
 * the method's NAME and the panel words it at render through
 * `console.developer.flowRuns.clientMethodUnavailable`, so under zh the
 * sentence is the zh row with the method name in it. A thrown message is
 * still drawn verbatim. Control: with no provider the English sentence is
 * unchanged.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

const CLIENT = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const ADAPTER = vi.hoisted(() => ({ getClient: () => CLIENT.current }));
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: [], getTypeStatus: () => 'loaded' }),
}));

// Imported after the mock so the page picks it up.
import { FlowRunsPage } from './FlowRunsPage';

afterEach(() => cleanup());

const { zh } = builtInLocales;
const zhFlow = zh.console.developer.flowRuns;

/** A client that serves one flow but has no automation surface at all. */
const NO_AUTOMATION = { meta: { getItems: async () => ({ type: 'flow', items: [{ name: 'welcome_flow' }] }) } };
/** A client that throws from the one method it has. */
const THROWS = { meta: { getItems: async () => { throw new Error('boom: 503'); } } };

function page(language: 'zh' | null) {
  const routed = (
    <MemoryRouter>
      <FlowRunsPage />
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

const unavailable = (method: string) => zhFlow.clientMethodUnavailable.replace('{{method}}', method);

describe('Flow Runs client diagnostics under zh (#25916)', () => {
  it('guard: the zh row is a real zh row', () => {
    expect(zhFlow.clientMethodUnavailable).toMatch(/\p{Script=Han}/u);
    expect(zhFlow.clientMethodUnavailable).toContain('{{method}}');
  });

  it('a client without meta.getItems: the flow panel says so in zh', async () => {
    CLIENT.current = {};
    page('zh');
    expect(await screen.findByText(unavailable('meta.getItems'))).toBeTruthy();
  });

  it('a client without automation: the runs panel and a test run say so in zh', async () => {
    CLIENT.current = NO_AUTOMATION;
    page('zh');
    expect(await screen.findByText(unavailable('automation.listRuns'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: zhFlow.runFlow }));
    expect(await screen.findByText(unavailable('automation.execute'))).toBeTruthy();
  });

  it('a thrown message is still drawn verbatim', async () => {
    CLIENT.current = THROWS;
    page('zh');
    expect(await screen.findByText('boom: 503')).toBeTruthy();
  });
});

describe('control: with no provider the diagnostics read their English (#25916)', () => {
  it('meta.getItems', async () => {
    CLIENT.current = {};
    page(null);
    expect(await screen.findByText('meta.getItems is not available on this client')).toBeTruthy();
  });

  it('automation.listRuns and automation.execute', async () => {
    CLIENT.current = NO_AUTOMATION;
    page(null);
    expect(await screen.findByText('automation.listRuns is not available on this client')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run Flow' }));
    expect(await screen.findByText('automation.execute is not available on this client')).toBeTruthy();
  });
});
