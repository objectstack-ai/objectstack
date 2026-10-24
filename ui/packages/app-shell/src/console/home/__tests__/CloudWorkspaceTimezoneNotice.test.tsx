// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CloudWorkspaceTimezoneNotice (`cloud:workspace-timezone-notice`,
 * objectui#11930) prints ONE line on the Cloud welcome page naming the
 * timezone the workspace was seeded with, read from the authoritative
 * entitlements summary's `workspaceTimezoneSeed` — and nothing in every other
 * state: no seed, a failed request, a body outside the envelope, or loading.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

let fetchImpl: (url: string, init?: RequestInit) => Promise<unknown>;
const fetchedUrls: string[] = [];

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ activeOrganization: { id: 'org_1' } }),
  createAuthenticatedFetch: () => (url: string, init?: RequestInit) => {
    fetchedUrls.push(url);
    return fetchImpl(url, init);
  },
}));

import { I18nProvider } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
import { CloudWorkspaceTimezoneNotice } from '../CloudWorkspaceTimezoneNotice';

const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;
const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;

/** The two packs' sentences for the seed below — the copy a user reads. */
const EN_LINE =
  'The environment timezone was set to Asia/Shanghai from your browser when the environment was created. '
  + 'You can change it in Settings → Localization.';
const ZH_LINE = '环境时区在创建时已按你的浏览器设为 Asia/Shanghai，可在「设置 → 本地化」中修改。';

/**
 * The line resolves from the locale packs, so a real i18n context is needed —
 * without one `t()` returns the raw key and a text assertion would pass
 * against nothing. The adapter is the row-derived fallback's data source; its
 * rows resolve, so a failed summary falls through to a REAL `derived` state.
 */
const adapter = { find: vi.fn().mockResolvedValue([{ id: 'env_1', environment_type: 'production' }]) };

const renderInShell = (ui: React.ReactElement, config: typeof EN | typeof ZH = EN) =>
  render(
    <I18nProvider config={config} persistLanguage={false}>
      <AdapterCtx.Provider value={adapter as never}>{ui}</AdapterCtx.Provider>
    </I18nProvider>,
  );

/** The control plane's `{ success, data }` envelope around a summary. */
function summary(data: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}

const SEEDED = { plan: 'free', hasProductionEnv: true, workspaceTimezoneSeed: 'Asia/Shanghai' };
const UNSEEDED = { plan: 'free', hasProductionEnv: true };

const noticeOf = (container: HTMLElement) => container.querySelector('[data-workspace-timezone-notice]');

/** Waits until the summary was read and the hook settled, so an empty render is a verdict, not the loading state. */
async function settledAfterSummary() {
  await waitFor(() => expect(fetchedUrls).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  cleanup();
  fetchedUrls.length = 0;
  adapter.find.mockClear();
});

describe('CloudWorkspaceTimezoneNotice — the seed is present (objectui#11930)', () => {
  it('names the seeded zone in English, verbatim', async () => {
    fetchImpl = async () => summary(SEEDED);
    const { container } = renderInShell(<CloudWorkspaceTimezoneNotice />);

    expect(await screen.findByText(EN_LINE)).toBeTruthy();
    expect(noticeOf(container)?.textContent).toBe(EN_LINE);
  });

  it('names the seeded zone in Chinese, verbatim', async () => {
    fetchImpl = async () => summary(SEEDED);
    const { container } = renderInShell(<CloudWorkspaceTimezoneNotice />, ZH);

    expect(await screen.findByText(ZH_LINE)).toBeTruthy();
    expect(noticeOf(container)?.textContent).toBe(ZH_LINE);
  });

  it('reads the org-scoped summary endpoint', async () => {
    fetchImpl = async () => summary(SEEDED);
    renderInShell(<CloudWorkspaceTimezoneNotice />);

    await screen.findByText(EN_LINE);
    expect(fetchedUrls).toEqual(['/api/v1/cloud/environment-entitlements?organizationId=org_1']);
  });

  it('is one line of text — no link, no button, no dismissal', async () => {
    fetchImpl = async () => summary(SEEDED);
    const { container } = renderInShell(<CloudWorkspaceTimezoneNotice />);

    await screen.findByText(EN_LINE);
    expect(container.querySelectorAll('a, button')).toHaveLength(0);
    expect(noticeOf(container)?.children).toHaveLength(0);
  });
});

describe('CloudWorkspaceTimezoneNotice — nothing renders without a seed (objectui#11930)', () => {
  it('renders nothing when the summary carries no seed — the control', async () => {
    fetchImpl = async () => summary(UNSEEDED);
    const { container } = renderInShell(<CloudWorkspaceTimezoneNotice />);

    await settledAfterSummary();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for an empty seed', async () => {
    fetchImpl = async () => summary({ ...UNSEEDED, workspaceTimezoneSeed: '' });
    const { container } = renderInShell(<CloudWorkspaceTimezoneNotice />);

    await settledAfterSummary();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while the summary is loading', () => {
    fetchImpl = () => new Promise(() => {});
    const { container } = renderInShell(<CloudWorkspaceTimezoneNotice />);

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing, and does not throw, when the summary request fails', async () => {
    fetchImpl = async () => ({ ok: false, status: 500, json: async () => null });
    const { container } = renderInShell(<CloudWorkspaceTimezoneNotice />);

    // The hook fell through to the rows, which resolve (source `derived`) but
    // carry no seed — so the line is left out instead of guessed.
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing, and does not throw, when the summary request rejects', async () => {
    fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    const { container } = renderInShell(<CloudWorkspaceTimezoneNotice />);

    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for a bare (un-enveloped) body that carries a seed', async () => {
    // A bare body is a producer contract violation (cloud#1046): it yields no
    // summary, so even a seed in it must not print.
    fetchImpl = async () => ({ ok: true, status: 200, json: async () => SEEDED });
    const { container } = renderInShell(<CloudWorkspaceTimezoneNotice />);

    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });
});

describe('`cloud:workspace-timezone-notice` registration (objectui#11930)', () => {
  it('is registered under the one key the page authors, with no second spelling', () => {
    expect(ComponentRegistry.has('cloud:workspace-timezone-notice')).toBe(true);
    // `skipFallback: true` — no bare `workspace-timezone-notice` fallback …
    expect(ComponentRegistry.has('workspace-timezone-notice')).toBe(false);
    // … and no `app-shell:`-prefixed twin.
    expect(ComponentRegistry.has('app-shell:cloud:workspace-timezone-notice')).toBe(false);
  });

  it('renders from a page node through SchemaRenderer', async () => {
    fetchImpl = async () => summary(SEEDED);
    const { container } = renderInShell(
      <SchemaRenderer
        schema={{
          type: 'cloud:workspace-timezone-notice',
          id: 'welcome_timezone_notice',
          responsiveStyles: { large: { marginTop: '8px' } },
        } as never}
      />,
    );

    expect(await screen.findByText(EN_LINE)).toBeTruthy();
    // The node's `responsiveStyles` scope class reaches the line through
    // `className`, so the page can place it.
    const scope = container.querySelector('style[data-os-scope]')?.getAttribute('data-os-scope');
    expect(scope).toBeTruthy();
    expect(noticeOf(container)?.classList.contains(scope as string)).toBe(true);
  });
});
