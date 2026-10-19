// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15597] The fourteen `{ records }` / `{ data }` union-normalizer blocks this
 * package carried, and the shape each one's REAL engine actually returns.
 *
 * ## What was removed, and why a test is owed for it
 *
 * Every block looked like `Array.isArray(x) ? x : x.records ?? []` (four of them
 * in the guard-clause spelling, one on a `data` limb). The envelope limb was
 * dead: nothing in this tree ever produced that shape. But "dead" is a claim
 * about RUNTIME, and the declared type cannot establish it — `IDataEngine.find`
 * is declared `Promise<any[]>` and #13706 is this repo's own counter-example of
 * a `find()` that did not resolve to an array. So the limbs were removed on a
 * MEASUREMENT, and these cases are that measurement, kept.
 *
 * ## The measurement
 *
 * All fourteen blocks read the same concrete engine: the `ObjectQL` instance the
 * kernel registers as the `objectql` / `data` service (`auth-plugin.ts` resolves
 * it with `ctx.getService('objectql')`; `AuthManager` reads it through
 * `withSystemReadContext`, which forwards `find` without touching its result).
 * Each case below boots a REAL `ObjectQL` over a REAL `SqlDriver`, issues the
 * exact read its block issues, and pins that the answer is a bare array —
 * populated AND empty, because an empty read answering `[]` rather than a
 * nullish value is half of why the limb was unreachable.
 *
 * ## Why these cases are not vacuous
 *
 * `expect(Array.isArray(x)).toBe(true)` is the kind of assertion that can pass
 * because nothing could have made it fail. It could have here: `ObjectQL.find`
 * returned `hookContext.result` on its hook path, so an `afterFind` handler
 * COULD replace the result with an envelope — measured, not supposed. Since
 * #15823 the engine refuses that replacement (`FIND_HOOK_RESULT_NOT_ARRAY`), so
 * the control case at the bottom now drives the same handler and asserts the
 * REFUSAL, and checks `expectBareArray`'s discrimination directly. That is also
 * the reason removal is right rather than merely safe:
 * a hook that corrupted `find()` into `{ records }` would be a contract
 * violation, and the limb did not repair it — it silently absorbed it at these
 * fourteen sites while this package's remaining `find()` call sites broke anyway
 * (47 `.find(` sites in its non-test source in total, a count that already
 * includes `Array#find`). Fourteen sites of false immunity is worse than one
 * visible failure.
 *
 * ## The fifteenth case is a different defect
 *
 * `settleSelfRegistrationGrant` also carried the silent-DROP shape, and commit
 * 9e9f03abe fixed it in the OPPOSITE direction; ADR-0131 D4 then retired the
 * row read itself — see the last `describe` in the file.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { FIND_HOOK_RESULT_NOT_ARRAY_CODE, ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { withSystemReadContext } from './objectql-adapter.js';
import { probeHumanUsersPresence, probeSignInAccountsPresence } from './boot-sign-in-reachability.js';
import { decideDevAdminSeedGate } from './dev-admin-seed-gate.js';
import { resolvePhoneSmsTemplateBody } from './phone-sms-texts.js';
import { resolveDefaultOrgId } from './tenancy-service.js';
import { probeAccountIdentityCollisions } from './account-identity-preflight.js';
import { canonicalizeStoredMemberRoles } from './member-role-canonical.js';

const SECRET = 'test-secret-at-least-32-chars-long-15597';
const SYSTEM = { context: { isSystem: true } } as never;
const SYSTEM_CTX = { isSystem: true };

/**
 * Two objects the auth manifest does not declare, spelled with only the columns
 * the blocks under test read — the `sso-register-platform-admin-gate` /
 * `signup-existing-address-refusal` precedent, so a fixture adds no dependency
 * edge to plugin-auth.
 */
const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    label: { name: 'label', type: 'text' as const },
    active: { name: 'active', type: 'boolean' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
  },
};

const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    // [ADR-0131 D4] The grant's set by NAME, which `settleSelfRegistrationGrant`
    // writes alone; undeclared, the engine refuses that insert.
    permission_set: { name: 'permission_set', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
  },
};

const sysNotificationTemplate = {
  name: 'sys_notification_template',
  label: 'Notification Template',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    topic: { name: 'topic', type: 'text' as const },
    channel: { name: 'channel', type: 'text' as const },
    locale: { name: 'locale', type: 'text' as const },
    body: { name: 'body', type: 'text' as const },
    is_active: { name: 'is_active', type: 'boolean' as const },
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
  engine.registry.registerObject(sysUserPermissionSet as never, '@objectstack/plugin-security');
  engine.registry.registerObject(sysNotificationTemplate as never, '@objectstack/service-messaging');
  await engine.syncSchemas();
  return engine;
}

/** One row per object every block below reads, so the POPULATED path is driven. */
async function seedAll(engine: ObjectQL): Promise<void> {
  await engine.insert('sys_user', { id: 'usr_1', name: 'Alice', email: 'alice@corp.example' }, SYSTEM);
  await engine.insert('sys_organization', { id: 'org_1', name: 'Default', slug: 'default' }, SYSTEM);
  await engine.insert('sys_member', { id: 'mem_1', user_id: 'usr_1', organization_id: 'org_1', role: 'member' }, SYSTEM);
  await engine.insert('sys_account', { id: 'acc_1', user_id: 'usr_1', provider_id: 'credential', account_id: 'alice@corp.example' }, SYSTEM);
  await engine.insert('sys_invitation', { id: 'inv_1', email: 'alice@corp.example', status: 'pending', organization_id: 'org_1', inviter_id: 'usr_1', expires_at: new Date(Date.now() + 86_400_000).toISOString() }, SYSTEM);
  await engine.insert('sys_permission_set', { id: 'ps_1', name: 'member_default', label: 'Member' }, SYSTEM);
  await engine.insert('sys_user_permission_set', { id: 'ups_1', user_id: 'usr_1', permission_set_id: 'ps_1' }, SYSTEM);
  await engine.insert('sys_notification_template', { id: 'nt_1', topic: 'otp', channel: 'sms', locale: 'en', body: 'code {{code}}', is_active: true }, SYSTEM);
}

/**
 * The assertion every shape pin makes.
 *
 * Both halves matter. `Array.isArray` is the limb's own test, so pinning it
 * pins exactly the branch that was removed; the key check states the positive
 * fact the deleted code claimed was possible, so a future envelope fails HERE
 * with a readable message rather than somewhere downstream.
 */
function expectBareArray(value: unknown, label: string): void {
  expect(Array.isArray(value), `${label}: expected a bare array, got ${JSON.stringify(value)}`).toBe(true);
  expect(value === null || typeof value !== 'object' || !('records' in (value as object)), `${label}: carries a 'records' envelope`).toBe(true);
  expect(value === null || typeof value !== 'object' || !('data' in (value as object)), `${label}: carries a 'data' envelope`).toBe(true);
}

/**
 * The blocks, each paired with the read it performs — thirteen since B4's read
 * (`findPermissionSetRows`) was retired with the grant's id (ADR-0131 D4) — same object,
 * same query, same call facade (`withSystemReadContext` for the `AuthManager`
 * blocks; the three-argument `ql.find(o, q, { context })` for the standalone
 * migration/probe modules; the context-inside-the-query form for
 * `phone-sms-texts`, which is the only block that spells it that way).
 */
const BLOCKS: Array<{
  id: string;
  site: string;
  populated: (engine: ObjectQL) => Promise<unknown>;
  empty: (engine: ObjectQL) => Promise<unknown>;
}> = [
  {
    id: 'B1  isBootstrapCreation',
    site: 'auth-manager.ts — sys_user page probe',
    populated: (e) => (withSystemReadContext(e) as never as { find: Function }).find('sys_user', { limit: 50 }),
    empty: (e) => (withSystemReadContext(e) as never as { find: Function }).find('sys_user', { where: { email: 'nobody@nowhere' }, limit: 50 }),
  },
  {
    id: 'B2  hasPendingInvitationFor',
    site: 'auth-manager.ts — sys_invitation paged probe',
    populated: (e) => (withSystemReadContext(e) as never as { find: Function }).find('sys_invitation', { where: { status: 'pending', email: 'alice@corp.example' }, limit: 100 }),
    // The second page: the `offset` arm the loop only sends past page one.
    empty: (e) => (withSystemReadContext(e) as never as { find: Function }).find('sys_invitation', { where: { status: 'pending', email: 'alice@corp.example' }, limit: 100, offset: 100 }),
  },
  {
    id: 'B3  hasExistingUserFor',
    site: 'auth-manager.ts — #15738 uniqueness probe',
    populated: (e) => (withSystemReadContext(e) as never as { find: Function }).find('sys_user', { where: { email: 'alice@corp.example' }, limit: 50 }),
    empty: (e) => (withSystemReadContext(e) as never as { find: Function }).find('sys_user', { where: { email: 'ghost@corp.example' }, limit: 50 }),
  },
  {
    id: 'B5  settleSelfRegistrationGrant',
    site: 'auth-manager.ts — sys_user_permission_set existence read',
    populated: (e) => (withSystemReadContext(e) as never as { find: Function }).find('sys_user_permission_set', { where: { user_id: 'usr_1', permission_set_id: 'ps_1' }, limit: 1 }),
    empty: (e) => (withSystemReadContext(e) as never as { find: Function }).find('sys_user_permission_set', { where: { user_id: 'ghost', permission_set_id: 'ps_1' }, limit: 1 }),
  },
  {
    id: 'B6  ensureDefaultOrganization.tryFind',
    site: 'ensure-default-organization.ts',
    populated: (e) => (e as never as { find: Function }).find('sys_organization', { where: { slug: 'default' }, limit: 100 }, { context: SYSTEM_CTX }),
    empty: (e) => (e as never as { find: Function }).find('sys_organization', { where: { slug: 'ghost' }, limit: 100 }, { context: SYSTEM_CTX }),
  },
  {
    id: 'B7  tenancy-service.findRows',
    site: 'tenancy-service.ts',
    populated: (e) => (e as never as { find: Function }).find('sys_organization', { where: { slug: 'default' }, limit: 1 }, { context: SYSTEM_CTX }),
    empty: (e) => (e as never as { find: Function }).find('sys_organization', { where: { slug: 'ghost' }, limit: 1 }, { context: SYSTEM_CTX }),
  },
  {
    id: 'B8  reconcile-membership.findRows',
    site: 'reconcile-membership.ts',
    populated: (e) => (e as never as { find: Function }).find('sys_member', { where: { user_id: 'usr_1' }, limit: 1 }, { context: SYSTEM_CTX }),
    empty: (e) => (e as never as { find: Function }).find('sys_member', { where: { user_id: 'ghost' }, limit: 1 }, { context: SYSTEM_CTX }),
  },
  {
    // [#17440] `backfill-account-issuer.ts` retired with the issuer column it
    // stamped. The `sys_account` read it measured did not: the successor site
    // is the retirement preflight, which reads the same object and — being the
    // answer that authorises an irreversible drop — REFUSES a non-array rather
    // than absorbing it. Same measurement, higher stakes.
    id: 'B9  probeAccountIdentityCollisions',
    site: 'account-identity-preflight.ts',
    populated: (e) => (e as never as { find: Function }).find('sys_account', { where: { provider_id: 'credential' }, limit: 5000 }, { context: SYSTEM_CTX }),
    empty: (e) => (e as never as { find: Function }).find('sys_account', { where: { provider_id: 'ghost' }, limit: 5000 }, { context: SYSTEM_CTX }),
  },
  {
    id: 'B10 canonicalizeStoredMemberRoles',
    site: 'member-role-canonical.ts',
    populated: (e) => (e as never as { find: Function }).find('sys_member', { limit: 5000 }, { context: SYSTEM_CTX }),
    empty: (e) => (e as never as { find: Function }).find('sys_member', { where: { user_id: 'ghost' }, limit: 5000 }, { context: SYSTEM_CTX }),
  },
  {
    id: 'B11 decideDevAdminSeedGate.asRows',
    site: 'dev-admin-seed-gate.ts',
    populated: (e) => (e as never as { find: Function }).find('sys_account', { where: { provider_id: 'credential' }, limit: 1 }, { context: SYSTEM_CTX }),
    empty: (e) => (e as never as { find: Function }).find('sys_account', { where: { user_id: 'ghost' }, limit: 1 }, { context: SYSTEM_CTX }),
  },
  {
    id: 'B12 probeWalledOwnerAccountState.asRows',
    site: 'walled-owner-verification-path.ts',
    populated: (e) => (e as never as { find: Function }).find('sys_user', { where: { email: 'alice@corp.example' }, limit: 5 }, { context: SYSTEM_CTX }),
    empty: (e) => (e as never as { find: Function }).find('sys_user', { where: { email: 'ghost@corp.example' }, limit: 5 }, { context: SYSTEM_CTX }),
  },
  {
    id: 'B13 probeHumanUsersPresence.asRows',
    site: 'boot-sign-in-reachability.ts',
    populated: (e) => (e as never as { find: Function }).find('sys_user', { limit: 50 }, { context: SYSTEM_CTX }),
    empty: (e) => (e as never as { find: Function }).find('sys_account', { where: { user_id: 'ghost' }, limit: 1 }, { context: SYSTEM_CTX }),
  },
  {
    id: 'B14 phone-sms-texts.rowsOf',
    site: 'phone-sms-texts.ts — the `data`-limb block',
    populated: (e) => (e as never as { find: Function }).find('sys_notification_template', { where: { topic: 'otp', channel: 'sms', locale: 'en', is_active: true }, limit: 1, context: SYSTEM_CTX }),
    empty: (e) => (e as never as { find: Function }).find('sys_notification_template', { where: { topic: 'ghost' }, limit: 1, context: SYSTEM_CTX }),
  },
];

describe('#15597 — the concrete shape each removed limb was guarding against', () => {
  for (const block of BLOCKS) {
    it(`${block.id}: its real engine read answers a bare array, populated and empty (${block.site})`, async () => {
      const engine = await bootEngine();
      await seedAll(engine);

      const populated = await block.populated(engine);
      expectBareArray(populated, `${block.id} populated`);
      expect((populated as unknown[]).length, `${block.id}: the populated read found no row, so it proved nothing`).toBeGreaterThan(0);

      // The empty read is the other half of why the limb was unreachable: it
      // answers `[]`, never `null`/`undefined`, so the `: []` tail never ran either.
      const empty = await block.empty(engine);
      expectBareArray(empty, `${block.id} empty`);
      expect((empty as unknown[]).length).toBe(0);
    });
  }
});

describe('#15597 — the control: these pins CAN go red', () => {
  /**
   * The discrimination check for all fourteen cases above, and the reason the
   * removal argument is about hooks rather than about drivers.
   *
   * ## What this control asserted before #15823, and why it changed
   *
   * `ObjectQL.find` used to end with `return hookContext.result` on its hook
   * path with nothing re-checking the value, so an `afterFind` handler
   * assigning a non-array made `find()` resolve to one — and this case drove
   * exactly that, asserting every pin above it went red. That was a real
   * measurement, and it is what made `expectBareArray` an assertion rather than
   * a tautology.
   *
   * #15823 ruled that seam shut (maintainer, 2026-09-06, direction 1):
   * `find()` GUARANTEES the array, and a handler that replaces the container is
   * refused at the engine with `FIND_HOOK_RESULT_NOT_ARRAY`. So the mutation
   * below no longer produces an envelope at these fourteen sites — it produces
   * a refusal, which is a STRONGER statement of the same fact and is asserted
   * as such here.
   *
   * ⛔ #15597's own conclusion is untouched by that. Its argument was that the
   * fourteen limbs were right to remove *even given* an open seam — fourteen
   * sites of false immunity being worse than one visible failure — and closing
   * the seam only removes the "reachable in principle" caveat a reviewer used
   * to have to pay. The limbs stay removed for the reason they were removed.
   *
   * ## The two jobs, kept
   *
   * (1) the mechanism is really gone — driven, on every one of the fourteen
   * real reads, through their real production entry points; and (2)
   * `expectBareArray` really discriminates — asserted directly, since no engine
   * can hand it an envelope any more.
   */
  it('an afterFind hook that returns an envelope is now REFUSED at every one of the reads', async () => {
    const engine = await bootEngine();
    await seedAll(engine);

    (engine as never as { registerHook: Function }).registerHook(
      'afterFind',
      (ctx: { result: unknown }) => {
        ctx.result = { records: [{ id: 'ENVELOPE' }] };
      },
      { packageId: 'test.15597-control' },
    );

    /** Blocks that answered a value instead of refusing — must be empty. */
    const answered: Array<{ id: string; value: unknown }> = [];
    /** Blocks that refused with some OTHER error — must be empty. */
    const otherError: Array<{ id: string; code: unknown; message: string }> = [];
    const refused: string[] = [];

    for (const block of BLOCKS) {
      try {
        answered.push({ id: block.id, value: await block.populated(engine) });
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (code === FIND_HOOK_RESULT_NOT_ARRAY_CODE) {
          refused.push(block.id);
          // The refusal names the seam it is about — the ruling's own
          // requirement, checked here on a real production read rather than
          // only on the engine's own unit harness.
          expect((error as Error).message, `${block.id}: message does not name the event`).toContain('afterFind');
        } else {
          otherError.push({ id: block.id, code, message: String((error as Error)?.message) });
        }
      }
    }

    expect(answered, 'a read answered under the replaced container instead of refusing').toEqual([]);
    expect(otherError, 'a read refused for some other reason — this control is measuring the wrong thing').toEqual([]);
    expect(refused, 'every block must refuse').toEqual(BLOCKS.map((b) => b.id));
  });

  it('expectBareArray still discriminates — it rejects the envelope the engine can no longer produce', () => {
    // Job (2), now that no engine can supply the input: the helper the fourteen
    // pins call is exercised against the exact shape the removed limbs claimed
    // to defend against, plus the `{ data }` spelling one of them used. Without
    // this the pins above would once again be assertions nothing was ever seen
    // to fail.
    for (const envelope of [{ records: [{ id: 'ENVELOPE' }] }, { data: [{ id: 'ENVELOPE' }] }, null, 'rows']) {
      expect(
        () => expectBareArray(envelope, 'control'),
        `expectBareArray accepted ${JSON.stringify(envelope)} — it does not discriminate`,
      ).toThrow();
    }
    // …and passes the shape it is meant to pass, so the check above is not
    // simply a helper that throws on everything.
    expect(() => expectBareArray([{ id: 'r1' }], 'control')).not.toThrow();
  });
});

describe('#15597 — the blocks driven through their real production entry points', () => {
  it('boot-sign-in-reachability answers present/absent off the bare array (B13)', async () => {
    const engine = await bootEngine();
    expect(await probeHumanUsersPresence(engine as never)).toBe('absent');
    expect(await probeSignInAccountsPresence(engine as never)).toBe('absent');
    await seedAll(engine);
    expect(await probeHumanUsersPresence(engine as never)).toBe('present');
    expect(await probeSignInAccountsPresence(engine as never)).toBe('present');
  });

  it('dev-admin-seed-gate reads the credential store off the bare array (B11)', async () => {
    const engine = await bootEngine();
    expect(await decideDevAdminSeedGate(engine as never, 'admin@objectos.ai')).toEqual({ act: true });
    await seedAll(engine);
    // A local `credential` account now exists, so the seed declines.
    expect(await decideDevAdminSeedGate(engine as never, 'admin@objectos.ai')).toEqual({
      act: false,
      reason: 'local-login-exists',
    });
  });

  it('phone-sms template read reads the bare array (B14, the `data` limb)', async () => {
    const engine = await bootEngine();
    await seedAll(engine);
    expect(await resolvePhoneSmsTemplateBody(engine as never, 'otp', 'en')).toBe('code {{code}}');
    // No row and no built-in text for the topic: the built-in walk's empty
    // floor, not a row invented from a misread envelope. (The seeder's
    // existence read, this site's second `rowsOf` call, retired with the seed.)
    expect(await resolvePhoneSmsTemplateBody(engine as never, 'nosuchtopic', 'en')).toBe('');
  });

  it('tenancy resolveDefaultOrgId reads the bare array (B7)', async () => {
    const engine = await bootEngine();
    expect(await resolveDefaultOrgId(engine)).toBeNull();
    await seedAll(engine);
    expect(await resolveDefaultOrgId(engine)).toBe('org_1');
  });

  it('probeAccountIdentityCollisions and canonicalizeStoredMemberRoles scan the bare array (B9, B10)', async () => {
    const engine = await bootEngine();
    await seedAll(engine);
    const probe = await probeAccountIdentityCollisions(engine as never);
    expect(probe.scanned).toBeGreaterThan(0);
    const canon = await canonicalizeStoredMemberRoles(engine);
    // One membership row was seeded, and the scan saw it — the count comes
    // straight off the array the removed limb used to normalise.
    expect(canon.scanned).toBe(1);
  });

});

/**
 * ## The fifteenth block, retired with its read
 *
 * `settleSelfRegistrationGrant` once picked a `sys_permission_set` row to take
 * the grant's id from, and commit 9e9f03abe made it refuse a malformed row
 * rather than drop it (B4 was that row read). [ADR-0131 D4] The grant now
 * names its set and reads no `sys_permission_set` row at all, so there is no
 * candidate row to drop, malformed or otherwise — pinned below. The grant is
 * owned by the membership it settles with (D3), so the case binds one first.
 */
describe('[ADR-0131 D4] settleSelfRegistrationGrant names the set and reads no sys_permission_set row', () => {
  const USER = { id: 'usr_new', name: 'New Person', email: 'new@corp.example' };

  it('grants by name even where the only row of that name is malformed, and stamps the resolved organization', async () => {
    const engine = await bootEngine();
    await engine.insert('sys_user', USER, SYSTEM);
    await engine.insert('sys_organization', { id: 'org_1', name: 'Default', slug: 'default' }, SYSTEM);
    await engine.insert('sys_permission_set', { id: '', name: 'portal_user', label: 'Org scoped', organization_id: 'org_1' }, SYSTEM);
    const lines: string[] = [];
    const manager = new AuthManager({
      secret: SECRET,
      baseUrl: 'http://localhost:3000',
      dataEngine: engine as never,
      getTenancy: () => ({ defaultOrgId: async () => 'org_1' }),
      logger: { error: (m: string) => lines.push(String(m)), warn: (m: string) => lines.push(String(m)), info: () => {} },
    } as never);
    (manager as never as { stageSelfRegistrationGrant: Function }).stageSelfRegistrationGrant(USER.email, 'portal_user');
    // The `user.create.after` order: the reconciler binds the Default
    // Organization, then the grant settles with that membership (ADR-0131 D3).
    await (manager as never as { settleMembership: Function }).settleMembership(USER.id);
    await (manager as never as { settleSelfRegistrationGrant: Function }).settleSelfRegistrationGrant(USER);

    const rows = (await engine.find('sys_user_permission_set', { limit: 100 }, SYSTEM)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r.user_id, r.permission_set, r.permission_set_id ?? null, r.organization_id])).toEqual([
      ['usr_new', 'portal_user', null, 'org_1'],
    ]);
    expect(lines).toEqual([]);
  });
});
