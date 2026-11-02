/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The PWA manifest at boot, as the real `main.tsx` decides it.
 *
 * Inside the native shell the Console drops its install manifest: the app is
 * installed natively there. A bridge speaking a newer protocol than this
 * Console (`version` 2) reads as no bridge, so the boot keeps the browser path
 * and injects its generated manifest. Control: a version 1 bridge drops it,
 * and no bridge at all keeps it.
 *
 * `main.tsx` runs for real; what it calls before the manifest step (runtime
 * config, auth preflight, the language seed and catalogue) and what it renders
 * after it are stubs, because this file is about that one decision.
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { NATIVE_HOST_GLOBAL } from '../../../../packages/mobile/src/nativeHost';

const { passthrough, roots, resolveManifestIcons } = vi.hoisted(() => ({
  passthrough: ({ children }: { children?: ReactNode }) => <>{children}</>,
  roots: [] as Root[],
  /** The manifest's icon step; the manifest link lands once it settles. */
  resolveManifestIcons: vi.fn(async () => []),
}));

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  const createRoot: typeof actual.createRoot = (container, options) => {
    const root = actual.createRoot(container, options);
    roots.push(root);
    return root;
  };
  return { ...actual, createRoot, default: { ...actual, createRoot } };
});
vi.mock('../index.css', () => ({}));
vi.mock('../App', () => ({ App: () => <div data-testid="app" /> }));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  I18nProvider: passthrough,
  preloadBootstrapLocale: async () => undefined,
}));
vi.mock('@object-ui/mobile', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MobileProvider: passthrough,
}));
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  registerPlaceholders: () => undefined,
}));
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  initSentry: async () => undefined,
  initRuntimeConfig: async () => undefined,
  getProductName: () => 'ObjectOS',
  getProductShortName: () => 'ObjectOS',
  getFaviconUrl: () => '',
  getPwaDescription: () => '',
  getPwaThemeColor: () => '#000000',
}));
vi.mock('../loadLanguage', () => ({ loadLanguage: async () => ({}) }));
vi.mock('../loadLocales', () => ({ loadLocales: async () => [] }));
vi.mock('../languageSeed', () => ({ seedTenantLanguage: async () => undefined }));
vi.mock('../pwaManifestIcons', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveManifestIcons,
}));
vi.mock('../lib/auth-preflight', () => ({ preflightAuth: async () => undefined }));
vi.mock('../register-plugins', () => ({}));
vi.mock('../registerDeveloperComponents', () => ({}));
vi.mock('../registerStudioComponents', () => ({}));
vi.mock('../registerAccountComponents', () => ({}));
vi.mock('../registerApprovalsComponents', () => ({}));
vi.mock('../registerSystemComponents', () => ({}));
vi.mock('../registerChatbotComponents', () => ({}));

// Pay the heavy graph's first load here, at module top, so the clocked test
// windows below measure the boot's decision and not module loading. Each case
// then re-runs `main.tsx` itself against these already-loaded modules.
await import('@object-ui/app-shell');
await import('@object-ui/components');

const BLOB_MANIFEST = 'blob:generated-manifest';

function installBridge(version: number): void {
  (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL] = {
    version,
    platform: 'ios',
    appVersion: '2.0.0',
    capabilities: [],
    safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
    has: () => false,
    ready: () => undefined,
    routeChanged: () => undefined,
  };
}

/** Run `main.tsx` once, as a page load does, and wait for it to render. */
async function boot(): Promise<void> {
  vi.resetModules();
  await import('../main');
  await waitFor(() => expect(screen.getByTestId('app')).toBeInTheDocument());
}

function manifestHrefs(): string[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="manifest"]')).map(
    (link) => link.getAttribute('href') ?? '',
  );
}

beforeEach(() => {
  document.head.innerHTML = '<link rel="manifest" href="./manifest.json" />';
  document.body.innerHTML = '<div id="root"></div>';
  vi.spyOn(URL, 'createObjectURL').mockReturnValue(BLOB_MANIFEST);
  resolveManifestIcons.mockClear();
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  delete (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL];
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the boot manifest and the bridge protocol version', () => {
  it('a version 2 bridge is no shell: the generated manifest replaces the static one', async () => {
    installBridge(2);
    await boot();
    expect(resolveManifestIcons).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(manifestHrefs()).toEqual([BLOB_MANIFEST]));
  });

  it('control: a version 1 bridge is the shell, and the manifest is dropped', async () => {
    installBridge(1);
    await boot();
    // The manifest step never started, so no link can land later either.
    expect(resolveManifestIcons).not.toHaveBeenCalled();
    expect(manifestHrefs()).toEqual([]);
  });

  it('control: without a bridge the generated manifest replaces the static one', async () => {
    await boot();
    expect(resolveManifestIcons).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(manifestHrefs()).toEqual([BLOB_MANIFEST]));
  });
});
