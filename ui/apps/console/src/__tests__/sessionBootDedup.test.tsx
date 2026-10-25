/**
 * objectui#12808 — one console open, one `GET /api/v1/auth/get-session`.
 *
 * The card measured two before the first app render: the pre-React preflight
 * (`lib/auth-preflight.ts`, awaited in `main.tsx`) validating the stored Bearer,
 * then `AuthProvider`'s own mount asking the same question with the same Bearer.
 * The preflight now hands its answer on, and `AuthProvider` takes it, once, for
 * its first state.
 *
 * These run the REAL preflight and the REAL `AuthProvider` with its own
 * better-auth client — no injected client double — over one stubbed `fetch`, so
 * the count is of requests that would reach the wire, and the slot the two
 * sides spell by hand is exercised from both ends.
 */

import React, { useLayoutEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { AuthProvider, useAuth } from '@object-ui/auth';
import { preflightAuth } from '../lib/auth-preflight';

const AUTH_URL = '/api/v1/auth';
const TOKEN = 'tok_valid';

const SESSION_BODY = {
  user: { id: 'u_1', name: 'Ada', email: 'ada@example.test' },
  session: { id: 's_1', userId: 'u_1', token: TOKEN, expiresAt: '2099-01-01T00:00:00.000Z' },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let sessionAnswer: () => unknown = () => SESSION_BODY;
const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/get-session')) return json(sessionAnswer());
  if (url.includes('/sign-out')) return json({ success: true });
  if (url.includes('/sign-in/email')) return json({ user: SESSION_BODY.user, token: TOKEN });
  if (url.includes('/organization/')) return json([]);
  return json(null);
});

function getSessionCalls(): number {
  return fetchStub.mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).includes('/get-session')).length;
}

const probe: { current: ReturnType<typeof useAuth> | null } = { current: null };
function Probe({ sink }: { sink: typeof probe }) {
  const value = useAuth();
  useLayoutEffect(() => {
    sink.current = value;
  });
  return <span data-testid="who">{value.isLoading ? 'loading' : value.user?.name ?? 'nobody'}</span>;
}

function mountConsole() {
  return render(
    <React.StrictMode>
      <AuthProvider authUrl={AUTH_URL}>
        <Probe sink={probe} />
      </AuthProvider>
    </React.StrictMode>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  fetchStub.mockClear();
  sessionAnswer = () => SESSION_BODY;
  localStorage.clear();
  delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for('objectui.authPreflightSession')];
  probe.current = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('one console open, one get-session (objectui#12808)', () => {
  it('the preflight plus AuthProvider\'s first render ask once', async () => {
    localStorage.setItem('auth-session-token', TOKEN);

    // The real boot order: `main.tsx` awaits the preflight, then renders.
    await preflightAuth(AUTH_URL);
    expect(getSessionCalls()).toBe(1);

    mountConsole();
    expect(await screen.findByText('Ada')).toBeTruthy();
    // Let every mount effect (and StrictMode's replay of them) run out.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(getSessionCalls()).toBe(1);
    expect(probe.current?.isAuthenticated).toBe(true);
    // Parsed as `getSession()` parses the wire body: dates revived.
    expect(probe.current?.session?.expiresAt).toBeInstanceOf(Date);
  });

  it('CONTROL: a sign-out then sign-in reads the session again', async () => {
    localStorage.setItem('auth-session-token', TOKEN);
    await preflightAuth(AUTH_URL);
    mountConsole();
    await screen.findByText('Ada');
    expect(getSessionCalls()).toBe(1);

    await act(async () => { await probe.current!.signOut(); });
    expect(screen.getByTestId('who').textContent).toBe('nobody');
    await act(async () => { await probe.current!.signIn('ada@example.test', 'pw'); });
    await act(async () => { await probe.current!.refreshSession(); });

    // The handoff was the first state only: the next read went to the server.
    expect(getSessionCalls()).toBe(2);
    expect(screen.getByTestId('who').textContent).toBe('Ada');
  });

  it('CONTROL: the answer is consumed once — a second provider asks the server', async () => {
    localStorage.setItem('auth-session-token', TOKEN);
    await preflightAuth(AUTH_URL);
    const first = mountConsole();
    await screen.findByText('Ada');
    first.unmount();

    mountConsole();
    await screen.findByText('Ada');
    await waitFor(() => expect(getSessionCalls()).toBeGreaterThanOrEqual(2));
  });

  it('CONTROL: a stale token hands nothing on, and AuthProvider asks itself', async () => {
    localStorage.setItem('auth-session-token', 'tok_stale');
    sessionAnswer = () => null;

    await preflightAuth(AUTH_URL);
    expect(localStorage.getItem('auth-session-token')).toBeNull();

    mountConsole();
    await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('nobody'));
    expect(getSessionCalls()).toBeGreaterThanOrEqual(2);
  });
});
