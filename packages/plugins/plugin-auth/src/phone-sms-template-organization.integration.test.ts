// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An auth SMS reads its template row in the organization the send resolves to.
 *
 * `sys_notification_template` is organization-owned (ADR-0131: a row is the
 * organization that authored it). The phone OTP and invitation SMS are
 * deployment-level acts whose send callbacks carry no organization, so
 * `AuthManager.renderPhoneSmsBody` hands the resolver the organization that
 * act resolves to, `tenancy.defaultOrgId()` (ADR-0093 D3), and every template
 * read is keyed by it (`phone-sms-texts.ts`, "Which organization's row"):
 *
 *  - `single`: the Default Organization's row decides the text;
 *  - `isolated` and `group`: `defaultOrgId()` is `null`, so no row is read and
 *    the built-in text is sent — no organization's row decides it.
 *
 * Pinned through the real `AuthManager` (the public invitation send and the
 * phone OTP send), the real tenancy service, and a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3) holding two organizations, each of which
 * authored its own rows for both auth topics.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { NotificationTemplate } from '@objectstack/service-messaging';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import { PHONE_SMS_TOPICS, builtinPhoneSmsBody, interpolatePhoneSms } from './phone-sms-texts.js';

const SECRET = 'test-secret-at-least-32-chars-long-24865';
const ORIGIN = 'http://localhost:3000';
const PHONE = '+15550124865';
const CODE = '482913';
const TEMPLATE_OBJECT = 'sys_notification_template';
const SYSTEM = { context: { isSystem: true } } as never;

type Posture = 'single' | 'isolated' | 'group';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()!.destroy(); } catch { /* noop */ }
  }
});

/**
 * A real engine on `posture` holding the Default Organization and one more,
 * each of which authored its own row for both auth SMS topics, and the
 * recipient's account.
 */
async function bootEngine(posture: Posture): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  engine.registry.registerObject(NotificationTemplate as never, '@objectstack/service-messaging');
  await engine.syncSchemas();
  engine.setTenancyPostureProvider(() => posture);

  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' }, SYSTEM);
  await engine.insert('sys_organization', { id: 'org_other', name: 'Other', slug: 'other' }, SYSTEM);
  for (const organization of ['org_default', 'org_other']) {
    for (const topic of [PHONE_SMS_TOPICS.otp, PHONE_SMS_TOPICS.invite]) {
      // Written as that organization's write lands.
      await engine.insert(
        TEMPLATE_OBJECT,
        { topic, channel: 'sms', locale: 'en', body: `${organization} ${topic} {{code}}`, format: 'text', is_active: true },
        { context: { isSystem: true, tenantId: organization } } as never,
      );
    }
  }
  await engine.insert('sys_user', { id: 'usr_recipient', name: 'Recipient', email: 'recipient@example.test', phone_number: PHONE, locale: 'en' }, SYSTEM);
  return engine;
}

/** What each template row is stored with — the fixture's own control. */
async function storedOrganizations(engine: ObjectQL): Promise<string[]> {
  const rows = (await engine.find(TEMPLATE_OBJECT, { fields: ['topic', 'organization_id'] }, SYSTEM)) ?? [];
  return rows.map((r: Record<string, unknown>) => `${String(r.organization_id ?? 'NULL')}:${String(r.topic)}`).sort();
}

/** The real manager over `engine`, with the real tenancy service and an SMS transport that records each body. */
function bootManager(engine: ObjectQL, posture: Posture) {
  const tenancy = createTenancyService({
    requested: posture,
    probeIsolation: () => true,
    getEngine: () => engine,
    logger: { info: () => {}, warn: () => {} },
  });
  const bodies: string[] = [];
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { phoneNumber: true },
    smsService: {
      async send(input: { body: string }) { bodies.push(input.body); return { status: 'sent', messageId: 'm' }; },
      isConfigured: () => true,
    },
    getTenancy: () => tenancy,
  } as never);
  return { manager, bodies, tenancy };
}

/** Both auth SMS sends: the public invitation, and the phone OTP the sign-in callbacks drive. */
async function sendBoth(manager: AuthManager): Promise<void> {
  await manager.sendPhoneInviteSms(PHONE);
  await (manager as unknown as { deliverPhoneOtp(phone: string, code: string): Promise<void> }).deliverPhoneOtp(PHONE, CODE);
}

/** The built-in `en` text for `topic` with every hole open — the invitation's URLs are the manager's own. */
function builtinShape(topic: string): RegExp {
  const escaped = builtinPhoneSmsBody(topic, 'en')
    .split(/\{\{\s*[\w.$]+\s*\}\}/)
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.+')}$`);
}

const EXPECTED_ROWS = [
  `org_default:${PHONE_SMS_TOPICS.invite}`, `org_default:${PHONE_SMS_TOPICS.otp}`,
  `org_other:${PHONE_SMS_TOPICS.invite}`, `org_other:${PHONE_SMS_TOPICS.otp}`,
];

describe("an auth SMS reads its template row in the organization the send resolves to", () => {
  it("single: the Default Organization's row decides the invitation and the OTP text", async () => {
    const engine = await bootEngine('single');
    expect(await storedOrganizations(engine)).toEqual(EXPECTED_ROWS);
    const { manager, bodies, tenancy } = bootManager(engine, 'single');
    expect(await tenancy.defaultOrgId()).toBe('org_default');

    await sendBoth(manager);

    expect(bodies).toEqual([
      `org_default ${PHONE_SMS_TOPICS.invite} `,
      `org_default ${PHONE_SMS_TOPICS.otp} ${CODE}`,
    ]);
  });

  for (const posture of ['isolated', 'group'] as const) {
    it(`${posture}: the built-in text is sent, and no organization's row decides it`, async () => {
      const engine = await bootEngine(posture);
      expect(await storedOrganizations(engine)).toEqual(EXPECTED_ROWS);
      const { manager, bodies, tenancy } = bootManager(engine, posture);
      expect(await tenancy.defaultOrgId()).toBeNull();

      await sendBoth(manager);

      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(
        interpolatePhoneSms(builtinPhoneSmsBody(PHONE_SMS_TOPICS.otp, 'en'), { code: CODE, appName: 'ObjectStack', minutes: 5 }),
      );
      expect(bodies[0]).toMatch(builtinShape(PHONE_SMS_TOPICS.invite));
      for (const body of bodies) expect(body).not.toMatch(/org_default|org_other/);
    });
  }
});
