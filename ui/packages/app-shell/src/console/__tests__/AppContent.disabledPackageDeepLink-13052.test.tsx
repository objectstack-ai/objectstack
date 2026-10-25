// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13052 — a deep link to an object outside the app's package, read by
 * name, always leaves the boot splash.
 *
 * Measured on the card: `/apps/showcase_app/qaprobe_widget`, after the object's
 * package was disabled, stayed on the full-page splash for good. The server
 * answered `404 OBJECT_PACKAGE_DISABLED`, the console's by-name read classed it
 * as a failed read, a failed read left the scope unsettled, and the first-paint
 * gate waited on it with no exit.
 *
 *   (a) `OBJECT_PACKAGE_DISABLED` draws the not-found view inside the shell
 *       with the sentence that names the disabled package;
 *   (b) CONTROL: `RESOURCE_NOT_FOUND` still draws the plain "Object Not Found";
 *   (c) a 5xx or a network drop draws the failed-read state inside the shell,
 *       and its Retry asks the object once more;
 *   (d) a 404 carrying a code this build does not know draws the failed state;
 *   CONTROL: a served object renders, and every open asks its object once.
 *
 * The harness is `AppContent.objectScope-12811.test.tsx`'s: the REAL
 * `MetadataProvider` under the real `AppContent`, with a client double that
 * records each call by URL. The double throws what the real adapter throws for
 * a by-name 404 (a `MetadataNotFoundError` wrapping the client error); both
 * envelope dialects through the real adapter are pinned in
 * `MetadataProvider.scopeRefusal-13052.test.tsx`. `ObjectView` is the real one
 * for an object the list does not hold (its not-found view is under test) and
 * a stand-in for one it does.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import { AuthProvider, ActiveOrganizationStorage } from '@object-ui/auth';
import type { AuthClient, AuthOrganization } from '@object-ui/auth';
import { MetadataNotFoundError } from '@object-ui/data-objectstack';

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => null,
  EditAppPage: () => null,
  DashboardDesignPage: () => null,
}));
vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ children }: { children?: React.ReactNode }) => <div data-testid="console-layout">{children}</div>,
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../views/ObjectView')>();
  return {
    ...real,
    ObjectView: (props: React.ComponentProps<typeof real.ObjectView>) => {
      const { objectName } = useParams();
      if (props.objects.some((o: { name?: string }) => o?.name === objectName)) {
        return <div data-testid="object-view">{objectName}</div>;
      }
      return <real.ObjectView {...props} />;
    },
  };
});
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({ objectLabel: ({ label }: { label?: string }) => label, objectPluralLabel: () => '' }),
}));

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

const actionRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

import { AppContent } from '../AppContent';
import { MetadataProvider } from '../../providers/MetadataProvider';

const PKG = 'app.showcase';
const PROBE = 'qaprobe_widget';
const OBJECTS = [{ name: 'showcase_account', _packageId: PKG, fields: {} }];
const PROBE_DEF = { name: PROBE, _packageId: 'com.qa.probe', fields: {} };

type Answer = 'served' | 'disabled' | 'absent' | 'server-error' | 'network' | 'unknown-code';

const server = { calls: [] as string[], next: 'served' as Answer };

/** The client error the SDK throws for a non-2xx answer (`status` + ADR-0112 `code`). */
function clientError(status: number, code: string): Error {
  return Object.assign(new Error(`request failed: ${status}`), { status, code });
}

function answerByName(name: string): Promise<unknown> {
  if (name !== PROBE) return Promise.reject(clientError(404, 'RESOURCE_NOT_FOUND'));
  switch (server.next) {
    case 'served':
      return Promise.resolve(structuredClone(PROBE_DEF));
    case 'disabled':
      return Promise.reject(clientError(404, 'OBJECT_PACKAGE_DISABLED'));
    case 'absent':
      return Promise.reject(clientError(404, 'RESOURCE_NOT_FOUND'));
    case 'unknown-code':
      return Promise.reject(clientError(404, 'SOME_FUTURE_REFUSAL'));
    case 'server-error':
      return Promise.reject(clientError(503, 'SERVICE_UNAVAILABLE'));
    case 'network':
      return Promise.reject(new TypeError('Failed to fetch'));
  }
}

function makeAdapter() {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    // What `ObjectStackAdapter.getObjectSchema` throws: a 404 wrapped in a
    // `MetadataNotFoundError` that carries the client error.
    getObjectSchema(name: string) {
      server.calls.push(`object/${name}`);
      return answerByName(name).catch((err: any) => {
        throw err?.status === 404 ? new MetadataNotFoundError(name, { originalError: err }) : err;
      });
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          server.calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const all = type === 'object' ? OBJECTS : type === 'app' ? APPS : [];
          const items = options?.packageId ? all.filter((o: any) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          server.calls.push(`${type}/${name}`);
          return Promise.resolve({ type, name });
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

const APPS = [
  {
    name: 'showcase_app',
    label: 'Showcase',
    _packageId: PKG,
    navigation: [{ id: 'n1', type: 'object', label: 'Accounts', objectName: 'showcase_account' }],
  },
];

const USER = 'u_13052';
const ORG: AuthOrganization = { id: 'org_a', name: 'Org A', slug: 'a' };

function authClient(): AuthClient {
  return {
    getSession: vi.fn(async () => ({
      user: { id: USER, name: 'Ada', email: 'ada@test.com', role: 'admin', positions: ['admin'] },
      session: { token: 'tok-13052', activeOrganizationId: ORG.id },
    })),
    signOut: vi.fn(async () => undefined),
    getConfig: vi.fn(async () => ({ features: {} })),
    listOrganizations: vi.fn(async () => [ORG]),
    getActiveOrganization: vi.fn(async () => ORG),
    setActiveOrganization: vi.fn(async () => ORG),
    getActiveMember: vi.fn(async () => ({ id: 'm1', organizationId: ORG.id, userId: USER, role: 'owner' })),
  } as unknown as AuthClient;
}

function boot(url: string) {
  render(
    <AuthProvider authUrl="/api/auth" client={authClient()}>
      <MetadataProvider adapter={makeAdapter()}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/apps/:appName/*" element={<AppContent />} />
          </Routes>
        </MemoryRouter>
      </MetadataProvider>
    </AuthProvider>,
  );
}

const probeReads = () => server.calls.filter((c) => c === `object/${PROBE}`).length;
const splashUp = () => document.querySelector('[data-boot-splash]') !== null;
const settle = (ms = 60) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

beforeEach(() => {
  server.calls = [];
  server.next = 'served';
  localStorage.clear();
  sessionStorage.clear();
  ActiveOrganizationStorage.clear();
});

afterEach(() => {
  cleanup();
  ActiveOrganizationStorage.clear();
});

const DEEP_LINK = `/apps/showcase_app/${PROBE}`;

describe('a deep link to an object read by name always leaves the splash (objectui#13052)', () => {
  it('(a) 404 OBJECT_PACKAGE_DISABLED draws the package-disabled state inside the shell', async () => {
    server.next = 'disabled';
    boot(DEEP_LINK);
    await waitFor(() => expect(screen.getByTestId('object-package-disabled')).toBeInTheDocument());
    expect(screen.getByTestId('console-layout')).toContainElement(screen.getByTestId('object-package-disabled'));
    expect(screen.getByTestId('object-package-disabled')).toHaveTextContent('console.objectView.objectPackageDisabled');
    expect(splashUp()).toBe(false);
    await settle();
    expect(probeReads()).toBe(1);
  });

  it('(b) CONTROL: 404 RESOURCE_NOT_FOUND still draws "Object Not Found"', async () => {
    server.next = 'absent';
    boot(DEEP_LINK);
    await waitFor(() => expect(screen.getByTestId('object-not-found')).toBeInTheDocument());
    expect(screen.getByTestId('object-not-found')).toHaveTextContent('console.objectView.objectNotFoundDescription');
    expect(screen.queryByTestId('object-package-disabled')).not.toBeInTheDocument();
    expect(splashUp()).toBe(false);
  });

  for (const failure of ['server-error', 'network'] as const) {
    it(`(c) a ${failure} read draws the failed-read state inside the shell`, async () => {
      server.next = failure;
      boot(DEEP_LINK);
      await waitFor(() => expect(screen.getByTestId('route-object-read-failed')).toBeInTheDocument());
      expect(screen.getByTestId('console-layout')).toContainElement(screen.getByTestId('route-object-read-failed'));
      expect(splashUp()).toBe(false);
      await settle(150);
      expect(probeReads()).toBe(1);
    });
  }

  it('(c) Retry asks the object exactly once more, and a served answer renders it', async () => {
    server.next = 'server-error';
    boot(DEEP_LINK);
    await waitFor(() => expect(screen.getByTestId('route-object-read-failed-retry')).toBeInTheDocument());
    await settle();
    expect(probeReads()).toBe(1);

    server.next = 'served';
    fireEvent.click(screen.getByTestId('route-object-read-failed-retry'));
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent(PROBE));
    await settle();
    expect(probeReads()).toBe(2);
  });

  it('(c) Retry that fails again draws the failed state again, one read per click', async () => {
    server.next = 'network';
    boot(DEEP_LINK);
    await waitFor(() => expect(screen.getByTestId('route-object-read-failed-retry')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('route-object-read-failed-retry'));
    await waitFor(() => expect(probeReads()).toBe(2));
    await waitFor(() => expect(screen.getByTestId('route-object-read-failed')).toBeInTheDocument());
    await settle(150);
    expect(probeReads()).toBe(2);
  });

  it('(d) a 404 carrying a code this build does not know draws the failed state', async () => {
    server.next = 'unknown-code';
    boot(DEEP_LINK);
    await waitFor(() => expect(screen.getByTestId('route-object-read-failed')).toBeInTheDocument());
    expect(screen.queryByTestId('object-not-found')).not.toBeInTheDocument();
    expect(splashUp()).toBe(false);
  });

  it('CONTROL: a served object renders normally, read by name once', async () => {
    boot(DEEP_LINK);
    await waitFor(() => expect(screen.getByTestId('object-view')).toHaveTextContent(PROBE));
    await settle(150);
    expect(probeReads()).toBe(1);
    expect(screen.queryByTestId('route-object-read-failed')).not.toBeInTheDocument();
  });
});
