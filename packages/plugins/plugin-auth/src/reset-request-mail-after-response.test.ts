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
 *  - the phone-number reset request (`plugins.phoneNumber` with an SMS
 *    service) answers without waiting for the SMS send, as the emailed reset
 *    does: a number with an account and a number without one get the same
 *    answer while the reset text's send is still open, and the text still
 *    goes out after the response; a text whose send fails is logged on the
 *    server at error, without its code, and the answer is the one a sent text
 *    gets; the server-side phone reset call (no `Request`) still awaits its
 *    send;
 *  - `runAfterResponse` hands a task's synchronous throw to `onFailure` and
 *    survives an `onFailure` that throws;
 *  - the public config says whether mail leaves the deployment
 *    (`features.emailDelivery`): false with no email service and with a
 *    transport that reports itself unconfigured (the stock `log` one), true
 *    with a configured one. It describes the deployment, not an address: in
 *    all three a known and an unknown address get the same reset answer, and
 *    that answer is the same one whether mail leaves or not;
 *  - a burst of concurrent reset requests for one address, counted by the
 *    cache-backed rate-limit storage `AuthPlugin` wires
 *    (`createLazyCacheRateLimitStorage` over the kernel cache adapter) under
 *    the per-endpoint rule the auth settings bind writes, answers each request
 *    200 or 429 and never 5xx: exactly the rule's `max` are admitted, every
 *    admitted answer is the body an address with no account gets, every
 *    refusal carries its message, nothing is logged at error, and each
 *    admitted request for the account still sends its reset mail.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { MemoryCacheAdapter } from '@objectstack/service-cache';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createLazyCacheRateLimitStorage } from './rate-limit-storage.js';
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

describe('the phone-number reset request answers without waiting on the reset text', () => {
  const PHONE = '+15550161';
  const NO_ACCOUNT_PHONE = '+15550162';
  const SYS = { context: { isSystem: true } } as never;

  type Text = { to: string; templateParams?: { code?: string } };

  /** A promise the case settles by hand. */
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  /**
   * A deployment with phone-number sign-in and one account holding `PHONE`,
   * whose SMS service hands each send to `answer`, and records every text it
   * was handed (`texts`) and the number of every send that has settled
   * (`settled`).
   */
  async function phoneDeployment(answer: () => Promise<unknown>) {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = await engines.take();
    const logged: string[] = [];
    const manager = new AuthManager({
      secret: SECRET,
      baseUrl: BASE,
      dataEngine: engine as never,
      plugins: { phoneNumber: true },
      logger: { warn: () => {}, error: (message: string) => logged.push(message) },
    } as never);
    manager.setEmailService({ sendTemplate: async () => ({ status: 'sent' }) } as never);
    const texts: Text[] = [];
    const settled: string[] = [];
    manager.setSmsService({
      async send(input: Text) {
        texts.push(input);
        try {
          return await answer();
        } finally {
          settled.push(input.to);
        }
      },
      isConfigured: () => true,
    } as never);
    const signedUp = await post(manager, '/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Reset' });
    expect(signedUp.status, await signedUp.clone().text()).toBe(200);
    const [user] = (await engine.find('sys_user', { where: { email: EMAIL }, limit: 1 }, SYS)) as Array<{ id: string }>;
    await engine.update('sys_user', { id: user.id, phone_number: PHONE, phone_number_verified: true }, SYS);
    return { manager, texts, settled, logged };
  }

  async function requestPhoneReset(manager: AuthManager, phoneNumber: string): Promise<{ status: number; body: string }> {
    const res = await post(manager, '/phone-number/request-password-reset', { phoneNumber });
    return { status: res.status, body: await res.text() };
  }

  it('answers a number with an account and a number without one alike, while the reset text is still being sent', async () => {
    const send = deferred();
    const d = await phoneDeployment(async () => {
      await send.promise;
      return { id: 'sms1', status: 'sent' };
    });

    const forAccount = await requestPhoneReset(d.manager, PHONE);
    const forNobody = await requestPhoneReset(d.manager, NO_ACCOUNT_PHONE);

    expect(forAccount.status).toBe(200);
    expect(forAccount).toEqual(forNobody);
    // Both answers arrived while the text's send was still open.
    expect(d.settled).toEqual([]);

    // The control: the text still goes to the number, after the response.
    send.resolve();
    await vi.waitFor(() => expect(d.settled).toEqual([PHONE]));
    expect(d.texts.map((t) => t.to)).toEqual([PHONE]);
    expect(d.logged).toEqual([]);
  }, 60_000);

  it('logs a reset text whose send fails on the server, without its code, and answers as for a text that is sent', async () => {
    const failing = await phoneDeployment(async () => ({ status: 'failed', error: 'carrier unavailable' }));
    const sending = await phoneDeployment(async () => ({ id: 'sms1', status: 'sent' }));

    const throughFailing = await requestPhoneReset(failing.manager, PHONE);
    const throughSending = await requestPhoneReset(sending.manager, PHONE);

    expect(throughFailing).toEqual(throughSending);
    await vi.waitFor(() => expect(failing.logged).toHaveLength(1));
    expect(failing.logged[0]).toContain('phone password-reset text was not delivered');
    expect(failing.logged[0]).toContain('carrier unavailable');
    const code = String(failing.texts[0]?.templateParams?.code ?? '');
    expect(code, 'the text carries its code').not.toBe('');
    expect(failing.logged[0]).not.toContain(code);
  }, 60_000);

  it('the server-side phone reset call (no Request) still awaits its send', async () => {
    const d = await phoneDeployment(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return { id: 'sms1', status: 'sent' };
    });
    const api = (await d.manager.getApi()) as unknown as {
      requestPasswordResetPhoneNumber(input: { body: { phoneNumber: string } }): Promise<unknown>;
    };

    await api.requestPasswordResetPhoneNumber({ body: { phoneNumber: PHONE } });

    expect(d.settled).toEqual([PHONE]);
  }, 60_000);
});

describe('the public config says whether a reset link can be emailed from this deployment', () => {
  /** The deployment's one account, then the email service under test swapped in. */
  async function withEmailService(service: Record<string, unknown> | undefined) {
    const d = await deployment(async () => ({ status: 'sent' }));
    d.manager.setEmailService(service as never);
    const config = d.manager.getPublicConfig() as { features: Record<string, unknown> };
    const forAccount = await requestReset(d.manager, EMAIL);
    const forNobody = await requestReset(d.manager, NOBODY);
    return { emailDelivery: config.features.emailDelivery, forAccount, forNobody };
  }

  const sendTemplate = async () => ({ status: 'sent' });

  it('no email service: no delivery, and a known and an unknown address get the same answer', async () => {
    const r = await withEmailService(undefined);

    expect(r.emailDelivery).toBe(false);
    expect(r.forAccount.status).toBe(200);
    expect(r.forAccount).toEqual(r.forNobody);
  }, 60_000);

  it('a transport that reports itself unconfigured (the log one): no delivery, same answer for both addresses', async () => {
    const r = await withEmailService({ sendTemplate, isConfigured: () => false });

    expect(r.emailDelivery).toBe(false);
    expect(r.forAccount.status).toBe(200);
    expect(r.forAccount).toEqual(r.forNobody);
  }, 60_000);

  it('a configured transport: delivery, and the reset answer is the one a deployment without mail gives', async () => {
    const live = await withEmailService({ sendTemplate, isConfigured: () => true });
    const none = await withEmailService(undefined);

    expect(live.emailDelivery).toBe(true);
    expect(live.forAccount).toEqual(live.forNobody);
    expect(live.forAccount).toEqual(none.forAccount);
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

describe('a burst of reset requests for one address answers 200 or 429, never 5xx', () => {
  /** The per-endpoint rule the auth settings bind writes (`rate_limit_max` / `rate_limit_window_seconds`). */
  const RULE = { window: 60, max: 3 } as const;
  /** Requests in the burst: more than the rule admits, so both answers occur. */
  const BURST = 8;

  /**
   * A deployment counting through the storage `AuthPlugin` hands better-auth
   * (`rateLimit.customStorage`), over the kernel cache adapter, with the
   * reset endpoint's rule as the settings bind writes it. Records every send,
   * every server-side error line, and every console error (better-call's own
   * unhandled-error line goes there).
   */
  async function burstDeployment(withAccount: boolean) {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const engine = await engines.take();
    const logged: string[] = [];
    const cache = new MemoryCacheAdapter();
    const manager = new AuthManager({
      secret: SECRET,
      baseUrl: BASE,
      dataEngine: engine as never,
      rateLimit: {
        enabled: true,
        window: RULE.window,
        max: RULE.max,
        customRules: { '/request-password-reset': { ...RULE } },
      },
      rateLimitStorage: createLazyCacheRateLimitStorage({ resolveCache: async () => cache }),
      logger: { warn: () => {}, error: (message: string) => logged.push(message) },
    } as never);
    const sends: Mail[] = [];
    manager.setEmailService({
      sendTemplate: async (input: Mail) => {
        sends.push(input);
        return { status: 'sent' };
      },
    } as never);
    if (withAccount) {
      const signedUp = await post(manager, '/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Reset' });
      expect(signedUp.status, await signedUp.clone().text()).toBe(200);
      sends.length = 0;
    }
    return { manager, sends, logged, consoleErrors };
  }

  /** Fire `BURST` reset requests for `email` at once; answer each status and body. */
  async function burst(manager: AuthManager, email: string): Promise<Array<{ status: number; body: string }>> {
    const answers = await Promise.all(
      Array.from({ length: BURST }, () => post(manager, '/request-password-reset', { email, redirectTo: `${BASE}/reset` })),
    );
    return Promise.all(answers.map(async (res) => ({ status: res.status, body: await res.text() })));
  }

  it('an address with an account: the rule admits exactly max, refuses the rest with 429, and logs no error', async () => {
    const d = await burstDeployment(true);

    const answers = await burst(d.manager, EMAIL);

    expect(answers.map((a) => a.status).sort()).toEqual([
      ...Array.from({ length: RULE.max }, () => 200),
      ...Array.from({ length: BURST - RULE.max }, () => 429),
    ]);
    const admitted = answers.filter((a) => a.status === 200);
    expect(new Set(admitted.map((a) => a.body)).size).toBe(1);
    for (const refused of answers.filter((a) => a.status === 429)) {
      expect(JSON.parse(refused.body)).toEqual({ message: expect.any(String) });
    }
    // Each admitted request still sends its reset mail, after the response.
    await vi.waitFor(() => expect(d.sends.map((m) => [m.template, m.to.address])).toEqual(
      Array.from({ length: RULE.max }, () => ['auth.password_reset', EMAIL]),
    ));
    expect(d.logged).toEqual([]);
    expect(d.consoleErrors).not.toHaveBeenCalled();
  }, 60_000);

  it('an address with no account answers the same burst the same way, with the same admitted body', async () => {
    const withAccount = await burstDeployment(true);
    const forAccount = await burst(withAccount.manager, EMAIL);
    const without = await burstDeployment(false);
    const forNobody = await burst(without.manager, NOBODY);

    expect(forNobody.map((a) => a.status).sort()).toEqual(forAccount.map((a) => a.status).sort());
    const admittedBodies = new Set(
      [...forAccount, ...forNobody].filter((a) => a.status === 200).map((a) => a.body),
    );
    expect(admittedBodies.size).toBe(1);
    await vi.waitFor(() => expect(withAccount.sends).toHaveLength(RULE.max));
    expect(without.sends).toEqual([]);
    expect([...withAccount.logged, ...without.logged]).toEqual([]);
    expect(without.consoleErrors).not.toHaveBeenCalled();
  }, 60_000);
});
