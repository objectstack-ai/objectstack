// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An organization's MFA requirement never strands its members (ADR-0069 D3).
 *
 * Before this guard an administrator could tick `require_mfa` on an
 * organization while the two-factor feature was off. The save went through,
 * and once the grace period ended every member, the owner included, was held
 * with `MFA_REQUIRED` and sent to an enrollment endpoint that answered 404.
 * Three blocks hold the two halves of the fix and their conjunction:
 *
 *  1. the guard's rule over its own hook (which payloads it refuses, with
 *     what envelope, on which object);
 *  2. the guard on a real ObjectQL engine over the real `sys_organization`
 *     object, composed behind the ADR-0092 D2 identity write guard the way
 *     `auth-plugin.ts` composes it: the by-id door an administrator's edit
 *     form uses, a multi-row update, a system insert, and the row left as it
 *     was after a refusal;
 *  3. end to end on the real better-auth pipeline: for a member of an
 *     organization that requires MFA, past the grace window, the session
 *     never carries `MFA_REQUIRED` while `/two-factor/enable` answers 404 —
 *     with two-factor off the session is not held, and with it on the
 *     session is held AND the enrollment endpoint answers.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysOrganization } from '@objectstack/platform-objects/identity';
import { AuthManager } from './auth-manager';
import {
  ORGANIZATION_MFA_ENROLLMENT_GUARD_PRIORITY,
  organizationMfaWithoutEnrollmentRefusal,
  registerOrganizationMfaEnrollmentGuard,
  turnsMfaRequirementOn,
} from './organization-mfa-enrollment-guard.js';
import { registerIdentityWriteGuard, registerManagedUpdateWhitelist } from './identity-write-guard.js';
import { managedExtensionEditableFields } from './managed-extension-fields.js';
// The SAME in-memory engine the sibling two-factor suites drive: a new fake
// would be a new `check:engine-double-contract` ledger entry for no fidelity.
import { createMemoryEngine } from './impersonation-bearer-rotation.test';

/** ADR-0112 / ADR-0114: the refusal is the per-field `VALIDATION_FAILED` envelope on `require_mfa`. */
function expectRequireMfaRefusal(err: any): void {
  expect(err, 'the write was admitted').toBeTruthy();
  // `mapDataError` in `@objectstack/rest` keys the 400 on exactly these two
  // discriminators, so pinning both is what pins the status.
  expect(err.code).toBe('VALIDATION_FAILED');
  expect(err.name).toBe('ValidationError');
  expect(err.fields).toEqual([
    expect.objectContaining({ field: 'require_mfa', code: 'invalid_value' }),
  ]);
}

// ── 1. The rule ─────────────────────────────────────────────────────────────

/** Fake engine capturing registrations, the shape the real engine builds. */
function captureEngine() {
  const registrations: Array<{ event: string; handler: (ctx: any) => Promise<void>; options: any }> = [];
  return {
    registrations,
    registerHook: (event: string, handler: (ctx: any) => Promise<void>, options?: any) => {
      registrations.push({ event, handler, options });
    },
  };
}

/** Run every registered handler for `event` over a payload; returns the thrown error, or null. */
async function judge(
  enrollable: boolean,
  event: 'beforeInsert' | 'beforeUpdate',
  data: Record<string, unknown>,
): Promise<any> {
  const engine = captureEngine();
  registerOrganizationMfaEnrollmentGuard(engine, {
    packageId: 'test.organization-mfa-enrollment-guard',
    isTwoFactorEnabled: () => enrollable,
  });
  try {
    for (const r of engine.registrations.filter((x) => x.event === event)) {
      await r.handler({ object: 'sys_organization', event, input: { id: 'org_1', data } });
    }
    return null;
  } catch (e) {
    return e;
  }
}

describe('organization MFA enrollment guard — the rule', () => {
  it('registers insert and update hooks on sys_organization alone, after the D2 identity write guard', () => {
    const engine = captureEngine();
    registerOrganizationMfaEnrollmentGuard(engine, { packageId: 'p', isTwoFactorEnabled: () => false });
    expect(engine.registrations.map((r) => r.event).sort()).toEqual(['beforeInsert', 'beforeUpdate']);
    for (const r of engine.registrations) {
      expect(r.options).toEqual({ object: 'sys_organization', priority: 15, packageId: 'p' });
    }
    // D2 runs at 10: a write it refuses is refused there first.
    expect(ORGANIZATION_MFA_ENROLLMENT_GUARD_PRIORITY).toBeGreaterThan(10);
  });

  it.each([true, 1, 'true', 'TRUE', '1', 'yes'])('judges %j as turning the requirement on', (value) => {
    expect(turnsMfaRequirementOn(value)).toBe(true);
  });

  it.each([false, 0, '0', 'false', ' False ', null, undefined])('judges %j as leaving it off', (value) => {
    expect(turnsMfaRequirementOn(value)).toBe(false);
  });

  it('refuses require_mfa turned on, on insert and on update, while two-factor is off', async () => {
    for (const event of ['beforeInsert', 'beforeUpdate'] as const) {
      expectRequireMfaRefusal(await judge(false, event, { require_mfa: true }));
      expectRequireMfaRefusal(await judge(false, event, { require_mfa: true, timezone: 'Asia/Shanghai' }));
    }
  });

  it('admits the same write once two-factor is on (control: the refusal is the enrollment state\'s)', async () => {
    for (const event of ['beforeInsert', 'beforeUpdate'] as const) {
      expect(await judge(true, event, { require_mfa: true })).toBeNull();
    }
  });

  it('never judges a write that clears the requirement or leaves it alone', async () => {
    for (const event of ['beforeInsert', 'beforeUpdate'] as const) {
      expect(await judge(false, event, { require_mfa: false })).toBeNull();
      expect(await judge(false, event, { timezone: 'Asia/Shanghai' })).toBeNull();
      expect(await judge(false, event, { name: 'Acme' })).toBeNull();
    }
  });

  it('says why and what to do, with no tracker number', () => {
    const err: any = organizationMfaWithoutEnrollmentRefusal();
    expectRequireMfaRefusal(err);
    // The wording is not a parsed contract; these are the facts the administrator
    // needs, asserted by their named subjects rather than by the sentence.
    expect(err.message).toMatch(/two-factor enrollment is off/);
    expect(err.message).toMatch(/owner included/);
    expect(err.message).toMatch(/OS_AUTH_TWO_FACTOR=true/);
    expect(err.message).toMatch(/auth\.mfa_required/);
    expect(err.message).not.toMatch(/#\d/);
    expect(err.fields[0].message).toBe(err.message);
  });
});

// ── 2. On a real engine ─────────────────────────────────────────────────────

const engines: ObjectQL[] = [];
afterAll(async () => {
  for (const engine of engines) await (engine as any).destroy?.().catch?.(() => undefined);
});

const SYSTEM = { context: { isSystem: true, positions: [] as string[], permissions: [] as string[] } };
/** A user-context write: the administrator saving the organization's edit form. */
const ADMIN = { context: { userId: 'usr_admin', positions: [] as string[], permissions: [] as string[] } };

/** A real sqlite engine with the real organization object and the production hook composition. */
async function bootOrganizationEngine(enrollable: { value: boolean }): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registry.registerObject(SysOrganization as never);
  await engine.syncSchemas();
  registerManagedUpdateWhitelist('sys_organization', managedExtensionEditableFields('sys_organization'));
  registerIdentityWriteGuard(engine, { packageId: 'test.identity-write-guard' });
  registerOrganizationMfaEnrollmentGuard(engine, {
    packageId: 'test.organization-mfa-enrollment-guard',
    isTwoFactorEnabled: () => enrollable.value,
  });
  await engine.insert('sys_organization', { id: 'org_a', name: 'Acme', slug: 'acme' }, SYSTEM);
  await engine.insert('sys_organization', { id: 'org_b', name: 'Bolt', slug: 'bolt' }, SYSTEM);
  return engine;
}

async function storedRequireMfa(engine: ObjectQL, id: string): Promise<unknown> {
  const row: any = await engine.findOne('sys_organization', { where: { id }, fields: ['require_mfa'], ...SYSTEM });
  return row?.require_mfa;
}

async function caught(p: Promise<unknown>): Promise<any> {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

describe('organization MFA enrollment guard — on a real engine', () => {
  it('refuses the administrator\'s save while two-factor is off, and the row keeps its value', async () => {
    const engine = await bootOrganizationEngine({ value: false });
    expectRequireMfaRefusal(await caught(engine.update('sys_organization', { id: 'org_a', require_mfa: true }, ADMIN)));
    expect(await storedRequireMfa(engine, 'org_a')).toBe(false);
  });

  it('admits the same save once two-factor is on, and the row stores it', async () => {
    const enrollable = { value: false };
    const engine = await bootOrganizationEngine(enrollable);
    expectRequireMfaRefusal(await caught(engine.update('sys_organization', { id: 'org_a', require_mfa: true }, ADMIN)));
    // Read per write: turning the plugin on admits the next write, no rebind.
    enrollable.value = true;
    await engine.update('sys_organization', { id: 'org_a', require_mfa: true }, ADMIN);
    expect(await storedRequireMfa(engine, 'org_a')).toBe(true);
  });

  it('refuses it for a system write and for a multi-row update too', async () => {
    const engine = await bootOrganizationEngine({ value: false });
    expectRequireMfaRefusal(await caught(engine.update('sys_organization', { id: 'org_a', require_mfa: true }, SYSTEM)));
    expectRequireMfaRefusal(await caught(
      engine.update('sys_organization', { require_mfa: true }, { ...SYSTEM, where: { slug: 'bolt' }, multi: true } as any),
    ));
    expectRequireMfaRefusal(await caught(
      engine.insert('sys_organization', { id: 'org_c', name: 'Cove', slug: 'cove', require_mfa: true }, SYSTEM),
    ));
    expect(await storedRequireMfa(engine, 'org_a')).toBe(false);
    expect(await storedRequireMfa(engine, 'org_b')).toBe(false);
    expect(await engine.findOne('sys_organization', { where: { id: 'org_c' }, ...SYSTEM })).toBeNull();
  });

  it('leaves every other organization write alone while two-factor is off', async () => {
    const engine = await bootOrganizationEngine({ value: false });
    await engine.update('sys_organization', { id: 'org_a', timezone: 'Asia/Shanghai' }, ADMIN);
    await engine.update('sys_organization', { id: 'org_a', require_mfa: false }, ADMIN);
    const row: any = await engine.findOne('sys_organization', { where: { id: 'org_a' }, ...SYSTEM });
    expect(row.timezone).toBe('Asia/Shanghai');
    expect(row.require_mfa).toBe(false);
  });
});

// ── 3. End to end ───────────────────────────────────────────────────────────

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-org-mfa';
const EMAIL = 'member@example.com';
const BASE = 'http://localhost:3000/api/v1/auth';
const ORG = 'org_requires_mfa';

const cookieHeader = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

const post = (manager: AuthManager, path: string, body: unknown, headers: Record<string, string> = {}) =>
  manager.handleRequest(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    }),
  );

/**
 * A member of an organization that requires MFA, unenrolled, whose grace clock
 * started 30 days ago, in a session whose active organization is that one —
 * the card's measured state, on a deployment with two-factor on or off.
 */
async function arrangeHeldMember(twoFactor: boolean) {
  const engine: any = createMemoryEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    mfaGracePeriodDays: 7,
    ...(twoFactor ? { plugins: { twoFactor: true } } : {}),
  } as any);
  const signedUp = await post(manager, '/sign-up/email', { email: EMAIL, password: PASSWORD, name: 'Member' });
  expect(signedUp.status, `sign-up: ${await signedUp.clone().text()}`).toBe(200);
  const cookie = cookieHeader(signedUp);
  const user = (engine.tables.get('sys_user') as any[]).find((r) => r.email === EMAIL);
  // Stored before the guard existed: the guard judges writes, the gate judges this row.
  await engine.insert('sys_organization', { id: ORG, name: 'Acme', slug: 'acme', require_mfa: true });
  user.mfa_required_at = new Date(Date.now() - 30 * 86_400_000).toISOString();
  for (const s of engine.tables.get('sys_session') as any[]) {
    if (s.user_id === user.id) s.active_organization_id = ORG;
  }
  // The "any organization requires MFA" cache is refreshed in the background
  // on the session path; let it land so the gate reads the organization row.
  manager.isAuthGateActive();
  await vi.waitFor(() => expect(manager.isAuthGateActive()).toBe(true));
  return { engine, manager, cookie, userId: String(user.id) };
}

async function sessionAuthGate(manager: AuthManager, cookie: string): Promise<{ code?: string } | undefined> {
  const auth: any = await manager.getAuthInstance();
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  expect(session?.user, 'no session for the member').toBeTruthy();
  return session.user.authGate;
}

describe('end to end — a member is never held for MFA while the enrollment endpoint answers 404', () => {
  it('two-factor off: /two-factor/enable answers 404, so the session is not held and no grace clock is started', async () => {
    const { engine, manager, cookie, userId } = await arrangeHeldMember(false);
    const warn = vi.fn();
    (manager as any).config.logger = { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const enable = await post(manager, '/two-factor/enable', { password: PASSWORD }, { cookie });
    // The card's measurement: the enrollment path does not exist here.
    expect(enable.status).toBe(404);
    expect((await sessionAuthGate(manager, cookie))?.code).not.toBe('MFA_REQUIRED');
    expect(await manager.resolveUserAuthGates(userId, { organizationId: ORG })).toEqual([]);
    // Said once, with the remedy — not once per request.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/NOT enforced/);
    // The stored clock is left as it was (no restamp while unenrollable).
    const user = (engine.tables.get('sys_user') as any[]).find((r) => r.id === userId);
    expect(new Date(user.mfa_required_at).getTime()).toBeLessThan(Date.now() - 29 * 86_400_000);
  });

  it('two-factor on: the session is held MFA_REQUIRED, and /two-factor/enable answers (the way forward exists)', async () => {
    const { manager, cookie } = await arrangeHeldMember(true);
    expect((await sessionAuthGate(manager, cookie))?.code).toBe('MFA_REQUIRED');
    const enable = await post(manager, '/two-factor/enable', { password: PASSWORD }, { cookie });
    expect(enable.status, `two-factor/enable: ${await enable.clone().text()}`).toBe(200);
    expect(((await enable.clone().json()) as { totpURI?: string }).totpURI).toMatch(/^otpauth:\/\/totp\//);
  });
});
