/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * OAuthConsentPage names the three agent scopes in words (objectui#12853).
 *
 * `data:read`, `data:write` and `actions:execute` are the scopes an MCP client
 * asks for, and consent is where the user decides to hand an agent their
 * data; the list used to show them as raw strings. Each now reads as one
 * sentence, carrying the bound the server enforces: the agent acts within the
 * user's own permissions.
 *
 * Any scope the page does not map still renders as its raw string — the
 * `CONTROL` case — so no sentence is guessed from a scope's spelling.
 *
 * The catalogue reaches the page through the global instance `createI18n`
 * registers, the same harness as `FormPage.chromeI18n-11071.test.tsx`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { createI18n } from '@object-ui/i18n';
import { OAuthConsentPage } from '../OAuthConsentPage';

const CLIENT_ID = 'mcp-client';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function authClient(): AuthClient {
  return {
    getSession: vi
      .fn()
      .mockResolvedValue({ user: { id: 'u1', email: 'me@example.com' }, session: {} }),
    getConfig: vi.fn().mockResolvedValue({ features: {} }),
  } as unknown as AuthClient;
}

function stubPublicClient() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ client_id: CLIENT_ID, client_name: 'Claude Code' }),
      }),
    ),
  );
}

function renderConsent(scope: string, language: string) {
  createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  stubPublicClient();
  const search = `?client_id=${CLIENT_ID}&scope=${encodeURIComponent(scope)}&sig=s1`;
  window.history.replaceState({}, '', `/oauth/consent${search}`);
  return render(
    <AuthProvider authUrl="/api/v1/auth" client={authClient()}>
      <MemoryRouter initialEntries={[`/oauth/consent${search}`]}>
        <Routes>
          <Route path="/oauth/consent" element={<OAuthConsentPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

/** The consent list's rows, in the order the page draws them. */
async function scopeRows(): Promise<string[]> {
  const list = await screen.findByRole('list');
  return Array.from(list.querySelectorAll('li')).map((li) => li.textContent ?? '');
}

const AGENT_SCOPES = 'openid data:read data:write actions:execute';

describe('OAuthConsentPage — the agent scopes in words (objectui#12853)', () => {
  it('names the three agent scopes in en', async () => {
    renderConsent(AGENT_SCOPES, 'en');

    expect(await scopeRows()).toEqual([
      'Confirm your identity',
      'Read records, within your own permissions',
      'Create, change and delete records, within your own permissions',
      'Run actions on your behalf, within your own permissions',
    ]);
  });

  it('names the three agent scopes in zh', async () => {
    renderConsent(AGENT_SCOPES, 'zh');

    expect(await scopeRows()).toEqual([
      '确认您的身份',
      '读取记录（不超出您自己的权限）',
      '创建、修改和删除记录（不超出您自己的权限）',
      '代表您运行操作（不超出您自己的权限）',
    ]);
  });

  it('CONTROL: a scope the page does not map still renders as its raw string', async () => {
    renderConsent('data:read reports:export', 'en');

    expect(await scopeRows()).toEqual([
      'Read records, within your own permissions',
      'reports:export',
    ]);
  });
});
