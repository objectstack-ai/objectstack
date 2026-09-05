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
 * returns `hookContext.result` on its hook path, so an `afterFind` handler CAN
 * replace the result with an envelope — measured, not supposed (see the control
 * case at the bottom, which drives exactly that and asserts every pin above it
 * goes red). That is also the reason removal is right rather than merely safe:
 * a hook that corrupted `find()` into `{ records }` would be a contract
 * violation, and the limb did not repair it — it silently absorbed it at these
 * fourteen sites while this package's remaining `find()` call sites broke anyway
 * (47 `.find(` sites in its non-test source in total, a count that already
 * includes `Array#find`). Fourteen sites of false immunity is worse than one
 * visible failure.
 *
 * ## The fifteenth case is a different defect
 *
 * `settleSelfRegistrationGrant` also carried #15092's DROP shape, and it is
 * fixed in the OPPOSITE direction — see the `describe` at the end of the file.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { withSystemReadContext } from './objectql-adapter.js';
import { probeHumanUsersPresence, probeSignInAccountsPresence } from './boot-sign-in-reachability.js';
import { decideDevAdminSeedGate } from './dev-admin-seed-gate.js';
import { loadPhoneSmsTemplateBody, seedPhoneSmsTemplates } from './phone-sms-texts.js';
import { resolveDefaultOrgId } from './tenancy-service.js';
import { backfillAccountIssuer } from './backfill-account-issuer.js';
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
 * The fourteen blocks, each paired with the read it performs — same object,
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
    id: 'B4  findPermissionSetRows',
    site: 'auth-manager.ts — sys_permission_set by name',
    populated: (e) => (withSystemReadContext(e) as never as { find: Function }).find('sys_permission_set', { where: { name: 'member_default' }, limit: 50 }),
    empty: (e) => (withSystemReadContext(e) as never as { find: Function }).find('sys_permission_set', { where: { name: 'ghost' }, limit: 50 }),
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
    id: 'B9  backfillAccountIssuer.tryFind',
    site: 'backfill-account-issuer.ts',
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
   * `ObjectQL.find` ends with `return hookContext.result` on its hook path, so
   * an `afterFind` handler that assigns a non-array makes `find()` resolve to
   * one. Nothing in this tree does that — the only registered `afterFind` in
   * the repo is plugin-audit's read recorder, which never touches `ctx.result`
   * — but the mechanism EXISTS, which is what makes `expectBareArray` a real
   * assertion instead of a tautology.
   */
  it('an afterFind hook that returns an envelope turns every shape pin red', async () => {
    const engine = await bootEngine();
    await seedAll(engine);

    (engine as never as { registerHook: Function }).registerHook(
      'afterFind',
      (ctx: { result: unknown }) => {
        ctx.result = { records: [{ id: 'ENVELOPE' }] };
      },
      { packageId: 'test.15597-control' },
    );

    const survivors: string[] = [];
    for (const block of BLOCKS) {
      const value = await block.populated(engine);
      // Under the mutation the read really does answer an envelope…
      expect(Array.isArray(value), `${block.id}: the hook did not take effect`).toBe(false);
      // …and the pin's own assertion rejects it.
      try {
        expectBareArray(value, block.id);
        survivors.push(block.id);
      } catch {
        /* expected: the pin discriminates */
      }
    }
    expect(survivors, 'these pins passed on an envelope — they do not discriminate').toEqual([]);
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

  it('phone-sms template load + seed read the bare array (B14, the `data` limb)', async () => {
    const engine = await bootEngine();
    await seedAll(engine);
    expect(await loadPhoneSmsTemplateBody(engine as never, 'otp', 'en')).toBe('code {{code}}');
    expect(await loadPhoneSmsTemplateBody(engine as never, 'nosuchtopic', 'en')).toBeNull();
    // The seeder's existence read is the second `rowsOf` call site: the row
    // above is already present, so it must not be duplicated.
    await seedPhoneSmsTemplates(engine as never);
    const rows = await engine.find('sys_notification_template', { where: { topic: 'otp', channel: 'sms', locale: 'en' }, limit: 100 }, SYSTEM);
    expect((rows as unknown[]).length).toBe(1);
  });

  it('tenancy resolveDefaultOrgId reads the bare array (B7)', async () => {
    const engine = await bootEngine();
    expect(await resolveDefaultOrgId(engine)).toBeNull();
    await seedAll(engine);
    expect(await resolveDefaultOrgId(engine)).toBe('org_1');
  });

  it('backfillAccountIssuer and canonicalizeStoredMemberRoles scan the bare array (B9, B10)', async () => {
    const engine = await bootEngine();
    await seedAll(engine);
    const backfill = await backfillAccountIssuer(engine);
    expect(backfill.scanned).toBeGreaterThan(0);
    const canon = await canonicalizeStoredMemberRoles(engine);
    // One membership row was seeded, and the scan saw it — the count comes
    // straight off the array the removed limb used to normalise.
    expect(canon.scanned).toBe(1);
  });

  it('AuthManager.findPermissionSetRows reads the bare array (B4)', async () => {
    const engine = await bootEngine();
    await seedAll(engine);
    const manager = new AuthManager({ secret: SECRET, baseUrl: 'http://localhost:3000', dataEngine: engine as never } as never);
    const rows = await (manager as never as { findPermissionSetRows: Function }).findPermissionSetRows('member_default');
    expectBareArray(rows, 'B4 via findPermissionSetRows');
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('ps_1');
  });
});

/**
 * ## The fifteenth block: #15092's DROP shape, fixed in the OPPOSITE direction
 *
 * `settleSelfRegistrationGrant` filtered its permission-set candidates with
 * `r?.active !== false && typeof r?.id === 'string' && r.id`. The first clause
 * is a selection predicate and stays. The second silently DROPPED a malformed
 * row, and these cases pin why that is the opposite defect from a dead limb:
 * the branch is reachable, and its old behaviour was wrong in two ways that
 * both looked normal from outside.
 */
describe('#15597 — settleSelfRegistrationGrant refuses on a malformed row instead of dropping it', () => {
  const USER = { id: 'usr_new', name: 'New Person', email: 'new@corp.example' };

  async function settle(
    engine: ObjectQL,
    setName: string,
    lines: string[],
    /**
     * The organization `settleSelfRegistrationGrant` resolves, read the way the
     * method itself reads it — `this.config.getTenancy?.()` then `defaultOrgId()`.
     * Omitted, nothing resolves and `organizationId` stays null; supplied, the
     * org-scoped arm of the row selection is the one that runs.
     */
    orgId?: string,
  ): Promise<void> {
    const manager = new AuthManager({
      secret: SECRET,
      baseUrl: 'http://localhost:3000',
      dataEngine: engine as never,
      ...(orgId ? { getTenancy: () => ({ defaultOrgId: async () => orgId }) } : {}),
      logger: { error: (m: string) => lines.push(String(m)), warn: (m: string) => lines.push(String(m)), info: () => {} },
    } as never);
    (manager as never as { stageSelfRegistrationGrant: Function }).stageSelfRegistrationGrant(USER.email, setName);
    await (manager as never as { settleSelfRegistrationGrant: Function }).settleSelfRegistrationGrant(USER);
  }

  const grants = (engine: ObjectQL): Promise<unknown[]> =>
    engine.find('sys_user_permission_set', { limit: 100 }, SYSTEM) as Promise<unknown[]>;

  it('a WELL-FORMED family still grants — the fix costs the happy path nothing', async () => {
    const engine = await bootEngine();
    await engine.insert('sys_user', USER, SYSTEM);
    await engine.insert('sys_permission_set', { id: 'ps_ok', name: 'portal_user', label: 'Portal' }, SYSTEM);

    const lines: string[] = [];
    await settle(engine, 'portal_user', lines);

    const rows = await grants(engine);
    expect(rows.length).toBe(1);
    expect((rows[0] as { permission_set_id: string }).permission_set_id).toBe('ps_ok');
  });

  it('a MALFORMED sole row is refused and NAMED — not reported as "no row named X resolves"', async () => {
    const engine = await bootEngine();
    await engine.insert('sys_user', USER, SYSTEM);
    // Active, named exactly right, and present — only its id is unusable.
    await engine.insert('sys_permission_set', { id: '', name: 'portal_user', label: 'Portal' }, SYSTEM);

    const lines: string[] = [];
    await settle(engine, 'portal_user', lines);

    expect(await grants(engine)).toEqual([]);
    const report = lines.join('\n');
    // The cause names the real fact. Before the fix the row was dropped and
    // this said "no active sys_permission_set row named 'portal_user'
    // resolves" — false, and it sends an operator to look for a missing row.
    expect(report, `nothing reported; logged: ${JSON.stringify(lines)}`).toContain('no usable id');
    expect(report).not.toContain('resolves for organization');
  });

  it('⭐ the wrong-GRANT case: a malformed ORG row no longer silently falls through to the GLOBAL set', async () => {
    // This is the case that makes the direction matter rather than being
    // cosmetic. Two rows carry the declared name: the organization's own row
    // (malformed id) and a global one (well-formed). The old trailing filter
    // dropped the org row, `rows.find((r) => r.organization_id == null)` then
    // matched the GLOBAL row, and the self-registrant was granted a permission
    // set their organization never declared — silently, with a success log.
    //
    // The organization is RESOLVED here (`getTenancy`), which is the shape that
    // actually bit and the reason this case does not lean on its sibling: with
    // an org in hand the wrong grant is not merely "some global row", it is
    // `ps_global` STAMPED `organization_id: 'org_1'` — the write spreads the
    // resolved org onto the row — so the store ends up asserting that org_1
    // granted a set org_1 never declared. Asserted by column below, not just by
    // row count, so the stamp itself is pinned.
    const engine = await bootEngine();
    await engine.insert('sys_user', USER, SYSTEM);
    await engine.insert('sys_organization', { id: 'org_1', name: 'Default', slug: 'default' }, SYSTEM);
    await engine.insert('sys_permission_set', { id: '', name: 'portal_user', label: 'Org scoped', organization_id: 'org_1' }, SYSTEM);
    await engine.insert('sys_permission_set', { id: 'ps_global', name: 'portal_user', label: 'Global' }, SYSTEM);

    const lines: string[] = [];
    await settle(engine, 'portal_user', lines, 'org_1');

    // Reverse-verified by ablation (recorded because the pre-fix behaviour is
    // the whole argument): with the old trailing filter restored and nothing
    // else changed, this case goes red with a granted row —
    // `permission_set_id: 'ps_global'`, `organization_id: null` — i.e. the
    // self-registrant really was handed the global set. The sibling case above
    // goes red at the same time with `Cause: no active sys_permission_set row
    // named 'portal_user' resolves`, which is the false cause. The other two
    // cases in this describe stay GREEN under that ablation, by design: they
    // are the no-regression and boundary guards, not the discriminators.
    // Refused, and in particular NOT granted the global set.
    const rows = await grants(engine);
    expect(rows, `granted anyway: ${JSON.stringify(rows)}`).toEqual([]);
    // The specific wrong write, named: no row may claim org_1 granted ps_global.
    expect(
      rows.some(
        (r) =>
          (r as { permission_set_id?: unknown }).permission_set_id === 'ps_global' &&
          (r as { organization_id?: unknown }).organization_id === 'org_1',
      ),
      'ps_global was granted STAMPED with org_1 — the organization is now recorded as having granted a set it never declared',
    ).toBe(false);
    expect(lines.join('\n')).toContain('no usable id');
  });

  it('a DEACTIVATED row is still an ordinary non-resolution, not a malformed-row refusal', async () => {
    // The `active !== false` clause is a selection predicate and stays one:
    // deactivating a set must keep reporting "does not resolve", not start
    // reporting a malformed row. This is the boundary between the two clauses.
    const engine = await bootEngine();
    await engine.insert('sys_user', USER, SYSTEM);
    await engine.insert('sys_permission_set', { id: 'ps_off', name: 'portal_user', label: 'Portal', active: false }, SYSTEM);

    const lines: string[] = [];
    await settle(engine, 'portal_user', lines);

    expect(await grants(engine)).toEqual([]);
    const report = lines.join('\n');
    expect(report).toContain("no active sys_permission_set row named 'portal_user'");
    expect(report).not.toContain('no usable id');
  });
});
