/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * OAuthConsentPage names every MCP scope the spec declares, in every built-in
 * language, and announces any other scope as unrecognised (objectstack#26587).
 *
 * `metadata:write` reached the consent screen as its raw spelling: the page
 * mapped the three older agent scopes by hand and had no case for the fourth,
 * so the one scope that lets an agent build in the user's environment was the
 * only one left unexplained. The walk below takes its subjects from
 * `MCP_OAUTH_SCOPES`, so a scope the spec adds is a subject here the moment it
 * lands, and its English is pinned to `MCP_OAUTH_SCOPE_CONSENT_COPY`, the
 * sentence the spec declares beside the scope.
 *
 * Each language's catalogue is loaded BEFORE the instance is created, so the
 * rows are read from that language's pack, never from the `en` fallback a
 * missing key would render through.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MCP_OAUTH_SCOPE_CONSENT_COPY, MCP_OAUTH_SCOPES } from '@objectstack/spec/ai';
import { AuthProvider } from '@object-ui/auth';
import type { AuthClient } from '@object-ui/auth';
import { BUILT_IN_LANGUAGE_CODES, createI18n, en, loadBuiltInLocale } from '@object-ui/i18n';
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

async function renderConsent(scope: string, language: string) {
  await loadBuiltInLocale(language);
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

const UNKNOWN_SCOPE = 'reports:export';
const UNRECOGNISED_EN = en.oauth.consent.scope.unrecognised;

describe('OAuthConsentPage — every MCP scope in words (objectstack#26587)', () => {
  it('names each MCP scope in en with the sentence the spec declares for it', async () => {
    await renderConsent(MCP_OAUTH_SCOPES.join(' '), 'en');

    expect(await scopeRows()).toEqual(
      MCP_OAUTH_SCOPES.map((scope) => MCP_OAUTH_SCOPE_CONSENT_COPY[scope]),
    );
  });

  it.each(BUILT_IN_LANGUAGE_CODES.filter((language) => language !== 'en'))(
    'names each MCP scope from the %s pack, never as its raw spelling',
    async (language) => {
      await renderConsent(MCP_OAUTH_SCOPES.join(' '), language);
      const rows = await scopeRows();

      expect(rows).toHaveLength(MCP_OAUTH_SCOPES.length);
      MCP_OAUTH_SCOPES.forEach((scope, index) => {
        expect(rows[index]).not.toContain(scope);
        // The `en` sentence here would mean the key is missing from this pack
        // and the row fell back to English.
        expect(rows[index]).not.toBe(MCP_OAUTH_SCOPE_CONSENT_COPY[scope]);
      });
    },
  );

  it('announces a scope the page does not name as unrecognised, never as the bare string', async () => {
    await renderConsent(`data:read ${UNKNOWN_SCOPE}`, 'en');

    expect(await scopeRows()).toEqual([
      MCP_OAUTH_SCOPE_CONSENT_COPY['data:read'],
      UNRECOGNISED_EN.replace('{{scope}}', UNKNOWN_SCOPE),
    ]);
  });

  it('announces an unrecognised scope in the user language too', async () => {
    await renderConsent(UNKNOWN_SCOPE, 'zh');
    const [row] = await scopeRows();

    expect(row).not.toBe(UNKNOWN_SCOPE);
    expect(row).toContain(UNKNOWN_SCOPE);
    expect(row).not.toBe(UNRECOGNISED_EN.replace('{{scope}}', UNKNOWN_SCOPE));
  });
});
