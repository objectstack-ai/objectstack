// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25060, ruling 1B on #25040] Under the `open` and `email_domain` postures, a
 * sign-up for an address that already has an account answers the same shape
 * as a successful sign-up, and that address receives a mail saying it already
 * has an account — WHILE THE MAIL TRANSPORT IS LIVE. Without a live transport
 * the explicit refusal stays; `invite_only` is unchanged.
 *
 * `signup-existing-address-refusal.test.ts` keeps holding the refusal on every
 * deployment that wires no email service at all (its harness wires none); this
 * file owns the rule's three named pins and the cases that bound them:
 *
 *  - ① an existing address gets the success shape plus the mail (both
 *    postures), and the shape is measured against a NEW sign-up's on the same
 *    deployment rather than written down, so a vendor change in either answer
 *    reds here;
 *  - ② no live transport keeps the refusal: `isConfigured()` false (the `log`
 *    transport), the member absent (an implementation that predates it), or a
 *    member that throws — and a transport swapped at runtime is honoured on the
 *    next request, because the reader is asked at sign-up time;
 *  - ③ `invite_only` is unchanged: an invited holder of an existing address
 *    is still refused with the shield on, and a stranger still learns nothing;
 *  - ④ `open` with verification declared off keeps the refusal: a new sign-up
 *    is signed in at once there, and no session may be issued for someone
 *    else's account;
 *  - ⑤ the mail's language: the recipient's stored locale, then the
 *    deployment default — never the requester's browser language;
 *  - ⑥ a send that fails after the decision still answers the success (the
 *    accepted residual) and says so at error level.
 *
 * Real engine for the same reason the sibling file gives: the uniqueness probe
 * and the row the vendor finds both live below any double.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { SELF_REGISTRATION_CLOSED } from './audience-posture.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-25060';
const PASSWORD = 'S3cure!Passw0rd-25060';
const EXISTING = 'alice@corp.example';
const ALREADY_EXISTS = 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL';
const NOTICE = 'auth.existing_account_sign_up';

/** Declared locally with only the columns the audience gate reads (the sibling file's precedent). */
const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    label: { name: 'label', type: 'text' as const },
    active: { name: 'active', type: 'boolean' as const },
  },
};
const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
  },
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    const engine = engines.pop();
    try {
      await (engine as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

const SYSTEM = { context: { isSystem: true } } as never;

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  engine.registry.registerObject(sysPermissionSet as never, '@objectstack/plugin-security');
  engine.registry.registerObject(sysUserPermissionSet as never, '@objectstack/plugin-security');
  await engine.syncSchemas();
  // The organization-less catalogue row below exists only on a store built
  // before 18.x (ADR-0131 D1 makes a fresh tenant column NOT NULL): this is it.
  await relaxTenantColumns(engine, ['sys_permission_set']);
  const bound = await bindTestSecurityCatalog(engine, { permissions: [{ name: 'member_default' }] });
  // Alice carries a stored language; Bob carries none.
  await engine.insert('sys_user', { id: 'usr_alice', email: EXISTING, name: 'Alice', locale: 'ja-JP' }, SYSTEM);
  await engine.insert('sys_user', { id: 'usr_bob', email: 'bob@corp.example', name: 'Bob' }, SYSTEM);
  await (engine as any).getDriver('sys_permission_set').create(
    'sys_permission_set',
    { id: 'ps_member_default', name: 'member_default', label: 'member_default', active: true },
  );
  return bound;
}

async function seedPendingInvitation(engine: ObjectQL, email: string): Promise<void> {
  await engine.insert(
    'sys_invitation',
    {
      id: `inv_${Math.random().toString(36).slice(2, 10)}`,
      email,
      status: 'pending',
      organization_id: 'org_25060',
      role: 'member',
      inviter_id: 'usr_bob',
      expires_at: new Date(Date.now() + 3_600_000),
    },
    SYSTEM,
  );
}

const EMAIL_DOMAIN = {
  audience: { posture: 'email_domain', allowedEmailDomains: ['corp.example'], selfRegistrationPermissionSet: 'member_default' },
};
const OPEN = {
  audience: { posture: 'open', selfRegistrationPermissionSet: 'member_default' },
};

/**
 * A recording email service. `live` is what `isConfigured()` answers, read on
 * every call so a test can swap it between requests; `'absent'` leaves the
 * member off (an implementation that predates it), `'throws'` makes it throw.
 */
function recordingEmail(initial: boolean | 'absent' | 'throws', sendStatus: 'sent' | 'failed' = 'sent') {
  const sent: any[] = [];
  const state = { live: initial };
  const service: Record<string, unknown> = {
    async send() { return { id: 'e', status: 'sent' }; },
    async sendTemplate(input: any) {
      sent.push(input);
      return sendStatus === 'failed'
        ? { id: `e${sent.length}`, status: 'failed', error: 'smtp refused (simulated)' }
        : { id: `e${sent.length}`, status: 'sent' };
    },
  };
  if (initial !== 'absent') {
    service.isConfigured = () => {
      if (state.live === 'throws') throw new Error('transport state unreadable (simulated)');
      return state.live === true;
    };
  }
  return { sent, state, service };
}

function makeManager(engine: ObjectQL, email: { service: unknown } | undefined, config: Record<string, unknown> = {}) {
  const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never, ...config } as never);
  if (email) manager.setEmailService(email.service as never);
  return manager;
}

function signUp(manager: AuthManager, email: string, headers: Record<string, string> = {}): Promise<Response> {
  return manager.handleRequest(
    new Request(`${AUTH}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, ...headers },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Someone' }),
    }),
  );
}

async function readAll(engine: ObjectQL, object: string): Promise<Record<string, unknown>[]> {
  const rows = await engine.find(object, { limit: 100 }, SYSTEM);
  return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
}

/** Count every insert attempt that reaches the engine, by object name. */
function instrumentInserts(engine: ObjectQL): string[] {
  const calls: string[] = [];
  const original = (engine as any).insert.bind(engine);
  (engine as any).insert = (...args: any[]) => {
    calls.push(String(args[0]));
    return original(...args);
  };
  return calls;
}

/** Status, header names, and the body reduced to its members and their types. */
async function shapeOf(res: Response) {
  const body = (await res.clone().json()) as Record<string, any>;
  const typeOf = (v: unknown) => (v === null ? 'null' : typeof v);
  const userShape = Object.fromEntries(
    Object.entries((body.user ?? {}) as Record<string, unknown>).map(([k, v]) => [k, typeOf(v)]).sort(),
  );
  return {
    status: res.status,
    headerNames: [...res.headers.keys()].sort(),
    keys: Object.keys(body).sort(),
    token: body.token,
    userShape,
    emailVerified: body.user?.emailVerified,
  };
}

/** A logger that records what the manager writes at error and at warn level. */
function recordingLogger(): { errors: string[]; warnings: string[]; logger: Record<string, unknown> } {
  const errors: string[] = [];
  const warnings: string[] = [];
  return {
    errors,
    warnings,
    logger: {
      error: (m: string) => { errors.push(String(m)); },
      warn: (m: string) => { warnings.push(String(m)); },
      info: () => {},
      debug: () => {},
    },
  };
}

async function expectRefused(res: Response) {
  expect(res.status, `expected the explicit refusal, got: ${await res.clone().text()}`).toBe(422);
  expect(((await res.json()) as { code?: string }).code).toBe(ALREADY_EXISTS);
}

describe('[#25060] ① an existing address gets the success shape plus the mail', () => {
  for (const [label, posture] of [['email_domain', EMAIL_DOMAIN], ['open (verification on by default)', OPEN]] as const) {
    it(`${label}: the same shape a new sign-up gets, nothing written, one mail to the address's holder`, async () => {
      const engine = await bootEngine();
      const email = recordingEmail(true);
      const { errors, warnings, logger } = recordingLogger();
      const manager = makeManager(engine, email, { ...posture, logger });
      await manager.getAuthInstance();

      // The reference: a NEW address on the same deployment.
      const fresh = await signUp(manager, 'dave@corp.example');
      expect(fresh.status, `a new registrant was refused: ${await fresh.clone().text()}`).toBeLessThan(300);
      const freshShape = await shapeOf(fresh);
      expect(email.sent.map((s) => s.template)).toEqual(['auth.verify_email']);
      email.sent.length = 0;
      errors.length = 0;
      warnings.length = 0;

      const inserts = instrumentInserts(engine);
      const existing = await signUp(manager, EXISTING);
      const existingShape = await shapeOf(existing);

      // The answer cannot be told apart from a new sign-up's by its shape.
      expect(existingShape).toEqual(freshShape);
      expect(existingShape.token).toBeNull();
      expect(existingShape.headerNames).not.toContain('set-cookie');

      // Nothing was written for the existing address: no row, no credential, no session.
      expect(inserts).toEqual([]);
      expect((await readAll(engine, 'sys_user')).filter((u) => u.email === EXISTING).map((u) => u.id)).toEqual(['usr_alice']);
      expect((await readAll(engine, 'sys_account')).map((a) => a.user_id)).not.toContain('usr_alice');
      expect((await readAll(engine, 'sys_session')).map((s) => s.user_id)).not.toContain('usr_alice');

      // Exactly one mail, to the existing address, through the template path.
      expect(email.sent).toHaveLength(1);
      const mail = email.sent[0];
      expect(mail.template).toBe(NOTICE);
      expect(mail.to.address).toBe(EXISTING);
      expect(mail.relatedObject).toBe('sys_user');
      expect(mail.relatedId).toBe('usr_alice');
      expect(mail.identityMail).toBe(true);
      expect(mail.data.user.email).toBe(EXISTING);
      expect(mail.data.signInUrl).toBe(`${BASE}/_console/login`);
      expect(mail.data.resetPasswordUrl).toBe(`${BASE}/_console/forgot-password`);
      // No credential rides this mail.
      expect(JSON.stringify(mail.data)).not.toMatch(/token/i);
      // And the success path is a normal outcome, not a degradation: nothing
      // downstream of the answer (the sign-up after-hook included) reports a
      // failure for the user id that belongs to no row.
      expect(errors, `logged: ${JSON.stringify(errors)}`).toEqual([]);
      expect(warnings, `logged: ${JSON.stringify(warnings)}`).toEqual([]);
    });
  }

  it('the shield\'s other trigger: open with verification declared off but autoSignIn off also answers the success shape', async () => {
    // A new sign-up's answer carries no session there either, so the shape
    // can be mirrored — the predicate is the vendor's shield, not the flag.
    const engine = await bootEngine();
    const email = recordingEmail(true);
    const manager = makeManager(engine, email, {
      ...OPEN,
      emailAndPassword: { requireEmailVerification: false, autoSignIn: false },
    });

    const fresh = await signUp(manager, 'dave@corp.example');
    const existing = await signUp(manager, EXISTING);

    expect(await shapeOf(existing)).toEqual(await shapeOf(fresh));
    expect(email.sent.filter((s) => s.template === NOTICE).map((s) => s.to.address)).toEqual([EXISTING]);
  });
});

describe('[#25060] ② no live transport keeps the refusal', () => {
  for (const [label, live] of [
    ['isConfigured() answers false (the log transport)', false],
    ['the service has no isConfigured member', 'absent'],
    ['isConfigured() throws', 'throws'],
  ] as const) {
    it(`${label}: refused explicitly, and nothing is mailed`, async () => {
      const engine = await bootEngine();
      const email = recordingEmail(live);
      const manager = makeManager(engine, email, EMAIL_DOMAIN);

      await expectRefused(await signUp(manager, EXISTING));
      expect(email.sent).toEqual([]);
    });
  }

  it('a transport swapped at runtime is honoured on the next request, in both directions', async () => {
    const engine = await bootEngine();
    const email = recordingEmail(false);
    const manager = makeManager(engine, email, OPEN);

    await expectRefused(await signUp(manager, EXISTING));
    email.state.live = true;
    const live = await signUp(manager, EXISTING);
    expect(live.status, await live.clone().text()).toBeLessThan(300);
    expect(email.sent.map((s) => s.template)).toEqual([NOTICE]);
    email.state.live = false;
    await expectRefused(await signUp(manager, EXISTING));
    expect(email.sent).toHaveLength(1);
  });
});

describe('[#25060] ③ invite_only is unchanged', () => {
  it('an invited holder of an existing address is refused with the shield on and a live transport, and nothing is mailed', async () => {
    const engine = await bootEngine();
    await seedPendingInvitation(engine, EXISTING);
    const email = recordingEmail(true);
    const manager = makeManager(engine, email, { emailAndPassword: { requireEmailVerification: true } });

    await expectRefused(await signUp(manager, EXISTING));
    expect(email.sent).toEqual([]);
  });

  it('an uninvited stranger still learns nothing: a registered and an unknown address answer alike', async () => {
    const engine = await bootEngine();
    const email = recordingEmail(true);
    const manager = makeManager(engine, email, { emailAndPassword: { requireEmailVerification: true } });

    const real = await signUp(manager, EXISTING);
    const unknown = await signUp(manager, 'nobody@corp.example');

    expect(real.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(((await real.json()) as { code?: string }).code).toBe(SELF_REGISTRATION_CLOSED);
    expect(((await unknown.json()) as { code?: string }).code).toBe(SELF_REGISTRATION_CLOSED);
    expect(email.sent).toEqual([]);
  });
});

describe('[#25060] ④ open with verification declared off keeps the refusal', () => {
  it('refused explicitly: no session is issued for the existing account and nothing is mailed', async () => {
    const engine = await bootEngine();
    const email = recordingEmail(true);
    const manager = makeManager(engine, email, { ...OPEN, emailAndPassword: { requireEmailVerification: false } });

    // The configuration this case is about: a new sign-up is signed in at once.
    const fresh = await signUp(manager, 'dave@corp.example');
    expect(typeof ((await fresh.clone().json()) as { token?: unknown }).token).toBe('string');

    const res = await signUp(manager, EXISTING);
    expect(res.headers.get('set-cookie')).toBeNull();
    await expectRefused(res);
    expect((await readAll(engine, 'sys_session')).map((s) => s.user_id)).not.toContain('usr_alice');
    expect(email.sent.filter((s) => s.template === NOTICE)).toEqual([]);
  });
});

describe('[#25060] ⑤ the mail is in the recipient\'s language', () => {
  it('the recipient\'s stored locale outranks the deployment default and the requester\'s Accept-Language', async () => {
    const engine = await bootEngine();
    const email = recordingEmail(true);
    const manager = makeManager(engine, email, EMAIL_DOMAIN);
    manager.setDefaultEmailLocale('zh-CN');

    await signUp(manager, EXISTING, { 'accept-language': 'es-ES,es;q=0.9' });

    expect(email.sent.map((s) => [s.template, s.locale])).toEqual([[NOTICE, 'ja-JP']]);
  });

  it('with no stored locale it is the deployment default — never the requester\'s Accept-Language', async () => {
    const engine = await bootEngine();
    const email = recordingEmail(true);
    const manager = makeManager(engine, email, EMAIL_DOMAIN);
    manager.setDefaultEmailLocale('zh-CN');

    await signUp(manager, 'bob@corp.example', { 'accept-language': 'es-ES,es;q=0.9' });

    expect(email.sent.map((s) => [s.template, s.to.address, s.locale])).toEqual([[NOTICE, 'bob@corp.example', 'zh-CN']]);
  });
});

describe('[#25060] ⑥ a send that fails after the decision', () => {
  it('still answers the success shape, and says at error level that the mail was lost', async () => {
    const engine = await bootEngine();
    const email = recordingEmail(true, 'failed');
    const { errors, logger } = recordingLogger();
    const manager = makeManager(engine, email, { ...EMAIL_DOMAIN, logger });

    const res = await signUp(manager, EXISTING);

    expect(res.status, await res.clone().text()).toBeLessThan(300);
    expect(email.sent.map((s) => s.template)).toEqual([NOTICE]);
    const named = errors.filter((l) => l.includes('could NOT be sent'));
    expect(named, `logged: ${JSON.stringify(errors)}`).toHaveLength(1);
  });
});
