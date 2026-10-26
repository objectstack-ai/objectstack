/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6654 — the discovery wire may no longer turn authentication off.
 *
 * ## What was removed
 *
 * `@objectstack/spec` retired the `RuntimeMode` value `'preview'` and the whole
 * `PreviewModeConfig` block (objectstack#11846). This console read that wire
 * surface back: a discovery response whose `mode` was `'preview'` took a branch
 * that called `setAuthEnabled(false)` and simulated an identity out of
 * `discovery.previewMode`. The producer is retired; the consumer is now gone.
 *
 * ## ⚠️ Which assertions here are evidence, and which are only cheap insurance
 *
 * The removed gate was `discovery?.mode === 'preview'` — NOT the presence of a
 * `previewMode` block. `previewMode` only supplied the details, every one of
 * them behind a default. That distinction decides what can be proved:
 *
 * - The `mode: 'preview'` cases are the LOAD-BEARING ones. Each was measured
 *   red against the pre-change component (it handed `AuthProvider` a
 *   `previewMode` prop and turned auth off).
 * - The `previewMode`-without-`mode: 'preview'` case is ALREADY GREEN against
 *   the pre-change component — that payload took the ordinary path before this
 *   change too. It is kept as a regression net, and labelled so that no future
 *   reader mistakes a never-red assertion for the one that bites.
 *
 * ## The failure direction this change accepts
 *
 * A deployment still emitting `mode: 'preview'` now falls back to the ordinary
 * auth reading — it requires login. Loud, diagnosable and more secure than a
 * dormant auth-off path keyed on a spelling the platform no longer produces.
 *
 * ## Deliberately NOT touched
 *
 * `AuthProvider`'s `previewMode` PROP, `useAuth().previewMode` and
 * `PreviewBanner` are a separate published capability with a different producer
 * (a host passing the prop). This file retires the discovery-wire producer of
 * that prop, never the prop itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// `vi.hoisted` because the `vi.mock` factories below are hoisted above the
// imports and would otherwise read these bindings before initialisation.
const mocks = vi.hoisted(() => ({
  authProviderProps: [] as Array<Record<string, unknown>>,
}));

// The published AuthProvider is replaced by a recorder: what this component
// decides about authentication IS the props it hands the provider, so that is
// what gets asserted. Nothing else in the auth package is exercised here.
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  AuthProvider: (props: { children?: ReactNode } & Record<string, unknown>) => {
    mocks.authProviderProps.push(props);
    return <div data-testid="auth-provider">{props.children}</div>;
  },
}));

// The real helper memoises one discovery promise per baseUrl for the process,
// which would make every case after the first read the first case's payload.
// Calling the fetcher through keeps the wire path (envelope unwrap included)
// while giving each case its own response.
vi.mock('@object-ui/data-objectstack', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSharedDiscovery: (_baseUrl: string, fetcher: () => Promise<unknown>) => fetcher(),
}));

import { ConditionalAuthWrapper } from './ConditionalAuthWrapper.js';

/** A usable auth service — the ordinary "login required" reading. */
const USABLE_AUTH = { services: { auth: { enabled: true, status: 'available', handlerReady: true } } };

/**
 * The auth-relevant facts the wrapper published, i.e. everything it told
 * `AuthProvider` except the subtree. Two payloads "behave exactly the same"
 * when these are equal.
 */
function authFacts(props: Record<string, unknown>) {
  const { children: _children, ...rest } = props;
  return rest;
}

async function boot(discovery: Record<string, unknown>) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: discovery }),
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <ConditionalAuthWrapper authUrl="/api/v1/auth">
      <div data-testid="app">app</div>
    </ConditionalAuthWrapper>,
  );
  await screen.findByTestId('app');
  const last = mocks.authProviderProps.at(-1);
  expect(last, 'the wrapper never rendered an AuthProvider').toBeDefined();
  return authFacts(last as Record<string, unknown>);
}

beforeEach(() => {
  mocks.authProviderProps.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ConditionalAuthWrapper — the retired preview wire (objectui#6654)', () => {
  it('LOAD-BEARING: mode "preview" carrying a previewMode block behaves exactly as a payload with neither', async () => {
    const withPreview = await boot({
      mode: 'preview',
      previewMode: {
        autoLogin: true,
        simulatedRole: 'admin',
        simulatedUserName: 'Preview User',
        readOnly: false,
        expiresInSeconds: 3600,
        bannerMessage: 'demo',
      },
      ...USABLE_AUTH,
    });

    mocks.authProviderProps.length = 0;
    const control = await boot({ mode: 'production', ...USABLE_AUTH });

    // The whole pin in one line: the retired wire buys the payload nothing.
    expect(withPreview).toEqual(control);
    // Spelled out too, so a failure names the security consequence directly.
    expect(withPreview.previewMode, 'no simulated preview identity').toBeUndefined();
    expect(withPreview.enabled, 'no auth-off').not.toBe(false);
  });

  it('LOAD-BEARING: mode "preview" with no previewMode block does not turn auth off either', async () => {
    // Every field of the removed branch had a default, so a bare
    // `mode: 'preview'` was enough to disable auth before this change.
    const facts = await boot({ mode: 'preview', ...USABLE_AUTH });

    expect(facts.previewMode).toBeUndefined();
    expect(facts.enabled, 'no auth-off').not.toBe(false);
  });

  it('LOAD-BEARING: mode "preview" defers entirely to the auth service reading', async () => {
    // A stub auth service is auth-off for the ordinary reason (ADR-0076 D12),
    // and that is now the ONLY reason the wrapper ever disables auth. Before the
    // change this payload was disabled by the preview branch instead, and
    // carried a simulated admin identity with it.
    const facts = await boot({
      mode: 'preview',
      previewMode: { simulatedRole: 'admin' },
      services: { auth: { enabled: true, status: 'stub', handlerReady: false } },
    });

    expect(facts.previewMode, 'no simulated preview identity').toBeUndefined();
    expect(facts.enabled, 'auth off because the service is a stub, not because of preview').toBe(false);
  });

  it('ALREADY GREEN BEFORE THIS CHANGE (regression net, not evidence): a previewMode block under another mode is inert', async () => {
    const facts = await boot({ mode: 'production', previewMode: { simulatedRole: 'admin' }, ...USABLE_AUTH });

    expect(facts.previewMode).toBeUndefined();
    expect(facts.enabled, 'no auth-off').not.toBe(false);
  });

  it('CONTROL: an ordinary payload is unchanged — a usable auth service still gets a real AuthProvider', async () => {
    const facts = await boot({ mode: 'production', ...USABLE_AUTH });

    expect(facts).toEqual({ authUrl: '/api/v1/auth' });
  });

  it('CONTROL: an ordinary payload is unchanged — a stub auth service is still guest mode', async () => {
    const facts = await boot({
      mode: 'development',
      services: { auth: { enabled: true, status: 'stub', handlerReady: false } },
    });

    expect(facts).toEqual({ authUrl: '/api/v1/auth', enabled: false });
  });
});
