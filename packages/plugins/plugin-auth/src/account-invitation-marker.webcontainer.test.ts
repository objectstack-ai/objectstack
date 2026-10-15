// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23343] The account-invitation marker on the POLYFILL path.
 *
 * WebContainer's `node:async_hooks` does not carry a store across `await`, so
 * `AuthManager`'s constructor seeds better-auth's request-state slot with a
 * synchronous, process-global polyfill there
 * (`installWebContainerRequestStatePolyfill`). The marker rides that slot, so
 * this file installs the polyfill the way a WebContainer boot does — the
 * `STACKBLITZ` signal, an empty better-auth global, then the constructor —
 * and measures, with the real stack:
 *
 *  ① the identity import still sends `auth.account_invitation` (the marker
 *    survives better-auth's awaits on the polyfill);
 *  ② a public `POST /request-password-reset` still sends `auth.password_reset`;
 *  ③ the polyfill really IS process-global — a task started outside the
 *    marker's store reads the store while the marked call is open — and leg 3
 *    (`request` present ⇒ no marker) is what still refuses an HTTP request
 *    there.
 *
 * Its own file because it replaces a process-wide slot; it puts the slot and
 * the env signal back when it ends.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { runAdminImportUsers } from './admin-import-users.js';
import { readAccountInvitation, runAsAccountInvitation } from './account-invitation-marker.js';

const ORIGIN = 'https://acme.example.com';
const BASE = '/api/v1/auth';
const SLOT = Symbol.for('better-auth:global');

type SentMail = { template: string; to: { address: string }; data: Record<string, any> };

let savedGlobal: unknown;
let savedSignal: string | undefined;
let engine: ObjectQL;
let manager: AuthManager;
const sent: SentMail[] = [];

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  savedGlobal = (globalThis as any)[SLOT];
  savedSignal = process.env.STACKBLITZ;
  delete (globalThis as any)[SLOT];
  process.env.STACKBLITZ = '1';

  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  await engine.syncSchemas();
  manager = new AuthManager({
    secret: 'test-secret-at-least-32-chars-long-23343',
    baseUrl: ORIGIN,
    dataEngine: engine as never,
    plugins: { admin: true },
  } as never);
  manager.setEmailService({
    sendTemplate: async (input: SentMail) => {
      sent.push(input);
      return { status: 'sent' };
    },
  } as never);
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  try {
    await (engine as unknown as { destroy?(): Promise<void> })?.destroy?.();
  } catch {
    /* noop */
  }
  if (savedGlobal === undefined) delete (globalThis as any)[SLOT];
  else (globalThis as any)[SLOT] = savedGlobal;
  if (savedSignal === undefined) delete process.env.STACKBLITZ;
  else process.env.STACKBLITZ = savedSignal;
});

describe('[#23343] the account-invitation marker under the WebContainer request-state polyfill', () => {
  it('the polyfill is what better-auth\'s request state runs on in this file', () => {
    const storage = (globalThis as any)[SLOT]?.context?.requestStateAsyncStorage;
    expect(storage?.constructor?.name).toBe('WebContainerRequestStateAsyncLocalStorage');
  });

  it('① the import still sends auth.account_invitation', async () => {
    const api = (await manager.getApi()) as any;
    const created = await api.createUser({ body: { email: 'wc-admin@acme.example.com', name: 'WC Admin', password: 'Adm1n!Passw0rd-23343' } });
    const res = await runAdminImportUsers(
      {
        getAuthApi: () => manager.getApi(),
        getDataEngine: () => manager.getDataEngine() as never,
        phoneNumberEnabled: () => false,
        emailServiceAvailable: () => manager.isEmailServiceAvailable(),
        smsInviteAvailable: () => false,
        sendInviteSms: async () => {},
        noteMustChangePasswordIssued: () => {},
      },
      new Request(`${ORIGIN}${BASE}/admin/import-users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'json', mode: 'insert', passwordPolicy: 'auto', rows: [{ email: 'wc-invitee@acme.example.com', name: 'WC Invitee' }] }),
      }),
      { id: String(created.user.id), email: 'wc-admin@acme.example.com' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await vi.waitFor(() => expect(sent.some((m) => m.to.address === 'wc-invitee@acme.example.com')).toBe(true));
    const mails = sent.filter((m) => m.to.address === 'wc-invitee@acme.example.com');
    expect(mails.map((m) => m.template)).toEqual(['auth.account_invitation']);
    expect(mails[0]!.data.inviter).toEqual({ name: 'WC Admin', email: 'wc-admin@acme.example.com' });
  }, 120_000);

  it('② a public reset still sends auth.password_reset', async () => {
    const res = await manager.handleRequest(
      new Request(`${ORIGIN}${BASE}/request-password-reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: 'wc-invitee@acme.example.com' }),
      }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    await vi.waitFor(() => expect(sent.filter((m) => m.to.address === 'wc-invitee@acme.example.com')).toHaveLength(2));
    expect(sent.filter((m) => m.to.address === 'wc-invitee@acme.example.com').map((m) => m.template))
      .toEqual(['auth.account_invitation', 'auth.password_reset']);
  }, 120_000);

  it('③ the polyfill exposes the store to a task started outside it; a Request still reads no marker', async () => {
    const marker = { email: 'wc-invitee@acme.example.com', inviter: { name: 'WC Admin', email: 'wc-admin@acme.example.com' } };
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    const outside = (async () => {
      await gate;
      return {
        serverSide: await readAccountInvitation(marker.email, undefined),
        httpRequest: await readAccountInvitation(marker.email, new Request(`${ORIGIN}${BASE}/request-password-reset`, { method: 'POST' })),
      };
    })();
    const seen = await runAsAccountInvitation(marker, async () => {
      openGate();
      return outside;
    });
    // Process-global: unlike native AsyncLocalStorage (account-invitation-marker.test.ts),
    // the task that began outside the store reads it while the marked call is open …
    expect(seen.serverSide?.email).toBe(marker.email);
    // … and leg 3 is what refuses a call that carries a Request.
    expect(seen.httpRequest).toBeUndefined();
  });
});
