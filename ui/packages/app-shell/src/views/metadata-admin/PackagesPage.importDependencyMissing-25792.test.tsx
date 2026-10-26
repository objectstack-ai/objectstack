// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Packages → Import draws the `422 DEPENDENCY_MISSING` install refusal
 * (ADR-0141 D2) in the author's terms — 「请先安装 HotCRM 6.x」 — one line per
 * unmet entry, from the refusal's own facts (objectstack#25792 item 3).
 *
 * Import is `POST /api/v1/marketplace/install-local` with the file's manifest.
 * The REAL locale packs are mounted (`I18nProvider`), so the zh case asserts
 * the sentence an author reads, not a key.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

import { PackagesPage } from './PackagesPage';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SERVER_MESSAGE = 'SERVER-ENGLISH sentinel: Install refused: a declared dependency is not satisfied in this environment.';
const PSA = { id: 'com.acme.psa', name: 'PSA', version: '1.0.0', type: 'app', dependencies: { 'app.objectstack.hotcrm': '6.x', 'com.acme.billing': '^2.1.0' } };

async function serve(installAnswer: { status: number; body: unknown }) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, { features: { installLocal: true } })));
  await initRuntimeConfig();
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
    const path = new URL(String(input), 'http://console.test').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path === '/api/v1/packages') return reply(200, { success: true, data: { packages: [] } });
    if (path === '/api/v1/cloud-connection/installed') return reply(404, {});
    if (path === '/api/v1/marketplace/install-local' && method === 'GET') return reply(200, { success: true, data: { items: [] } });
    if (path === '/api/v1/marketplace/install-local' && method === 'POST') return reply(installAnswer.status, installAnswer.body);
    return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
  }));
}

const refusal = (details: unknown) => ({
  status: 422,
  body: { success: false, error: { code: 'DEPENDENCY_MISSING', httpStatus: 422, message: SERVER_MESSAGE, details } },
});

const UNMET = [
  { packageId: 'com.acme.psa', dependency: 'app.objectstack.hotcrm', range: '6.x', found: 'absent' },
  { packageId: 'com.acme.psa', dependency: 'com.acme.billing', range: '^2.1.0', found: 'out-of-range', installedVersion: '1.4.0' },
];

async function importFile(lang: 'en' | 'zh') {
  render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/setup/component/developer/packages']}>
        <PackagesPage />
      </MemoryRouter>
    </I18nProvider>,
  );
  const input = await vi.waitFor(() => {
    const el = document.querySelector('input[type="file"]');
    if (!el) throw new Error('no import input yet');
    return el as HTMLInputElement;
  });
  const file = new File([JSON.stringify(PSA)], 'psa.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('Packages → Import draws DEPENDENCY_MISSING from its facts (objectstack#25792)', () => {
  it('zh: 「请先安装 …」, one line per unmet entry, in place of the server\'s English sentence', async () => {
    await serve(refusal({ compatible: false, issues: [], unmet: UNMET }));
    await importFile('zh');

    const note = await screen.findByText(/安装被拒绝/);
    expect(note.textContent!.split('\n')).toEqual([
      '安装被拒绝：此软件包声明的依赖在当前环境中未满足，未安装任何内容。',
      '• 请先安装 app.objectstack.hotcrm 6.x。',
      '• 请先安装 com.acme.billing ^2.1.0（当前安装的是 1.4.0）。',
    ]);
    expect(screen.queryByText(SERVER_MESSAGE)).not.toBeInTheDocument();
  });

  it('en: the same facts in English', async () => {
    await serve(refusal({ compatible: false, issues: [], unmet: UNMET }));
    await importFile('en');

    const note = await screen.findByText(/Install refused/);
    expect(note.textContent!.split('\n').slice(1)).toEqual([
      '• Install app.objectstack.hotcrm 6.x first.',
      '• Install com.acme.billing ^2.1.0 first. Version 1.4.0 is installed.',
    ]);
  });

  it('CONTROL: a refusal without facts it can read keeps the envelope\'s own message', async () => {
    await serve(refusal({ compatible: false, issues: [] }));
    await importFile('en');

    // As this page has always drawn a refusal: the envelope's message, its code behind it.
    expect(await screen.findByText(`${SERVER_MESSAGE} (DEPENDENCY_MISSING)`)).toBeInTheDocument();
    expect(screen.queryByText(/安装被拒绝|Install refused: a dependency this package declares/)).not.toBeInTheDocument();
  });
});
