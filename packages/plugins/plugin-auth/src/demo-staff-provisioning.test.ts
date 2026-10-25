// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25777 — the stack's `demoStaff`, provisioned by a real development boot.
 *
 * ## The composition
 *
 * The one the development admin seed is pinned on
 * (`dev-admin-seed-workspace-timezone.test.ts`): a real `ObjectKernel`, a real
 * ObjectQL engine on in-memory SQLite, the real `AuthPlugin` (the seed, the
 * `single` posture's Default Organization, and now the demo accounts) and the
 * real `SecurityPlugin` (first-user promotion — the hazard the prior-login gate
 * exists for — and the `sys_user_position` / `sys_user_permission_set`
 * objects the assignments land in). `NODE_ENV=development` arms the boot the
 * way `os dev` does.
 *
 * ## What each case reads
 *
 * The boot step's own answer, captured off the `kernel:ready` hook that ran
 * it (a spy on `maybeProvisionDemoStaff` that calls through), plus the rows it
 * left: accounts that can sign in, their membership, their assignments, and
 * who holds the platform-admin grant. A refusal is asserted by its ADR-0112
 * `code` and `status`, and by the rows it did NOT write.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AuthPlugin, type DemoStaffingService } from './auth-plugin.js';
import type { AuthManager } from './auth-manager.js';
import type { DemoStaffOutcome, DemoStaffRefusal } from './demo-staff.js';

const SYS = { isSystem: true } as const;
const BASE = 'http://localhost:3000';
const SECRET = 'test-secret-at-least-32-chars-long-25777';
const SEED_EMAIL = 'admin@objectos.ai';
const SEED_PASSWORD = 'admin123';

const STAFF = [
  {
    name: 'Legal Counsel 1',
    email: 'counsel1@legal.example',
    position: 'legal_counsel',
    permissionSets: ['legal_counsel_access'],
  },
  { name: 'Paralegal 1', email: 'Para1@Legal.example', permissionSets: ['legal_counsel_access'] },
];

const ENV_KEYS = [
  'NODE_ENV',
  'OS_SEED_ADMIN',
  'OS_SEED_ADMIN_EMAIL',
  'OS_SEED_ADMIN_PASSWORD',
  'OS_SEED_ADMIN_NAME',
  'OS_MIGRATE_AND_EXIT',
  'OS_TENANCY_POSTURE',
  'OS_MULTI_ORG_ENABLED',
  'OS_PLATFORM_OWNER_EMAIL',
] as const;

function sqliteDriverPlugin(): Plugin {
  return {
    name: 'test.driver.sqlite',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      );
    },
  };
}

type StaffingAnswer = DemoStaffRefusal | DemoStaffOutcome | undefined;

describe('the development boot provisions the stack`s demo accounts (#25777)', () => {
  let kernel: ObjectKernel | undefined;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.NODE_ENV = 'development';
  });

  afterEach(async () => {
    try {
      await kernel?.shutdown();
    } catch {
      /* a refused boot leaves the kernel stopped */
    }
    kernel = undefined;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  async function boot(options: { baseUrl?: string } = {}) {
    const step = vi.spyOn(
      AuthPlugin.prototype as unknown as { maybeProvisionDemoStaff(ctx: PluginContext): Promise<StaffingAnswer> },
      'maybeProvisionDemoStaff',
    );
    const auth = new AuthPlugin({ secret: SECRET, baseUrl: options.baseUrl ?? BASE, demoStaff: STAFF });
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(sqliteDriverPlugin());
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(auth);
    await kernel.use(new SecurityPlugin());
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    const manager = kernel.getService<AuthManager>('auth');
    const staffing = kernel.getService<DemoStaffingService>('demo-staff');

    expect(step, 'the kernel:ready hook must have run the step exactly once').toHaveBeenCalledTimes(1);
    const answer = (await step.mock.results[0]!.value) as StaffingAnswer;

    const rows = async (object: string, where: Record<string, unknown> = {}) =>
      (await ql.find(object, { where, limit: 200, context: SYS })) as Array<Record<string, any>>;
    const userId = async (email: string) => (await rows('sys_user', { email }))[0]?.id as string | undefined;
    const signIn = (email: string, password: string) =>
      manager.handleRequest(
        new Request(`${BASE}/api/v1/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: BASE },
          body: JSON.stringify({ email, password }),
        }),
      );
    /** Run the boot step again, as the next boot against this database runs it. */
    const rerun = () =>
      (auth as unknown as { maybeProvisionDemoStaff(ctx: PluginContext): Promise<StaffingAnswer> })
        .maybeProvisionDemoStaff({
          getService: (name: string) => kernel!.getService(name),
          logger: { info() {}, warn() {}, error() {}, debug() {} },
        } as unknown as PluginContext);

    return { ql, staffing, answer, rows, userId, signIn, rerun };
  }

  it('1. a fresh dev database: every entry can sign in, in the Default Organization, with its position and sets', async () => {
    const { staffing, answer, rows, userId, signIn } = await boot();

    expect(staffing.armed, 'init() must have published the armed verdict the app seed waits on').toBe(true);
    expect(answer).toMatchObject({
      created: ['counsel1@legal.example', 'para1@legal.example'],
      present: [],
      failed: [],
      assignmentsAdded: 3,
    });

    const org = (await rows('sys_organization', { slug: 'default' }))[0];
    expect(org?.id, 'the single posture boots with a Default Organization').toBeTruthy();

    for (const entry of STAFF) {
      const email = entry.email.toLowerCase();
      const user = (await rows('sys_user', { email }))[0];
      expect(user, `${email} must exist`).toBeTruthy();
      expect(user!.name).toBe(entry.name);
      expect(user!.email_verified, `${email} must be born verified`).toBeTruthy();
      expect((await rows('sys_account', { user_id: user!.id })).map((a) => a.provider_id)).toEqual(['credential']);
      expect((await rows('sys_member', { user_id: user!.id })).map((m) => m.organization_id)).toEqual([org!.id]);

      // The development seed password is the one every demo account signs in with.
      const res = await signIn(email, SEED_PASSWORD);
      expect(res.status, `sign-in for ${email} failed: ${await res.clone().text()}`).toBeLessThan(300);
    }

    const counsel = await userId('counsel1@legal.example');
    expect((await rows('sys_user_position', { user_id: counsel })).map((r) => [r.position, r.organization_id])).toEqual([
      ['legal_counsel', org!.id],
    ]);
    expect(
      (await rows('sys_user_permission_set', { user_id: counsel }))
        .filter((r) => r.permission_set === 'legal_counsel_access')
        .map((r) => r.organization_id),
    ).toEqual([org!.id]);
  }, 30_000);

  it('2. the development admin is the platform admin, and no demo account is', async () => {
    const { rows, userId } = await boot();
    const holders = (await rows('sys_user_permission_set', { permission_set: 'admin_full_access' })).map((r) => r.user_id);
    expect(holders).toEqual([await userId(SEED_EMAIL)]);
  }, 30_000);

  it('3. idempotent: the next boot creates nothing, adds nothing, and leaves every credential as it was', async () => {
    const { rows, rerun } = await boot();
    const accountsBefore = await rows('sys_account');
    const positionsBefore = await rows('sys_user_position');
    const setsBefore = await rows('sys_user_permission_set');

    expect(await rerun()).toMatchObject({
      created: [],
      present: ['counsel1@legal.example', 'para1@legal.example'],
      failed: [],
      assignmentsAdded: 0,
    });
    expect(await rows('sys_account')).toEqual(accountsBefore);
    expect(await rows('sys_user_position')).toEqual(positionsBefore);
    expect(await rows('sys_user_permission_set')).toEqual(setsBefore);
  }, 30_000);

  it('4. an existing account is never touched, and only its missing assignments are added', async () => {
    const { ql, rows, userId, rerun } = await boot();
    const counsel = await userId('counsel1@legal.example');
    const position = (await rows('sys_user_position', { user_id: counsel }))[0]!;
    await ql.delete('sys_user_position', { where: { id: position.id }, context: SYS } as never);
    await ql.update('sys_user', { id: counsel, name: 'Renamed by the developer' }, { context: SYS } as never);

    expect(await rerun()).toMatchObject({ created: [], assignmentsAdded: 1 });
    expect((await rows('sys_user', { id: counsel }))[0]!.name).toBe('Renamed by the developer');
    expect((await rows('sys_user_position', { user_id: counsel })).map((r) => r.position)).toEqual(['legal_counsel']);
  }, 30_000);

  it('5. production refuses — PERMISSION_DENIED 403 — and no demo account exists', async () => {
    process.env.NODE_ENV = 'production';
    const { staffing, answer, rows } = await boot();
    expect(staffing.armed).toBe(false);
    expect(answer).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, reason: 'not-development' });
    expect(await rows('sys_user', { email: { $in: ['counsel1@legal.example', 'para1@legal.example'] } })).toEqual([]);
  }, 30_000);

  it('6. a development server published at a reachable address refuses — PERMISSION_DENIED 403', async () => {
    const { staffing, answer, rows } = await boot({ baseUrl: 'https://legal-demo.example.com' });
    expect(staffing.armed).toBe(false);
    expect(answer).toMatchObject({ code: 'PERMISSION_DENIED', status: 403, reason: 'non-loopback-base-url' });
    expect(await rows('sys_user', { email: 'counsel1@legal.example' })).toEqual([]);
  }, 30_000);

  it('7. with the admin seed off, a fresh database refuses — PRECONDITION_REQUIRED 428 — so no demo account is promoted', async () => {
    process.env.OS_SEED_ADMIN = '0';
    const { answer, rows } = await boot();
    expect(answer).toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428, reason: 'no-prior-login' });
    expect(await rows('sys_account')).toEqual([]);
    expect(await rows('sys_user_permission_set', { permission_set: 'admin_full_access' })).toEqual([]);
  }, 30_000);
});
