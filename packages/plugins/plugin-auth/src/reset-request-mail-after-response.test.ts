// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A reset request answers the same way for any address and does not wait on
 * the reset mail: on the public door the mail is built and sent after the
 * response (`run-after-response.ts`, `sendResetPassword` in
 * `auth-manager-auth-instance.ts`).
 *
 * Driven through `AuthManager.handleRequest` over a real `ObjectQL` engine
 * (better-sqlite3, this plugin's own manifest).
 *
 * Pinned:
 *  - the answer does not wait on the send: a send that never settles still
 *    lets `POST /request-password-reset` answer, with the body an address
 *    with no account gets;
 *  - the control: the reset mail is still sent, to the address, after the
 *    response;
 *  - a send that fails is logged on the server, at error, and the caller's
 *    answer is the one a succeeding send gets;
 *  - the server-side reset call (no `Request` — the identity import's) still
 *    awaits its send, because it reads the delivery receipt the send settles;
 *  - `runAfterResponse` hands a task's synchronous throw to `onFailure` and
 *    survives an `onFailure` that throws.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { runAfterResponse } from './run-after-response.js';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import { sqliteEnginePool } from './__tests__/sqlite-engine-pool.testkit';
// better-auth's first module load is paid here, at module load, not inside the
// first case (AGENTS.md, Build & Test: clocked windows measure behaviour).
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-reset-request-mail';
const EMAIL = 'reset-request-mail@example.com';
const NOBODY = 'no-account-here@example.com';
const PASSWORD = 'Reset!Request-Mail-2026';
/** How long a response may take before the case reads it as waiting on the send. */
const ANSWER_DEADLINE_MS = 5_000;

const engines = sqliteEnginePool(async () => {
  const engine = new ObjectQL();
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return { engine, driver };
});
afterEach(engines.release);
afterAll(engines.destroy);

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

afterEach(() => {
  vi.restoreAllMocks();
});

const post = (manager: AuthManager, path: string, body: unknown) =>
  manager.handleRequest(
    new Request(`${AUTH}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: BASE },
      body: JSON.stringify(body),
    }),
  );

type Mail = { template: string; to: { address: string } };

/**
 * A deployment with one account, whose email service answers each send with
 * `answer` (called per send) and records every send it was handed.
 */
async function deployment(answer: () => Promise<unknown>) {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const engine = await engines.take();
  const logged: string[] = [];
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    logger: { warn: () => {}, error: (message: string) => logged.push(message) },
  } as never);
  const sends: Mail[] = [];
  manager.setEmailService({
    sendTemplate: (input: Mail) => {
      sends.push(input);
      return answer();
    },
  } as never);
  const signedUp = await post(manager, '/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Reset' });
  expect(signedUp.status, await signedUp.clone().text()).toBe(200);
  sends.length = 0;
  return { manager, sends, logged };
}

/** The answer to a reset request, or a refusal to wait past the deadline. */
async function requestReset(manager: AuthManager, email: string): Promise<{ status: number; body: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`POST /request-password-reset for ${email} did not answer within ${ANSWER_DEADLINE_MS} ms`)),
      ANSWER_DEADLINE_MS,
    );
  });
  try {
    const res = await Promise.race([post(manager, '/request-password-reset', { email, redirectTo: `${BASE}/reset` }), deadline]);
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

describe('a reset request answers without waiting on the reset mail', () => {
  it('answers while the send has not settled, with the answer an address with no account gets', async () => {
    const d = await deployment(() => new Promise(() => {}));

    const forAccount = await requestReset(d.manager, EMAIL);
    const forNobody = await requestReset(d.manager, NOBODY);

    expect(forAccount.status).toBe(200);
    expect(forAccount).toEqual(forNobody);
  }, 60_000);

  it('still sends the reset mail to the address, after the response (control)', async () => {
    const d = await deployment(async () => ({ status: 'sent' }));

    expect((await requestReset(d.manager, EMAIL)).status).toBe(200);

    await vi.waitFor(() => expect(d.sends.map((m) => [m.template, m.to.address])).toEqual([['auth.password_reset', EMAIL]]));
    expect(d.logged).toEqual([]);
  }, 60_000);

  it('logs a send that fails on the server, and answers as for a send that succeeds', async () => {
    const failing = await deployment(async () => ({ status: 'failed', error: '550 mailbox unavailable' }));
    const succeeding = await deployment(async () => ({ status: 'sent' }));

    const throughFailing = await requestReset(failing.manager, EMAIL);
    const throughSucceeding = await requestReset(succeeding.manager, EMAIL);

    expect(throughFailing).toEqual(throughSucceeding);
    await vi.waitFor(() => expect(failing.logged).toHaveLength(1));
    expect(failing.logged[0]).toContain('password-reset email was not delivered');
    expect(failing.logged[0]).toContain('550 mailbox unavailable');
  }, 60_000);

  it('the server-side reset call (no Request) still awaits its send', async () => {
    let settled = false;
    const d = await deployment(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      settled = true;
      return { status: 'sent' };
    });
    const api = (await d.manager.getApi()) as unknown as {
      requestPasswordReset(input: { body: { email: string } }): Promise<unknown>;
    };

    await api.requestPasswordReset({ body: { email: EMAIL } });

    expect(d.sends.map((m) => m.template)).toEqual(['auth.password_reset']);
    expect(settled).toBe(true);
  }, 60_000);
});

describe('runAfterResponse', () => {
  it("hands a task's synchronous throw to onFailure", async () => {
    const failures: unknown[] = [];
    runAfterResponse(() => {
      throw new Error('thrown before any await');
    }, (e) => failures.push(e));
    await vi.waitFor(() => expect(failures).toHaveLength(1));
    expect((failures[0] as Error).message).toBe('thrown before any await');
  });

  it('survives an onFailure that throws', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      let reported = false;
      runAfterResponse(async () => {
        throw new Error('task failed');
      }, () => {
        reported = true;
        throw new Error('the report failed too');
      });
      await vi.waitFor(() => expect(reported).toBe(true));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
