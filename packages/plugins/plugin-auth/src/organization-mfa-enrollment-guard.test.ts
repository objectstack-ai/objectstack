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
import type { PluginContext } from '@objectstack/core';
import { SysOrganization } from '@objectstack/platform-objects/identity';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin.js';
import {
  ORGANIZATION_MFA_ENROLLMENT_GUARD_PRIORITY,
  ORGANIZATION_MFA_REFUSAL_COPY,
  ORGANIZATION_MFA_REQUIRED_NOTICE_COPY,
  organizationMfaRequiredNotice,
  organizationMfaWithoutEnrollmentRefusal,
  registerOrganizationMfaEnrollmentGuard,
  turnsMfaRequirementOn,
} from './organization-mfa-enrollment-guard.js';
import { resolveMfaGracePeriodDays } from './auth-manager-password-session-policy.js';
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

/**
 * Run every registered handler for `event` over a payload, with the stored row
 * as `previous` when given (the engine binds it on every update path); returns
 * the thrown error, or null.
 */
async function judge(
  enrollable: boolean,
  event: 'beforeInsert' | 'beforeUpdate',
  data: Record<string, unknown>,
  previous?: Record<string, unknown>,
): Promise<any> {
  const engine = captureEngine();
  registerOrganizationMfaEnrollmentGuard(engine, {
    packageId: 'test.organization-mfa-enrollment-guard',
    isTwoFactorEnabled: () => enrollable,
    mfaGracePeriodDays: () => 7,
  });
  try {
    for (const r of engine.registrations.filter((x) => x.event === event)) {
      await r.handler({
        object: 'sys_organization', event, input: { id: 'org_1', data },
        ...(previous ? { previous } : {}),
      });
    }
    return null;
  } catch (e) {
    return e;
  }
}

describe('organization MFA enrollment guard — the rule', () => {
  it('registers insert and update hooks on sys_organization alone, after the D2 identity write guard', () => {
    const engine = captureEngine();
    registerOrganizationMfaEnrollmentGuard(engine, {
      packageId: 'p',
      isTwoFactorEnabled: () => false,
      mfaGracePeriodDays: () => 7,
    });
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

  it('refuses an update that turns it on for a row stored off, and one with no stored row to prove otherwise', async () => {
    expectRequireMfaRefusal(await judge(false, 'beforeUpdate', { require_mfa: true }, { require_mfa: false }));
    expectRequireMfaRefusal(await judge(false, 'beforeUpdate', { require_mfa: true }, { require_mfa: null }));
    expectRequireMfaRefusal(await judge(false, 'beforeUpdate', { require_mfa: true }, { name: 'Acme' }));
    // No `previous` at all: an unproven prior state is judged as a change.
    expectRequireMfaRefusal(await judge(false, 'beforeUpdate', { require_mfa: true }));
  });

  it('admits re-sending it for a row that already stores it on: the write turns nothing on', async () => {
    // A whole-row SDK/MCP update, an import re-run, a save with no change.
    expect(await judge(false, 'beforeUpdate', { require_mfa: true }, { require_mfa: true })).toBeNull();
    expect(await judge(false, 'beforeUpdate', { require_mfa: 1, name: 'Acme' }, { require_mfa: 1 })).toBeNull();
    // An insert has no stored value to keep: a `previous` there changes nothing.
    expectRequireMfaRefusal(await judge(false, 'beforeInsert', { require_mfa: true }, { require_mfa: true }));
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
    // The env var outranks the settings: the settings remedy is offered only where it can work.
    expect(err.message).toMatch(/Unless OS_AUTH_TWO_FACTOR is set to false/);
    expect(err.message).not.toMatch(/#\d/);
    expect(err.fields[0].message).toBe(err.message);
  });
});

describe('auth-plugin registers the guard on `kernel:ready` and asks the live manager', () => {
  it('both hooks on sys_organization, after the D2 guard, judging the manager\'s two-factor state per write', async () => {
    const registered: Array<{ event: string; handler: (ctx: any) => Promise<void>; options: any }> = [];
    const engine = {
      registerHook: (event: string, handler: (ctx: any) => Promise<void>, options: any) => {
        registered.push({ event, handler, options });
      },
      getSchema: () => undefined,
    };
    const ready: Array<() => Promise<void>> = [];
    const ctx = {
      registerService: vi.fn(),
      getService: vi.fn((name: string): any => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'objectql') return engine;
        return undefined;
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn((name: string, handler: () => Promise<void>) => { if (name === 'kernel:ready') ready.push(handler); }),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    } as unknown as PluginContext;
    const plugin = new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long', baseUrl: 'http://localhost:3000' });
    await plugin.init(ctx);
    await plugin.start(ctx);
    for (const handler of ready) {
      try { await handler(); } catch { /* other kernel:ready work needs services this double does not offer */ }
    }

    const ours = registered.filter(
      (r) => r.options?.packageId === 'com.objectstack.plugin-auth.organization-mfa-enrollment-guard',
    );
    expect(ours.map((r) => [r.event, r.options.object, r.options.priority]).sort()).toEqual([
      ['beforeInsert', 'sys_organization', ORGANIZATION_MFA_ENROLLMENT_GUARD_PRIORITY],
      ['beforeUpdate', 'sys_organization', ORGANIZATION_MFA_ENROLLMENT_GUARD_PRIORITY],
    ]);
    const d2 = registered.find(
      (r) => r.event === 'beforeUpdate' && r.options?.packageId === 'com.objectstack.plugin-auth.identity-write-guard',
    );
    expect(ORGANIZATION_MFA_ENROLLMENT_GUARD_PRIORITY).toBeGreaterThan(d2!.options.priority);

    const update = ours.find((r) => r.event === 'beforeUpdate')!;
    const turnOn = () => update.handler({ object: 'sys_organization', input: { id: 'org_1', data: { require_mfa: true } } });
    // The default deployment: two-factor off.
    expectRequireMfaRefusal(await turnOn().then(() => null, (e) => e));
    // The settings pass turns the plugin on (as `auth.mfa_required` does): the next write is admitted.
    (plugin as any).authManager.applyConfigPatch({ plugins: { twoFactor: true } });
    await expect(turnOn()).resolves.toBeUndefined();

    // [#30411] …and its save notice names the grace period the live manager
    // holds, read per write: the settings pass changes it, the next write says so.
    const told: string[] = [];
    const turnOnTold = () => update.handler({
      object: 'sys_organization', input: { id: 'org_1', data: { require_mfa: true } },
      session: { userId: 'usr_admin', locale: 'en-US' }, notice: (m: string) => told.push(m),
    });
    await turnOnTold();
    expect(told).toEqual([organizationMfaRequiredNotice(7, 'en')]);
    (plugin as any).authManager.applyConfigPatch({ mfaGracePeriodDays: 14 });
    await turnOnTold();
    expect(told[1]).toBe(organizationMfaRequiredNotice(14, 'en'));
    expect(told[1]).toMatch(/has 14 days to enroll/);
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
async function bootOrganizationEngine(
  enrollable: { value: boolean },
  graceDays: { value: number } = { value: 7 },
): Promise<ObjectQL> {
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
    mfaGracePeriodDays: () => graceDays.value,
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

  it('admits re-saving a row that already requires MFA, so its other edits are not blocked', async () => {
    const enrollable = { value: true };
    const engine = await bootOrganizationEngine(enrollable);
    await engine.update('sys_organization', { id: 'org_a', require_mfa: true }, ADMIN);
    // Two-factor goes off afterwards (an env pin, a settings change).
    enrollable.value = false;
    // A door that sends the whole editable record re-sends the stored `true`.
    await engine.update('sys_organization', { id: 'org_a', require_mfa: true, timezone: 'Asia/Shanghai' }, ADMIN);
    await engine.update('sys_organization', { id: 'org_a', require_mfa: true }, SYSTEM);
    const row: any = await engine.findOne('sys_organization', { where: { id: 'org_a' }, ...SYSTEM });
    expect(row.timezone).toBe('Asia/Shanghai');
    expect(row.require_mfa).toBe(true);
    // Control: the other row, stored off, is still refused.
    expectRequireMfaRefusal(await caught(engine.update('sys_organization', { id: 'org_b', require_mfa: true }, ADMIN)));
  });

  it('judges a multi-row update row by row: one row turning it on refuses the whole write, with nothing written', async () => {
    const enrollable = { value: true };
    const engine = await bootOrganizationEngine(enrollable);
    await engine.update('sys_organization', { id: 'org_a', require_mfa: true }, ADMIN);
    enrollable.value = false;
    // org_a already requires it, org_b does not: the batch turns it on for org_b.
    expectRequireMfaRefusal(await caught(
      engine.update('sys_organization', { require_mfa: true, timezone: 'UTC' }, { ...SYSTEM, where: {}, multi: true } as any),
    ));
    expect(await storedRequireMfa(engine, 'org_b')).toBe(false);
    const a: any = await engine.findOne('sys_organization', { where: { id: 'org_a' }, ...SYSTEM });
    expect(a.timezone).not.toBe('UTC');
    // Every matched row already requires it: the batch turns nothing on and lands.
    await engine.update('sys_organization', { require_mfa: true, timezone: 'UTC' }, { ...SYSTEM, where: { slug: 'acme' }, multi: true } as any);
    const a2: any = await engine.findOne('sys_organization', { where: { id: 'org_a' }, ...SYSTEM });
    expect(a2.timezone).toBe('UTC');
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

// ── #30411. What the saver is told, in the saver's language ─────────────────

/** The first sentence of each copy: the language is the contract, so the sentence that carries it is pinned. */
const REFUSAL_FIRST = {
  en: 'This organization cannot require multi-factor authentication yet:',
  'zh-CN': '本组织暂时无法强制多因素认证：',
} as const;
const NOTICE_FIRST = {
  en: 'Multi-factor authentication is now required for this organization.',
  'zh-CN': '本组织现已强制多因素认证。',
} as const;

/** Run the guard's hook for `event` with a session locale and a notice listener; the outcome and what it told. */
async function judgeTold(opts: {
  enrollable: boolean;
  event: 'beforeInsert' | 'beforeUpdate';
  data: Record<string, unknown>;
  previous?: Record<string, unknown>;
  locale?: string;
  graceDays?: number;
  noNoticeMember?: boolean;
}): Promise<{ error: any; told: string[] }> {
  const engine = captureEngine();
  registerOrganizationMfaEnrollmentGuard(engine, {
    packageId: 'test.organization-mfa-enrollment-guard',
    isTwoFactorEnabled: () => opts.enrollable,
    mfaGracePeriodDays: () => opts.graceDays ?? 7,
  });
  const told: string[] = [];
  try {
    for (const r of engine.registrations.filter((x) => x.event === opts.event)) {
      await r.handler({
        object: 'sys_organization', event: opts.event, input: { id: 'org_1', data: opts.data },
        ...(opts.previous ? { previous: opts.previous } : {}),
        ...(opts.locale ? { session: { userId: 'usr_admin', locale: opts.locale } } : {}),
        ...(opts.noNoticeMember ? {} : { notice: (m: string) => told.push(m) }),
      });
    }
    return { error: null, told };
  } catch (e) {
    return { error: e, told };
  }
}

describe('#30411 the refusal is in the caller\'s language, with the same field-level shape', () => {
  it('zh-CN: the refusal reads in Chinese and still names the env var and the setting key', () => {
    const err: any = organizationMfaWithoutEnrollmentRefusal('zh-CN');
    expectRequireMfaRefusal(err);
    expect(err.message.startsWith(REFUSAL_FIRST['zh-CN'])).toBe(true);
    expect(err.message).toMatch(/OS_AUTH_TWO_FACTOR=true/);
    expect(err.message).toMatch(/auth\.mfa_required/);
    expect(err.fields[0].message).toBe(err.message);
  });

  it('en: the refusal is the English sentence it was, top level and on the field', () => {
    for (const locale of ['en', 'en-US', undefined]) {
      const err: any = organizationMfaWithoutEnrollmentRefusal(locale);
      expectRequireMfaRefusal(err);
      expect(err.message.startsWith(REFUSAL_FIRST.en)).toBe(true);
      expect(err.message).toBe(ORGANIZATION_MFA_REFUSAL_COPY.en);
      expect(err.fields[0].message).toBe(err.message);
    }
  });

  it.each([
    ['zh', 'zh-CN'], ['zh-cn', 'zh-CN'], ['zh-Hans-CN', 'zh-CN'], ['ja', 'ja-JP'], ['es-MX', 'es-ES'],
    ['fr-FR', 'en'], ['', 'en'],
  ] as const)('the request locale %j reads the %s copy (exact, then by language, else English)', (asked, served) => {
    expect((organizationMfaWithoutEnrollmentRefusal(asked) as any).message).toBe(ORGANIZATION_MFA_REFUSAL_COPY[served]);
  });

  it('every language names what an operator types, and carries no tracker number', () => {
    for (const [locale, message] of Object.entries(ORGANIZATION_MFA_REFUSAL_COPY)) {
      expect(message, locale).toMatch(/OS_AUTH_TWO_FACTOR=true/);
      expect(message, locale).toMatch(/OS_AUTH_TWO_FACTOR .*false|false.*OS_AUTH_TWO_FACTOR/);
      expect(message, locale).toMatch(/auth\.mfa_required/);
      expect(message, locale).not.toMatch(/#\d/);
      expectRequireMfaRefusal(organizationMfaWithoutEnrollmentRefusal(locale));
    }
  });

  it('the hook answers in the session\'s locale, and in English for a write with no caller locale', async () => {
    for (const event of ['beforeInsert', 'beforeUpdate'] as const) {
      const zh = await judgeTold({ enrollable: false, event, data: { require_mfa: true }, locale: 'zh-CN' });
      expectRequireMfaRefusal(zh.error);
      expect(zh.error.message.startsWith(REFUSAL_FIRST['zh-CN'])).toBe(true);
      expect(zh.told, 'a refused write tells no notice').toEqual([]);
      const none = await judgeTold({ enrollable: false, event, data: { require_mfa: true } });
      expectRequireMfaRefusal(none.error);
      expect(none.error.message.startsWith(REFUSAL_FIRST.en)).toBe(true);
    }
  });
});

describe('#30411 an admitted turn-on answers the grace period in force as its save notice', () => {
  it('turning it on (insert, or update of a row stored off) tells who must enroll and the grace period, once', async () => {
    for (const [event, previous] of [
      ['beforeInsert', undefined],
      ['beforeUpdate', { require_mfa: false }],
      ['beforeUpdate', undefined],
    ] as const) {
      const out = await judgeTold({ enrollable: true, event, data: { require_mfa: true }, previous, graceDays: 30 });
      expect(out.error).toBeNull();
      expect(out.told).toEqual([organizationMfaRequiredNotice(30, 'en')]);
      expect(out.told[0].startsWith(NOTICE_FIRST.en)).toBe(true);
      expect(out.told[0]).toMatch(/has 30 days to enroll/);
    }
  });

  it('zh-CN: the notice reads in Chinese and names the configured days', async () => {
    const out = await judgeTold({
      enrollable: true, event: 'beforeUpdate', data: { require_mfa: true }, previous: { require_mfa: false },
      locale: 'zh-CN', graceDays: 14,
    });
    expect(out.told).toHaveLength(1);
    expect(out.told[0].startsWith(NOTICE_FIRST['zh-CN'])).toBe(true);
    expect(out.told[0]).toMatch(/有 14 天时间完成绑定/);
  });

  it('a grace period of 0 and of 1 day get their own sentence in every language', () => {
    for (const [locale, copy] of Object.entries(ORGANIZATION_MFA_REQUIRED_NOTICE_COPY)) {
      expect(copy(0), locale).toMatch(/\b0\b/);
      expect(copy(0), locale).not.toBe(copy(1));
      expect(copy(1), locale).toMatch(/\b1\b/);
      expect(copy(45), locale).toMatch(/\b45\b/);
      expect(copy(45), locale).not.toMatch(/#\d/);
    }
    expect(ORGANIZATION_MFA_REQUIRED_NOTICE_COPY.en(1)).toMatch(/has 1 day to enroll/);
    expect(ORGANIZATION_MFA_REQUIRED_NOTICE_COPY.en(0)).toMatch(/blocked from data the next time they use the app/);
  });

  it('says nothing for a write that turns nothing on', async () => {
    for (const event of ['beforeInsert', 'beforeUpdate'] as const) {
      for (const data of [{ require_mfa: false }, { timezone: 'Asia/Shanghai' }, { name: 'Acme' }]) {
        const out = await judgeTold({ enrollable: true, event, data });
        expect(out, `${event} ${JSON.stringify(data)}`).toEqual({ error: null, told: [] });
      }
    }
    // A re-save of a stored `true` (a whole-row door, an import re-run).
    const resave = await judgeTold({
      enrollable: true, event: 'beforeUpdate', data: { require_mfa: true }, previous: { require_mfa: true },
    });
    expect(resave).toEqual({ error: null, told: [] });
  });

  it('a dispatch with no notice member is admitted all the same', async () => {
    const out = await judgeTold({ enrollable: true, event: 'beforeInsert', data: { require_mfa: true }, noNoticeMember: true });
    expect(out).toEqual({ error: null, told: [] });
  });
});

describe('#30411 on a real engine: the caller\'s locale reaches the refusal, the notice reaches the write\'s answer', () => {
  const zhAdmin = { context: { ...ADMIN.context, locale: 'zh-CN' } };

  it('refuses the zh-CN administrator\'s save in Chinese, envelope unchanged, and the row keeps its value', async () => {
    const engine = await bootOrganizationEngine({ value: false });
    const err = await caught(engine.update('sys_organization', { id: 'org_a', require_mfa: true }, zhAdmin));
    expectRequireMfaRefusal(err);
    expect(err.message.startsWith(REFUSAL_FIRST['zh-CN'])).toBe(true);
    expect(await storedRequireMfa(engine, 'org_a')).toBe(false);
    // Control: the same write with no caller locale reads English.
    const en = await caught(engine.update('sys_organization', { id: 'org_a', require_mfa: true }, ADMIN));
    expect(en.message.startsWith(REFUSAL_FIRST.en)).toBe(true);
  });

  it('the admitted save hands its listener the notice, with the grace period read per write', async () => {
    const grace = { value: 21 };
    const engine = await bootOrganizationEngine({ value: true }, grace);
    const told: string[] = [];
    await engine.update('sys_organization', { id: 'org_a', require_mfa: true }, {
      ...zhAdmin, onNotice: (m: string) => told.push(m),
    } as any);
    expect(await storedRequireMfa(engine, 'org_a')).toBe(true);
    expect(told).toEqual([organizationMfaRequiredNotice(21, 'zh-CN')]);
    // The setting changes; the next write that turns it on names the new number.
    grace.value = 3;
    await engine.insert('sys_organization', { id: 'org_c', name: 'Cove', slug: 'cove', require_mfa: true }, {
      ...ADMIN, onNotice: (m: string) => told.push(m),
    } as any);
    expect(told[1]).toBe(organizationMfaRequiredNotice(3, 'en'));
    // A re-save of the stored `true` answers no notice.
    await engine.update('sys_organization', { id: 'org_a', require_mfa: true, timezone: 'UTC' }, {
      ...ADMIN, onNotice: (m: string) => told.push(m),
    } as any);
    expect(told).toHaveLength(2);
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
 * the card's measured state, on a deployment with two-factor on or off, and a
 * grace period of `graceDays` (7 unless a case says otherwise).
 */
async function arrangeHeldMember(twoFactor: boolean, graceDays: number | undefined = 7) {
  const engine: any = createMemoryEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    ...(graceDays === undefined ? {} : { mfaGracePeriodDays: graceDays }),
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

describe('#30411 the grace period the notice names is the one the gate holds to', () => {
  it.each([
    [undefined, 7], [0, 0], [14, 14], [2.9, 2], [-3, 0], [120, 120],
  ] as const)('resolveMfaGracePeriodDays(%j) = %j, the reading the gate\'s clock always took', (configured, days) => {
    expect(resolveMfaGracePeriodDays({ mfaGracePeriodDays: configured as number | undefined })).toBe(days);
  });

  it.each([
    [40, false], [20, true], [undefined, true],
  ] as const)('grace %j days, clock started 30 days ago: held = %j, and the manager answers the same number', async (graceDays, held) => {
    const { manager, userId } = await arrangeHeldMember(true, graceDays);
    expect(manager.getMfaGracePeriodDays()).toBe(graceDays ?? 7);
    const gates = await manager.resolveUserAuthGates(userId, { organizationId: ORG });
    expect(gates.some((g) => g.code === 'MFA_REQUIRED')).toBe(held);
  });
});
