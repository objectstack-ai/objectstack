// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Packages → Import says when the install door admitted the imported package
 * WITHOUT checking its platform protocol range: the answer's
 * `data.protocolCheckSkipped` (objectstack#30326), drawn under the success
 * sentence. The REAL locale packs are mounted (`I18nProvider`), so the zh case
 * asserts the sentence an administrator reads, not a key.
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

const SERVER_MESSAGE = 'SERVER-ENGLISH sentinel: installed without a compatibility check.';
const PSA = { id: 'com.acme.psa', name: 'PSA', version: '1.0.0', type: 'app' };
const MANAGED = { manifestId: 'com.acme.psa', version: '1.0.0', versionId: 'ver_1', installedAt: '2026-11-05T00:00:00Z', hotLoaded: true, upgradedFrom: null };

async function serve(installData: Record<string, unknown>) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, { features: { installLocal: true } })));
  await initRuntimeConfig();
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
    const path = new URL(String(input), 'http://console.test').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path === '/api/v1/packages') return reply(200, { success: true, data: { packages: [] } });
    if (path === '/api/v1/cloud-connection/installed') return reply(404, {});
    if (path === '/api/v1/marketplace/install-local' && method === 'GET') return reply(200, { success: true, data: { items: [] } });
    if (path === '/api/v1/marketplace/install-local' && method === 'POST') return reply(200, { success: true, data: installData });
    return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
  }));
}

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

describe('Packages → Import draws protocolCheckSkipped (objectstack#30326)', () => {
  it('zh: no range — the package, the protocol it was installed under, in place of the server\'s English', async () => {
    await serve({ ...MANAGED, protocolCheckSkipped: { reason: 'no-range', packageId: 'com.acme.psa', protocolVersion: '18.1.0', message: SERVER_MESSAGE } });
    await importFile('zh');

    const line = await screen.findByTestId('protocol-check-skipped');
    expect(line).toHaveTextContent(/^com\.acme\.psa 未声明它支持的平台协议版本，因此已在平台协议 18\.1\.0 下安装，未做兼容性检查/);
    expect(screen.queryByText(SERVER_MESSAGE)).not.toBeInTheDocument();
  });

  it('en: an unreadable range — the range it declared', async () => {
    await serve({
      ...MANAGED,
      protocolCheckSkipped: {
        reason: 'unparsed-range', packageId: 'com.acme.psa', protocolVersion: '18.1.0',
        requiredRange: 'latest', rangeSource: 'engines.protocol', message: SERVER_MESSAGE,
      },
    });
    await importFile('en');

    const line = await screen.findByTestId('protocol-check-skipped');
    expect(line).toHaveTextContent(/^com\.acme\.psa states its platform protocol as latest, which this runtime cannot read, so it was installed under protocol 18\.1\.0 without a compatibility check/);
  });

  it('CONTROL: an import whose range was checked draws no such line', async () => {
    await serve({ ...MANAGED });
    await importFile('en');

    await screen.findByText(/com\.acme\.psa/);
    expect(screen.queryByTestId('protocol-check-skipped')).not.toBeInTheDocument();
  });
});
