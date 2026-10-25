/**
 * objectui#4042 — the console must not read `/meta/*` before it knows whether
 * it has a session.
 *
 * The reported symptom was ~30 red `HTTP request failed` lines on a freshly
 * opened, still-logged-out console: `GET /auth/get-session` had already
 * answered "no session" (and, worse, was sometimes still in flight) while
 * `meta/object` / `meta/view` / `meta/app` were fired anyway, all doomed to
 * 401. `ConnectedShellInner` now withholds the metadata tree until auth
 * resolves.
 *
 * Both directions are pinned, because the fix is worth nothing if it also
 * stops the signed-in console from loading:
 *   - auth pending  → zero metadata requests;
 *   - auth resolved → the eager requests, once each.
 *
 * objectui#12811: the eager requests are `app` and `view`. The third,
 * `object`, was the whole object registry, which the root's action runtime
 * (`useActionModal`) loaded on every open by reading `objects`; it now loads
 * only where a route or an action reads it, and this shell renders neither.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** Flipped per-test; read by the mocked `useAuth`. */
const authState = { isLoading: true, isAuthenticated: false };

/** Every `meta.getItems(type)` the shell issues, in order. */
const metaCalls: string[] = [];

const fakeAdapter = {
  clearCache: vi.fn(),
  getObjectSchema: vi.fn(async () => null),
  getClient: () => ({
    meta: {
      getItems: (type: string) => {
        metaCalls.push(type);
        return Promise.resolve({ type, items: [] });
      },
      getItem: (type: string, name: string) => {
        metaCalls.push(`${type}/${name}`);
        return Promise.resolve({ item: null });
      },
    },
  }),
};

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/auth')>();
  return {
    ...actual,
    useAuth: () => ({
      ...authState,
      user: authState.isAuthenticated ? { id: 'u1', email: 'u@example.com' } : null,
      session: null,
      isAuthEnabled: true,
      error: null,
    }),
    createAuthenticatedFetch: () => globalThis.fetch,
  };
});

// The adapter itself is not under test — the shell's ORDERING is. Hand it a
// ready fake so `useAdapter()` never gates the render for an unrelated reason.
vi.mock('../../providers/AdapterProvider', () => ({
  AdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAdapter: () => fakeAdapter,
}));

import { ConnectedShell } from '../ConsoleShell';

function renderShell() {
  return render(
    <MemoryRouter>
      <ConnectedShell>
        <div data-testid="route-content">ROUTE CONTENT</div>
      </ConnectedShell>
    </MemoryRouter>,
  );
}

describe('ConnectedShell session gate (objectui#4042)', () => {
  beforeEach(() => {
    metaCalls.length = 0;
    authState.isLoading = true;
    authState.isAuthenticated = false;
  });

  it('issues no /meta/* request while get-session is still in flight', async () => {
    const { queryByTestId } = renderShell();

    // Give every effect and microtask a chance to fire a request.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(metaCalls).toEqual([]);
    // And the gate is a WAIT, not a render-through: the metadata-backed route
    // content must not be showing either (it would read empty metadata).
    expect(queryByTestId('route-content')).toBeNull();
  });

  it('issues each /meta/* request exactly once as soon as the session resolves', async () => {
    authState.isLoading = false;
    authState.isAuthenticated = true;

    const { getByTestId } = renderShell();

    await waitFor(() => expect(metaCalls).toContain('app'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(metaCalls.filter((c) => c === 'object')).toHaveLength(0);
    expect(metaCalls.filter((c) => c === 'view')).toHaveLength(1);
    expect(metaCalls.filter((c) => c === 'app')).toHaveLength(1);
    expect(getByTestId('route-content')).toBeTruthy();
  });

  it('renders through once auth resolves with NO session (a 401 is then real, not noise)', async () => {
    // A consumer may mount ConnectedShell outside an AuthGuard. The gate is
    // "wait for the answer", not "require a yes" — once the answer is known the
    // tree renders and any resulting 401 is a genuine, loggable event rather
    // than a request the console fired blind.
    authState.isLoading = false;
    authState.isAuthenticated = false;

    const { getByTestId } = renderShell();

    await waitFor(() => expect(metaCalls).toContain('app'));
    expect(getByTestId('route-content')).toBeTruthy();
  });
});
