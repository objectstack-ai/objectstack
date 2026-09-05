// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15587] A sign-up for an address that ALREADY carries a `sys_user` row is
 * refused explicitly — never answered 200 for a row that is never written.
 *
 * ## The defect, and which of its two candidate mechanisms it actually was
 *
 * Measured: under posture `email_domain` (domain allowlisted, permission set
 * resolvable), `POST /sign-up/email` for an existing address answered **200**
 * with a freshly minted user id, persisted **nothing** — no new `sys_user`, no
 * `sys_account` — and the next sign-in was 401 with nothing anywhere
 * explaining it. The same call on the same population under the `invite_only`
 * default answered **422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL**.
 *
 * The card left the mechanism open: was the response synthesized on the
 * forced-email-verification lane ahead of the uniqueness refusal, or was an
 * insert attempted and swallowed? It is the FIRST, and cases ⓪ and ① are that
 * finding pinned rather than asserted:
 *
 *  - better-auth 1.7.2 `dist/api/routes/sign-up.mjs` computes
 *    `shouldReturnGenericDuplicateResponse = requireEmailVerification ||
 *    autoSignIn === false` (:163). On a duplicate it does NOT reach
 *    `createUser`: `findUserByEmail` hits at :199 and returns
 *    `buildGenericDuplicateResponse()` — a 200 carrying a `generateId()`-ed
 *    user built in memory — instead of throwing at :212.
 *  - So no insert is attempted and nothing is swallowed. Case ① asserts that
 *    directly by counting engine `insert` calls across the request.
 *  - And the POSTURE is not the cause: it is only what turns the shield on. A
 *    self-registration-permitting posture FORCES `requireEmailVerification`
 *    (`createAuthInstance`). Case ⓪ holds the posture CONSTANT at the
 *    `invite_only` default and moves only that flag — 422 becomes the
 *    synthetic 200 — which is what makes "before the uniqueness refusal" a
 *    measurement rather than a reading of vendor source.
 *
 * ## Why a real engine
 *
 * The population predicate and the uniqueness check both live below the fake
 * doubles: the probe reads `sys_user` through `withSystemReadContext` on the
 * real ObjectQL engine, and the duplicate the vendor finds is a real row in a
 * real table. A pin built on mocks passes against the unfixed code.
 * `@objectstack/driver-sql` + better-sqlite3 `:memory:`, plugin-auth's own
 * `authIdentityObjects`, driven through `AuthManager.handleRequest` — the
 * card's own harness.
 *
 * ## The controls, and what each one would catch
 *
 * A refusal is cheap to make unconditional, so the cases that must be able to
 * go red are the ones asserting the fix did NOT become "always refuse" and did
 * NOT invent a new oracle:
 *
 *  - ③ a NEW address on the same allowlisted domain is still admitted;
 *  - ④ the ORDER: under the `invite_only` default an UNINVITED stranger asking
 *    about an address that really exists still gets `SELF_REGISTRATION_CLOSED`,
 *    not 422. Asking uniqueness before the audience gate would hand that
 *    stranger an account-existence oracle on the DEFAULT posture — inventing
 *    on the closed door exactly what the vendor's shield exists to prevent.
 *  - ⑤ the two lanes answer byte-identically. The refusal is built from
 *    better-auth's own `BASE_ERROR_CODES` entry, so this is a drift detector:
 *    if the vendor re-words its message, the lanes part and this case reds.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { SELF_REGISTRATION_CLOSED } from './audience-posture.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-15587';
const PASSWORD = 'S3cure!Passw0rd-15587';
const EXISTING = 'alice@corp.example';

/** The refusal the platform already ships on the `invite_only` lane. */
const ALREADY_EXISTS = 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL';

/**
 * The RBAC object the audience gate resolves `selfRegistrationPermissionSet`
 * against lives in `@objectstack/plugin-security`; it is declared locally with
 * only the columns the resolver reads (the `last-admin-guard` /
 * `sso-register-platform-admin-gate` precedent) so a fixture adds no
 * dependency edge to plugin-auth.
 */
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

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  engine.registry.registerObject(sysPermissionSet as never, '@objectstack/plugin-security');
  await engine.syncSchemas();
  return engine;
}

const SYSTEM = { context: { isSystem: true } } as never;

/** The card's population: three human `sys_user` rows, zero `sys_account`. */
async function seedPopulation(engine: ObjectQL): Promise<void> {
  for (const [id, email] of [
    ['usr_alice', EXISTING],
    ['usr_bob', 'bob@corp.example'],
    ['usr_carol', 'carol@corp.example'],
  ] as const) {
    await engine.insert('sys_user', { id, email, name: id }, SYSTEM);
  }
  await engine.insert(
    'sys_permission_set',
    { id: 'ps_member_default', name: 'member_default', label: 'member_default', active: true },
    SYSTEM,
  );
}

async function seedPendingInvitation(engine: ObjectQL, email: string): Promise<void> {
  await engine.insert(
    'sys_invitation',
    {
      id: `inv_${Math.random().toString(36).slice(2, 10)}`,
      email: email.trim().toLowerCase(),
      status: 'pending',
      organization_id: 'org_15587',
      role: 'member',
      inviter_id: 'usr_bob',
      expires_at: new Date(Date.now() + 3_600_000),
    },
    SYSTEM,
  );
}

function makeManager(engine: ObjectQL, config: Record<string, unknown> = {}): AuthManager {
  return new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    ...config,
  } as never);
}

/** The widened posture the card measured, and the recovery path it sits on. */
const EMAIL_DOMAIN_POSTURE = {
  audience: {
    posture: 'email_domain',
    allowedEmailDomains: ['corp.example'],
    selfRegistrationPermissionSet: 'member_default',
  },
};

function signUp(manager: AuthManager, email: string): Promise<Response> {
  return manager.handleRequest(
    new Request(`${AUTH}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Someone' }),
    }),
  );
}

function signIn(manager: AuthManager, email: string): Promise<Response> {
  return manager.handleRequest(
    new Request(`${AUTH}/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
}

async function readAll(engine: ObjectQL, object: string): Promise<Record<string, unknown>[]> {
  const rows = await engine.find(object, { limit: 100 }, SYSTEM);
  return (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
}

/**
 * Make ONLY the uniqueness probe's own read fail, leaving every other engine
 * read working. This is the reviewer-measured shape from #15738: a total
 * outage is loud by itself (the vendor's read goes through the same engine and
 * the request answers 500), so the interesting failure is one specific to this
 * query's signature — `sys_user` filtered by `email`.
 */
function breakExistingUserProbe(engine: ObjectQL): void {
  const original = (engine as any).find.bind(engine);
  (engine as any).find = (object: string, options?: any, ...rest: any[]) => {
    if (object === 'sys_user' && typeof options?.where?.email === 'string') {
      throw new Error('probe-scoped failure (simulated)');
    }
    return original(object, options, ...rest);
  };
}

/** A logger that records what the manager writes at error/warn level. */
function recordingLogger(): { lines: string[]; logger: Record<string, unknown> } {
  const lines: string[] = [];
  const push = (m: string) => { lines.push(String(m)); };
  return { lines, logger: { error: push, warn: push, info: () => {}, debug: () => {} } };
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

describe('[#15587] sign-up for an address that already exists is refused, not falsely receipted', () => {
  it('⓪ THE MECHANISM: posture held constant, only requireEmailVerification moved — the honest 422 becomes a synthetic 200', async () => {
    // Both legs run the DEFAULT `invite_only` posture with a pending
    // invitation, so the audience gate admits identically and the only moving
    // part is the flag that arms better-auth's anti-enumeration shield. This
    // is what establishes "synthesized on the forced-verification lane" as a
    // measurement rather than a reading of vendor source.
    const shieldOffEngine = await bootEngine();
    await seedPopulation(shieldOffEngine);
    await seedPendingInvitation(shieldOffEngine, EXISTING);
    const shieldOff = await signUp(makeManager(shieldOffEngine), EXISTING);

    const shieldOnEngine = await bootEngine();
    await seedPopulation(shieldOnEngine);
    await seedPendingInvitation(shieldOnEngine, EXISTING);
    const shieldOn = await signUp(
      makeManager(shieldOnEngine, { emailAndPassword: { requireEmailVerification: true } }),
      EXISTING,
    );

    // The vendor's own answer when the shield is off — unchanged by this card.
    expect(shieldOff.status).toBe(422);
    expect(((await shieldOff.json()) as { code?: string }).code).toBe(ALREADY_EXISTS);
    // …and with the shield on it is now the SAME answer. Before the fix this
    // leg was `200 {"token":null,"user":{…synthetic…}}`.
    expect(shieldOn.status).toBe(422);
    expect(((await shieldOn.json()) as { code?: string }).code).toBe(ALREADY_EXISTS);
  });

  it('① THE DEFECT: posture email_domain, existing address — 422, nothing written, no insert even ATTEMPTED', async () => {
    const engine = await bootEngine();
    await seedPopulation(engine);
    const manager = makeManager(engine, EMAIL_DOMAIN_POSTURE);
    const before = await readAll(engine, 'sys_user');
    const inserts = instrumentInserts(engine);

    const res = await signUp(manager, EXISTING);

    expect(res.status, `expected an explicit refusal, got: ${await res.clone().text()}`).toBe(422);
    const body = (await res.json()) as { code?: string; user?: unknown };
    expect(body.code).toBe(ALREADY_EXISTS);
    // ⛔ The shape this card is about: a 200 carrying a user id no row holds.
    expect(body.user).toBeUndefined();

    // Nothing was written, and — the mechanism finding — nothing was tried.
    // A swallowed insert would show `sys_user` here.
    expect(inserts).toEqual([]);
    const after = await readAll(engine, 'sys_user');
    expect(after.map((u) => u.id).sort()).toEqual(before.map((u) => u.id).sort());
    expect(after.filter((u) => u.email === EXISTING).map((u) => u.id)).toEqual(['usr_alice']);
    expect(await readAll(engine, 'sys_account')).toEqual([]);
  });

  it('② the refusal is the whole story: no credential appeared, so sign-in still refuses — and now something explains it', async () => {
    const engine = await bootEngine();
    await seedPopulation(engine);
    const manager = makeManager(engine, EMAIL_DOMAIN_POSTURE);

    const up = await signUp(manager, EXISTING);
    const inRes = await signIn(manager, EXISTING);

    // The 401 was never the bug — being told 200 first was.
    expect(up.status).toBe(422);
    expect(inRes.status).toBe(401);
  });

  it('③ CONTROL: the fix did not become "always refuse" — a NEW address on the allowlisted domain is still admitted and really persists', async () => {
    const engine = await bootEngine();
    await seedPopulation(engine);
    const manager = makeManager(engine, EMAIL_DOMAIN_POSTURE);

    const res = await signUp(manager, 'dave@corp.example');

    expect(res.status, `a new allowlisted registrant was refused: ${await res.clone().text()}`)
      .toBeLessThan(300);
    const users = await readAll(engine, 'sys_user');
    expect(users.map((u) => u.email)).toContain('dave@corp.example');
    // …and unlike the synthetic 200, this one left a credential behind.
    expect((await readAll(engine, 'sys_account')).length).toBe(1);
  });

  it('④ ORDER: on the invite_only DEFAULT an uninvited stranger still gets SELF_REGISTRATION_CLOSED for a REAL address — no new existence oracle', async () => {
    const engine = await bootEngine();
    await seedPopulation(engine);
    const manager = makeManager(engine);

    const real = await signUp(manager, EXISTING);
    const unknown = await signUp(manager, 'nobody@corp.example');

    // Indistinguishable — which is the point. A uniqueness check asked BEFORE
    // the audience gate would answer 422 here and 403 below.
    expect(real.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(((await real.json()) as { code?: string }).code).toBe(SELF_REGISTRATION_CLOSED);
    expect(((await unknown.json()) as { code?: string }).code).toBe(SELF_REGISTRATION_CLOSED);
  });

  it('⑤ the two lanes are byte-identical — the refusal is built from better-auth\'s own constant, so vendor re-wording reds here', async () => {
    const vendorEngine = await bootEngine();
    await seedPopulation(vendorEngine);
    await seedPendingInvitation(vendorEngine, EXISTING);
    const vendorLane = await signUp(makeManager(vendorEngine), EXISTING);

    const ourEngine = await bootEngine();
    await seedPopulation(ourEngine);
    const ourLane = await signUp(makeManager(ourEngine, EMAIL_DOMAIN_POSTURE), EXISTING);

    expect(ourLane.status).toBe(vendorLane.status);
    expect(await ourLane.json()).toEqual(await vendorLane.json());
  });

  it('⑦ an UNANSWERABLE probe keeps the fall-through direction but is never SILENT about it', async () => {
    // Reviewer-measured on #15738: with a throw scoped to this probe's own
    // signature the pre-fix response came back — 200, fresh id, no row — and
    // nothing anywhere named the probe. The direction is deliberate and stays
    // (the vendor still decides); what is pinned here is that the refusal that
    // did NOT happen says so, so a query-shape-specific or transient failure
    // cannot re-open #15587 with zero signal.
    const engine = await bootEngine();
    await seedPopulation(engine);
    const { lines, logger } = recordingLogger();
    const manager = makeManager(engine, { ...EMAIL_DOMAIN_POSTURE, logger });
    breakExistingUserProbe(engine);

    const res = await signUp(manager, EXISTING);

    // Direction unchanged: fell through to better-auth, which under a forced-
    // verification posture answers with its synthetic duplicate response.
    expect(res.status).toBeLessThan(300);
    // …and the probe said so. This is the assertion the reviewer's measurement
    // had nothing to match.
    const named = lines.filter((l) => l.includes('existing-user probe could not be answered'));
    expect(named.length, `nothing named the probe; logged: ${JSON.stringify(lines)}`).toBe(1);
    expect(named[0]).toContain('uniqueness refusal was NOT raised');
    // Still nothing written — the fall-through did not invent a row either.
    expect(await readAll(engine, 'sys_account')).toEqual([]);
  });

  it('⑥ the shield\'s OTHER trigger: autoSignIn:false arms it under any posture, and that lane is refused too', async () => {
    // `shouldReturnGenericDuplicateResponse` is `requireEmailVerification ||
    // autoSignIn === false`, so the defect was never confined to the widened
    // postures — a deployment that merely turns auto-sign-in off reached it on
    // the `invite_only` default.
    const engine = await bootEngine();
    await seedPopulation(engine);
    await seedPendingInvitation(engine, EXISTING);
    const manager = makeManager(engine, { emailAndPassword: { autoSignIn: false } });

    const res = await signUp(manager, EXISTING);

    expect(res.status, `autoSignIn:false lane was not refused: ${await res.clone().text()}`).toBe(422);
    expect(((await res.json()) as { code?: string }).code).toBe(ALREADY_EXISTS);
    expect(await readAll(engine, 'sys_account')).toEqual([]);
  });
});
