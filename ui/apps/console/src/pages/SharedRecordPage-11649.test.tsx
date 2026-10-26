// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11649 — the share-link landing page sends a link's password in the
 * `X-Share-Password` request header, never in a request URL, and reads a `401`
 * by its `error.code`.
 *
 * The stub answers the two public routes the way both producers do at the
 * `@objectstack/*` release this console resolves: it reads the password from the
 * `?password=` query parameter FIRST and from the header otherwise (so a page
 * that still put it in the URL would be served — and caught by the URL pin, not
 * by a refusal), and refuses with `401 { success: false, error: { code } }`:
 * `NEEDS_PASSWORD` / `WRONG_PASSWORD` for a protected link, `SIGN_IN_REQUIRED`
 * for a link shared with signed-in users only. `/messages` re-checks the
 * password and answers `404` without it. Every visitor here is anonymous.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SharedRecordPage from './SharedRecordPage';

const TOKEN = 'tok_abcdefgh';
const SECRET = 'correct-horse-77';

interface ShareFixture {
  object_name: string;
  password?: string;
  audience?: 'anyone' | 'signed_in';
}

interface Call {
  url: URL;
  password: string | null;
  answered: number;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const refuse = (status: number, code: string, message: string) =>
  json(status, { success: false, error: { code, message } });

/** A server that answers `/share-links/:token/{resolve,messages}` like both producers. */
function shareServer(link: ShareFixture) {
  const calls: Call[] = [];
  const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const headers = new Headers(init?.headers);
    const presented = url.searchParams.get('password') ?? headers.get('x-share-password');
    const answer = (res: Response) => {
      calls.push({ url, password: headers.get('x-share-password'), answered: res.status });
      return res;
    };
    const base = `/api/v1/share-links/${TOKEN}`;
    const passes = !link.password || presented === link.password;

    if (url.pathname === `${base}/resolve`) {
      if (!passes) {
        return answer(
          presented
            ? refuse(401, 'WRONG_PASSWORD', 'Incorrect password')
            : refuse(401, 'NEEDS_PASSWORD', 'This link requires a password'),
        );
      }
      if (link.audience === 'signed_in') {
        return answer(refuse(401, 'SIGN_IN_REQUIRED', 'Please sign in to view this link'));
      }
      return answer(
        json(200, {
          success: true,
          data: {
            record: { id: 'rec_1', name: 'Acme' },
            link: {
              id: 'sl_1',
              token: TOKEN,
              object_name: link.object_name,
              record_id: 'rec_1',
              permission: 'view',
              audience: link.audience ?? 'anyone',
            },
            redactFields: [],
          },
        }),
      );
    }
    if (url.pathname === `${base}/messages`) {
      if (!passes) return answer(refuse(404, 'NOT_FOUND', 'Share link not found'));
      return answer(json(200, { success: true, data: [] }));
    }
    return answer(new Response(null, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

function renderLink() {
  return render(
    <MemoryRouter initialEntries={[`/s/${TOKEN}`]}>
      <Routes>
        <Route path="/s/:token" element={<SharedRecordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** No request URL the page built carries the password, in any spelling. */
function expectNoUrlCarriesThePassword(calls: Call[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const { url } of calls) {
    expect(url.searchParams.has('password')).toBe(false);
    expect(url.href).not.toContain(SECRET);
    expect(decodeURIComponent(url.href)).not.toContain(SECRET);
  }
}

async function submitPassword(value: string) {
  const input = await screen.findByPlaceholderText('Enter password');
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(() => {
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    consoleSpies.push(vi.spyOn(console, method));
  }
});

afterEach(() => {
  // Nothing the page writes to the console carries the password.
  for (const spy of consoleSpies) {
    for (const args of spy.mock.calls as unknown[][]) {
      expect(args.map((a) => String(a)).join(' ')).not.toContain(SECRET);
    }
    spy.mockRestore();
  }
  consoleSpies.length = 0;
  cleanup();
  vi.unstubAllGlobals();
});

describe('SharedRecordPage — the password travels in a header (objectui#11649)', () => {
  it('a protected link prompts, and the password reaches the server in the header and in no URL', async () => {
    const calls = shareServer({ object_name: 'crm_account', password: SECRET });
    renderLink();

    expect(await screen.findByText('Password required')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0].password).toBeNull();

    await submitPassword(SECRET);

    expect(await screen.findByText('Shared crm_account')).toBeInTheDocument();
    const resolves = calls.filter((c) => c.url.pathname.endsWith('/resolve'));
    expect(resolves).toHaveLength(2);
    expect(resolves[1].password).toBe(SECRET);
    expect(resolves[1].answered).toBe(200);
    expectNoUrlCarriesThePassword(calls);
  });

  it('a wrong password shows the error on the prompt', async () => {
    const calls = shareServer({ object_name: 'crm_account', password: SECRET });
    renderLink();

    await submitPassword('not-it');

    expect(await screen.findByText('Wrong password.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter password')).toHaveAttribute('type', 'password');
    const last = calls[calls.length - 1];
    expect(last.answered).toBe(401);
    expect(last.password).toBe('not-it');
    expect(calls.every((c) => !c.url.searchParams.has('password'))).toBe(true);
  });

  it('an unlocked conversation sends the password to /messages in the header too', async () => {
    const calls = shareServer({ object_name: 'ai_conversations', password: SECRET });
    renderLink();

    await submitPassword(SECRET);

    expect(await screen.findByText('This conversation has no messages yet.')).toBeInTheDocument();
    const messages = calls.filter((c) => c.url.pathname.endsWith('/messages'));
    expect(messages).toHaveLength(1);
    // Without the header the route answers 404 and the page reads that as an
    // empty conversation — the text above is the same either way, so the pin is
    // on the request and the server's answer to it.
    expect(messages[0].password).toBe(SECRET);
    expect(messages[0].answered).toBe(200);
    expectNoUrlCarriesThePassword(calls);
  });

  it('a password the header cannot carry is never sent, and the prompt says why', async () => {
    const calls = shareServer({ object_name: 'crm_account', password: SECRET });
    renderLink();

    await submitPassword('密码');

    expect(await screen.findByText(/can't be sent/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
    // Only the first, password-less resolve went out.
    expect(calls).toHaveLength(1);
    expect(calls[0].password).toBeNull();
  });
});

describe('SharedRecordPage — a sign-in-required link shows the sign-in path (objectui#11649)', () => {
  it('shows the sign-in path back to this link, and no password prompt', async () => {
    shareServer({ object_name: 'crm_account', audience: 'signed_in' });
    const { container } = renderLink();

    const signIn = await screen.findByRole('link', { name: 'Sign in' });
    expect(signIn).toHaveAttribute('href', `/login?redirect=${encodeURIComponent(`/s/${TOKEN}`)}`);
    expect(screen.getByText('Sign in required')).toBeInTheDocument();
    expect(screen.queryByText('Password required')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it('a 401 with a code the page does not know shows the server message, not a prompt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => refuse(401, 'UNAUTHENTICATED', 'Session expired')),
    );
    const { container } = renderLink();

    expect(await screen.findByText('Session expired')).toBeInTheDocument();
    expect(screen.getByText("Can't open this link")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('input[type="password"]')).toBeNull());
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
