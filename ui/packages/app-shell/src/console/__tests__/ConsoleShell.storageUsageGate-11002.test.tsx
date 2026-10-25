/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `ConsoleShell` asks `GET /api/v1/usage/storage` only when the runtime serves
 * it (objectui#11002, ruled on the card as letter A).
 *
 * The endpoint is a cloud one: the cloud distribution's `RuntimeConfigPlugin`
 * serves `features.storageUsage: true` exactly when its composition mounts the
 * endpoint plugin, and every other runtime sends no key at all. Before this
 * gate the shell's two banners (`ReadRateBanner`, `StorageUsageBanner`) asked
 * on every admin page load regardless, so a self-hosted admin logged a 404 per
 * shell mount.
 *
 * What is pinned, against the real shell, the real runtime-config singleton
 * (filled through `initRuntimeConfig`, so the payload mapping is on the path)
 * and the real shared endpoint reader — only the admin status and the network
 * are stood in:
 *   - an admin on a runtime that sends no `storageUsage` key issues NO request;
 *   - so does an admin on a runtime that sends `storageUsage: false`;
 *   - an admin on a runtime that serves it issues ONE request, shared by both
 *     banners, and the storage banner still renders on a `warn` verdict;
 *   - a non-admin issues no request even when the runtime serves it.
 *
 * Every zero below is read after the same settle that sees the one request in
 * the served case, so a zero here is a reading, not an unflushed effect.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Same two stubs the sibling ConsoleShell tests use: sonner is a global toast
// surface, and the ADR-0069 remediation gate needs an AuthProvider above it.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
    dismiss: vi.fn(), custom: vi.fn(), loading: vi.fn(), promise: vi.fn(),
  }),
  Toaster: () => null,
}));
vi.mock('../RemediationOverlay', () => ({ RemediationOverlay: () => null }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: vi.fn(),
}));

import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';
import { ConsoleShell } from '../ConsoleShell';

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

// `createAuthenticatedFetch` reads `response.headers` to adopt a rotated
// session token, so a stub without them is not a Response that lane can use.
function respond(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

/** The endpoint's answer: a `warn` storage verdict and an anomalous read rate. */
const USAGE = {
  state: 'warning',
  usedMb: 850,
  limitMb: 1024,
  warn: true,
  blocked: false,
  readRate: { state: 'anomalous', readsPerWrite: 700, ratioThreshold: 500 },
};

/**
 * Stand in for the network: the runtime config carries `features` as given,
 * `/usage/storage` answers {@link USAGE} and is counted, anything else is 404.
 */
function stubNetwork(features: Record<string, unknown>): string[] {
  const storageRequests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/v1/runtime/config')) return respond({ features });
      if (url.endsWith('/usage/storage')) {
        storageRequests.push(url);
        return respond(USAGE);
      }
      return respond({}, 404);
    }),
  );
  return storageRequests;
}

function setAdmin(isAdmin: boolean) {
  asMock(useWorkspaceAdminStatus).mockReturnValue({ isAdmin, isResolved: true });
}

/** Boot the runtime config against `features`, then mount the real shell. */
async function mountShell(features: Record<string, unknown>) {
  const storageRequests = stubNetwork(features);
  await initRuntimeConfig();
  render(
    <MemoryRouter initialEntries={['/home']}>
      <ConsoleShell>
        <div data-testid="route">route</div>
      </ConsoleShell>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('route')).toBeInTheDocument());
  // Let every mount effect run and any request it started settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return storageRequests;
}

/** What a runtime that is not the cloud distribution sends: no `storageUsage` key. */
const SELF_HOSTED = { marketplace: true, installLocal: false, aiStudio: true };

describe('ConsoleShell asks for the storage reading only when the runtime serves it (objectui#11002)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    resetRuntimeConfigForTesting();
    vi.unstubAllGlobals();
  });

  it('an admin on a runtime that sends no storageUsage key issues no request', async () => {
    setAdmin(true);
    const storageRequests = await mountShell(SELF_HOSTED);

    expect(storageRequests).toHaveLength(0);
    expect(screen.queryByTestId('storage-usage-banner')).toBeNull();
    expect(screen.queryByTestId('read-rate-banner')).toBeNull();
  });

  it('an admin on a runtime that sends storageUsage: false issues no request', async () => {
    setAdmin(true);
    const storageRequests = await mountShell({ ...SELF_HOSTED, storageUsage: false });

    expect(storageRequests).toHaveLength(0);
  });

  it('an admin on a runtime that serves it issues ONE request, shared by both banners', async () => {
    setAdmin(true);
    const storageRequests = await mountShell({ ...SELF_HOSTED, storageUsage: true });

    await waitFor(() =>
      expect(screen.getByTestId('storage-usage-banner')).toHaveAttribute('data-storage-usage-case', 'warning'),
    );
    expect(screen.getByTestId('read-rate-banner')).toHaveAttribute('data-read-rate-case', 'anomalous-ratio');
    expect(storageRequests).toHaveLength(1);
  });

  it('a non-admin issues no request even when the runtime serves it', async () => {
    setAdmin(false);
    const storageRequests = await mountShell({ ...SELF_HOSTED, storageUsage: true });

    expect(storageRequests).toHaveLength(0);
    expect(screen.queryByTestId('storage-usage-banner')).toBeNull();
  });
});
