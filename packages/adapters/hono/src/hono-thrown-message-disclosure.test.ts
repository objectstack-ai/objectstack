// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23532] `createHonoApp`'s two catch arms run the 5xx disclosure filter
 * before they ship an UNDECLARED throw's message.
 *
 * ## The defect
 *
 * Both arms (the `${authMount}/*` mount's and the `${prefix}/*` catch-all's
 * around `HttpDispatcher.dispatch()`) end in `thrownJson`. A throw the ADR-0112
 * recogniser does not accept fell to `errorJson(c, err.message, …)` with the
 * message unread, so a driver diagnostic reached the client verbatim. Measured
 * through a real host (an object registered, its table never synced):
 *
 *     POST /api/v1/data/ghost
 *       500 {"success":false,"error":{"code":"INTERNAL_ERROR",
 *            "message":"insert into [statement and bound values redacted] - no such table: ghost"}}
 *
 * The driver had already redacted the statement and its values; the SQLite
 * diagnostic and the physical table name still went out. Every other door that
 * emits a thrown message asks `looksLikeInternalErrorLeak` first
 * (`HttpDispatcher.error`, `packages/rest`'s registrars, the recogniser's own
 * 5xx limb, and this file's `/auth/config` arm), so this one now does too.
 *
 * ## What is pinned, per arm
 *
 *  - the probe above, as the throw: `500`, `INTERNAL_ERROR`, and the twins'
 *    `INTERNAL_ERROR_MESSAGE` in place of the message; neither the table name
 *    nor the diagnostic is anywhere in the body;
 *  - a plain `new Error('boom')`: `500`, `INTERNAL_ERROR`, `boom` — an ordinary
 *    undeclared 5xx still names itself.
 *
 * And the filter's scope on the catch-all, the same as the twins': a 5xx that
 * declares its status through `statusCode` is filtered at that status, and a
 * 4xx keeps its message, because a 4xx message is a caller-facing answer.
 *
 * ## What this file is
 *
 * This package's vitest config aliases `@objectstack/runtime` to a stub, so the
 * dispatcher here is a fixture whose methods throw what a case hands them;
 * `createHonoApp`, both of its arms and `thrownJson` are the real source.
 * The composed-host sibling, a real kernel and the real dispatcher, is
 * `packages/qa/http-conformance/src/hono-declared-envelope.conformance.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';

const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', routes: {} }),
  handleAuth: vi.fn(),
  dispatch: vi.fn(),
};

vi.mock('@objectstack/runtime', () => ({
  HttpDispatcher: function HttpDispatcher() { return mockDispatcher; },
}));

import { createHonoApp } from './index';

const PREFIX = '/api/v1';
/** The card's probe: the message the SQL driver threw for an unsynced table. */
const PROBE = 'insert into [statement and bound values redacted] - no such table: ghost';
const PLAIN = 'boom';

interface Answer { status: number; body: any; text: string }

const send = async (app: ReturnType<typeof createHonoApp>, method: string, path: string): Promise<Answer> => {
  const res = await app.request(`http://localhost${path}`, {
    method,
    ...(method === 'GET' ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }) }),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text), text };
};

/** A kernel whose `auth` service's `handleRequest` throws `thrown`. */
const kernelWithThrowingAuth = (thrown: unknown) => ({
  name: 'test-kernel',
  getServiceAsync: vi.fn(async () => ({ handleRequest: vi.fn(async () => { throw thrown; }) })),
});

const withheld = { success: false, error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE } };
const kept = (message: string) => ({ success: false, error: { code: 'INTERNAL_ERROR', message } });

/** The disclosure itself, independent of the replacement text. */
const expectNoDiagnostic = (a: Answer) => {
  expect(a.text).not.toContain('ghost');
  expect(a.text).not.toContain('no such table');
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('[#23532] the dispatch() catch-all arm', () => {
  const app = () => createHonoApp({ kernel: { name: 'test-kernel' } as any, prefix: PREFIX, cors: false });

  it('a driver diagnostic thrown undeclared: 500 INTERNAL_ERROR with the withheld message', async () => {
    mockDispatcher.dispatch.mockRejectedValueOnce(new Error(PROBE));
    const answer = await send(app(), 'POST', `${PREFIX}/data/ghost`);
    expect(answer.status, answer.text).toBe(500);
    expect(answer.body).toEqual(withheld);
    expectNoDiagnostic(answer);
  });

  it('control: a plain bare Error keeps its message', async () => {
    mockDispatcher.dispatch.mockRejectedValueOnce(new Error(PLAIN));
    const answer = await send(app(), 'POST', `${PREFIX}/data/ghost`);
    expect(answer.status, answer.text).toBe(500);
    expect(answer.body).toEqual(kept(PLAIN));
  });

  it('a 5xx declared through `statusCode` alone is filtered at that status', async () => {
    mockDispatcher.dispatch.mockRejectedValueOnce(Object.assign(new Error(PROBE), { statusCode: 503 }));
    const answer = await send(app(), 'GET', `${PREFIX}/data/ghost`);
    expect(answer.status, answer.text).toBe(503);
    expect(answer.body).toEqual({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: INTERNAL_ERROR_MESSAGE } });
    expectNoDiagnostic(answer);
  });

  it('scope: a 4xx keeps its message, as on the twin doors', async () => {
    mockDispatcher.dispatch.mockRejectedValueOnce(Object.assign(new Error(PROBE), { statusCode: 400 }));
    const answer = await send(app(), 'GET', `${PREFIX}/data/ghost`);
    expect(answer.status, answer.text).toBe(400);
    expect(answer.body.error.message).toBe(PROBE);
  });
});

describe('[#23532] the auth-mount arm', () => {
  it('an auth service that throws a driver diagnostic: 500 INTERNAL_ERROR with the withheld message', async () => {
    const app = createHonoApp({ kernel: kernelWithThrowingAuth(new Error(PROBE)) as any, prefix: PREFIX, cors: false });
    const answer = await send(app, 'GET', `${PREFIX}/auth/get-session`);
    expect(answer.status, answer.text).toBe(500);
    expect(answer.body).toEqual(withheld);
    expectNoDiagnostic(answer);
  });

  it('control: an auth service that throws a plain bare Error keeps its message', async () => {
    const app = createHonoApp({ kernel: kernelWithThrowingAuth(new Error(PLAIN)) as any, prefix: PREFIX, cors: false });
    const answer = await send(app, 'GET', `${PREFIX}/auth/get-session`);
    expect(answer.status, answer.text).toBe(500);
    expect(answer.body).toEqual(kept(PLAIN));
  });

  it('the legacy dispatcher fallback (no auth service) throwing a driver diagnostic: withheld', async () => {
    mockDispatcher.handleAuth.mockRejectedValueOnce(new Error(PROBE));
    const app = createHonoApp({ kernel: { name: 'test-kernel' } as any, prefix: PREFIX, cors: false });
    const answer = await send(app, 'POST', `${PREFIX}/auth/sign-in/email`);
    expect(answer.status, answer.text).toBe(500);
    expect(answer.body).toEqual(withheld);
    expectNoDiagnostic(answer);
  });
});
